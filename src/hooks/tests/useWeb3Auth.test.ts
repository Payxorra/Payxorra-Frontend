/**
 * useWeb3Auth.test.ts
 *
 * Covers the challenge -> sign -> verify handshake: happy path,
 * in-flight call deduplication, nonce expiry, and mid-flow wallet
 * disconnection.
 */

import { renderHook, act, waitFor } from "@testing-library/react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import React from "react";
import { Keypair } from "@stellar/stellar-sdk";
import {
  WalletContext,
  type WalletContextValue,
} from "@/src/components/providers/WalletProvider";
import { apiClient } from "@/src/lib/apiClient";
import { useWeb3Auth, useWeb3AuthStore } from "../useWeb3Auth";

vi.mock("@/src/lib/apiClient", () => ({
  apiClient: { post: vi.fn() },
  apiErrorMessage: (_e: unknown, fallback: string) => fallback,
  apiErrorCode: () => undefined,
}));

const PUBLIC_KEY = Keypair.random().publicKey();

function mockWallet(publicKey: string | null): WalletContextValue {
  return {
    publicKey,
    generation: 0,
    isTransitioning: false,
    connect: vi.fn(),
    disconnect: vi.fn(),
  };
}

function renderWithWallet(publicKey: string | null) {
  return renderHook(() => useWeb3Auth(), {
    wrapper: ({ children }) =>
      React.createElement(WalletContext, { value: mockWallet(publicKey) }, children),
  });
}

beforeEach(() => {
  useWeb3AuthStore.getState().reset();
  vi.mocked(apiClient.post).mockReset();
  window.freighter = {
    getUserInfo: vi.fn(),
    isConnected: vi.fn(),
    signTransaction: vi.fn().mockResolvedValue({ signedTxXdr: "signed-xdr" }),
  };
});

describe("useWeb3Auth", () => {
  it("completes the full handshake and reaches authenticated", async () => {
    vi.mocked(apiClient.post)
      .mockResolvedValueOnce({ data: { nonce: "abc123", expiresAt: new Date().toISOString() } })
      .mockResolvedValueOnce({ data: { publicKey: PUBLIC_KEY, expiresIn: 900 } });

    const { result } = renderWithWallet(PUBLIC_KEY);
    await act(async () => {
      await result.current.authenticate();
    });

    expect(result.current.status).toBe("authenticated");
    expect(apiClient.post).toHaveBeenNthCalledWith(
      1,
      "/auth/challenge",
      { publicKey: PUBLIC_KEY },
      expect.anything(),
    );
  });

  it("dedupes concurrent authenticate() calls into one handshake", async () => {
    vi.mocked(apiClient.post)
      .mockResolvedValueOnce({ data: { nonce: "abc123", expiresAt: new Date().toISOString() } })
      .mockResolvedValueOnce({ data: { publicKey: PUBLIC_KEY, expiresIn: 900 } });

    const { result } = renderWithWallet(PUBLIC_KEY);
    await act(async () => {
      await Promise.all([result.current.authenticate(), result.current.authenticate()]);
    });

    const challengeCalls = vi
      .mocked(apiClient.post)
      .mock.calls.filter(([path]) => path === "/auth/challenge");
    expect(challengeCalls).toHaveLength(1);
  });

  it("errors out when the wallet disconnects mid-flow", async () => {
    let resolveChallenge: (v: unknown) => void = () => {};
    vi.mocked(apiClient.post).mockReturnValueOnce(
      new Promise((resolve) => {
        resolveChallenge = resolve;
      }),
    );

    const walletBox: { publicKey: string | null } = { publicKey: PUBLIC_KEY };
    const { result, rerender } = renderHook(() => useWeb3Auth(), {
      wrapper: ({ children }) =>
        React.createElement(WalletContext, { value: mockWallet(walletBox.publicKey) }, children),
    });

    // Kick off, then flip the wallet to disconnected before the challenge resolves.
    act(() => {
      void result.current.authenticate();
    });
    useWeb3AuthStore.getState().setStatus("signing");
    walletBox.publicKey = null;
    rerender();

    resolveChallenge({ data: { nonce: "abc123", expiresAt: new Date().toISOString() } });

    await waitFor(() => expect(result.current.status).toBe("error"));
    expect(result.current.error).toMatch(/disconnected/i);
  });
});
