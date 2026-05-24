"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { API_BASE_URL } from "@/lib/api";

type DashboardSummary = {
  total_available_inventory_face_value: string | number;
  available_acquisition_cost: string | number;
  awaiting_payment_total: string | number;
  awaiting_payment_expected_profit: string | number;
  credit_card_estimated_balances: string | number;
  pending_verification_count: number;
  pending_verification_face_value: string | number;
  awaiting_payment_count: number;
  overdue_payment_count: number;
  purchases_needing_receipts_count: number;
  unsold_inventory_count: number;
  fuel_points_available: number;
  fuel_points_earned: string | number;
  fuel_accounts_near_target: number;
  credit_card_utilization_warnings: number;
  range_profit: string | number;
  range_total_sales: string | number;
  settled_revenue: string | number;
  realized_profit: string | number;
  rewards_by_program: RewardProgramMetric[];
  rewards_by_type: RewardMetric[];
  warnings: {
    fuel_accounts_near_expiration: FuelExpirationWarning[];
    high_utilization_credit_cards: CreditUtilizationWarning[];
    overdue_payments: OverduePaymentWarning[];
  };
  overdue_buyers: BuyerWarning[];
};

type RewardMetric = {
  rewards_type: string;
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

type FuelExpirationWarning = {
  id: number;
  retailer: string;
  nearest_expiration_date: string;
  days_until_expiration: number;
};

type CreditUtilizationWarning = {
  id: number;
  nickname: string;
  current_balance: string | number | null;
  credit_limit: string | number | null;
  utilization_percent: number;
};

type OverduePaymentWarning = {
  id: number;
  brand: string;
  buyer_name: string | null;
  expected_payout: string | number | null;
  expected_payment_date: string | null;
};

type BuyerWarning = {
  id: number;
  name: string;
  outstanding_payouts: string | number;
  overdue_count: number;
};

type CreditCard = {
  id: number;
  nickname: string;
  current_balance: string | number | null;
  credit_limit: string | number | null;
  statement_remaining: string | number | null;
  minimum_payment_due: string | number | null;
  minimum_payment_paid: boolean;
  minimum_payment_missing: boolean;
  interest_risk: boolean;
  payment_due_date: string | null;
  next_statement_close_date: string | null;
  is_active: boolean;
};

type PurchaseBatch = {
  id: number;
  store_name: string;
  purchase_date: string;
  created_at: string | null;
  total_amount: string | number;
  purchase_total_paid: string | number | null;
  calculated_card_face_value: string | number | null;
  card_count: number;
  receipt_count?: number;
};

type Sale = {
  id: number;
  buyer_name: string | null;
  sold_at: string;
  created_at: string | null;
  expected_payment_date: string | null;
  expected_payout: string | number;
  payout_received: string | number | null;
  status: string;
};

type FuelAccount = {
  id: number;
  retailer: string;
  email: string | null;
  current_points: number;
  target_points: number | null;
  nearest_expiration_date: string | null;
  expiration_cycle: string | null;
  status: string;
};

type GiftCard = {
  id: number;
  brand: string;
  status: string;
  purchase_batch_id: number;
  created_at: string | null;
  updated_at: string | null;
};

type ActivityItem = {
  id: string;
  label: string;
  detail: string;
  href: string;
  date: string;
  tone: "normal" | "warning" | "success" | "danger";
};

function numericValue(value: string | number | null | undefined) {
  const amount = Number(value ?? 0);
  return Number.isFinite(amount) ? amount : 0;
}

function formatCurrency(value: string | number | null | undefined) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(numericValue(value));
}

function formatNumber(value: string | number | null | undefined) {
  return new Intl.NumberFormat("en-US").format(numericValue(value));
}

function formatDate(value: string | null | undefined) {
  if (!value) {
    return "-";
  }

  const date = value.includes("T")
    ? new Date(value)
    : new Date(`${value}T00:00:00`);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
  }).format(date);
}

function daysUntil(value: string | null | undefined) {
  if (!value) {
    return null;
  }

  const date = value.includes("T")
    ? new Date(value)
    : new Date(`${value}T00:00:00`);

  if (Number.isNaN(date.getTime())) {
    return null;
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  date.setHours(0, 0, 0, 0);

  return Math.round((date.getTime() - today.getTime()) / 86_400_000);
}

function dueLabel(value: string | null | undefined, prefix = "") {
  const days = daysUntil(value);

  if (days === null) {
    return "-";
  }

  if (days < 0) {
    return `overdue ${Math.abs(days)}d (${formatDate(value)})`;
  }

  return `${prefix}${days}d (${formatDate(value)})`;
}

async function fetchJson<T>(endpoint: string, label: string): Promise<T> {
  const response = await fetch(endpoint);

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    console.error("Home dashboard fetch failed", {
      label,
      endpoint,
      status: response.status,
      body,
    });
    throw new Error(`Failed to load ${label} (${response.status})`);
  }

  return (await response.json()) as T;
}

export default function HomePage() {
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [ytdSummary, setYtdSummary] = useState<DashboardSummary | null>(null);
  const [creditCards, setCreditCards] = useState<CreditCard[]>([]);
  const [batches, setBatches] = useState<PurchaseBatch[]>([]);
  const [sales, setSales] = useState<Sale[]>([]);
  const [fuelAccounts, setFuelAccounts] = useState<FuelAccount[]>([]);
  const [giftCards, setGiftCards] = useState<GiftCard[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dashboardLoadedAt] = useState(() => Date.now());

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      async function loadHome() {
        setIsLoading(true);
        setError(null);

        try {
          const [
            monthlySummary,
            ytdMetrics,
            cardData,
            batchData,
            saleData,
            fuelData,
            giftCardData,
          ] = await Promise.all([
            fetchJson<DashboardSummary>(
              `${API_BASE_URL}/dashboard/summary?range=this_month`,
              "monthly dashboard summary",
            ),
            fetchJson<DashboardSummary>(
              `${API_BASE_URL}/dashboard/summary?range=ytd`,
              "YTD dashboard summary",
            ),
            fetchJson<CreditCard[]>(`${API_BASE_URL}/credit-cards`, "credit cards"),
            fetchJson<PurchaseBatch[]>(
              `${API_BASE_URL}/purchase-batches/`,
              "purchase batches",
            ),
            fetchJson<Sale[]>(`${API_BASE_URL}/sales/`, "sales"),
            fetchJson<FuelAccount[]>(
              `${API_BASE_URL}/fuel-accounts/dashboard`,
              "fuel accounts",
            ),
            fetchJson<GiftCard[]>(`${API_BASE_URL}/gift-cards/`, "gift cards"),
          ]);

          setSummary(monthlySummary);
          setYtdSummary(ytdMetrics);
          setCreditCards(cardData);
          setBatches(batchData);
          setSales(saleData);
          setFuelAccounts(fuelData);
          setGiftCards(giftCardData);
        } catch (err) {
          setError(
            err instanceof Error
              ? err.message
              : "Failed to load operations dashboard.",
          );
        } finally {
          setIsLoading(false);
        }
      }

      void loadHome();
    }, 0);

    return () => window.clearTimeout(timeoutId);
  }, []);

  const activeCreditCards = useMemo(
    () => creditCards.filter((card) => card.is_active),
    [creditCards],
  );

  const creditUtilizationExposure = useMemo(() => {
    const totalBalance = activeCreditCards.reduce(
      (total, card) => total + numericValue(card.current_balance),
      0,
    );
    const totalLimit = activeCreditCards.reduce(
      (total, card) => total + numericValue(card.credit_limit),
      0,
    );

    return totalLimit > 0 ? (totalBalance / totalLimit) * 100 : 0;
  }, [activeCreditCards]);

  const outstandingStatementBalances = useMemo(
    () =>
      activeCreditCards.reduce(
        (total, card) => total + numericValue(card.statement_remaining),
        0,
      ),
    [activeCreditCards],
  );

  const statementsClosingSoon = useMemo(
    () =>
      activeCreditCards
        .filter((card) => {
          const days = daysUntil(card.next_statement_close_date);
          return days !== null && days <= 7 && numericValue(card.current_balance) > 0;
        })
        .sort(
          (cardA, cardB) =>
            (daysUntil(cardA.next_statement_close_date) ?? 999) -
            (daysUntil(cardB.next_statement_close_date) ?? 999),
        )
        .slice(0, 5),
    [activeCreditCards],
  );

  const paymentsDueSoon = useMemo(
    () =>
      activeCreditCards
        .filter((card) => {
          const days = daysUntil(card.payment_due_date);
          return (
            days !== null &&
            days <= 7 &&
            (card.minimum_payment_missing || card.interest_risk)
          );
        })
        .sort(
          (cardA, cardB) =>
            (daysUntil(cardA.payment_due_date) ?? 999) -
            (daysUntil(cardB.payment_due_date) ?? 999),
        )
        .slice(0, 5),
    [activeCreditCards],
  );

  const fuelExpiringSoon = useMemo(
    () =>
      fuelAccounts
        .filter((account) => {
          const days = daysUntil(account.nearest_expiration_date);
          return account.status === "ACTIVE" && days !== null && days <= 14;
        })
        .sort(
          (accountA, accountB) =>
            (daysUntil(accountA.nearest_expiration_date) ?? 999) -
            (daysUntil(accountB.nearest_expiration_date) ?? 999),
        )
        .slice(0, 5),
    [fuelAccounts],
  );

  const recentActivity = useMemo<ActivityItem[]>(() => {
    const purchaseItems = batches.map((batch) => ({
      id: `purchase-${batch.id}`,
      label: `Purchase #${batch.id}`,
      detail: `${batch.store_name} · ${formatCurrency(
        batch.purchase_total_paid ?? batch.total_amount,
      )}`,
      href: `/purchases/${batch.id}`,
      date: batch.created_at ?? batch.purchase_date,
      tone: "normal" as const,
    }));
    const saleItems = sales.map((sale) => ({
      id: `sale-${sale.id}`,
      label: `Sale #${sale.id}`,
      detail: `${sale.buyer_name ?? "Unknown buyer"} · ${formatCurrency(
        sale.expected_payout,
      )}`,
      href: `/sales`,
      date: sale.created_at ?? sale.sold_at,
      tone:
        sale.status === "SETTLED" ? ("success" as const) : ("warning" as const),
    }));
    const paymentItems = sales
      .filter((sale) => sale.payout_received !== null || sale.status === "SETTLED")
      .map((sale) => ({
        id: `payment-${sale.id}`,
        label: `Payment received`,
        detail: `Sale #${sale.id} · ${formatCurrency(
          sale.payout_received ?? sale.expected_payout,
        )}`,
        href: `/sales`,
        date: sale.created_at ?? sale.sold_at,
        tone: "success" as const,
      }));
    const voidItems = giftCards
      .filter((card) => ["VOID", "VOIDED", "ARCHIVED"].includes(card.status))
      .map((card) => ({
        id: `void-${card.id}`,
        label: `Card voided #${card.id}`,
        detail: `${card.brand} · purchase #${card.purchase_batch_id}`,
        href: `/gift-cards/${card.id}/verify`,
        date: card.updated_at ?? card.created_at ?? "",
        tone: "danger" as const,
      }));

    return [...purchaseItems, ...saleItems, ...paymentItems, ...voidItems]
      .filter((item) => item.date)
      .sort((itemA, itemB) => itemB.date.localeCompare(itemA.date))
      .slice(0, 10);
  }, [batches, giftCards, sales]);

  const rewardsEarned = useMemo(
    () =>
      (summary?.rewards_by_program ?? summary?.rewards_by_type ?? []).reduce(
        (total, reward) => total + numericValue(reward.estimated_rewards_earned),
        0,
      ),
    [summary],
  );

  const settledSaleCount = sales.filter((sale) => sale.status === "SETTLED").length;
  const partialPaymentCount = sales.filter(
    (sale) => sale.status === "PARTIALLY_SETTLED",
  ).length;
  const inventoryAgingThresholdDays = 30;
  const agedInventoryCount = giftCards.filter((card) => {
    if (card.status !== "VERIFIED_AVAILABLE") {
      return false;
    }

    const ageSource = card.created_at ?? card.updated_at;

    if (!ageSource) {
      return false;
    }

    const createdAt = new Date(ageSource);

    if (Number.isNaN(createdAt.getTime())) {
      return false;
    }

    return (
      (dashboardLoadedAt - createdAt.getTime()) / 86_400_000 >=
      inventoryAgingThresholdDays
    );
  }).length;
  const manualReviewCount = giftCards.filter((card) =>
    ["VOID", "VOIDED", "ARCHIVED"].includes(card.status),
  ).length;
  const activeInventoryCount =
    (summary?.unsold_inventory_count ?? 0) +
    (summary?.awaiting_payment_count ?? 0) +
    (summary?.pending_verification_count ?? 0);
  const turnoverRate =
    settledSaleCount + activeInventoryCount > 0
      ? (settledSaleCount / (settledSaleCount + activeInventoryCount)) * 100
      : 0;

  return (
    <main className="px-4 py-5 text-slate-100 sm:px-6 lg:px-8 lg:py-7">
      <div className="mx-auto max-w-7xl space-y-5">
        <header className="flex flex-col gap-4 border-b border-white/10 pb-5 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-cyan-200/80">
              Operations Command Center
            </p>
            <h1 className="mt-2 text-2xl font-semibold tracking-tight text-white sm:text-3xl">
              What needs attention now
            </h1>
            <p className="mt-2 max-w-3xl text-sm text-slate-400">
              Navigation lives in the sidebar. This screen is for exposure,
              queues, time-sensitive work, and recent operational movement.
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <QuickAction href="/intake" label="New Purchase" />
            <QuickAction href="/sales/new" label="Create Sale" />
            <QuickAction href="/payments/receive" label="Receive Payment" />
            <QuickAction href="/settings/payment-accounts" label="Payment Accounts" />
          </div>
        </header>

        {error ? (
          <div className="rounded-lg border border-red-400/25 bg-red-500/10 px-4 py-3 text-sm font-medium text-red-100">
            {error}
          </div>
        ) : null}

        <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <MetricCard
            detail={`Cost ${formatCurrency(summary?.available_acquisition_cost ?? 0)}`}
            href="/inventory"
            isLoading={isLoading}
            label="Inventory Total"
            value={formatCurrency(summary?.total_available_inventory_face_value ?? 0)}
          />
          <MetricCard
            detail={`${summary?.awaiting_payment_count ?? 0} awaiting · ${
              summary?.overdue_payment_count ?? 0
            } overdue`}
            href="/inventory"
            isLoading={isLoading}
            label="Awaiting Payouts"
            tone={(summary?.overdue_payment_count ?? 0) > 0 ? "danger" : "warning"}
            value={formatCurrency(summary?.awaiting_payment_total ?? 0)}
          />
          <MetricCard
            detail={`${creditUtilizationExposure.toFixed(1)}% aggregate utilization`}
            href="/credit-cards"
            isLoading={isLoading}
            label="Credit Utilization Exposure"
            tone={creditUtilizationExposure > 30 ? "warning" : "normal"}
            value={formatCurrency(summary?.credit_card_estimated_balances ?? 0)}
          />
          <MetricCard
            detail={`${paymentsDueSoon.length} payment alerts`}
            href="/credit-cards"
            isLoading={isLoading}
            label="Outstanding Statement Balances"
            tone={outstandingStatementBalances > 0 ? "danger" : "normal"}
            value={formatCurrency(outstandingStatementBalances)}
          />
        </section>

        <section className="grid gap-4 xl:grid-cols-4">
          <Panel title="Financial Risk">
            <div className="grid gap-2">
              <QueueCard
                count={paymentsDueSoon.length}
                detail="Cards with payment due soon"
                href="/credit-cards?queue=payments_due"
                isLoading={isLoading}
                severity={paymentsDueSoon.length > 0 ? "danger" : "normal"}
                title="Credit Card Payments Due"
              />
              <QueueCard
                count={summary?.credit_card_utilization_warnings ?? 0}
                detail="Above utilization threshold"
                exposure={formatCurrency(summary?.credit_card_estimated_balances ?? 0)}
                href="/credit-cards?filter=high_utilization"
                isLoading={isLoading}
                severity={
                  (summary?.credit_card_utilization_warnings ?? 0) > 0
                    ? "warning"
                    : "normal"
                }
                title="High Utilization Alerts"
              />
              <QueueCard
                count={0}
                detail="Coming soon"
                href="/sales?filter=margin_risk"
                isLoading={isLoading}
                severity="normal"
                title="Margin Risk"
              />
            </div>
          </Panel>

          <Panel title="Inventory Operations">
            <div className="grid gap-2">
              <QueueCard
                count={agedInventoryCount}
                detail={`${inventoryAgingThresholdDays}+ days unsold`}
                href="/inventory?filter=aging"
                isLoading={isLoading}
                severity={agedInventoryCount > 0 ? "warning" : "normal"}
                title="Inventory Aging"
              />
              <QueueCard
                count={summary?.pending_verification_count ?? 0}
                detail="Missing details or manual verification"
                href="/inventory?status=awaiting_verification"
                isLoading={isLoading}
                severity={
                  (summary?.pending_verification_count ?? 0) > 0
                    ? "warning"
                    : "normal"
                }
                title="Failed / Manual Verification"
              />
              <QueueCard
                count={0}
                detail="Concentration risk placeholder"
                href="/inventory?filter=large_exposure"
                isLoading={isLoading}
                severity="normal"
                title="Large Exposure"
              />
            </div>
          </Panel>

          <Panel title="Fuel Operations">
            <div className="grid gap-2">
              <QueueCard
                count={fuelExpiringSoon.length}
                detail="Expiring within warning window"
                href="/fuel-accounts?filter=expiring"
                isLoading={isLoading}
                severity={fuelExpiringSoon.length > 0 ? "danger" : "normal"}
                title="Fuel Accounts Near Expiration"
              />
            </div>
          </Panel>

          <Panel title="Workflow Exceptions">
            <div className="grid gap-2">
              <QueueCard
                count={partialPaymentCount}
                detail="Sales partially reconciled"
                href="/payments/receive?queue=partial"
                isLoading={isLoading}
                severity={partialPaymentCount > 0 ? "warning" : "normal"}
                title="Partial Payment Reconciliation"
              />
              <QueueCard
                count={0}
                detail="Buyer setup audit placeholder"
                href="/buyers?filter=missing_configuration"
                isLoading={isLoading}
                severity="normal"
                title="Missing Buyer Configuration"
              />
              <QueueCard
                count={manualReviewCount}
                detail="Voids, adjustments, mismatches"
                href="/inventory?filter=manual_review"
                isLoading={isLoading}
                severity={manualReviewCount > 0 ? "warning" : "normal"}
                title="Pending Manual Review"
              />
            </div>
          </Panel>
        </section>

        <section className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
          <Panel title="Operational Queues">
            <div className="grid gap-2 sm:grid-cols-2">
              <QueueRow
                href="/payments/awaiting"
                label="Sales awaiting payment"
                tone={(summary?.awaiting_payment_count ?? 0) > 0 ? "warning" : "normal"}
                value={formatNumber(summary?.awaiting_payment_count ?? 0)}
              />
              <QueueRow
                href="/purchases/receipt-audit"
                label="Purchases needing receipts"
                tone={
                  (summary?.purchases_needing_receipts_count ?? 0) > 0
                    ? "warning"
                    : "normal"
                }
                value={formatNumber(
                  summary?.purchases_needing_receipts_count ?? 0,
                )}
              />
            </div>
          </Panel>

          <Panel title="Performance Snapshot">
            <div className="grid gap-2 sm:grid-cols-2">
              <MiniMetric
                label="Monthly Profit"
                value={formatCurrency(summary?.range_profit ?? 0)}
              />
              <MiniMetric
                label="YTD Sales"
                value={formatCurrency(ytdSummary?.range_total_sales ?? 0)}
              />
              <MiniMetric
                href="/rewards"
                label="Rewards Recorded"
                value={formatNumber(rewardsEarned)}
              />
              <MiniMetric
                href="/rewards?category=fuel"
                label="Fuel Points Earned"
                value={formatNumber(summary?.fuel_points_earned ?? 0)}
              />
              <MiniMetric
                label="Inventory Turnover"
                value={`${turnoverRate.toFixed(1)}%`}
              />
              <MiniMetric
                label="Awaiting Profit"
                value={formatCurrency(summary?.awaiting_payment_expected_profit ?? 0)}
              />
            </div>
          </Panel>
        </section>

        <section className="grid gap-4 xl:grid-cols-3">
          <Panel title="Time-Sensitive Actions">
            <ActionList
              empty="No statement or payment deadlines in the next week."
              items={[
                ...statementsClosingSoon.map((card) => ({
                  href: `/credit-cards/${card.id}`,
                  label: `${card.nickname} statement closing`,
                  meta: dueLabel(card.next_statement_close_date),
                  tone: "warning" as const,
                })),
                ...paymentsDueSoon.map((card) => ({
                  href: `/credit-cards/${card.id}`,
                  label: `${card.nickname} payment due`,
                  meta: dueLabel(card.payment_due_date),
                  tone: card.minimum_payment_missing
                    ? ("danger" as const)
                    : ("warning" as const),
                })),
              ]}
            />
          </Panel>

          <Panel title="Fuel & Buyer Alerts">
            <ActionList
              empty="No fuel expirations or overdue buyers currently flagged."
              items={[
                ...fuelExpiringSoon.map((account) => ({
                  href: `/fuel-accounts/${account.id}`,
                  label: `${account.retailer} fuel points`,
                  meta: `${formatNumber(account.current_points)} pts · ${dueLabel(
                    account.nearest_expiration_date,
                  )}`,
                  tone: "danger" as const,
                })),
                ...(summary?.overdue_buyers ?? []).slice(0, 4).map((buyer) => ({
                  href: `/buyers/${buyer.id}`,
                  label: `${buyer.name} overdue`,
                  meta: `${buyer.overdue_count} item${
                    buyer.overdue_count === 1 ? "" : "s"
                  } · ${formatCurrency(buyer.outstanding_payouts)}`,
                  tone: "danger" as const,
                })),
              ]}
            />
          </Panel>

          <Panel title="Recent Activity">
            <ActionList
              empty="No recent activity yet."
              items={recentActivity.map((item) => ({
                href: item.href,
                label: item.label,
                meta: `${item.detail} · ${formatDate(item.date)}`,
                tone: item.tone,
              }))}
            />
          </Panel>
        </section>

      </div>
    </main>
  );
}

function QuickAction({ href, label }: { href: string; label: string }) {
  return (
    <Link
      className="inline-flex h-9 cursor-pointer items-center rounded-lg border border-cyan-300/25 bg-cyan-300/10 px-3 text-xs font-semibold text-cyan-100 transition hover:border-cyan-200/45 hover:bg-cyan-300/15 active:bg-cyan-300/20"
      href={href}
    >
      {label}
    </Link>
  );
}

function Panel({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border border-white/10 bg-slate-950/45 p-4 shadow-2xl shadow-black/10 backdrop-blur">
      <h2 className="text-sm font-semibold uppercase tracking-[0.18em] text-slate-300">
        {title}
      </h2>
      <div className="mt-3">{children}</div>
    </section>
  );
}

function MetricCard({
  label,
  value,
  detail,
  href,
  isLoading,
  tone = "normal",
}: {
  label: string;
  value: string;
  detail: string;
  href: string;
  isLoading: boolean;
  tone?: "normal" | "warning" | "danger";
}) {
  const toneClass =
    tone === "danger"
      ? "border-red-400/25 bg-red-500/10"
      : tone === "warning"
        ? "border-amber-300/25 bg-amber-400/10"
        : "border-white/10 bg-slate-950/45";

  return (
    <Link
      className={`rounded-xl border p-4 shadow-2xl shadow-black/10 transition hover:border-cyan-200/30 hover:bg-white/[0.06] active:bg-white/[0.08] ${toneClass}`}
      href={href}
    >
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
        {label}
      </p>
      <p className="mt-2 text-2xl font-semibold tracking-tight text-white">
        {isLoading ? "..." : value}
      </p>
      <p className="mt-1 text-xs text-slate-400">{detail}</p>
    </Link>
  );
}

function MiniMetric({
  href,
  label,
  value,
}: {
  href?: string;
  label: string;
  value: string;
}) {
  const content = (
    <>
      <p className="text-xs text-slate-400">{label}</p>
      <p className="mt-1 text-base font-semibold text-white">{value}</p>
    </>
  );

  if (href) {
    return (
      <Link
        className="rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 transition hover:border-cyan-200/25 hover:bg-white/[0.055]"
        href={href}
      >
        {content}
      </Link>
    );
  }

  return (
    <div className="rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2">
      {content}
    </div>
  );
}

function QueueRow({
  label,
  value,
  href,
  tone,
}: {
  label: string;
  value: string;
  href: string;
  tone: "normal" | "warning" | "danger";
}) {
  const accent =
    tone === "danger"
      ? "bg-red-400"
      : tone === "warning"
        ? "bg-amber-300"
        : "bg-emerald-300";

  return (
    <Link
      className="flex cursor-pointer items-center justify-between gap-3 rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-sm transition hover:bg-white/[0.07] active:bg-white/[0.1] focus:outline-none focus:ring-2 focus:ring-cyan-300/40"
      href={href}
    >
      <span className="flex items-center gap-2 text-slate-300">
        <span className={`h-2 w-2 rounded-full ${accent}`} />
        {label}
      </span>
      <span className="font-semibold text-white">{value}</span>
    </Link>
  );
}

function QueueCard({
  title,
  count,
  detail,
  href,
  severity,
  isLoading,
  exposure,
}: {
  title: string;
  count: number;
  detail: string;
  href: string;
  severity: "normal" | "warning" | "danger";
  isLoading: boolean;
  exposure?: string;
}) {
  const dotClass =
    severity === "danger"
      ? "bg-red-400"
      : severity === "warning"
        ? "bg-amber-300"
        : "bg-emerald-300";
  const borderClass =
    severity === "danger"
      ? "border-red-400/25"
      : severity === "warning"
        ? "border-amber-300/25"
        : "border-white/10";
  const statusText =
    count > 0
      ? severity === "danger"
        ? "Action needed"
        : "Review"
      : detail.toLowerCase().includes("coming soon") ||
          detail.toLowerCase().includes("placeholder")
        ? "Coming soon"
        : "No issues";

  return (
    <Link
      className={`block rounded-lg border bg-white/[0.03] px-3 py-3 transition hover:bg-white/[0.07] active:bg-white/[0.1] focus:outline-none focus:ring-2 focus:ring-cyan-300/40 ${borderClass}`}
      href={href}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className={`h-2 w-2 shrink-0 rounded-full ${dotClass}`} />
            <h3 className="truncate text-sm font-semibold text-slate-100">
              {title}
            </h3>
          </div>
          <p className="mt-1 text-xs text-slate-500">{detail}</p>
        </div>
        <span className="shrink-0 text-lg font-semibold tabular-nums text-white">
          {isLoading ? "..." : formatNumber(count)}
        </span>
      </div>
      <div className="mt-3 flex items-center justify-between gap-3 text-xs">
        <span className="font-medium text-slate-400">{statusText}</span>
        {exposure ? (
          <span className="truncate text-slate-500">{exposure}</span>
        ) : null}
      </div>
    </Link>
  );
}

function ActionList({
  items,
  empty,
}: {
  items: {
    href: string;
    label: string;
    meta: string;
    tone: "normal" | "warning" | "success" | "danger";
  }[];
  empty: string;
}) {
  if (items.length === 0) {
    return <p className="text-sm text-slate-500">{empty}</p>;
  }

  return (
    <div className="divide-y divide-white/10">
      {items.slice(0, 8).map((item, index) => (
        <Link
          className="flex cursor-pointer items-center justify-between gap-3 py-2 text-sm transition hover:bg-white/[0.04] focus:outline-none focus:ring-2 focus:ring-cyan-300/40"
          href={item.href}
          key={`${item.href}-${item.label}-${index}`}
        >
          <span className="min-w-0">
            <span className="block truncate font-medium text-slate-100">
              {item.label}
            </span>
            <span className="block truncate text-xs text-slate-500">
              {item.meta}
            </span>
          </span>
          <StatusDot tone={item.tone} />
        </Link>
      ))}
    </div>
  );
}

function StatusDot({
  tone,
}: {
  tone: "normal" | "warning" | "success" | "danger";
}) {
  const className =
    tone === "danger"
      ? "bg-red-400"
      : tone === "warning"
        ? "bg-amber-300"
        : tone === "success"
          ? "bg-emerald-300"
          : "bg-slate-500";

  return <span className={`h-2 w-2 shrink-0 rounded-full ${className}`} />;
}
