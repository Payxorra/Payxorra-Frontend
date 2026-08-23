"use client";

import { create } from "zustand";
import type { BridgeTransaction, BridgeRoute, BridgeStatus, ChainId } from "./types";

export const STATUS_ORDER: BridgeStatus[] = [
  "Initiated",
  "SourceConfirmed",
  "BridgeRelayed",
  "DestinationPending",
  "DestinationConfirmed",
  "Complete",
];

const STATUS_TIMESTAMPS = [
  "initiatedAt",
  "sourceConfirmedAt",
  "bridgeRelayedAt",
  "destinationPendingAt",
  "destinationConfirmedAt",
  "completedAt",
] as const;

function getNextStatus(current: BridgeStatus): BridgeStatus | null {
  const idx = STATUS_ORDER.indexOf(current);
  if (idx === -1 || idx === STATUS_ORDER.length - 1) return null;
  return STATUS_ORDER[idx + 1];
}

function getStatusTimestampField(status: BridgeStatus): string | null {
  const idx = STATUS_ORDER.indexOf(status);
  if (idx === -1) return null;
  return STATUS_TIMESTAMPS[idx] ?? null;
}

export interface BridgeState {
  transactions: Record<string, BridgeTransaction>
  routes: BridgeRoute[]

  addTransaction: (tx: BridgeTransaction) => void
  updateStatus: (id: string, status: BridgeStatus, overrides?: Partial<BridgeTransaction>) => void
  advanceStatus: (id: string, overrides?: Partial<BridgeTransaction>) => void
  markFailed: (id: string, reason: string, action: "retry" | "contact_support") => void
  removeTransaction: (id: string) => void
  getTransaction: (id: string) => BridgeTransaction | undefined
  getTransactionsByStatus: (status: BridgeStatus) => BridgeTransaction[]
  getTransactionsByChain: (chainId: ChainId) => BridgeTransaction[]
  setRoutes: (routes: BridgeRoute[]) => void
}

export const useBridgeStore = create<BridgeState>((set, get) => ({
  transactions: {},
  routes: [],

  addTransaction: (tx: BridgeTransaction) => {
    set((state) => ({
      transactions: { ...state.transactions, [tx.id]: tx },
    }));
  },

  updateStatus: (id: string, status: BridgeStatus, overrides?: Partial<BridgeTransaction>) => {
    set((state) => {
      const existing = state.transactions[id];
      if (!existing) return state;

      const timestampField = getStatusTimestampField(status);
      const now = Date.now();

      const timestampUpdate = timestampField ? { [timestampField]: now } : {};

      return {
        transactions: {
          ...state.transactions,
          [id]: {
            ...existing,
            ...timestampUpdate,
            status,
            ...overrides,
          },
        },
      };
    });
  },

  advanceStatus: (id: string, overrides?: Partial<BridgeTransaction>) => {
    const state = get();
    const tx = state.transactions[id];
    if (!tx || tx.status === "Failed") return;

    const next = getNextStatus(tx.status);
    if (!next) return;
    state.updateStatus(id, next, overrides);
  },

  markFailed: (id: string, reason: string, action: "retry" | "contact_support") => {
    set((state) => {
      const existing = state.transactions[id];
      if (!existing) return state;

      return {
        transactions: {
          ...state.transactions,
          [id]: {
            ...existing,
            status: "Failed",
            errorReason: reason,
            recommendedAction: action,
            failedAt: Date.now(),
          },
        },
      };
    });
  },

  removeTransaction: (id: string) => {
    set((state) => {
      const { [id]: _, ...rest } = state.transactions; // eslint-disable-line @typescript-eslint/no-unused-vars
      return { transactions: rest };
    });
  },

  getTransaction: (id: string) => {
    return get().transactions[id];
  },

  getTransactionsByStatus: (status: BridgeStatus) => {
    return Object.values(get().transactions).filter((tx) => tx.status === status);
  },

  getTransactionsByChain: (chainId: ChainId) => {
    return Object.values(get().transactions).filter(
      (tx) => tx.sourceChain === chainId || tx.destinationChain === chainId,
    );
  },

  setRoutes: (routes: BridgeRoute[]) => {
    set({ routes });
  },
}));
