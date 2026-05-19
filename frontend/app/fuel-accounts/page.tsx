"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

import { API_BASE_URL } from "@/lib/api";

type FuelAccountDashboardRow = {
  id: number;
  retailer: string;
  email: string | null;
  alt_id: string | null;
  status: string;
  target_points: number | null;
  current_points: number;
  remaining_to_target: number | null;
  nearest_expiration_date: string | null;
  expiration_cycle: string | null;
  entries_count: number;
};

type SortOption = "closest" | "expiration" | "balance";

function formatNumber(value: number | null) {
  if (value === null) {
    return "-";
  }

  return value.toLocaleString();
}

function formatDate(value: string | null) {
  if (!value) {
    return "-";
  }

  const date = new Date(`${value}T00:00:00`);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date);
}

function formatCycle(value: string | null) {
  return value ? formatDate(value) : "Fresh";
}

function getDaysUntil(value: string | null) {
  if (!value) {
    return null;
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const expiration = new Date(`${value}T00:00:00`);

  if (Number.isNaN(expiration.getTime())) {
    return null;
  }

  return Math.ceil((expiration.getTime() - today.getTime()) / 86400000);
}

function getProgressPercent(account: FuelAccountDashboardRow) {
  if (!account.target_points || account.target_points <= 0) {
    return null;
  }

  return Math.min(
    100,
    Math.round((account.current_points / account.target_points) * 100),
  );
}

function getProgressBarClass(progressPercent: number | null) {
  if (progressPercent === null) {
    return "bg-slate-300";
  }

  if (progressPercent >= 100) {
    return "bg-emerald-600";
  }

  if (progressPercent > 75) {
    return "bg-amber-500";
  }

  return "bg-blue-600";
}

function getIndicator(account: FuelAccountDashboardRow) {
  const daysUntilExpiration = getDaysUntil(account.nearest_expiration_date);

  if (
    daysUntilExpiration !== null &&
    daysUntilExpiration >= 0 &&
    daysUntilExpiration <= 7
  ) {
    return {
      label: "Expiring soon",
      className: "border-red-300 bg-red-50 text-red-800",
    };
  }

  if (
    daysUntilExpiration !== null &&
    daysUntilExpiration >= 0 &&
    daysUntilExpiration <= 14
  ) {
    return {
      label: "Expires within 14 days",
      className: "border-amber-300 bg-amber-50 text-amber-800",
    };
  }

  if (
    account.target_points !== null &&
    account.current_points >= account.target_points
  ) {
    return {
      label: "Target reached",
      className: "border-emerald-300 bg-emerald-50 text-emerald-800",
    };
  }

  if (
    account.remaining_to_target !== null &&
    account.remaining_to_target <= 2000
  ) {
    return {
      label: "Near target",
      className: "border-amber-300 bg-amber-50 text-amber-800",
    };
  }

  return {
    label: "Tracking",
    className: "border-slate-200 bg-slate-50 text-slate-700",
  };
}

export default function FuelAccountsPage() {
  const [accounts, setAccounts] = useState<FuelAccountDashboardRow[]>([]);
  const [sortOption, setSortOption] = useState<SortOption>("closest");
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadAccounts = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch(`${API_BASE_URL}/fuel-accounts/dashboard`);

      if (!response.ok) {
        throw new Error(`Failed to load fuel accounts (${response.status})`);
      }

      const data = (await response.json()) as FuelAccountDashboardRow[];
      setAccounts(data);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to load fuel accounts.",
      );
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    queueMicrotask(() => {
      void loadAccounts();
    });
  }, [loadAccounts]);

  const activeAccounts = useMemo(
    () =>
      accounts
        .filter((account) => account.status === "ACTIVE")
        .sort((first, second) => {
          if (sortOption === "expiration") {
            const firstTime = first.nearest_expiration_date
              ? new Date(`${first.nearest_expiration_date}T00:00:00`).getTime()
              : Number.POSITIVE_INFINITY;
            const secondTime = second.nearest_expiration_date
              ? new Date(`${second.nearest_expiration_date}T00:00:00`).getTime()
              : Number.POSITIVE_INFINITY;

            return firstTime - secondTime;
          }

          if (sortOption === "balance") {
            return second.current_points - first.current_points;
          }

          const firstRemaining =
            first.remaining_to_target ?? Number.POSITIVE_INFINITY;
          const secondRemaining =
            second.remaining_to_target ?? Number.POSITIVE_INFINITY;

          return firstRemaining - secondRemaining;
        }),
    [accounts, sortOption],
  );

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-8 text-slate-950 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-6xl space-y-6">
        <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-sm font-medium text-slate-500">Fuel Rewards</p>
            <h1 className="mt-1 text-3xl font-semibold tracking-tight">
              Fuel Accounts
            </h1>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <label className="flex items-center gap-2 text-sm font-medium text-slate-700">
              <span>Sort</span>
              <select
                className="h-11 cursor-pointer rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-950 outline-none transition hover:bg-slate-50 focus:border-slate-500 focus:ring-2 focus:ring-slate-200"
                onChange={(event) =>
                  setSortOption(event.target.value as SortOption)
                }
                value={sortOption}
              >
                <option value="closest">Closest to target</option>
                <option value="expiration">Expiration soonest</option>
                <option value="balance">Highest balance</option>
              </select>
            </label>
            <button
              className="h-11 cursor-pointer rounded-md border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-700 transition hover:bg-slate-100 active:bg-slate-200 disabled:cursor-not-allowed disabled:opacity-60"
              disabled={isLoading}
              onClick={loadAccounts}
              type="button"
            >
              {isLoading ? "Loading..." : "Refresh"}
            </button>
          </div>
        </header>

        {error ? (
          <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-800">
            {error}
          </div>
        ) : null}

        {isLoading ? (
          <div className="rounded-lg border border-slate-200 bg-white px-6 py-12 text-center text-sm text-slate-500 shadow-sm">
            Loading fuel accounts...
          </div>
        ) : activeAccounts.length === 0 ? (
          <div className="rounded-lg border border-slate-200 bg-white px-6 py-12 text-center text-sm text-slate-500 shadow-sm">
            No active fuel accounts found.
          </div>
        ) : (
          <>
            <div className="grid gap-4 lg:hidden">
              {activeAccounts.map((account) => {
                const indicator = getIndicator(account);
                const progressPercent = getProgressPercent(account);
                const progressBarClass = getProgressBarClass(progressPercent);

                return (
                  <article
                    className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm"
                    key={account.id}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <h2 className="text-lg font-semibold">
                          {account.retailer}
                        </h2>
                        <p className="mt-1 truncate text-sm text-slate-500">
                          {account.email || account.alt_id || "-"}
                        </p>
                      </div>
                      <span
                        className={`shrink-0 rounded-full border px-2 py-1 text-xs font-semibold ${indicator.className}`}
                      >
                        {indicator.label}
                      </span>
                    </div>

                    <div className="mt-4 grid grid-cols-3 gap-2 text-center">
                      <div className="rounded-md bg-slate-50 p-3">
                        <p className="text-xs font-semibold text-slate-500">
                          Current
                        </p>
                        <p className="mt-1 text-lg font-bold">
                          {formatNumber(account.current_points)}
                        </p>
                      </div>
                      <div className="rounded-md bg-slate-50 p-3">
                        <p className="text-xs font-semibold text-slate-500">
                          Target
                        </p>
                        <p className="mt-1 text-lg font-bold">
                          {formatNumber(account.target_points)}
                        </p>
                      </div>
                      <div className="rounded-md bg-slate-50 p-3">
                        <p className="text-xs font-semibold text-slate-500">
                          Expires
                        </p>
                        <p className="mt-1 text-sm font-bold">
                          {formatDate(account.nearest_expiration_date)}
                        </p>
                      </div>
                    </div>

                    <div className="mt-4">
                      <div className="flex justify-between text-xs font-medium text-slate-600">
                        <span>
                          {progressPercent !== null
                            ? `${progressPercent}%`
                            : "No target"}
                        </span>
                        <span>{formatCycle(account.expiration_cycle)}</span>
                      </div>
                      <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-200">
                        <div
                          className={`h-full rounded-full ${progressBarClass}`}
                          style={{ width: `${progressPercent ?? 0}%` }}
                        />
                      </div>
                    </div>

                    <div className="mt-4 grid gap-2 sm:grid-cols-2">
                      <Link
                        className="flex h-11 cursor-pointer items-center justify-center rounded-md bg-slate-900 px-4 text-sm font-semibold text-white transition hover:bg-slate-700 active:bg-slate-800"
                        href={`/fuel-accounts/${account.id}/barcode`}
                      >
                        Open Barcode
                      </Link>
                      <Link
                        className="flex h-11 cursor-pointer items-center justify-center rounded-md border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-700 transition hover:bg-slate-100 active:bg-slate-200"
                        href={`/fuel-accounts/${account.id}`}
                      >
                        Details
                      </Link>
                    </div>
                  </article>
                );
              })}
            </div>

            <div className="hidden overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm lg:block">
              <table className="min-w-full divide-y divide-slate-200 text-sm">
                <thead className="bg-slate-100 text-left text-xs font-semibold uppercase tracking-wide text-slate-600">
                  <tr>
                    <th className="px-5 py-3">Retailer</th>
                    <th className="px-5 py-3">Current</th>
                    <th className="px-5 py-3">Progress</th>
                    <th className="px-5 py-3">Target</th>
                    <th className="px-5 py-3">Expiration</th>
                    <th className="px-5 py-3">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 bg-white">
                  {activeAccounts.map((account) => {
                    const progressPercent = getProgressPercent(account);
                    const progressBarClass = getProgressBarClass(progressPercent);
                    const isReadyToSell =
                      account.target_points !== null &&
                      account.current_points >= account.target_points;

                    return (
                      <tr key={account.id} className="hover:bg-slate-50">
                        <td className="whitespace-nowrap px-5 py-4 font-semibold">
                          <div>{account.retailer}</div>
                          <div className="mt-1 text-xs font-normal text-slate-500">
                            {account.email || account.alt_id || "-"}
                          </div>
                        </td>
                        <td className="whitespace-nowrap px-5 py-4 font-semibold">
                          {formatNumber(account.current_points)}
                        </td>
                        <td className="min-w-44 px-5 py-4">
                          <div className="flex items-center justify-between gap-3 text-xs font-medium text-slate-600">
                            <span>
                              {progressPercent !== null
                                ? `${progressPercent}%`
                                : "No target"}
                            </span>
                            {isReadyToSell ? (
                              <span className="rounded-full bg-emerald-100 px-2 py-1 font-semibold text-emerald-800">
                                Ready to Sell
                              </span>
                            ) : null}
                          </div>
                          <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-200">
                            <div
                              className={`h-full rounded-full ${progressBarClass}`}
                              style={{ width: `${progressPercent ?? 0}%` }}
                            />
                          </div>
                        </td>
                        <td className="whitespace-nowrap px-5 py-4 text-slate-700">
                          {formatNumber(account.target_points)}
                        </td>
                        <td className="whitespace-nowrap px-5 py-4 text-slate-700">
                          <div>{formatDate(account.nearest_expiration_date)}</div>
                          <div className="mt-1 text-xs text-slate-500">
                            {formatCycle(account.expiration_cycle)}
                          </div>
                        </td>
                        <td className="whitespace-nowrap px-5 py-4">
                          <div className="flex flex-col gap-2 xl:flex-row">
                            <Link
                              className="inline-flex h-10 cursor-pointer items-center justify-center rounded-md bg-slate-900 px-4 text-sm font-semibold text-white transition hover:bg-slate-700 active:bg-slate-800"
                              href={`/fuel-accounts/${account.id}/barcode`}
                            >
                              Open Barcode
                            </Link>
                            <Link
                              className="inline-flex h-10 cursor-pointer items-center justify-center rounded-md border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-700 transition hover:bg-slate-100 active:bg-slate-200"
                              href={`/fuel-accounts/${account.id}`}
                            >
                              Details
                            </Link>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </main>
  );
}
