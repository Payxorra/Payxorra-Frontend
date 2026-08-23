"use client";

import { useState, useRef, useEffect } from "react"; // eslint-disable-line @typescript-eslint/no-unused-vars
import { useSorobanBilling } from "@/src/hooks/useSorobanBilling";
import type { BalanceDelta } from "@/src/lib/OptimisticTransactionManager";

const MOCK_CONTRACT_ID = "CCQPK3IWQP5LM6NQVMQBXQK6XVYD7QDWFQVJW3QWVQRQZQZQZQZQ";

interface ToastMessage {
  id: string;
  type: "success" | "error" | "info";
  message: string;
}

export function EscrowPanel() {
  const [depositAmount, setDepositAmount] = useState("");
  const [withdrawAmount, setWithdrawAmount] = useState("");
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const depositButtonRef = useRef<HTMLButtonElement>(null);
  const withdrawButtonRef = useRef<HTMLButtonElement>(null);

  const {
    billingData,
    billingLoading,
    billingError,
    submitWithOptimisticUpdate,
    isSubmitting,
    refetchBalance, // eslint-disable-line @typescript-eslint/no-unused-vars
  } = useSorobanBilling();

  const showToast = (type: ToastMessage["type"], message: string) => {
    const id = `${Date.now()}-${Math.random()}`;
    setToasts((prev) => [...prev, { id, type, message }]);

    // Auto-remove after 5 seconds
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 5000);
  };

  const removeToast = (id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  };

  const handleDeposit = async () => {
    const amount = parseFloat(depositAmount);
    
    if (isNaN(amount) || amount <= 0) {
      showToast("error", "Please enter a valid deposit amount");
      return;
    }

    // Disable button to prevent double submission
    if (depositButtonRef.current) {
      depositButtonRef.current.disabled = true;
    }

    try {
      const stroops = BigInt(Math.floor(amount * 1e7)); // Convert to stroops

      const delta: BalanceDelta = {
        amount: stroops,
        operation: "deposit",
      };

      // Mock transaction XDR (in real app, this would be built using Stellar SDK)
      const mockTxXdr = `MOCK_DEPOSIT_${Date.now()}`;

      const result = await submitWithOptimisticUpdate({
        contractId: MOCK_CONTRACT_ID,
        method: "deposit",
        args: [stroops],
        txXdr: mockTxXdr,
        delta,
      });

      if (result.success) {
        showToast("success", `Successfully deposited ${amount} XLM to escrow`);
        setDepositAmount("");
      } else {
        showToast("error", result.error ?? "Deposit failed");
      }
    } catch (error) {
      showToast("error", error instanceof Error ? error.message : "Deposit failed");
    } finally {
      if (depositButtonRef.current) {
        depositButtonRef.current.disabled = false;
      }
    }
  };

  const handleWithdraw = async () => {
    const amount = parseFloat(withdrawAmount);
    
    if (isNaN(amount) || amount <= 0) {
      showToast("error", "Please enter a valid withdrawal amount");
      return;
    }

    const currentBalance = billingData?.rawBalance ?? 0n;
    const stroops = BigInt(Math.floor(amount * 1e7));

    if (stroops > currentBalance) {
      showToast("error", "Insufficient balance");
      return;
    }

    // Disable button to prevent double submission
    if (withdrawButtonRef.current) {
      withdrawButtonRef.current.disabled = true;
    }

    try {
      const delta: BalanceDelta = {
        amount: stroops,
        operation: "withdraw",
      };

      // Mock transaction XDR
      const mockTxXdr = `MOCK_WITHDRAW_${Date.now()}`;

      const result = await submitWithOptimisticUpdate({
        contractId: MOCK_CONTRACT_ID,
        method: "withdraw",
        args: [stroops],
        txXdr: mockTxXdr,
        delta,
      });

      if (result.success) {
        showToast("success", `Successfully withdrew ${amount} XLM from escrow`);
        setWithdrawAmount("");
      } else {
        showToast("error", result.error ?? "Withdrawal failed");
      }
    } catch (error) {
      showToast("error", error instanceof Error ? error.message : "Withdrawal failed");
    } finally {
      if (withdrawButtonRef.current) {
        withdrawButtonRef.current.disabled = false;
      }
    }
  };

  return (
    <section className="rounded-lg border border-border bg-surface">
      {/* Header */}
      <div className="border-b border-border px-5 py-4">
        <h2 className="text-lg font-semibold text-foreground">Escrow Management</h2>
        <p className="mt-0.5 text-sm text-muted">
          Deposit or withdraw funds from your escrow account
        </p>
      </div>

      {/* Balance Display */}
      <div className="border-b border-border bg-surface-alt px-5 py-4">
        <div className="flex items-baseline gap-2">
          <span className="text-sm font-medium text-muted">Current Balance:</span>
          {billingLoading ? (
            <div className="h-6 w-24 animate-pulse rounded bg-surface-alt" />
          ) : (
            <span className="text-2xl font-bold text-primary">
              {billingData?.formattedBalance ?? "0.0"} XLM
            </span>
          )}
        </div>
        {billingError && (
          <div className="mt-2 rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-800">
            {billingError.userMessage}
          </div>
        )}
      </div>

      {/* Deposit Section */}
      <div className="border-b border-table-divider px-5 py-5">
        <h3 className="mb-3 text-sm font-semibold text-foreground">Deposit Funds</h3>
        <div className="flex gap-3">
          <input
            type="number"
            value={depositAmount}
            onChange={(e) => setDepositAmount(e.target.value)}
            placeholder="Amount (XLM)"
            min="0"
            step="0.1"
            className="flex-1 rounded-md border border-border-light px-3 py-2 text-sm text-foreground placeholder-placeholder focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
            disabled={isSubmitting}
          />
          <button
            ref={depositButtonRef}
            type="button"
            onClick={handleDeposit}
            disabled={isSubmitting || !depositAmount}
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-text transition hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isSubmitting ? "Processing..." : "Deposit"}
          </button>
        </div>
        <p className="mt-2 text-xs text-muted">
          Funds will be locked in the escrow contract on Stellar Soroban
        </p>
      </div>

      {/* Withdraw Section */}
      <div className="px-5 py-5">
        <h3 className="mb-3 text-sm font-semibold text-foreground">Withdraw Funds</h3>
        <div className="flex gap-3">
          <input
            type="number"
            value={withdrawAmount}
            onChange={(e) => setWithdrawAmount(e.target.value)}
            placeholder="Amount (XLM)"
            min="0"
            step="0.1"
            className="flex-1 rounded-md border border-border-light px-3 py-2 text-sm text-foreground placeholder-placeholder focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
            disabled={isSubmitting}
          />
          <button
            ref={withdrawButtonRef}
            type="button"
            onClick={handleWithdraw}
            disabled={isSubmitting || !withdrawAmount}
            className="rounded-md border border-border-light px-4 py-2 text-sm font-medium text-muted-text transition hover:border-primary hover:text-primary disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isSubmitting ? "Processing..." : "Withdraw"}
          </button>
        </div>
        <p className="mt-2 text-xs text-muted">
          Withdraw available funds from your escrow balance
        </p>
      </div>

      {/* Toast Notifications */}
      {toasts.length > 0 && (
        <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2">
          {toasts.map((toast) => (
            <div
              key={toast.id}
              className={`flex items-center gap-3 rounded-lg border px-4 py-3 shadow-lg ${
                toast.type === "success"
                  ? "border-green-200 bg-green-50 text-green-800"
                  : toast.type === "error"
                  ? "border-rose-200 bg-rose-50 text-rose-800"
                  : "border-blue-200 bg-blue-50 text-blue-800"
              }`}
            >
              <span className="text-sm font-medium">{toast.message}</span>
              <button
                type="button"
                onClick={() => removeToast(toast.id)}
                className="ml-2 text-current opacity-70 hover:opacity-100"
              >
                <svg className="h-4 w-4" viewBox="0 0 16 16" fill="currentColor">
                  <path d="M4.646 4.646a.5.5 0 0 1 .708 0L8 7.293l2.646-2.647a.5.5 0 0 1 .708.708L8.707 8l2.647 2.646a.5.5 0 0 1-.708.708L8 8.707l-2.646 2.647a.5.5 0 0 1-.708-.708L7.293 8 4.646 5.354a.5.5 0 0 1 0-.708z" />
                </svg>
              </button>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
