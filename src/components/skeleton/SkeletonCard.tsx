'use client'

import { SkeletonText } from './SkeletonText'

export type SkeletonCardVariant = 'node' | 'alert' | 'metric'

export interface SkeletonCardProps {
  variant: SkeletonCardVariant
  className?: string
}

function NodeSkeleton() {
  return (
    <div className="skeleton-card" aria-hidden="true">
      <div className="skeleton-card-header">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <div className="skeleton skeleton-circle" style={{ width: 12, height: 12 }} />
          <div className="skeleton skeleton-text skeleton-text--lg" style={{ width: 120, height: 14, margin: 0 }} />
        </div>
        <div className="skeleton skeleton-badge" />
      </div>
      <div className="skeleton-card-body">
        <SkeletonText lines={3} width="full" />
        <div style={{ height: 8 }} />
        <SkeletonText lines={3} width="md" />
      </div>
      <div className="skeleton-card-footer">
        <div className="skeleton skeleton-text skeleton-text--sm" style={{ width: 80, margin: 0 }} />
      </div>
    </div>
  )
}

function AlertSkeleton() {
  return (
    <div className="skeleton-card" aria-hidden="true">
      <div className="skeleton-card-header">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <div className="skeleton skeleton-circle" style={{ width: 8, height: 8 }} />
          <div className="skeleton skeleton-text skeleton-text--lg" style={{ width: 160, height: 14, margin: 0 }} />
        </div>
        <div className="skeleton" style={{ width: 24, height: 24, borderRadius: 4 }} />
      </div>
      <div className="skeleton-card-body">
        <div className="skeleton skeleton-text skeleton-text--full" style={{ height: 14 }} />
        <div className="skeleton skeleton-text skeleton-text--full" style={{ width: '70%', height: 14 }} />
        <div style={{ height: 8 }} />
        <div className="flex items-center justify-between">
          <div className="skeleton skeleton-text skeleton-text--sm" style={{ width: 80, margin: 0 }} />
          <div className="skeleton skeleton-text skeleton-text--sm" style={{ width: 60, margin: 0 }} />
        </div>
      </div>
    </div>
  )
}

function MetricSkeleton() {
  return (
    <div className="skeleton-card" aria-hidden="true">
      <div className="skeleton-card-body" style={{ padding: '16px' }}>
        <div className="flex items-center justify-between">
          <div className="skeleton skeleton-text skeleton-text--sm" style={{ width: 80, margin: 0 }} />
          <div className="skeleton" style={{ width: 32, height: 32, borderRadius: 8 }} />
        </div>
        <div style={{ height: 12 }} />
        <div className="skeleton skeleton-text skeleton-text--lg" style={{ width: 100, height: 28, margin: 0 }} />
        <div style={{ height: 4 }} />
        <div className="skeleton skeleton-text skeleton-text--sm" style={{ width: 60, margin: 0 }} />
      </div>
      <div className="skeleton-card-footer" style={{ padding: '12px 16px' }}>
        <div className="skeleton skeleton-text skeleton-text--sm" style={{ width: 120, margin: 0 }} />
      </div>
    </div>
  )
}

export function SkeletonCard({ variant, className = '' }: SkeletonCardProps) { // eslint-disable-line @typescript-eslint/no-unused-vars
  switch (variant) {
    case 'node':
      return <NodeSkeleton />
    case 'alert':
      return <AlertSkeleton />
    case 'metric':
      return <MetricSkeleton />
  }
}
