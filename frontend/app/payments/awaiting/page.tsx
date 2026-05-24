"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { API_BASE_URL } from "@/lib/api";

type PaymentAccount = {
  id: number;
  name: string;
  account_type: string;
  institution: string | null;
  last_four: string | null;
  payment_identifier: string | null;
  account_identifier: string | null;
  bank_account_type: string | null;
  is_business_account: boolean;
};

type SaleCard = {
  id: number;
  brand: string;
  face_value: string | number;
  card_number_ending: string | null;
  expected_payout: string | number | null;
  settlement_received_at: string | null;
};

type SaleFuelAccount = {
  id: number;
  retailer: string;
  points_sold: number | null;
  expected_value: string | number | null;
  settlement_received_at: string | null;
};

type Sale = {
  id: number;
  buyer_id: number;
  buyer_name: string | null;
  sold_at: string;
  expected_payment_date: string | null;
  expected_payout: string | number;
  payment_account: PaymentAccount | null;
  status: string;
  gift_cards: SaleCard[];
  fuel_accounts: SaleFuelAccount[];
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

function formatDate(value: string | null) {
  if (!value) {
    return "—";
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
    year: "numeric",
  }).format(date);
}

function dayDifference(value: string | null) {
  if (!value) {
    return null;
  }

  const due = value.includes("T")
    ? new Date(value)
    : new Date(`${value}T00:00:00`);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  due.setHours(0, 0, 0, 0);

  if (Number.isNaN(due.getTime())) {
    return null;
  }

  return Math.round((due.getTime() - today.getTime()) / 86_400_000);
}

function dueLabel(value: string | null) {
  const diff = dayDifference(value);

  if (diff === null) {
    return "—";
  }

  if (diff < 0) {
    return `Overdue ${Math.abs(diff)}d (${formatDate(value)})`;
  }

  if (diff === 0) {
    return `Due today (${formatDate(value)})`;
  }

  return `Due in ${diff}d (${formatDate(value)})`;
}

function paymentAccountLabel(account: PaymentAccount | null) {
  if (!account) {
    return "No expected account";
  }

  const type = account.account_type.toLowerCase();
  const identifier = account.payment_identifier ?? account.account_identifier;

  if (["paypal", "venmo", "zelle"].includes(type)) {
    return [account.account_type, identifier].filter(Boolean).join(" · ");
  }

  return [
    account.name,
    account.institution,
    account.bank_account_type,
    account.last_four ? `****${account.last_four}` : null,
    account.is_business_account ? "Business" : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

function unpaidCardExpected(card: SaleCard) {
  return card.settlement_received_at ? 0 : Number(card.expected_payout ?? 0) || 0;
}

function unpaidFuelExpected(account: SaleFuelAccount) {
  return account.settlement_received_at
    ? 0
    : Number(account.expected_value ?? 0) || 0;
}

function unpaidExpectedTotal(sale: Sale) {
  return (
    sale.gift_cards.reduce((total, card) => total + unpaidCardExpected(card), 0) +
    sale.fuel_accounts.reduce(
      (total, account) => total + unpaidFuelExpected(account),
      0,
    )
  );
}

function assetSummary(sale: Sale) {
  const cardCount = sale.gift_cards.filter(
    (card) => !card.settlement_received_at,
  ).length;
  const fuelCount = sale.fuel_accounts.filter(
    (account) => !account.settlement_received_at,
  ).length;
  const details = [
    cardCount > 0 ? `${cardCount} card${cardCount === 1 ? "" : "s"}` : null,
    fuelCount > 0
      ? `${fuelCount} fuel account${fuelCount === 1 ? "" : "s"}`
      : null,
  ].filter(Boolean);

  return details.length > 0 ? details.join(" · ") : "No unpaid assets";
}

function compareAwaitingSales(saleA: Sale, saleB: Sale) {
  const diffA = dayDifference(saleA.expected_payment_date);
  const diffB = dayDifference(saleB.expected_payment_date);
  const overdueA = diffA !== null && diffA < 0;
  const overdueB = diffB !== null && diffB < 0;

  if (overdueA !== overdueB) {
    return overdueA ? -1 : 1;
  }

  const dateA = saleA.expected_payment_date ?? "9999-12-31";
  const dateB = saleB.expected_payment_date ?? "9999-12-31";

  if (dateA !== dateB) {
    return dateA.localeCompare(dateB);
  }

  return (saleA.buyer_name ?? "").localeCompare(saleB.buyer_name ?? "");
}

export default function AwaitingPaymentQueuePage() {
  const [sales, setSales] = useState<Sale[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function loadSales() {
      setIsLoading(true);
      setError(null);

      try {
        const endpoint = `${API_BASE_URL}/sales/awaiting-payment`;
        const response = await fetch(endpoint);

        if (!response.ok) {
          const body = await response.text().catch(() => "");
          console.error("Awaiting payment queue fetch failed", {
            endpoint,
            status: response.status,
            body,
          });
          throw new Error(`Failed to load sales (${response.status})`);
        }

        setSales((await response.json()) as Sale[]);
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Failed to load awaiting payments.",
        );
      } finally {
        setIsLoading(false);
      }
    }

    void loadSales();
  }, []);

  const awaitingSales = useMemo(
    () => [...sales].sort(compareAwaitingSales),
    [sales],
  );

  const totalAwaiting = awaitingSales.reduce(
    (total, sale) => total + unpaidExpectedTotal(sale),
    0,
  );

  return (
    <main className="min-h-screen bg-[#070b12] px-4 py-6 text-slate-100 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-7xl space-y-5">
        <header className="flex flex-col gap-3 border-b border-white/10 pb-4 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-cyan-200/80">
              Payment Queue
            </p>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight text-white">
              Sales Awaiting Payment
            </h1>
            <p className="mt-1 text-sm text-slate-400">
              Reconcile unpaid sales, starting with overdue deposits.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link
              className="inline-flex h-10 cursor-pointer items-center rounded-lg border border-white/10 px-3 text-sm font-semibold text-slate-200 transition hover:bg-white/10 active:bg-white/15"
              href="/payments/receive?status=unpaid"
            >
              Receive Payment
            </Link>
            <Link
              className="inline-flex h-10 cursor-pointer items-center rounded-lg border border-white/10 px-3 text-sm font-semibold text-slate-200 transition hover:bg-white/10 active:bg-white/15"
              href="/sales"
            >
              Sales History
            </Link>
          </div>
        </header>

        <section className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-xl border border-white/10 bg-white/[0.04] px-4 py-3">
            <p className="text-xs uppercase tracking-[0.16em] text-slate-500">
              Awaiting Sales
            </p>
            <p className="mt-1 text-xl font-semibold text-white">
              {isLoading ? "..." : awaitingSales.length}
            </p>
          </div>
          <div className="rounded-xl border border-white/10 bg-white/[0.04] px-4 py-3">
            <p className="text-xs uppercase tracking-[0.16em] text-slate-500">
              Expected Payout
            </p>
            <p className="mt-1 text-xl font-semibold text-white">
              {formatCurrency(totalAwaiting)}
            </p>
          </div>
        </section>

        {error ? (
          <p className="rounded-lg border border-red-400/30 bg-red-500/10 px-4 py-3 text-sm font-medium text-red-100">
            {error}
          </p>
        ) : null}

        <section className="overflow-hidden rounded-xl border border-white/10 bg-slate-950/70 shadow-2xl shadow-black/20">
          <div className="flex flex-col gap-2 border-b border-white/10 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-sm font-semibold uppercase tracking-[0.18em] text-slate-300">
                Unpaid Sales
              </h2>
              <p className="mt-1 text-xs text-slate-500">
                Sorted by overdue status, expected date, then buyer.
              </p>
            </div>
          </div>

          {isLoading ? (
            <p className="px-4 py-8 text-sm text-slate-400">
              Loading unpaid sales...
            </p>
          ) : awaitingSales.length === 0 ? (
            <div className="px-4 py-8 text-sm text-slate-400">
              <p className="font-medium text-slate-100">
                No unpaid sales in the queue.
              </p>
              <p className="mt-1">Nothing needs payment reconciliation right now.</p>
            </div>
          ) : (
            <div>
              <div className="hidden grid-cols-[1.15fr_0.7fr_1.1fr_0.9fr_0.7fr_0.9fr] gap-3 border-b border-white/10 bg-white/[0.03] px-4 py-2 text-xs font-semibold uppercase tracking-[0.14em] text-slate-500 lg:grid">
                <div>Buyer / Sale</div>
                <div className="text-right">Expected Payout</div>
                <div>Expected Account</div>
                <div className="text-center">Expected Date</div>
                <div className="text-center">Assets</div>
                <div className="text-right">Actions</div>
              </div>
              {awaitingSales.map((sale) => {
                const dueDiff = dayDifference(sale.expected_payment_date);
                const rowTone =
                  dueDiff !== null && dueDiff < 0
                    ? "border-l-red-400"
                    : dueDiff !== null && dueDiff <= 2
                      ? "border-l-amber-300"
                      : "border-l-transparent";
                const rowBackground =
                  awaitingSales.indexOf(sale) % 2 === 0
                    ? "bg-white/[0.015]"
                    : "bg-white/[0.035]";

                return (
                  <article
                    className={`grid gap-2 border-l-2 px-4 py-2.5 transition hover:bg-white/[0.06] lg:grid-cols-[1.15fr_0.7fr_1.1fr_0.9fr_0.7fr_0.9fr] lg:items-center lg:gap-3 ${rowTone} ${rowBackground}`}
                    key={sale.id}
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-white">
                        {sale.buyer_name ?? "Unknown buyer"}
                      </p>
                      <p className="mt-0.5 text-xs text-slate-500">
                        Sale #{sale.id} · sold {formatDate(sale.sold_at)}
                      </p>
                    </div>
                    <div className="flex items-center justify-between gap-3 lg:block lg:text-right">
                      <p className="text-xs text-slate-500 lg:hidden">
                        Expected
                      </p>
                      <p className="text-sm font-semibold tabular-nums text-slate-100">
                        {formatCurrency(unpaidExpectedTotal(sale))}
                      </p>
                    </div>
                    <div className="min-w-0">
                      <p className="text-xs text-slate-500 lg:hidden">
                        Account
                      </p>
                      <p className="truncate text-sm text-slate-200">
                        {paymentAccountLabel(sale.payment_account)}
                      </p>
                    </div>
                    <div className="flex items-center justify-between gap-3 lg:block lg:text-center">
                      <p className="text-xs text-slate-500 lg:hidden">Date</p>
                      <p
                        className={`text-sm font-medium ${
                          dueDiff !== null && dueDiff < 0
                            ? "text-red-200"
                            : dueDiff !== null && dueDiff <= 2
                              ? "text-amber-100"
                              : "text-slate-200"
                        }`}
                      >
                        {dueLabel(sale.expected_payment_date)}
                      </p>
                    </div>
                    <div className="flex items-center justify-between gap-3 lg:block lg:text-center">
                      <p className="text-xs text-slate-500 lg:hidden">Assets</p>
                      <p className="text-sm text-slate-300">
                        {assetSummary(sale)}
                      </p>
                    </div>
                    <div className="flex items-center justify-start gap-2 lg:justify-end">
                      <Link
                        className="inline-flex h-8 cursor-pointer items-center rounded-md bg-cyan-300 px-3 text-xs font-semibold text-slate-950 transition hover:bg-cyan-200 active:bg-cyan-100"
                        href={`/payments/receive?buyer_id=${sale.buyer_id}&sale_id=${sale.id}`}
                      >
                        Receive
                      </Link>
                      <Link
                        className="inline-flex h-8 cursor-pointer items-center rounded-md border border-white/10 px-3 text-xs font-semibold text-slate-200 transition hover:bg-white/10 active:bg-white/15"
                        href={`/sales?sale=${sale.id}`}
                      >
                        View
                      </Link>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
