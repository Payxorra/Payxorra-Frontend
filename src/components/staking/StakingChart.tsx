"use client";

import { useMemo } from "react"
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts"
import type { StakingChartPoint } from "@/src/lib/staking/types"

interface StakingChartProps {
  data: StakingChartPoint[] | undefined
  loading: boolean
}

function formatBalance(val: number): string {
  if (val >= 1_000_000) return `${(val / 1_000_000).toFixed(1)}M`
  if (val >= 1_000) return `${(val / 1_000).toFixed(1)}k`
  return val.toFixed(0)
}

export function StakingChart({ data, loading }: StakingChartProps) {
  const chartData = useMemo(() => {
    if (!data) return []
    return data.map((p) => ({
      time: p.label,
      balance: Number(p.balance) / 1e7,
    }))
  }, [data])

  if (loading) {
    return (
      <div className="rounded-lg border border-border bg-surface p-6">
        <div className="mb-4 h-5 w-36 animate-pulse rounded bg-surface-alt" />
        <div className="h-64 animate-pulse rounded bg-surface-alt" />
      </div>
    )
  }

  return (
    <div className="rounded-lg border border-border bg-surface p-6">
      <h3 className="mb-4 text-base font-semibold text-foreground">
        Balance History
      </h3>

      {chartData.length > 0 ? (
        <ResponsiveContainer width="100%" height={280}>
          <AreaChart
            data={chartData}
            margin={{ top: 5, right: 20, left: 0, bottom: 5 }}
          >
            <defs>
              <linearGradient id="stakingGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="var(--color-primary)" stopOpacity={0.3} />
                <stop offset="95%" stopColor="var(--color-primary)" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid
              strokeDasharray="3 3"
              stroke="var(--color-chart-grid)"
            />
            <XAxis
              dataKey="time"
              tick={{ fontSize: 11, fill: "var(--color-chart-text)" }}
              tickLine={false}
              interval="preserveStartEnd"
            />
            <YAxis
              tickFormatter={formatBalance}
              tick={{ fontSize: 11, fill: "var(--color-chart-text)" }}
              tickLine={false}
              axisLine={false}
            />
            <Tooltip
              contentStyle={{
                backgroundColor: "var(--color-surface)",
                border: "1px solid var(--color-chart-border)",
                borderRadius: "6px",
                fontSize: "12px",
              }}
              formatter={(value: unknown) => [
                `${Number(value).toLocaleString()} LUM`,
                "Balance",
              ]}
            />
            <Area
              type="monotone"
              dataKey="balance"
              stroke="var(--color-primary)"
              strokeWidth={2}
              fill="url(#stakingGradient)"
              dot={false}
              isAnimationActive={false}
            />
          </AreaChart>
        </ResponsiveContainer>
      ) : (
        <div className="flex items-center justify-center py-16 text-sm text-muted">
          No balance history available.
        </div>
      )}
    </div>
  )
}
