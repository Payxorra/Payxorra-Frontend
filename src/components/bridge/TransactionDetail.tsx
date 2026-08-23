"use client";

import type { BridgeTransaction, BridgeStatus } from "@/src/lib/bridge";

const STATUS_STEPS: { status: BridgeStatus; label: string }[] = [
  { status: "Initiated", label: "Transaction Initiated" },
  { status: "SourceConfirmed", label: "Source Chain Confirmed" },
  { status: "BridgeRelayed", label: "Bridge Relayed" },
  { status: "DestinationPending", label: "Destination Pending" },
  { status: "DestinationConfirmed", label: "Destination Confirmed" },
  { status: "Complete", label: "Complete" },
];

interface TimelineEntry {
  status: BridgeStatus
  label: string
  timestamp: number | undefined
  isReached: boolean
  isActive: boolean
  isFailed: boolean
}

function formatTime(ts: number | undefined): string {
  if (!ts) return "";
  return new Date(ts).toLocaleString();
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between border-b border-border py-2 last:border-0">
      <span className="text-sm text-muted">{label}</span>
      <span className="text-sm font-medium text-foreground">{value}</span>
    </div>
  );
}

interface TransactionDetailProps {
  transaction: BridgeTransaction
  onRetry?: (id: string) => void
  onClose?: () => void
}

export function TransactionDetail({ transaction, onRetry, onClose }: TransactionDetailProps) {
  const entries: TimelineEntry[] = STATUS_STEPS.map((step, idx) => {
    const statusToKey: Partial<Record<BridgeStatus, keyof BridgeTransaction>> = {
      Initiated: "initiatedAt",
      SourceConfirmed: "sourceConfirmedAt",
      BridgeRelayed: "bridgeRelayedAt",
      DestinationPending: "destinationPendingAt",
      DestinationConfirmed: "destinationConfirmedAt",
      Complete: "completedAt",
    };

    const timestampKey = statusToKey[step.status];
    const ts = timestampKey ? transaction[timestampKey] as number | undefined : undefined;
    const isFailed = transaction.status === "Failed";
    const currentIdx = STATUS_STEPS.findIndex((s) => s.status === transaction.status);
    const isReached = idx <= currentIdx && !isFailed;
    const isActive = idx === currentIdx && !isFailed;

    return {
      status: step.status,
      label: step.label,
      timestamp: ts,
      isReached,
      isActive,
      isFailed: isFailed && idx === currentIdx,
    };
  });

  const chainName = (id: string) => id.charAt(0).toUpperCase() + id.slice(1);

  return (
    <div className="rounded-lg border border-border bg-surface">
      <div className="flex items-center justify-between border-b border-border px-6 py-4">
        <h2 className="text-lg font-semibold text-foreground">Transaction Detail</h2>
        {onClose && (
          <button
            onClick={onClose}
            className="rounded p-1 text-muted transition hover:bg-surface-alt hover:text-foreground"
          >
            ✕
          </button>
        )}
      </div>

      <div className="grid grid-cols-2 gap-4 border-b border-border px-6 py-4">
        <DetailRow label="Token" value={`${transaction.amount} ${transaction.token}`} />
        <DetailRow label="Route" value={`${chainName(transaction.sourceChain)} \u2192 ${chainName(transaction.destinationChain)}`} />
        <DetailRow label="Source TX" value={transaction.sourceTxHash.slice(0, 18) + "..."} />
        <DetailRow
          label="Destination TX"
          value={transaction.destinationTxHash ? transaction.destinationTxHash.slice(0, 18) + "..." : "Pending"}
        />
        <DetailRow
          label="Confirmations"
          value={`${transaction.currentConfirmations}/${transaction.requiredConfirmations}`}
        />
        <DetailRow label="Gas Used" value={transaction.gasUsed ?? "N/A"} />
        <DetailRow
          label="Actual Time"
          value={transaction.actualTimeMs ? `${(transaction.actualTimeMs / 1000).toFixed(1)}s` : "In progress"}
        />
        <DetailRow
          label="Estimated Time"
          value={`${(transaction.estimatedTimeMs / 1000).toFixed(0)}s`}
        />
      </div>

      <div className="px-6 py-4">
        <h3 className="mb-4 text-sm font-semibold text-foreground">Status Timeline</h3>
        <div className="relative">
          {entries.map((entry, idx) => (
            <div key={entry.status} className="relative flex gap-4 pb-6 last:pb-0">
              <div className="flex flex-col items-center">
                <div
                  className={`z-10 flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold ${
                    entry.isActive
                      ? "border-2 border-primary bg-surface text-primary"
                      : entry.isReached
                        ? "bg-primary text-primary-text"
                        : entry.isFailed
                          ? "border-2 border-danger bg-error-bg text-danger-text"
                          : "border border-border bg-surface text-muted"
                  }`}
                >
                  {entry.isFailed ? "!" : entry.isReached ? "\u2713" : idx + 1}
                </div>
                {idx < entries.length - 1 && (
                  <div
                    className={`mt-0 h-full w-0.5 ${
                      entry.isReached ? "bg-primary" : "bg-border"
                    }`}
                  />
                )}
              </div>
              <div className="flex-1 pb-2">
                <p
                  className={`text-sm font-medium ${
                    entry.isReached || entry.isActive ? "text-foreground" : "text-muted"
                  }`}
                >
                  {entry.label}
                </p>
                {entry.timestamp && (
                  <p className="text-xs text-muted">{formatTime(entry.timestamp)}</p>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {transaction.status === "Failed" && (
        <div className="mx-6 mb-4 rounded-md border border-error-border bg-error-bg p-4">
          <p className="text-sm font-medium text-danger-text">
            {transaction.errorReason ?? "Unknown error"}
          </p>
          {transaction.recommendedAction === "retry" && onRetry && (
            <button
              onClick={() => onRetry(transaction.id)}
              className="mt-2 rounded bg-primary px-3 py-1 text-xs font-semibold text-primary-text transition hover:bg-primary-hover"
            >
              Retry Transaction
            </button>
          )}
          {transaction.recommendedAction === "contact_support" && (
            <p className="mt-1 text-xs text-muted">
              Please contact support to resolve this issue.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
