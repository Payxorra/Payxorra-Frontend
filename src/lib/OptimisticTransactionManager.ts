"use client";

import { QueryClient } from "@tanstack/react-query";
import { generateIdempotencyKey } from "@/src/services/txPersistence";

export interface OptimisticSnapshot {
  nonce: string;
  queryKey: unknown[];
  previousData: unknown;
  delta: BalanceDelta;
  timestamp: number;
  contractId: string;
  method: string;
  args: unknown[];
}

export interface BalanceDelta {
  amount: bigint;
  operation: "deposit" | "withdraw";
}

export interface TransactionParams {
  contractId: string;
  method: string;
  args: unknown[];
  delta: BalanceDelta;
  queryKey: unknown[];
  txXdr: string;
}

const STORAGE_KEY = "lumina-optimistic-snapshots";
const STORAGE_EXPIRY_MS = 5 * 60 * 1000; // 5 minutes
const SUBMIT_DEBOUNCE_MS = 50;

export class OptimisticTransactionManager {
  private queryClient: QueryClient;
  private submitting = new Set<string>();

  constructor(queryClient: QueryClient) {
    this.queryClient = queryClient;
  }

  /**
   * Apply optimistic update within 50ms of user action
   */
  applyOptimisticUpdate(
    queryKey: unknown[],
    delta: BalanceDelta,
    previousData: unknown // eslint-disable-line @typescript-eslint/no-unused-vars
  ): string {
    const nonce = generateIdempotencyKey();
    const startTime = performance.now();

    // Apply the balance delta immediately
    this.queryClient.setQueryData(queryKey, (old: unknown) => {
      if (!old) return old;

      const newBalance =
        delta.operation === "deposit"
          ? Number((old as { rawBalance: number }).rawBalance) + Number(delta.amount)
          : Number((old as { rawBalance: number }).rawBalance) - Number(delta.amount);

      return {
        ...old,
        rawBalance: newBalance,
        balance: newBalance.toString(),
        formattedBalance: this.formatBalance(newBalance),
      };
    });

    const elapsed = performance.now() - startTime;
    if (elapsed > SUBMIT_DEBOUNCE_MS) {
      console.warn(`Optimistic update took ${elapsed.toFixed(2)}ms (target: <${SUBMIT_DEBOUNCE_MS}ms)`);
    }

    return nonce;
  }

  /**
   * Persist snapshot to sessionStorage for crash recovery
   */
  persistSnapshot(snapshot: OptimisticSnapshot): void {
    try {
      const existing = this.loadSnapshots();
      existing.push(snapshot);
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(existing));
    } catch (error) {
      console.error("Failed to persist optimistic snapshot:", error);
    }
  }

  /**
   * Load all snapshots from sessionStorage
   */
  loadSnapshots(): OptimisticSnapshot[] {
    try {
      const raw = sessionStorage.getItem(STORAGE_KEY);
      if (!raw) return [];

      const snapshots = JSON.parse(raw) as OptimisticSnapshot[];
      
      // Filter out expired snapshots
      const now = Date.now();
      const valid = snapshots.filter(
        (s) => now - s.timestamp < STORAGE_EXPIRY_MS
      );

      if (valid.length !== snapshots.length) {
        sessionStorage.setItem(STORAGE_KEY, JSON.stringify(valid));
      }

      return valid;
    } catch {
      return [];
    }
  }

  /**
   * Remove snapshot by nonce
   */
  removeSnapshot(nonce: string): void {
    try {
      const snapshots = this.loadSnapshots();
      const filtered = snapshots.filter((s) => s.nonce !== nonce);
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(filtered));
    } catch (error) {
      console.error("Failed to remove snapshot:", error);
    }
  }

  /**
   * Rollback optimistic update within 200ms of failure detection
   */
  rollbackOptimisticUpdate(
    queryKey: unknown[],
    previousData: unknown,
    nonce: string
  ): void {
    const startTime = performance.now();

    this.queryClient.setQueryData(queryKey, previousData);
    this.removeSnapshot(nonce);

    const elapsed = performance.now() - startTime;
    if (elapsed > 200) {
      console.warn(`Rollback took ${elapsed.toFixed(2)}ms (target: <200ms)`);
    }
  }

  /**
   * Check if a transaction is currently being submitted
   */
  isSubmitting(nonce: string): boolean {
    return this.submitting.has(nonce);
  }

  /**
   * Mark transaction as submitting to prevent duplicates
   */
  markSubmitting(nonce: string): boolean {
    if (this.submitting.has(nonce)) {
      return false; // Already submitting
    }
    this.submitting.add(nonce);
    return true;
  }

  /**
   * Clear submitting flag
   */
  clearSubmitting(nonce: string): void {
    this.submitting.delete(nonce);
  }

  /**
   * Reconcile orphaned optimistic entries on mount
   */
  async reconcileOrphanedSnapshots(
    backendBalanceFetcher: () => Promise<{ rawBalance: bigint }>
  ): Promise<number> {
    const snapshots = this.loadSnapshots();
    if (snapshots.length === 0) return 0;

    try {
      // Fetch the actual backend balance
      const backendData = await backendBalanceFetcher();
      
      // For each snapshot, check if it should be rolled back
      for (const snapshot of snapshots) {
        this.queryClient.setQueryData(snapshot.queryKey, (current: unknown) => {
          if (!current) return current;

          // If current balance doesn't match backend, use backend value
          return {
            ...current,
            rawBalance: backendData.rawBalance,
            balance: backendData.rawBalance.toString(),
            formattedBalance: this.formatBalance(backendData.rawBalance),
          };
        });

        this.removeSnapshot(snapshot.nonce);
      }

      return snapshots.length;
    } catch (error) {
      console.error("Failed to reconcile orphaned snapshots:", error);
      return 0;
    }
  }

  /**
   * Clear all snapshots (for testing or manual cleanup)
   */
  clearAllSnapshots(): void {
    try {
      sessionStorage.removeItem(STORAGE_KEY);
    } catch (error) {
      console.error("Failed to clear snapshots:", error);
    }
  }

  /**
   * Format balance for display
   */
  private formatBalance(balance: bigint): string {
    const decimals = 7; // Standard Stellar stroops
    const divisor = 10n ** BigInt(decimals);
    const integerPart = balance / divisor;
    const fractionalPart = balance % divisor;
    
    const fractionalStr = fractionalPart
      .toString()
      .padStart(decimals, "0")
      .replace(/0+$/, "") || "0";

    return `${integerPart}.${fractionalStr}`;
  }
}
