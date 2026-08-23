export interface SharePayload {
  facilityId: string;
  timeRange: string;
  expiresAt: number;
  permissions: "read-only";
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function toBase64Url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64url");
}

function fromBase64Url(value: string): Uint8Array {
  return new Uint8Array(Buffer.from(value, "base64url"));
}

async function deriveKey(serverSecret: string): Promise<CryptoKey> {
  const secret = await crypto.subtle.digest("SHA-256", encoder.encode(serverSecret));
  return crypto.subtle.importKey("raw", secret, "AES-GCM", false, ["encrypt", "decrypt"]);
}

export async function generateToken(payload: SharePayload, serverSecret: string): Promise<string> {
  const identifier = crypto.getRandomValues(new Uint8Array(32));
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(serverSecret);
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: nonce },
    key,
    encoder.encode(JSON.stringify(payload)),
  );

  return [toBase64Url(identifier), toBase64Url(nonce), toBase64Url(new Uint8Array(ciphertext as ArrayBuffer))].join(".");
}

export async function parseToken(token: string, serverSecret: string): Promise<SharePayload | null> {
  try {
    const [identifier, nonce, ciphertext] = token.split(".");
    if (!identifier || !nonce || !ciphertext || fromBase64Url(identifier).length !== 32) return null;

    const key = await deriveKey(serverSecret);
    const plaintext = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: fromBase64Url(nonce) as unknown as BufferSource },
      key,
      fromBase64Url(ciphertext) as unknown as BufferSource,
    );
    const payload = JSON.parse(decoder.decode(plaintext)) as SharePayload;
    if (
      typeof payload.facilityId !== "string" ||
      typeof payload.timeRange !== "string" ||
      payload.permissions !== "read-only" ||
      !Number.isFinite(payload.expiresAt) ||
      payload.expiresAt <= Date.now()
    ) return null;

    return payload;
  } catch {
    return null;
  }
}

export function getShareSecret(): string {
  const secret = process.env.SHARE_LINK_SECRET;
  if (!secret && process.env.NODE_ENV === "production") {
    throw new Error("SHARE_LINK_SECRET must be configured in production");
  }
  return secret ?? "lumina-development-share-secret";
}

export function getTokenIdentifier(token: string): string | null {
  const identifier = token.split(".")[0];
  if (!identifier) return null;
  try {
    return toBase64Url(fromBase64Url(identifier));
  } catch {
    return null;
  }
}