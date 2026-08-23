/// <reference lib="webworker" />
import { defaultCache } from "@serwist/next/worker";
import type { PrecacheEntry, SerwistGlobalConfig } from "serwist";
import {
  CacheFirst,
  ExpirationPlugin,
  NetworkFirst,
  Serwist,
} from "serwist";

interface FilePickerAcceptType {
  description?: string;
  accept: Record<string, string[]>;
}

interface SaveFilePickerOptions { // eslint-disable-line @typescript-eslint/no-unused-vars
  suggestedName?: string;
  types?: FilePickerAcceptType[];
  excludeAcceptAllOption?: boolean;
  id?: string;
  startIn?: FileSystemHandle | string;
}

interface FileSystemHandlePermissionDescriptor { // eslint-disable-line @typescript-eslint/no-unused-vars
  name: 'file' | 'directory';
  mode?: 'read' | 'readwrite';
}

interface FileSystemCreateWritableOptions {
  keepExistingData?: boolean;
}

interface FileSystemWritableFileStream extends WritableStream {
  write(data: unknown): Promise<void>;
  seek(position: number): Promise<void>;
  truncate(size: number): Promise<void>;
  close(): Promise<void>;
}

interface FileSystemFileHandle extends FileSystemHandle { // eslint-disable-line @typescript-eslint/no-unused-vars
  getFile(): Promise<File>;
  createWritable(options?: FileSystemCreateWritableOptions): Promise<FileSystemWritableFileStream>;
}

declare global {
  interface WorkerGlobalScope extends SerwistGlobalConfig {
    __SW_MANIFEST: (PrecacheEntry | string)[] | undefined;
  }
}

declare const self: ServiceWorkerGlobalScope &
  SerwistGlobalConfig & {
    __SW_MANIFEST: (PrecacheEntry | string)[] | undefined;
  };

const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST,
  skipWaiting: true,
  clientsClaim: true,
  navigationPreload: true,
  fallbacks: {
    entries: [
      {
        url: "/offline",
        matcher({ request }) {
          return request.destination === "document";
        },
      },
    ],
  },
  runtimeCaching: [
    {
      matcher: ({ url }) => url.pathname.startsWith("/api/telemetry/"),
      handler: new NetworkFirst({
        cacheName: "lumina-telemetry",
        networkTimeoutSeconds: 5,
        plugins: [
          {
            cacheWillUpdate: async ({ response }) => {
              if (response && response.status === 200) {
                return response;
              }
              return null;
            },
          },
        ],
      }),
    },
    {
      matcher: ({ url }) => url.pathname.startsWith("/api/"),
      handler: new NetworkFirst({
        cacheName: "lumina-api",
        networkTimeoutSeconds: 4,
        plugins: [
          new ExpirationPlugin({
            maxEntries: 32,
            maxAgeSeconds: 60 * 60 * 24,
            purgeOnQuotaError: true,
          }),
        ],
      }),
    },
    {
      matcher: ({ url }) =>
        url.pathname.startsWith("/icons/") ||
        url.pathname.startsWith("/favicon"),
      handler: new CacheFirst({
        cacheName: "lumina-icons",
        plugins: [
          new ExpirationPlugin({
            maxEntries: 32,
            maxAgeSeconds: 60 * 60 * 24 * 30,
            purgeOnQuotaError: true,
          }),
        ],
      }),
    },
    ...defaultCache,
  ],
});

serwist.addEventListeners();

let activeFileStream: FileSystemWritableFileStream | null = null;
let abortController: AbortController | null = null;

self.addEventListener('fetch', (event) => {
  const { request } = event;
  
  if (request.headers.get('X-Stream-Export') === 'true') {
    event.respondWith(handleStreamExport(request, event.clientId));
  }
});

self.addEventListener('message', async (event) => {
  const { type } = event.data;
  
  if (type === 'abort-export') {
    if (abortController) {
      abortController.abort();
    }
    if (activeFileStream) {
      try {
        await activeFileStream.abort();
      } catch (e) {
        console.error('Error aborting file stream:', e);
      }
    }
  }
});

async function handleStreamExport(request: Request, clientId: string) {
  try {
    abortController = new AbortController();
    const response = await fetch(request, { signal: abortController.signal });
    
    if (!response.ok) {
      return new Response('Export failed', { status: response.status });
    }

    const contentEncoding = response.headers.get('Content-Encoding');
    let readableStream = response.body;
    
    if (contentEncoding === 'gzip' && readableStream) {
      const decompressionStream = new DecompressionStream('gzip');
      readableStream = readableStream.pipeThrough(decompressionStream);
    }

    const client = await self.clients.get(clientId);
    if (!client) {
      return new Response('Client not found', { status: 400 });
    }

    const messageChannel = new MessageChannel();
    const { port1, port2 } = messageChannel;
    const CHUNK_SIZE = 64 * 1024;
    const PROGRESS_THRESHOLD = 1024 * 1024;
    
    let bytesReceived = 0;
    let bytesWritten = 0;
    let buffer = new Uint8Array(0);
    let lastProgressEmittedAt = 0;

    port2.onmessage = async (msg) => {
      if (msg.data.type === 'init-file-stream' && msg.data.fileHandle) {
        activeFileStream = await msg.data.fileHandle.createWritable();
        
        const reader = readableStream?.getReader();
        if (!reader) return;

        try {
          while (true) {
            const { done, value } = await reader.read();
            
            if (done) {
              if (buffer.length > 0 && activeFileStream) {
                await activeFileStream.write(buffer);
                bytesWritten += buffer.length;
              }
              if (activeFileStream) {
                await activeFileStream.close();
              }
              client.postMessage({ type: 'export-complete', bytesWritten });
              break;
            }

            if (value) {
              bytesReceived += value.length;
              
              const newBuffer = new Uint8Array(buffer.length + value.length);
              newBuffer.set(buffer);
              newBuffer.set(value, buffer.length);
              buffer = newBuffer;
              
              while (buffer.length >= CHUNK_SIZE && activeFileStream) {
                const chunk = buffer.slice(0, CHUNK_SIZE);
                await activeFileStream.write(chunk);
                bytesWritten += CHUNK_SIZE;
                buffer = buffer.slice(CHUNK_SIZE);
              }
              
              if (bytesReceived - lastProgressEmittedAt >= PROGRESS_THRESHOLD) {
                client.postMessage({ 
                  type: 'progress', 
                  bytesReceived, 
                  bytesWritten 
                });
                lastProgressEmittedAt = bytesReceived;
              }
            }
          }
        } catch (error) {
          if (error instanceof Error && error.name === 'AbortError') {
            client.postMessage({ type: 'export-aborted' });
          } else {
            client.postMessage({ type: 'export-error', error });
          }
        }
      }
    };

    client.postMessage({ type: 'request-file-handle' }, [port1]);
    
    return new Response('Export initiated', { status: 200 });
  } catch (error) {
    console.error('Stream export error:', error);
    return new Response('Export failed', { status: 500 });
  }
}
