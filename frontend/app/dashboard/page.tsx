"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { API_BASE_URL } from "@/lib/api";

type DashboardSummary = {
  reporting_range: string;
  reporting_range_start: string | null;
  reporting_range_end: string | null;
  range_total_purchases: string | number;
  range_total_sales: string | number;
  range_profit: string | number;
  rewards_by_program: RewardProgramMetric[];
  rewards_by_type: RewardMetric[];
  rewards_by_card: Array<RewardMetric & { credit_card_id: number; nickname: string }>;
  rewards_by_category: Array<
    RewardMetric & { spending_category_id: number; key: string; name: string }
  >;
  total_available_inventory_face_value: string | number;
  total_card_acquisition_cost: string | number;
  available_acquisition_cost: string | number;
  pending_verification_face_value: string | number;
  pending_verification_count: number;
  awaiting_payment_total: string | number;
  awaiting_payment_expected_profit: string | number;
  settled_revenue: string | number;
  realized_profit: string | number;
  unsold_inventory_count: number;
  awaiting_payment_count: number;
  overdue_payment_count: number;
  fuel_points_available: number;
  fuel_accounts_near_target: number;
  credit_card_estimated_balances: string | number;
  credit_card_utilization_warnings: number;
  purchase_batch_count: number;
  top_buyer_by_volume: BuyerMetric | null;
  highest_profit_buyer: BuyerMetric | null;
  overdue_buyers: BuyerMetric[];
  warnings: {
    overdue_payments: Array<{
      id: number;
      brand: string;
      buyer_name: string | null;
      expected_payout: string | number | null;
      expected_payment_date: string | null;
    }>;
    fuel_accounts_near_target: Array<{
      id: number;
      retailer: string;
      current_points: number;
      target_points: number | null;
    }>;
    fuel_accounts_near_expiration: Array<{
      id: number;
      retailer: string;
      nearest_expiration_date: string;
      days_until_expiration: number;
    }>;
    high_utilization_credit_cards: Array<{
      id: number;
      nickname: string;
      issuer: string;
      current_balance: string | number | null;
      credit_limit: string | number;
      utilization_percent: number;
    }>;
  };
};

type RewardMetric = {
  rewards_type?: string;
  estimated_rewards_earned: string | number;
};

type RewardProgramMetric = RewardMetric & {
  reward_program_id: number | null;
  name: string;
  short_code: string;
  category: string;
  estimated_value_cents_per_point: string | number | null;
  estimated_value: string | number;
};

type BuyerMetric = {
  id: number;
  name: string;
  total_sales_volume?: string | number;
  profit?: string | number;
  outstanding_payouts?: string | number;
  overdue_count?: number;
};

type AppSettings = {
  multi_player_mode_enabled: boolean;
};

type Player = {
  id: number;
  label: string;
  name: string | null;
  active: boolean;
};

type MetricCardProps = {
  href: string;
  label: string;
  value: string;
  tone?: "default" | "green" | "yellow" | "red";
};

function formatCurrency(value: string | number | null) {
  const amount = Number(value ?? 0);

  if (Number.isNaN(amount)) {
    return String(value);
  }

  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(amount);
}

function formatNumber(value: number) {
  return new Intl.NumberFormat("en-US").format(value);
}

function formatRewardAmount(reward: RewardProgramMetric) {
  const amount = Number(reward.estimated_rewards_earned);

  if (reward.category === "Cashback") {
    return formatCurrency(amount);
  }

  return `${formatNumber(amount)} pts`;
}

function formatDate(value: string | null) {
  if (!value) {
    return "";
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

function cardToneClass(tone: MetricCardProps["tone"]) {
  if (tone === "green") {
    return "border-emerald-200 bg-emerald-50";
  }

  if (tone === "yellow") {
    return "border-yellow-200 bg-yellow-50";
  }

  if (tone === "red") {
    return "border-red-200 bg-red-50";
  }

  return "border-slate-200 bg-white";
}

function MetricCard({ href, label, value, tone = "default" }: MetricCardProps) {
  return (
    <Link
      className={`block rounded-lg border p-4 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md active:translate-y-0 ${cardToneClass(
        tone,
      )}`}
      href={href}
    >
      <p className="text-sm font-medium text-slate-600">{label}</p>
      <p className="mt-2 text-2xl font-semibold tracking-tight text-slate-950">
        {value}
      </p>
    </Link>
  );
}

export default function DashboardPage() {
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [reportingRange, setReportingRange] = useState("this_month");
  const [selectedPlayerId, setSelectedPlayerId] = useState("ALL");
  const [players, setPlayers] = useState<Player[]>([]);
  const [isMultiPlayerModeEnabled, setIsMultiPlayerModeEnabled] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      async function loadSummary() {
        setIsLoading(true);
        setError(null);

        try {
          const params = new URLSearchParams({ range: reportingRange });

          if (selectedPlayerId !== "ALL") {
            params.set("player_id", selectedPlayerId);
          }

          const response = await fetch(
            `${API_BASE_URL}/dashboard/summary?${params.toString()}`,
          );

          if (!response.ok) {
            throw new Error(`Failed to load dashboard (${response.status})`);
          }

          const data = (await response.json()) as DashboardSummary;
          setSummary(data);
        } catch (err) {
          setError(
            err instanceof Error ? err.message : "Failed to load dashboard.",
          );
        } finally {
          setIsLoading(false);
        }
      }

      void loadSummary();
    }, 0);

    return () => window.clearTimeout(timeoutId);
  }, [reportingRange, selectedPlayerId]);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      async function loadPlayerSettings() {
        try {
          const [settingsResponse, playersResponse] = await Promise.all([
            fetch(`${API_BASE_URL}/app-settings`),
            fetch(`${API_BASE_URL}/players/`),
          ]);

          if (!settingsResponse.ok || !playersResponse.ok) {
            return;
          }

          const settings = (await settingsResponse.json()) as AppSettings;
          setIsMultiPlayerModeEnabled(settings.multi_player_mode_enabled);
          setPlayers((await playersResponse.json()) as Player[]);
        } catch {
          setIsMultiPlayerModeEnabled(false);
          setPlayers([]);
        }
      }

      void loadPlayerSettings();
    }, 0);

    return () => window.clearTimeout(timeoutId);
  }, []);

  const warningCount = useMemo(() => {
    if (!summary) {
      return 0;
    }

    return (
      summary.warnings.overdue_payments.length +
      summary.warnings.fuel_accounts_near_expiration.length +
      summary.warnings.high_utilization_credit_cards.length
    );
  }, [summary]);

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-8 text-slate-950 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-7xl space-y-6">
        <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-sm font-medium uppercase tracking-wide text-slate-500">
              Operations
            </p>
            <h1 className="mt-1 text-3xl font-semibold tracking-tight">
              MS Tracker Dashboard
            </h1>
          </div>
          <div className="flex flex-wrap gap-2">
            <select
              className="h-10 rounded-md border border-slate-300 bg-white px-3 text-sm font-semibold"
              onChange={(event) => setReportingRange(event.target.value)}
              value={reportingRange}
            >
              <option value="this_month">This month</option>
              <option value="last_month">Last month</option>
              <option value="ytd">YTD</option>
              <option value="all_time">All time</option>
            </select>
            {isMultiPlayerModeEnabled ? (
              <select
                className="h-10 rounded-md border border-slate-300 bg-white px-3 text-sm font-semibold"
                onChange={(event) => setSelectedPlayerId(event.target.value)}
                value={selectedPlayerId}
              >
                <option value="ALL">All players</option>
                {players
                  .filter((player) => player.active)
                  .map((player) => (
                    <option key={player.id} value={String(player.id)}>
                      {player.label}
                      {player.name ? ` · ${player.name}` : ""}
                    </option>
                  ))}
              </select>
            ) : null}
          </div>
        </header>

        {error ? (
          <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-800">
            {error}
          </div>
        ) : null}

        {isLoading ? (
          <div className="rounded-lg border border-slate-200 bg-white p-8 text-center text-sm text-slate-500">
            Loading dashboard...
          </div>
        ) : null}

        {summary ? (
          <>
            <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <MetricCard
                href="/purchases"
                label="Purchases in Range"
                value={formatCurrency(summary.range_total_purchases)}
              />
              <MetricCard
                href="/sales?date_range=active"
                label="Gross Sales in Range"
                value={formatCurrency(summary.range_total_sales)}
              />
              <MetricCard
                href="/sales?focus=profit"
                label="Profit in Range"
                tone={Number(summary.range_profit) >= 0 ? "green" : "red"}
                value={formatCurrency(summary.range_profit)}
              />
              <MetricCard
                href="/rewards"
                label="Rewards Programs"
                value={formatNumber(
                  summary.rewards_by_program.filter(
                    (reward) => Number(reward.estimated_rewards_earned) > 0,
                  ).length,
                )}
              />
              <MetricCard
                href="/inventory?status=available"
                label="Available Inventory Face Value"
                value={formatCurrency(
                  summary.total_available_inventory_face_value,
                )}
              />
              <MetricCard
                href="/inventory?status=available"
                label="Total Card Acquisition Cost"
                value={formatCurrency(summary.total_card_acquisition_cost)}
              />
              <MetricCard
                href="/inventory?status=available"
                label="Available Acquisition Cost"
                value={formatCurrency(summary.available_acquisition_cost)}
              />
              <MetricCard
                href="/inventory?status=needs_verification"
                label="Pending Verification Face Value"
                tone={summary.pending_verification_count > 0 ? "yellow" : "default"}
                value={formatCurrency(summary.pending_verification_face_value)}
              />
              <MetricCard
                href="/inventory?status=needs_verification"
                label="Pending Verification Count"
                tone={summary.pending_verification_count > 0 ? "yellow" : "default"}
                value={formatNumber(summary.pending_verification_count)}
              />
              <MetricCard
                href="/sales?status=awaiting_payment"
                label="Awaiting Payment Total"
                tone={summary.overdue_payment_count > 0 ? "red" : "yellow"}
                value={formatCurrency(summary.awaiting_payment_total)}
              />
              <MetricCard
                href="/sales?status=awaiting_payment&focus=profit"
                label="Awaiting Payment Expected Profit"
                tone={
                  Number(summary.awaiting_payment_expected_profit) >= 0
                    ? "green"
                    : "red"
                }
                value={formatCurrency(summary.awaiting_payment_expected_profit)}
              />
              <MetricCard
                href="/sales?status=settled"
                label="Settled Revenue"
                tone="green"
                value={formatCurrency(summary.settled_revenue)}
              />
              <MetricCard
                href="/sales?status=settled&focus=profit"
                label="Realized Profit"
                tone={Number(summary.realized_profit) >= 0 ? "green" : "red"}
                value={formatCurrency(summary.realized_profit)}
              />
              <MetricCard
                href="/inventory?status=available"
                label="Unsold Inventory Count"
                value={formatNumber(summary.unsold_inventory_count)}
              />
              <MetricCard
                href="/sales?status=awaiting_payment"
                label="Awaiting Payment Count"
                value={formatNumber(summary.awaiting_payment_count)}
              />
              <MetricCard
                href="/sales?status=awaiting_payment"
                label="Overdue Payment Count"
                tone={summary.overdue_payment_count > 0 ? "red" : "default"}
                value={formatNumber(summary.overdue_payment_count)}
              />
              <MetricCard
                href="/fuel-accounts?status=available"
                label="Fuel Points Available"
                value={formatNumber(summary.fuel_points_available)}
              />
              <MetricCard
                href="/fuel-accounts?filter=near_target"
                label="Fuel Accounts Near Target"
                tone={summary.fuel_accounts_near_target > 0 ? "green" : "default"}
                value={formatNumber(summary.fuel_accounts_near_target)}
              />
              <MetricCard
                href="/credit-cards?focus=utilization"
                label="Credit Card Estimated Balances"
                value={formatCurrency(summary.credit_card_estimated_balances)}
              />
              <MetricCard
                href="/credit-cards?filter=utilization_warning"
                label="Credit Card Utilization Warnings"
                tone={
                  summary.credit_card_utilization_warnings > 0
                    ? "yellow"
                    : "default"
                }
                value={formatNumber(summary.credit_card_utilization_warnings)}
              />
              <MetricCard
                href={
                  summary.top_buyer_by_volume
                    ? `/buyers/${summary.top_buyer_by_volume.id}`
                    : "/buyers"
                }
                label="Top Buyer by Volume"
                value={
                  summary.top_buyer_by_volume
                    ? `${summary.top_buyer_by_volume.name} · ${formatCurrency(
                        summary.top_buyer_by_volume.total_sales_volume ?? 0,
                      )}`
                    : "-"
                }
              />
              <MetricCard
                href={
                  summary.highest_profit_buyer
                    ? `/buyers/${summary.highest_profit_buyer.id}`
                    : "/buyers"
                }
                label="Highest Profit Buyer"
                tone="green"
                value={
                  summary.highest_profit_buyer
                    ? `${summary.highest_profit_buyer.name} · ${formatCurrency(
                        summary.highest_profit_buyer.profit ?? 0,
                      )}`
                    : "-"
                }
              />
              <MetricCard
                href="/buyers"
                label="Overdue Buyers"
                tone={summary.overdue_buyers.length > 0 ? "red" : "default"}
                value={formatNumber(summary.overdue_buyers.length)}
              />
            </section>

            <section className="grid gap-4 lg:grid-cols-3">
              <RewardPanel
                emptyText="No estimated rewards in this range."
                href="/rewards"
                title="Rewards Snapshot"
              >
                {summary.rewards_by_program.map((reward) => (
                  <Link
                    className="flex justify-between rounded-md bg-white px-3 py-2"
                    href={`/rewards?program=${reward.short_code}`}
                    key={reward.reward_program_id ?? reward.short_code}
                  >
                    <span>
                      <span className="font-semibold">{reward.short_code}</span>
                      <span className="ml-2 text-xs text-slate-500">
                        {reward.name}
                      </span>
                    </span>
                    <span className="text-right font-semibold">
                      {formatRewardAmount(reward)}
                      {Number(reward.estimated_value) > 0 ? (
                        <span className="block text-xs font-medium text-slate-500">
                          ~{formatCurrency(reward.estimated_value)} value
                        </span>
                      ) : null}
                    </span>
                  </Link>
                ))}
              </RewardPanel>
              <RewardPanel
                emptyText="No card rewards in this range."
                href="/rewards?view=cards"
                title="Rewards by Card"
              >
                {summary.rewards_by_card.slice(0, 8).map((reward) => (
                  <Link
                    className="flex justify-between rounded-md bg-white px-3 py-2"
                    href={`/rewards?card=${reward.credit_card_id}`}
                    key={reward.credit_card_id}
                  >
                    <span>{reward.nickname}</span>
                    <span className="font-semibold">
                      {formatNumber(Number(reward.estimated_rewards_earned))}
                    </span>
                  </Link>
                ))}
              </RewardPanel>
              <RewardPanel
                emptyText="No category rewards in this range."
                href="/rewards?view=categories"
                title="Rewards by Category"
              >
                {summary.rewards_by_category.slice(0, 8).map((reward) => (
                  <Link
                    className="flex justify-between rounded-md bg-white px-3 py-2"
                    href={`/rewards?category=${reward.key}`}
                    key={reward.spending_category_id}
                  >
                    <span>{reward.name}</span>
                    <span className="font-semibold">
                      {formatNumber(Number(reward.estimated_rewards_earned))}
                    </span>
                  </Link>
                ))}
              </RewardPanel>
            </section>

            <section className="grid gap-4 lg:grid-cols-3">
              <WarningPanel
                emptyText="No overdue payouts."
                href="/sales?status=awaiting_payment"
                title="Overdue Payouts"
                tone={summary.warnings.overdue_payments.length > 0 ? "red" : "default"}
              >
                {summary.warnings.overdue_payments.map((payment) => (
                  <li key={payment.id} className="rounded-md bg-white px-3 py-2">
                    <div className="flex items-center justify-between gap-3">
                      <span className="font-medium">{payment.brand}</span>
                      <span>{formatCurrency(payment.expected_payout)}</span>
                    </div>
                    <p className="text-xs text-slate-500">
                      {payment.buyer_name ?? "No buyer"} · Due{" "}
                      {formatDate(payment.expected_payment_date)}
                    </p>
                  </li>
                ))}
              </WarningPanel>

              <WarningPanel
                emptyText="No fuel expiration warnings."
                href="/fuel-accounts?filter=expiring"
                title="Fuel Expiration"
                tone={
                  summary.warnings.fuel_accounts_near_expiration.length > 0
                    ? "yellow"
                    : "default"
                }
              >
                {summary.warnings.fuel_accounts_near_expiration.map((account) => (
                  <li key={account.id} className="rounded-md bg-white px-3 py-2">
                    <div className="flex items-center justify-between gap-3">
                      <span className="font-medium">{account.retailer}</span>
                      <span>{account.days_until_expiration}d</span>
                    </div>
                    <p className="text-xs text-slate-500">
                      Expires {formatDate(account.nearest_expiration_date)}
                    </p>
                  </li>
                ))}
              </WarningPanel>

              <WarningPanel
                emptyText="No high utilization cards."
                href="/credit-cards?filter=utilization_warning"
                title="Credit Exposure"
                tone={
                  summary.warnings.high_utilization_credit_cards.length > 0
                    ? "yellow"
                    : "default"
                }
              >
                {summary.warnings.high_utilization_credit_cards.map((card) => (
                  <li key={card.id} className="rounded-md bg-white px-3 py-2">
                    <div className="flex items-center justify-between gap-3">
                      <span className="font-medium">{card.nickname}</span>
                      <span>{card.utilization_percent.toFixed(1)}%</span>
                    </div>
                    <p className="text-xs text-slate-500">
                      {card.issuer} · {formatCurrency(card.current_balance)} of{" "}
                      {formatCurrency(card.credit_limit)}
                    </p>
                  </li>
                ))}
              </WarningPanel>
            </section>

            <section
              className={`rounded-lg border p-4 text-sm shadow-sm ${
                warningCount > 0
                  ? "border-yellow-200 bg-yellow-50 text-yellow-900"
                  : "border-emerald-200 bg-emerald-50 text-emerald-900"
              }`}
            >
              {warningCount > 0
                ? `${warningCount} operational warning${
                    warningCount === 1 ? "" : "s"
                  } need attention.`
                : "No urgent dashboard warnings."}
            </section>
          </>
        ) : null}
      </div>
    </main>
  );
}

function WarningPanel({
  title,
  href,
  tone,
  emptyText,
  children,
}: {
  title: string;
  href: string;
  tone: "default" | "red" | "yellow";
  emptyText: string;
  children: React.ReactNode;
}) {
  const hasItems = Array.isArray(children) ? children.length > 0 : Boolean(children);

  return (
    <section
      className={`rounded-lg border p-4 shadow-sm ${
        tone === "red"
          ? "border-red-200 bg-red-50"
          : tone === "yellow"
            ? "border-yellow-200 bg-yellow-50"
            : "border-slate-200 bg-white"
      }`}
    >
      <div className="flex items-center justify-between gap-3">
        <h2 className="font-semibold">{title}</h2>
        <Link
          className="text-sm font-semibold text-slate-700 hover:text-slate-950"
          href={href}
        >
          View
        </Link>
      </div>
      {hasItems ? (
        <ul className="mt-3 space-y-2 text-sm">{children}</ul>
      ) : (
        <p className="mt-3 text-sm text-slate-500">{emptyText}</p>
      )}
    </section>
  );
}

function RewardPanel({
  title,
  emptyText,
  children,
  href,
}: {
  title: string;
  emptyText: string;
  children: React.ReactNode;
  href?: string;
}) {
  const hasItems = Array.isArray(children) ? children.length > 0 : Boolean(children);

  return (
    <section className="rounded-lg border border-slate-200 bg-slate-50 p-4 shadow-sm">
      {href ? (
        <Link className="font-semibold hover:underline" href={href}>
          {title}
        </Link>
      ) : (
        <h2 className="font-semibold">{title}</h2>
      )}
      {hasItems ? (
        <ul className="mt-3 space-y-2 text-sm">{children}</ul>
      ) : (
        <p className="mt-3 text-sm text-slate-500">{emptyText}</p>
      )}
    </section>
  );
}
