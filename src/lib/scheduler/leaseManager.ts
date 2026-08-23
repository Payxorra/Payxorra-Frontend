import type { Lease, WorkerIdentity, WorkerClaim } from "./types"
import { JobStore } from "./jobStore"

export class LeaseManager {
  private leases = new Map<string, Lease>()
  private workers = new Map<string, WorkerIdentity>()
  private jobStore: JobStore

  constructor(jobStore: JobStore) {
    this.jobStore = jobStore
  }

  registerWorker(identity: WorkerIdentity): void {
    this.workers.set(identity.workerId, identity)
  }

  unregisterWorker(workerId: string): void {
    this.workers.delete(workerId)
    for (const [leaseId, lease] of this.leases) {
      if (lease.workerId === workerId && lease.status === "active") {
        this.releaseLease(leaseId)
      }
    }
  }

  getWorker(workerId: string): WorkerIdentity | undefined {
    return this.workers.get(workerId)
  }

  getWorkerCount(): number {
    return this.workers.size
  }

  getWorkers(): WorkerIdentity[] {
    return Array.from(this.workers.values())
  }

  claimJob(claim: WorkerClaim): { job: import("./types").Job; lease: Lease } | null {
    const now = claim.claimedAt
    const result = this.jobStore.claimNext(claim.workerId, claim.leaseDurationMs, now)
    if (!result) return null

    const leaseId = crypto.randomUUID()
    const lease: Lease = {
      leaseId,
      jobId: result.job.jobId,
      workerId: claim.workerId,
      status: "active",
      acquiredAt: now,
      expiresAt: result.leaseExpiresAt,
      heartbeatAt: now,
    }
    this.leases.set(leaseId, lease)
    return { job: result.job, lease }
  }

  renewLease(leaseId: string, now: number): boolean {
    const lease = this.leases.get(leaseId)
    if (!lease || lease.status !== "active") return false
    lease.heartbeatAt = now
    return true
  }

  releaseLease(leaseId: string): boolean {
    const lease = this.leases.get(leaseId)
    if (!lease) return false
    lease.status = "released"
    return true
  }

  expireStaleLeases(now: number, leaseDurationMs: number): string[] { // eslint-disable-line @typescript-eslint/no-unused-vars
    const expired: string[] = []
    for (const [leaseId, lease] of this.leases) {
      if (lease.status === "active" && now > lease.expiresAt) {
        lease.status = "expired"
        expired.push(leaseId)
      }
    }
    return expired
  }

  getActiveLeaseCount(): number {
    let count = 0
    for (const lease of this.leases.values()) {
      if (lease.status === "active") count++
    }
    return count
  }

  getExpiredLeaseCount(): number {
    let count = 0
    for (const lease of this.leases.values()) {
      if (lease.status === "expired") count++
    }
    return count
  }

  getLease(leaseId: string): Lease | undefined {
    return this.leases.get(leaseId)
  }

  getLeasesByWorker(workerId: string): Lease[] {
    return Array.from(this.leases.values()).filter(
      (l) => l.workerId === workerId,
    )
  }

  clear(): void {
    this.leases.clear()
    this.workers.clear()
  }
}