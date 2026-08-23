import { useState, useRef, useCallback } from 'react';

type ExportStatus = 'idle' | 'initializing' | 'downloading' | 'complete' | 'error' | 'aborted';

interface ExportState {
  status: ExportStatus;
  progress: number;
  bytesReceived: number;
  bytesTotal: number | null;
  error: Error | null;
  usingFallback: boolean;
}

function triggerBlobDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function useExportData() {
  const [state, setState] = useState<ExportState>({
    status: 'idle',
    progress: 0,
    bytesReceived: 0,
    bytesTotal: null,
    error: null,
    usingFallback: false,
  });
  
  const swRegistrationRef = useRef<ServiceWorkerRegistration | null>(null);
  const messageChannelRef = useRef<MessageChannel | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const formatRef = useRef<'csv' | 'json'>('csv');

  const updateState = useCallback((updates: Partial<ExportState>) => {
    setState(prev => ({ ...prev, ...updates }));
  }, []);

  const handleServiceWorkerMessage = useCallback((event: MessageEvent) => {
    const { type, bytesReceived, bytesWritten, bytesTotal, error } = event.data; // eslint-disable-line @typescript-eslint/no-unused-vars

    switch (type) {
      case 'request-file-handle':
        (async () => {
          try {
            const fileHandle = await window.showSaveFilePicker({
              suggestedName: `node-telemetry-${Date.now()}.csv`,
              types: [
                {
                  description: 'CSV Files',
                  accept: { 'text/csv': ['.csv'] },
                },
                {
                  description: 'JSON Files',
                  accept: { 'application/json': ['.json'] },
                },
              ],
            });

            if (event.ports && event.ports[0]) {
              event.ports[0].postMessage({
                type: 'init-file-stream',
                fileHandle,
              });
            }
          } catch (err) {
            if (err instanceof Error && err.name === 'AbortError') {
              updateState({ status: 'aborted' });
            } else {
              updateState({ status: 'error', error: err as Error });
            }
          }
        })();
        break;

      case 'progress':
        const progress = state.bytesTotal ? Math.min(100, (bytesReceived / state.bytesTotal) * 100) : 0;
        updateState({
          status: 'downloading',
          progress,
          bytesReceived,
        });
        break;

      case 'export-complete':
        updateState({
          status: 'complete',
          progress: 100,
          bytesReceived: bytesWritten,
        });
        break;

      case 'export-aborted':
        updateState({ status: 'aborted' });
        break;

      case 'export-error':
        updateState({
          status: 'error',
          error: error || new Error('Unknown export error'),
        });
        break;
    }
  }, [state.bytesTotal, updateState]);

  const startExport = useCallback(async (url: string, options: { format: 'csv' | 'json'; startDate: Date; endDate: Date; bytesTotal?: number }) => {
    if (!('serviceWorker' in navigator)) {
      throw new Error('Service Workers are not supported in this browser');
    }

    updateState({
      status: 'initializing',
      progress: 0,
      bytesReceived: 0,
      bytesTotal: options.bytesTotal || null,
      error: null,
      usingFallback: false,
    });
    formatRef.current = options.format;
    chunksRef.current = [];

    try {
      // Check if File System Access API is available
      const hasFileSystemAccess = 'showSaveFilePicker' in window;
      
      if (!hasFileSystemAccess) {
        // Fallback: use traditional blob download
        updateState({ usingFallback: true, status: 'downloading' });
        
        abortControllerRef.current = new AbortController();
        
        const response = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            format: options.format,
            startDate: options.startDate.toISOString(),
            endDate: options.endDate.toISOString(),
          }),
          signal: abortControllerRef.current.signal,
        });

        if (!response.ok) {
          throw new Error(`Export failed with status: ${response.status}`);
        }

        const reader = response.body?.getReader();
        if (!reader) {
          throw new Error('Response body is not readable');
        }

        let received = 0;
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (value) {
            chunksRef.current.push(value);
            received += value.length;
            const progress = options.bytesTotal ? Math.min(100, (received / options.bytesTotal) * 100) : 0;
            updateState({ bytesReceived: received, progress });
          }
        }

        // Create blob and trigger download
        const blob = new Blob(chunksRef.current, {
          type: options.format === 'csv' ? 'text/csv' : 'application/json',
        });
        const filename = `node-telemetry-${Date.now()}.${options.format}`;
        triggerBlobDownload(blob, filename);
        
        updateState({ status: 'complete', progress: 100, bytesReceived: received });
      } else {
        // Use File System Access API via service worker
        const registration = await navigator.serviceWorker.ready;
        swRegistrationRef.current = registration;
        
        abortControllerRef.current = new AbortController();
        messageChannelRef.current = new MessageChannel();

        navigator.serviceWorker.addEventListener('message', handleServiceWorkerMessage);

        const response = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Stream-Export': 'true',
          },
          body: JSON.stringify({
            format: options.format,
            startDate: options.startDate.toISOString(),
            endDate: options.endDate.toISOString(),
          }),
          signal: abortControllerRef.current.signal,
        });

        if (!response.ok) {
          throw new Error(`Export failed with status: ${response.status}`);
        }
      }
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        updateState({ status: 'aborted' });
      } else {
        updateState({ status: 'error', error: error as Error });
      }
    }
  }, [updateState, handleServiceWorkerMessage]);

  const abort = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    if (swRegistrationRef.current?.active) {
      swRegistrationRef.current.active.postMessage({ type: 'abort-export' });
    }
    updateState({ status: 'aborted' });
  }, [updateState]);

  const reset = useCallback(() => {
    setState({
      status: 'idle',
      progress: 0,
      bytesReceived: 0,
      bytesTotal: null,
      error: null,
      usingFallback: false,
    });
    chunksRef.current = [];
  }, []);

  return {
    state,
    startExport,
    abort,
    reset,
  };
}
