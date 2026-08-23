"use client";

import { useCallback, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  StakingPortfolio,
  UnstakeRequest,
  RewardHistoryPage,
  StakingChartPoint,
} from "@/src/lib/staking/types";
import {
  formatCooldownTime,
  getCooldownEnd,
  getCooldownRemaining,
  generateMockChartData,
} from "@/src/lib/staking/stakingCalculator";

const MOCK_STAKED = 5_000_000_000_000n;
const MOCK_PENDING = 125_000_000_000n;
const DEFAULT_APR = 1200;

export function useStaking(walletAddress?: string) {
  const queryClient = useQueryClient();
  const [isSubmitting, setIsSubmitting] = useState(false);

  const portfolioQueryKey = useMemo(
    () => ["staking", "portfolio", walletAddress],
    [walletAddress],
  );

  const historyQueryKey = useMemo(
    () => ["staking", "history", walletAddress],
    [walletAddress],
  );

  const unstakeRequestsQueryKey = useMemo(
    () => ["staking", "unstake-requests", walletAddress],
    [walletAddress],
  );

  const chartDataQueryKey = useMemo(
    () => ["staking", "chart", walletAddress],
    [walletAddress],
  );

  const { data: portfolio, isLoading: portfolioLoading } = useQuery({
    queryKey: portfolioQueryKey,
    queryFn: async (): Promise<StakingPortfolio> => {
      const nextClaim = Date.now() + 7 * 86_400_000;
      return {
        totalStaked: MOCK_STAKED,
        aprBps: DEFAULT_APR,
        userStake: walletAddress ? MOCK_STAKED : 0n,
        pendingRewards: MOCK_PENDING,
        nextRewardClaimDate: nextClaim,
      };
    },
    enabled: !!walletAddress,
    staleTime: 30_000,
  });

  const { data: stakeHistory, isLoading: historyLoading } = useQuery({
    queryKey: historyQueryKey,
    queryFn: async (): Promise<RewardHistoryPage> => {
      return {
        records: [],
        totalRecords: 0,
        page: 1,
        pageSize: 10,
      };
    },
    enabled: !!walletAddress,
    staleTime: 30_000,
  });

  const { data: unstakeRequests, isLoading: unstakeLoading } = useQuery({
    queryKey: unstakeRequestsQueryKey,
    queryFn: async (): Promise<UnstakeRequest[]> => {
      return [];
    },
    enabled: !!walletAddress,
    staleTime: 30_000,
  });

  const { data: chartData, isLoading: chartLoading } = useQuery({
    queryKey: chartDataQueryKey,
    queryFn: async (): Promise<StakingChartPoint[]> => {
      return generateMockChartData(30);
    },
    enabled: !!walletAddress,
    staleTime: 60_000,
  });

  const approve = useCallback(async (_amount: bigint): Promise<boolean> => { // eslint-disable-line @typescript-eslint/no-unused-vars
    setIsSubmitting(true);
    try {
      await new Promise((r) => setTimeout(r, 1000));
      return true;
    } finally {
      setIsSubmitting(false);
    }
  }, []);

  const stake = useCallback(
    async (_amount: bigint): Promise<boolean> => { // eslint-disable-line @typescript-eslint/no-unused-vars
      setIsSubmitting(true);
      try {
        await new Promise((r) => setTimeout(r, 1500));
        queryClient.invalidateQueries({ queryKey: portfolioQueryKey });
        queryClient.invalidateQueries({ queryKey: chartDataQueryKey });
        return true;
      } finally {
        setIsSubmitting(false);
      }
    },
    [queryClient, portfolioQueryKey, chartDataQueryKey],
  );

  const requestUnstake = useCallback(
    async (amount: bigint): Promise<boolean> => {
      setIsSubmitting(true);
      try {
        await new Promise((r) => setTimeout(r, 1500));
        const now = Date.now();
        const newRequest: UnstakeRequest = {
          amount,
          walletAddress: walletAddress ?? "",
          requestedAt: now,
          cooldownEndsAt: getCooldownEnd(now),
          status: "pending",
        };
        queryClient.setQueryData<UnstakeRequest[]>(
          unstakeRequestsQueryKey,
          (prev) => [...(prev ?? []), newRequest],
        );
        queryClient.invalidateQueries({ queryKey: portfolioQueryKey });
        return true;
      } finally {
        setIsSubmitting(false);
      }
    },
    [walletAddress, queryClient, portfolioQueryKey, unstakeRequestsQueryKey],
  );

  const claimRewards = useCallback(async (): Promise<boolean> => {
    setIsSubmitting(true);
    try {
      await new Promise((r) => setTimeout(r, 1500));
      queryClient.invalidateQueries({ queryKey: portfolioQueryKey });
      return true;
    } finally {
      setIsSubmitting(false);
    }
  }, [queryClient, portfolioQueryKey]);

  const claimUnstake = useCallback(
    async (requestId: string): Promise<boolean> => {
      setIsSubmitting(true);
      try {
        await new Promise((r) => setTimeout(r, 1500));
        queryClient.setQueryData<UnstakeRequest[]>(
          unstakeRequestsQueryKey,
          (prev) =>
            (prev ?? []).map((r) =>
              r.requestedAt.toString() === requestId
                ? { ...r, status: "claimed" as const }
                : r,
            ),
        );
        return true;
      } finally {
        setIsSubmitting(false);
      }
    },
    [queryClient, unstakeRequestsQueryKey],
  );

  const cooldownInfo = useMemo(() => {
    if (!unstakeRequests || unstakeRequests.length === 0) return null;
    const pending = unstakeRequests.filter((r) => r.status !== "claimed");
    if (pending.length === 0) return null;
    const latest = pending[pending.length - 1];
    const remaining = getCooldownRemaining(latest);
    return {
      remaining,
      formatted: formatCooldownTime(remaining),
      isComplete: remaining <= 0,
      request: latest,
    };
  }, [unstakeRequests]);

  const fetchHistoryPage = useCallback(
    async (page: number, pageSize: number = 10): Promise<RewardHistoryPage> => {
      const start = (page - 1) * pageSize;
      const records = [];
      for (let i = 0; i < pageSize; i++) {
        records.push({
          id: `rec-${start + i}`,
          amount: BigInt(Math.floor(Math.random() * 1_000_000_000_000)),
          timestamp: Date.now() - i * 86_400_000,
          type: (["stake", "unstake", "reward"] as const)[i % 3],
          txHash: `0x${Math.random().toString(16).slice(2, 18)}`,
        });
      }
      return { records, totalRecords: 50, page, pageSize };
    },
    [],
  );

  return {
    portfolio,
    portfolioLoading,
    stakeHistory,
    historyLoading,
    unstakeRequests,
    unstakeLoading,
    chartData,
    chartLoading,
    isSubmitting,
    cooldownInfo,
    approve,
    stake,
    requestUnstake,
    claimRewards,
    claimUnstake,
    fetchHistoryPage,
  };
}
