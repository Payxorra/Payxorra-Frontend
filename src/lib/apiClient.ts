"use client";

import axios, { type AxiosError } from "axios";

const baseURL = process.env.NEXT_PUBLIC_API_BASE_URL ?? "/api";

/**
 * Shared HTTP client for backend calls. `withCredentials` is required so the
 * browser attaches/accepts the httpOnly session + refresh cookies that the
 * auth endpoints set via `Set-Cookie` (the app never reads those cookies
 * directly — they are not visible to JS by design).
 */
export const apiClient = axios.create({
  baseURL,
  withCredentials: true,
  headers: { "Content-Type": "application/json" },
});

export function isApiError(err: unknown): err is AxiosError {
  return axios.isAxiosError(err);
}

interface ApiErrorBody {
  message?: string;
  code?: string;
}

/** Best-effort human readable message extraction from a failed request. */
export function apiErrorMessage(err: unknown, fallback = "Request failed"): string {
  if (isApiError(err)) {
    const body = err.response?.data as ApiErrorBody | undefined;
    return body?.message ?? err.message ?? fallback;
  }
  return err instanceof Error ? err.message : fallback;
}

/** Machine-readable error code, when the backend supplies one. */
export function apiErrorCode(err: unknown): string | undefined {
  if (isApiError(err)) {
    return (err.response?.data as ApiErrorBody | undefined)?.code;
  }
  return undefined;
}
