import type { Job, JobDefinition, JobStatus } from "./types"

export class JobStore<T = unknown> {
  private jobs = new Map<string, Job<T>>()
  private byStatus = new Map<JobStatus, Set<string>>()

  submit(def: JobDefinition): Job<T> {
    const existing = Array.from(this.jobs.values()).find(
      (j) =>
        j.definition.jobType === def.jobType &&
        j.status === "pending",
    )
    if (existing) return existing

    const jobId = crypto.randomUUID()
    const now = Date.now()
    const job: Job<T> = {
      jobId,
      definition: def,
      status: "pending",
      retryCount: 0,
      createdAt: now,
    }
    this.jobs.set(jobId, job)
    this.addToIndex("pending", jobId)
    return job
  }

  get(jobId: string): Job<T> | undefined {
    return this.jobs.get(jobId)
  }

  updateStatus(jobId: string, status: JobStatus, extra?: Partial<Job<T>>): void {
    const job = this.jobs.get(jobId)
    if (!job) return

    this.removeFromIndex(job.status, jobId)
    job.status = status
    if (extra) Object.assign(job, extra)
    this.addToIndex(status, jobId)
  }

  claimNext(
    workerId: string,
    leaseDurationMs: number,
    now: number,
    allowTypes?: string[],
  ): { job: Job<T>; leaseExpiresAt: number } | null {
    const pending = this.getByStatus("pending")
    for (const job of pending) {
      if (allowTypes && !allowTypes.includes(job.definition.jobType)) continue
      const leaseExpiresAt = now + leaseDurationMs
      this.updateStatus(job.jobId, "running", {
        startedAt: now,
        claimedBy: workerId,
        leaseExpiresAt,
      })
      return { job, leaseExpiresAt }
    }
    return null
  }

  complete(jobId: string, result: T, now: number): void {
    this.updateStatus(jobId, "completed", { result, completedAt: now })
  }

  fail(jobId: string, error: string): void {
    const job = this.jobs.get(jobId)
    if (!job) return

    if (job.retryCount < job.definition.maxRetries) {
      job.retryCount++
      this.updateStatus(jobId, "pending", {
        claimedBy: undefined,
        startedAt: undefined,
        leaseExpiresAt: undefined,
      })
    } else {
      this.updateStatus(jobId, "failed", { error, completedAt: Date.now() })
    }
  }

  timeoutExpiredLeases(now: number, leaseDurationMs: number): string[] { // eslint-disable-line @typescript-eslint/no-unused-vars
    const timedOut: string[] = []
    const running = this.getByStatus("running")
    for (const job of running) {
      if (job.leaseExpiresAt && now > job.leaseExpiresAt) {
        if (job.retryCount < job.definition.maxRetries) {
          job.retryCount++
          this.updateStatus(job.jobId, "pending", {
            claimedBy: undefined,
            startedAt: undefined,
            leaseExpiresAt: undefined,
          })
        } else {
          this.updateStatus(job.jobId, "timed_out", {
            error: "Lease expired",
            completedAt: now,
          })
        }
        timedOut.push(job.jobId)
      }
    }
    return timedOut
  }

  timeoutJobs(now: number): string[] {
    const timedOut: string[] = []
    const running = this.getByStatus("running")
    for (const job of running) {
      if (job.startedAt && now - job.startedAt > job.definition.timeoutMs) {
        this.fail(job.jobId, `Job timed out after ${job.definition.timeoutMs}ms`)
        timedOut.push(job.jobId)
      }
    }
    return timedOut
  }

  getByStatus(status: JobStatus): Job<T>[] {
    const ids = this.byStatus.get(status)
    if (!ids) return []
    return Array.from(ids)
      .map((id) => this.jobs.get(id)!)
      .filter(Boolean)
  }

  getAll(): Job<T>[] {
    return Array.from(this.jobs.values()).sort((a, b) => a.createdAt - b.createdAt)
  }

  size(): number {
    return this.jobs.size
  }

  clear(): void {
    this.jobs.clear()
    this.byStatus.clear()
  }

  private addToIndex(status: JobStatus, jobId: string): void {
    let set = this.byStatus.get(status)
    if (!set) {
      set = new Set()
      this.byStatus.set(status, set)
    }
    set.add(jobId)
  }

  private removeFromIndex(status: JobStatus, jobId: string): void {
    this.byStatus.get(status)?.delete(jobId)
  }
}