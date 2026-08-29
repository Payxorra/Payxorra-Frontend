"use client";

import { useCallback, useContext, useEffect, useRef } from "react";
import { create } from "zustand";
import {
  Account,
  BASE_FEE,
  Networks,
  Operation,
  TransactionBuilder,
} from "@stellar/stellar-sdk";
import { WalletContext } from "@/src/components/providers/WalletProvider";
import { apiClient, apiErrorCode, apiErrorMessage } from "@/src/lib/apiClient";

/** Nonce lifetime enforced by the backend; the handshake must fit inside it. */
export const NONCE_TTL_MS = 120_000;

/** Refresh a bit before actual expiry to absorb clock drift + latency. */
const REFRESH_SAFETY_MARGIN_MS = 10_000;

export type AuthStatus =
  | "idle"
  | "requesting-challenge"
  | "signing"
  | "verifying"
  | "authenticated"
  | "error";

export class NonceExpiredError extends Error {
  constructor() {
    super("Authentication challenge expired before it could be verified");
    this.name = "NonceExpiredError";
  }
}

export class WalletDisconnectedError extends Error {
  constructor() {
    super("Wallet was disconnected before authentication completed");
    this.name = "WalletDisconnectedError";
  }
}

export class SignatureRejectedError extends Error {
  constructor() {
    super("Signature request was rejected in the wallet");
    this.name = "SignatureRejectedError";
  }
}

interface ChallengeResponse {
  nonce: string;
  expiresAt: string;
}

interface VerifyResponse {
  publicKey: string;
  expiresIn: number;
}

interface AuthStoreState {
  status: AuthStatus;
  publicKey: string | null;
  error: string | null;
  errorCode: string | null;
  setStatus: (status: AuthStatus) => void;
  setAuthenticated: (publicKey: string) => void;
  setError: (message: string, code?: string) => void;
  reset: () => void;
}

/**
 * Module-level store so every consumer (useWeb3Auth, useAuthState,
 * sessionWatcher wiring, …) shares one authoritative auth status.
 */
export const useWeb3AuthStore = create<AuthStoreState>((set) => ({
  status: "idle",
  publicKey: null,
  error: null,
  errorCode: null,
  setStatus: (status) => set({ status, error: null, errorCode: null }),
  setAuthenticated: (publicKey) =>
    set({ status: "authenticated", publicKey, error: null, errorCode: null }),
  setError: (message, code) =>
    set({ status: "error", error: message, errorCode: code ?? null }),
  reset: () => set({ status: "idle", publicKey: null, error: null, errorCode: null }),
}));

// Single in-flight handshake promise, shared across all hook instances so
// rapid/duplicate calls (double-clicks, effect re-fires) collapse into one.
let inFlightAuth: Promise<void> | null = null;
let refreshTimer: ReturnType<typeof setTimeout> | null = null;

function clearRefreshTimer(): void {
  if (refreshTimer !== null) {
    clearTimeout(refreshTimer);
    refreshTimer = null;
  }
}

/**
 * Builds a minimal, never-broadcast Stellar transaction envelope carrying
 * the nonce as a ManageData entry. Only its signature is checked server
 * side, so sequence number/timebounds only need to be internally valid.
 */
function buildChallengeEnvelope(publicKey: string, nonce: string): string {
  const networkPassphrase =
    process.env.NEXT_PUBLIC_STELLAR_NETWORK_PASSPHRASE ?? Networks.TESTNET;

  // Sequence "-1" is fine: this envelope is only ever signed and inspected,
  // never submitted to the network, so no real account sequence is needed.
  const account = new Account(publicKey, "-1");

  return new TransactionBuilder(account, { fee: BASE_FEE, networkPassphrase })
    .addOperation(
      Operation.manageData({
        name: "lumina-auth-nonce",
        value: nonce.slice(0, 64),
      }),
    )
    .setTimeout(Math.floor(NONCE_TTL_MS / 1000))
    .build()
    .toXDR();
}

function assertNotExpired(deadline: number): void {
  if (Date.now() > deadline) throw new NonceExpiredError();
}

async function requestChallenge(publicKey: string, signal: AbortSignal): Promise<ChallengeResponse> {
  const { data } = await apiClient.post<ChallengeResponse>(
    "/auth/challenge",
    { publicKey },
    { signal },
  );
  return data;
}

async function signChallenge(publicKey: string, nonce: string): Promise<string> {
  if (!window.freighter?.signTransaction) {
    throw new Error("Freighter wallet is not available");
  }

  const envelope = buildChallengeEnvelope(publicKey, nonce);
  try {
    const { signedTxXdr } = await window.freighter.signTransaction(envelope);
    return signedTxXdr;
  } catch {
    // Freighter rejects with a generic Error on user cancellation.
    throw new SignatureRejectedError();
  }
}

async function verifySignature(
  publicKey: string,
  signedTxXdr: string,
  signal: AbortSignal,
): Promise<VerifyResponse> {
  const { data } = await apiClient.post<VerifyResponse>(
    "/auth/verify",
    { publicKey, signedTxXdr },
    { signal },
  );
  return data;
}

/** Schedules the next silent refresh; each successful call reschedules itself. */
function scheduleSilentRefresh(expiresInSeconds: number, onLoggedOut: () => void): void {
  clearRefreshTimer();
  const delay = Math.max(expiresInSeconds * 1000 - REFRESH_SAFETY_MARGIN_MS, 1_000);

  refreshTimer = setTimeout(async () => {
    try {
      // Rotation: the backend issues a brand-new refresh cookie on every
      // successful call and invalidates the one that was just used.
      const { data } = await apiClient.post<VerifyResponse>("/auth/refresh");
      useWeb3AuthStore.getState().setAuthenticated(data.publicKey);
      scheduleSilentRefresh(data.expiresIn, onLoggedOut);
    } catch {
      clearRefreshTimer();
      useWeb3AuthStore.getState().reset();
      onLoggedOut();
    }
  }, delay);
}

export interface UseWeb3AuthOptions {
  /** Where to send the user after a session is fully invalidated. */
  redirectUrl?: string;
}

export interface UseWeb3AuthResult {
  status: AuthStatus;
  error: string | null;
  /** Runs the full challenge -> sign -> verify handshake. Deduplicated. */
  authenticate: () => Promise<void>;
}

export function useWeb3Auth(options: UseWeb3AuthOptions = {}): UseWeb3AuthResult {
  const { redirectUrl } = options;
  const wallet = useContext(WalletContext);
  const walletRef = useRef(wallet);
  walletRef.current = wallet;

  const status = useWeb3AuthStore((s) => s.status);
  const error = useWeb3AuthStore((s) => s.error);
  const abortRef = useRef<AbortController | null>(null);

  const handleLoggedOut = useCallback(() => {
    if (redirectUrl && typeof window !== "undefined") {
      window.location.assign(redirectUrl);
    }
  }, [redirectUrl]);

  const authenticate = useCallback((): Promise<void> => {
    if (inFlightAuth) return inFlightAuth; // dedupe concurrent triggers

    const store = useWeb3AuthStore.getState();
    const controller = new AbortController();
    abortRef.current = controller;

    const run = (async () => {
      const publicKey = walletRef.current?.publicKey;
      if (!publicKey) {
        store.setError("Connect a wallet before authenticating", "NO_WALLET");
        return;
      }

      const deadline = Date.now() + NONCE_TTL_MS;
      const checkAlive = () => {
        if (!walletRef.current?.publicKey) throw new WalletDisconnectedError();
        assertNotExpired(deadline);
      };

      try {
        store.setStatus("requesting-challenge");
        const challenge = await requestChallenge(publicKey, controller.signal);
        checkAlive();

        store.setStatus("signing");
        const signedTxXdr = await signChallenge(publicKey, challenge.nonce);
        checkAlive();

        store.setStatus("verifying");
        const result = await verifySignature(publicKey, signedTxXdr, controller.signal);

        store.setAuthenticated(result.publicKey);
        scheduleSilentRefresh(result.expiresIn, handleLoggedOut);
      } catch (err) {
        if (controller.signal.aborted) return;
        const message =
          err instanceof Error ? err.message : apiErrorMessage(err, "Authentication failed");
        store.setError(message, apiErrorCode(err));
      }
    })();

    inFlightAuth = run.finally(() => {
      inFlightAuth = null;
    });

    return inFlightAuth;
  }, [handleLoggedOut]);

  // Abort an in-progress handshake if the wallet disconnects mid-flow.
  useEffect(() => {
    if (wallet?.publicKey) return;
    if (status === "idle" || status === "error" || status === "authenticated") return;

    abortRef.current?.abort();
    useWeb3AuthStore.getState().setError(new WalletDisconnectedError().message, "WALLET_DISCONNECTED");
  }, [wallet?.publicKey, status]);

  useEffect(() => () => abortRef.current?.abort(), []);

  return { status, error, authenticate };
}
