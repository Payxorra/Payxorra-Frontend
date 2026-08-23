import type {
  Approval,
  ApprovalHistoryEntry,
  ApprovalStatus,
  ApprovalStoreEvents,
  ApprovalStoreListener,
  SpendingCap,
  SpendingCapPeriod, // eslint-disable-line @typescript-eslint/no-unused-vars
} from "./types"

export class ApprovalStore {
  private approvals = new Map<string, Approval>()
  private caps = new Map<string, SpendingCap>()
  private history: ApprovalHistoryEntry[] = []
  private listeners = new Map<string, Set<ApprovalStoreListener>>()
  private historyLimit = 200

  constructor(historyLimit?: number) {
    if (historyLimit !== undefined) this.historyLimit = historyLimit
  }

  addApproval(approval: Approval): void {
    this.approvals.set(approval.id, approval)
    this.emit("approval_added", { approval })
  }

  updateApproval(id: string, updates: Partial<Approval>): Approval | undefined {
    const existing = this.approvals.get(id)
    if (!existing) return undefined
    const updated: Approval = { ...existing, ...updates }
    this.approvals.set(id, updated)
    this.emit("approval_updated", { approval: updated })
    return updated
  }

  removeApproval(id: string): boolean {
    const removed = this.approvals.delete(id)
    if (removed) this.emit("approval_removed", { id })
    return removed
  }

  getApproval(id: string): Approval | undefined {
    return this.approvals.get(id)
  }

  getApprovalsByDApp(dAppAddress: string): Approval[] {
    return Array.from(this.approvals.values()).filter(
      (a) => a.dAppAddress === dAppAddress,
    )
  }

  getAllApprovals(): Approval[] {
    return Array.from(this.approvals.values())
  }

  getApprovalsByStatus(status: ApprovalStatus): Approval[] {
    return Array.from(this.approvals.values()).filter(
      (a) => a.status === status,
    )
  }

  revokeApproval(id: string): Approval | undefined {
    return this.updateApproval(id, {
      status: "revoked",
      allowance: 0n,
    })
  }

  addSpendingCap(cap: SpendingCap): void {
    this.caps.set(cap.id, cap)
    this.emit("cap_added", { cap })
  }

  updateSpendingCap(id: string, updates: Partial<SpendingCap>): SpendingCap | undefined {
    const existing = this.caps.get(id)
    if (!existing) return undefined
    const updated: SpendingCap = { ...existing, ...updates }
    this.caps.set(id, updated)
    this.emit("cap_updated", { cap: updated })
    return updated
  }

  removeSpendingCap(id: string): boolean {
    const removed = this.caps.delete(id)
    if (removed) this.emit("cap_removed", { id })
    return removed
  }

  getSpendingCap(id: string): SpendingCap | undefined {
    return this.caps.get(id)
  }

  getSpendingCapsByDApp(dAppAddress: string): SpendingCap[] {
    return Array.from(this.caps.values()).filter(
      (c) => c.dAppAddress === dAppAddress,
    )
  }

  getAllSpendingCaps(): SpendingCap[] {
    return Array.from(this.caps.values())
  }

  checkSpendingCap(dAppAddress: string, amount: bigint): boolean {
    const caps = this.getSpendingCapsByDApp(dAppAddress)
    if (caps.length === 0) return true
    const now = Date.now()
    for (const cap of caps) {
      const windowMs = cap.period === "daily" ? 86_400_000 : 604_800_000
      if (now - cap.windowStart > windowMs) {
        this.updateSpendingCap(cap.id, {
          spent: 0n,
          windowStart: now,
        })
        continue
      }
      if (cap.spent + amount > cap.limit) return false
    }
    return true
  }

  recordSpend(dAppAddress: string, amount: bigint): void {
    const caps = this.getSpendingCapsByDApp(dAppAddress)
    const now = Date.now()
    for (const cap of caps) {
      const windowMs = cap.period === "daily" ? 86_400_000 : 604_800_000
      const reset = now - cap.windowStart > windowMs
      this.updateSpendingCap(cap.id, {
        spent: reset ? amount : cap.spent + amount,
        windowStart: reset ? now : cap.windowStart,
        lastUpdated: now,
      })
    }
  }

  addHistoryEntry(entry: ApprovalHistoryEntry): void {
    this.history.push(entry)
    if (this.history.length > this.historyLimit) {
      this.history.shift()
    }
    this.emit("history_added", { entry })
  }

  getHistory(approvalId?: string): ApprovalHistoryEntry[] {
    const entries = approvalId
      ? this.history.filter((e) => e.approvalId === approvalId)
      : this.history
    return [...entries].sort((a, b) => b.timestamp - a.timestamp)
  }

  clearHistory(): void {
    this.history = []
  }

  subscribe<E extends keyof ApprovalStoreEvents>(
    event: E,
    listener: (event: ApprovalStoreEvents[E]) => void,
  ): () => void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set())
    }
    this.listeners.get(event)!.add(listener as ApprovalStoreListener)
    return () => this.listeners.get(event)?.delete(listener as ApprovalStoreListener)
  }

  clear(): void {
    this.approvals.clear()
    this.caps.clear()
    this.history = []
    this.listeners.clear()
  }

  private emit<E extends keyof ApprovalStoreEvents>(
    event: E,
    data: ApprovalStoreEvents[E],
  ): void {
    const set = this.listeners.get(event)
    if (!set) return
    for (const listener of set) {
      try {
        listener(data)
      } catch {
        /* noop */
      }
    }
  }
}
