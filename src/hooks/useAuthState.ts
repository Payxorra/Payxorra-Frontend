"use client";

import { useCallback } from "react";
import { apiClient } from "@/src/lib/apiClient";
import { useWeb3AuthStore, type AuthStatus } from "@/src/hooks/useWeb3Auth";

export interface UseAuthStateResult {
  publicKey: string | null;
  status: AuthStatus;
  isAuthenticated: boolean;
  logout: () => Promise<void>;
}

/**
 * Read-only view of the shared auth store, plus logout. Safe to use from
 * anywhere (nav bar, session watcher, etc.) without triggering a handshake.
 */
export function useAuthState(): UseAuthStateResult {
  const status = useWeb3AuthStore((s) => s.status);
  const publicKey = useWeb3AuthStore((s) => s.publicKey);
  const reset = useWeb3AuthStore((s) => s.reset);

  const logout = useCallback(async () => {
    try {
      // Backend clears both the session and refresh httpOnly cookies and
      // revokes the refresh token server-side.
      await apiClient.post("/auth/logout");
    } finally {
      reset();
    }
  }, [reset]);

  return {
    publicKey,
    status,
    isAuthenticated: status === "authenticated",
    logout,
  };
}
