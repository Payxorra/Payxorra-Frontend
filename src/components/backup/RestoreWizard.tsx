"use client";

import { useState } from "react";
import { useBackupRestore } from "@/src/hooks/useBackupRestore";

interface RestoreStep {
  id: "select" | "verify" | "confirm" | "result";
  label: string;
}

const STEPS: RestoreStep[] = [
  { id: "select", label: "Select File" },
  { id: "verify", label: "Verify" },
  { id: "confirm", label: "Confirm" },
  { id: "result", label: "Result" },
];

export function RestoreWizard() {
  const { uploadAndRestore, runRestoreTest } = useBackupRestore();
  const [step, setStep] = useState<RestoreStep["id"]>("select");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [verifyResult, setVerifyResult] = useState<unknown>(null);
  const [restoreResult, setRestoreResult] = useState<unknown>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setSelectedFile(file);
    setError(null);
    setIsProcessing(true);

    try {
      const text = await file.text();
      const backup = JSON.parse(text);
      const result = await runRestoreTest(backup);
      setVerifyResult(result);
      if (result.ok) {
        setStep("verify");
      } else {
        setError(result.error ?? "Verification failed");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Invalid backup file");
    } finally {
      setIsProcessing(false);
    }
  };

  const handleConfirm = async () => {
    if (!selectedFile) return;
    setIsProcessing(true);
    setError(null);

    try {
      const text = await selectedFile.text();
      const backup = JSON.parse(text); // eslint-disable-line @typescript-eslint/no-unused-vars
      const result = await uploadAndRestore(selectedFile, false);
      setRestoreResult(result);
      if (result?.ok) {
        setStep("result");
      } else {
        setError(result?.error ?? "Restore failed");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Restore failed");
    } finally {
      setIsProcessing(false);
    }
  };

  const handleReset = () => {
    setStep("select");
    setSelectedFile(null);
    setVerifyResult(null);
    setRestoreResult(null);
    setError(null);
  };

  const currentStepIndex = STEPS.findIndex((s) => s.id === step);

  return (
    <div className="rounded-lg border border-neutral-800 bg-neutral-900/50 p-4">
      {/* Step Indicator */}
      <div className="mb-6 flex items-center gap-2">
        {STEPS.map((s, i) => (
          <div key={s.id} className="flex items-center gap-2">
            <span className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-medium ${
              i <= currentStepIndex
                ? "bg-emerald-600 text-white"
                : "bg-neutral-800 text-neutral-500"
            }`}>
              {i + 1}
            </span>
            <span className={`text-xs ${
              i <= currentStepIndex ? "text-neutral-200" : "text-neutral-600"
            }`}>
              {s.label}
            </span>
            {i < STEPS.length - 1 && (
              <span className="text-neutral-700">→</span>
            )}
          </div>
        ))}
      </div>

      {/* Step Content */}
      {step === "select" && (
        <div>
          <p className="mb-3 text-sm text-neutral-400">
            Select a backup JSON file to restore. The file will be verified
            before any data is written.
          </p>
          <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg bg-neutral-700 px-4 py-2 text-sm font-medium text-neutral-200 hover:bg-neutral-600">
            <input
              type="file"
              accept=".json"
              onChange={handleFileSelect}
              className="hidden"
              disabled={isProcessing}
            />
            {isProcessing ? "Verifying..." : "Choose Backup File"}
          </label>
          {error && (
            <p className="mt-3 text-sm text-red-400">{error}</p>
          )}
        </div>
      )}

      {step === "verify" && verifyResult && (
        <div>
          {verifyResult.ok ? (
            <div className="mb-4 rounded-lg bg-emerald-900/20 p-3">
              <p className="text-sm font-medium text-emerald-400">
                Backup Verified Successfully
              </p>
              <p className="mt-1 text-xs text-neutral-400">
                {verifyResult.totalRecordsRestored} records across{" "}
                {verifyResult.storesAttempted} stores will be restored.
              </p>
            </div>
          ) : (
            <div className="mb-4 rounded-lg bg-red-900/20 p-3">
              <p className="text-sm font-medium text-red-400">
                Verification Failed
              </p>
              <p className="mt-1 text-xs text-neutral-400">
                {verifyResult.error}
              </p>
            </div>
          )}

          <div className="flex gap-3">
            {verifyResult.ok && (
              <button
                onClick={handleConfirm}
                disabled={isProcessing}
                className="rounded-lg bg-amber-600 px-4 py-2 text-sm font-medium text-white hover:bg-amber-500 disabled:opacity-50"
              >
                {isProcessing ? "Restoring..." : "Proceed with Restore"}
              </button>
            )}
            <button
              onClick={handleReset}
              className="rounded-lg bg-neutral-700 px-4 py-2 text-sm font-medium text-neutral-200 hover:bg-neutral-600"
            >
              Cancel
            </button>
          </div>

          {error && (
            <p className="mt-3 text-sm text-red-400">{error}</p>
          )}
        </div>
      )}

      {step === "confirm" && (
        <div>
          <p className="mb-3 text-sm text-neutral-400">
            Restore in progress...
          </p>
          <div className="h-1 w-full overflow-hidden rounded bg-neutral-800">
            <div className="h-full w-1/2 animate-pulse rounded bg-emerald-600" />
          </div>
        </div>
      )}

      {step === "result" && restoreResult && (
        <div>
          {restoreResult.ok ? (
            <div className="mb-4 rounded-lg bg-emerald-900/20 p-3">
              <p className="text-sm font-medium text-emerald-400">
                Restore Completed Successfully
              </p>
              <p className="mt-1 text-xs text-neutral-400">
                {restoreResult.totalRecordsRestored} records restored across{" "}
                {restoreResult.storesSucceeded} stores in{" "}
                {restoreResult.durationMs}ms.
              </p>
            </div>
          ) : (
            <div className="mb-4 rounded-lg bg-red-900/20 p-3">
              <p className="text-sm font-medium text-red-400">
                Restore Failed
              </p>
              <p className="mt-1 text-xs text-neutral-400">
                {restoreResult.error ?? "Unknown error"}
              </p>
            </div>
          )}

          <button
            onClick={handleReset}
            className="rounded-lg bg-neutral-700 px-4 py-2 text-sm font-medium text-neutral-200 hover:bg-neutral-600"
          >
            Start New Restore
          </button>
        </div>
      )}
    </div>
  );
}
