"use client";

import Link from "next/link";
import { Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";

import { API_BASE_URL } from "@/lib/api";

type PaymentLedgerRow = {
  id: number;
  sale_id: number;
  received_date: string | null;
  buyer: string | null;
  buyer_id: number;
  payment_account: {
    id: number;
    name: string;
    account_type: string;
    institution: string | null;
    last_four: string | null;
    payment_identifier: string | null;
    account_identifier: string | null;
  } | null;
  amount_received: string | number;
  expected_amount: string | number;
  difference: string | number;
  linked_sales: Array<{ id: number; status: string; asset_count: number }>;
  settlement_reference: string | null;
  settlement_notes: string | null;
  status: string;
  status_label: string;
};

const paymentHistoryFilters = [
  { value: "recent", label: "Recent" },
  { value: "settled", label: "Settled" },
  { value: "short", label: "Short Pay" },
  { value: "over", label: "Overpay" },
  { value: "all", label: "All" },
] as const;

type PaymentHistoryFilter = (typeof paymentHistoryFilters)[number]["value"];

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
    return "-";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date);
}

function paymentAccountLabel(account: PaymentLedgerRow["payment_account"]) {
  if (!account) {
    return "-";
  }

  const identifier = account.payment_identifier ?? account.account_identifier;
  return [
    account.name,
    account.institution,
    account.last_four ? `****${account.last_four}` : null,
    identifier,
  ]
    .filter(Boolean)
    .join(" · ");
}

function differenceTone(value: string | number) {
  const amount = Number(value);
  if (amount < 0) {
    return "text-red-700";
  }
  if (amount > 0) {
    return "text-emerald-700";
  }
  return "text-slate-700";
}

function filterFromStatusParam(status: string | null): PaymentHistoryFilter {
  if (status === "short") {
    return "short";
  }
  if (status === "over") {
    return "over";
  }
  if (status === "settled") {
    return "settled";
  }
  return "recent";
}

function varianceLabel(value: string | number) {
  const amount = Number(value);
  if (amount < 0) {
    return {
      className: "border-red-200 bg-red-50 text-red-700",
      label: "Short pay",
    };
  }
  if (amount > 0) {
    return {
      className: "border-emerald-200 bg-emerald-50 text-emerald-700",
      label: "Overpay",
    };
  }
  return {
    className: "border-slate-200 bg-slate-100 text-slate-600",
    label: "Matched",
  };
}

export default function PaymentHistoryPage() {
  return (
    <Suspense
      fallback={
        <main className="min-h-screen bg-slate-50 px-4 py-8 text-slate-950 sm:px-6 lg:px-8">
          <div className="mx-auto max-w-7xl rounded-lg border border-slate-200 bg-white p-8 text-sm text-slate-500">
            Loading payment history...
          </div>
        </main>
      }
    >
      <PaymentHistoryContent />
    </Suspense>
  );
}

function PaymentHistoryContent() {
  const searchParams = useSearchParams();
  const statusFilter = searchParams.get("status");
  const [selectedFilter, setSelectedFilter] = useState<PaymentHistoryFilter>(
    () => filterFromStatusParam(statusFilter),
  );
  const [rows, setRows] = useState<PaymentLedgerRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function loadRows() {
      setIsLoading(true);
      setError(null);

      const endpoint = `${API_BASE_URL}/sales/payment-history`;

      try {
        const response = await fetch(endpoint);
        if (!response.ok) {
          const body = await response.text();
          throw new Error(
            `Failed to load payment history from ${endpoint} (${response.status}): ${
              body || response.statusText
            }`,
          );
        }
        setRows((await response.json()) as PaymentLedgerRow[]);
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Failed to load payment history.",
        );
      } finally {
        setIsLoading(false);
      }
    }

    void loadRows();
  }, []);

  const visibleRows = useMemo(
    () =>
      rows.filter((row) => {
        const difference = Number(row.difference);
        if (selectedFilter === "short") {
          return difference < 0;
        }
        if (selectedFilter === "over") {
          return difference > 0;
        }
        if (selectedFilter === "settled") {
          return row.status === "COMPLETED" || row.status === "SETTLED";
        }
        return true;
      }),
    [rows, selectedFilter],
  );

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-8 text-slate-950 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-7xl space-y-6">
        <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-sm font-medium uppercase tracking-wide text-slate-500">
              Payments
            </p>
            <h1 className="mt-1 text-3xl font-semibold tracking-tight">
              Payment History
            </h1>
            <p className="mt-2 text-sm text-slate-600">
              Received payouts, payment accounts, variances, and linked sales.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link
              className="inline-flex h-10 items-center rounded-md border border-slate-300 px-3 text-sm font-semibold text-slate-700 hover:bg-slate-100"
              href="/payments/receive"
            >
              Receive Payment
            </Link>
            <Link
              className="inline-flex h-10 items-center rounded-md border border-slate-300 px-3 text-sm font-semibold text-slate-700 hover:bg-slate-100"
              href="/settings/payment-accounts"
            >
              Payment Accounts
            </Link>
          </div>
        </header>

        {error ? (
          <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-800">
            {error}
          </div>
        ) : null}

        <section className="flex flex-col gap-3 rounded-lg border border-slate-200 bg-white p-4 shadow-sm sm:flex-row sm:items-end sm:justify-between">
          <label className="space-y-2 text-sm font-medium text-slate-700">
            <span>Status</span>
            <select
              className="h-10 min-w-48 rounded-md border border-slate-300 px-3 text-sm text-slate-950 outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-200"
              onChange={(event) =>
                setSelectedFilter(event.target.value as PaymentHistoryFilter)
              }
              value={selectedFilter}
            >
              {paymentHistoryFilters.map((filter) => (
                <option key={filter.value} value={filter.value}>
                  {filter.label}
                </option>
              ))}
            </select>
          </label>
          <p className="pb-2 text-sm font-medium text-slate-500">
            {visibleRows.length} of {rows.length} payments
          </p>
        </section>

        <section className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-100 text-left text-xs font-semibold uppercase tracking-wide text-slate-600">
              <tr>
                <th className="px-4 py-3">Received</th>
                <th className="px-4 py-3">Buyer</th>
                <th className="px-4 py-3">Payment Account</th>
                <th className="px-4 py-3 text-right">Received</th>
                <th className="px-4 py-3 text-right">Expected</th>
                <th className="px-4 py-3 text-right">Difference</th>
                <th className="px-4 py-3">Sale</th>
                <th className="px-4 py-3">Reference / Notes</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {isLoading ? (
                <tr>
                  <td className="px-4 py-6 text-slate-500" colSpan={10}>
                    Loading payment history...
                  </td>
                </tr>
              ) : visibleRows.length === 0 ? (
                <tr>
                  <td className="px-4 py-6 text-slate-500" colSpan={10}>
                    No payment history found.
                  </td>
                </tr>
              ) : (
                visibleRows.map((row) => {
                  const variance = varianceLabel(row.difference);
                  const isSettled =
                    row.status === "COMPLETED" || row.status === "SETTLED";

                  return (
                    <tr key={row.id}>
                      <td className="px-4 py-3">{formatDate(row.received_date)}</td>
                      <td className="px-4 py-3">{row.buyer ?? "-"}</td>
                      <td className="px-4 py-3">
                        {paymentAccountLabel(row.payment_account)}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums">
                        {formatCurrency(row.amount_received)}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums">
                        {formatCurrency(row.expected_amount)}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums">
                        <div className="flex flex-col items-end gap-1">
                          <span className={`font-semibold ${differenceTone(row.difference)}`}>
                            {formatCurrency(row.difference)}
                          </span>
                          <span
                            className={`inline-flex w-fit rounded-full border px-2 py-0.5 text-xs font-semibold ${variance.className}`}
                          >
                            {variance.label}
                          </span>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        {row.linked_sales.map((sale) => (
                          <Link
                            className="font-semibold text-slate-900 hover:underline"
                            href={`/sales?sale=${sale.id}`}
                            key={sale.id}
                          >
                            Sale #{sale.id}
                          </Link>
                        ))}
                      </td>
                      <td className="px-4 py-3">
                        <p>{row.settlement_reference ?? "-"}</p>
                        {row.settlement_notes ? (
                          <p className="mt-1 max-w-xs truncate text-xs text-slate-500">
                            {row.settlement_notes}
                          </p>
                        ) : null}
                      </td>
                      <td className="px-4 py-3">{row.status_label}</td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex justify-end gap-2">
                          <Link
                            className="font-semibold text-slate-700 hover:text-slate-950 hover:underline"
                            href={`/sales?sale=${row.sale_id}`}
                          >
                            View Sale
                          </Link>
                          {!isSettled ? (
                            <Link
                              className="font-semibold text-slate-700 hover:text-slate-950 hover:underline"
                              href={`/payments/receive?buyer_id=${row.buyer_id}&sale_id=${row.sale_id}`}
                            >
                              Receive Balance
                            </Link>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </section>
      </div>
    </main>
  );
}
