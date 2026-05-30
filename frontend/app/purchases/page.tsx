"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useState } from "react";

import { API_BASE_URL } from "@/lib/api";

type PurchaseBatch = {
  id: number;
  store_name: string;
  purchase_date: string;
  total_amount: string | number | null;
  purchase_total_paid: string | number | null;
  calculated_card_face_value: string | number | null;
  card_count: number;
  receipt_count?: number;
  notes: string | null;
};

type PurchaseRewardAuditRow = {
  purchase_id: number;
  store_name: string;
  purchase_date: string;
  paid_amount: string | number | null;
  payment_count: number;
  credit_card_payment_count: number;
  reward_transaction_count: number;
  funding_status: string;
  reward_status: string;
  issues: string[];
  recommended_action: string;
};

type PurchaseRewardAuditResponse = {
  count: number;
  purchases: PurchaseRewardAuditRow[];
};

function formatCurrency(value: string | number | null) {
  if (value === null || value === "") {
    return "-";
  }

  const amount = Number(value);

  if (Number.isNaN(amount)) {
    return String(value);
  }

  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(amount);
}

function formatDate(value: string) {
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

export default function PurchasesPage() {
  return (
    <Suspense
      fallback={
        <main className="min-h-screen bg-slate-50 px-4 py-8 text-slate-950 sm:px-6 lg:px-8">
          <div className="mx-auto max-w-7xl rounded-lg border border-slate-200 bg-white p-8 text-sm text-slate-500">
            Loading purchases...
          </div>
        </main>
      }
    >
      <PurchasesContent />
    </Suspense>
  );
}

function PurchasesContent() {
  const searchParams = useSearchParams();
  const [purchases, setPurchases] = useState<PurchaseBatch[]>([]);
  const [rewardAuditRows, setRewardAuditRows] = useState<PurchaseRewardAuditRow[]>([]);
  const [search, setSearch] = useState("");
  const [selectedPurchaseIds, setSelectedPurchaseIds] = useState<number[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const isReceiptAudit = searchParams.get("receiptAudit") === "true";
  const isRewardAudit = searchParams.get("rewardAudit") === "true";

  useEffect(() => {
    async function loadPurchases() {
      setIsLoading(true);
      setError(null);

      try {
        const endpoint = isRewardAudit
          ? `${API_BASE_URL}/purchase-batches/reward-audit`
          : `${API_BASE_URL}/purchase-batches/`;
        const response = await fetch(endpoint);

        if (!response.ok) {
          throw new Error(`Failed to load purchases (${response.status})`);
        }

        if (isRewardAudit) {
          const data = (await response.json()) as PurchaseRewardAuditResponse;
          setRewardAuditRows(data.purchases);
        } else {
          setPurchases((await response.json()) as PurchaseBatch[]);
          setRewardAuditRows([]);
        }
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Failed to load purchases.",
        );
      } finally {
        setIsLoading(false);
      }
    }

    queueMicrotask(() => {
      void loadPurchases();
    });
  }, [isRewardAudit]);

  const filteredPurchases = useMemo(() => {
    const query = search.trim().toLowerCase();

    return purchases.filter((purchase) => {
      if (
        isReceiptAudit &&
        ((purchase.receipt_count ?? 0) > 0 ||
          Number(purchase.purchase_total_paid ?? purchase.total_amount ?? 0) <= 0)
      ) {
        return false;
      }

      if (!query) {
        return true;
      }

      const searchable = [
        String(purchase.id),
        purchase.store_name,
        purchase.purchase_date,
        purchase.notes ?? "",
        String(purchase.calculated_card_face_value ?? ""),
        String(purchase.total_amount ?? ""),
        String(purchase.purchase_total_paid ?? ""),
      ]
        .join(" ")
        .toLowerCase();

      return searchable.includes(query);
    });
  }, [isReceiptAudit, purchases, search]);
  const filteredRewardAuditRows = useMemo(() => {
    const query = search.trim().toLowerCase();

    if (!query) {
      return rewardAuditRows;
    }

    return rewardAuditRows.filter((row) =>
      [
        String(row.purchase_id),
        row.store_name,
        row.purchase_date,
        String(row.paid_amount ?? ""),
        row.funding_status,
        row.reward_status,
        row.recommended_action,
        row.issues.join(" "),
      ]
        .join(" ")
        .toLowerCase()
        .includes(query),
    );
  }, [rewardAuditRows, search]);
  const selectedExportHref = `${API_BASE_URL}/data-transfer/export?purchases=${selectedPurchaseIds.join(",")}`;

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-8 text-slate-950 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-7xl space-y-6">
        <header className="flex flex-col gap-4 rounded-lg border border-slate-200 bg-white p-6 shadow-sm md:flex-row md:items-end md:justify-between">
          <div>
            <p className="text-sm font-medium uppercase tracking-wide text-slate-500">
              Purchase Workflow
            </p>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight">
              Purchases
            </h1>
            <p className="mt-2 max-w-2xl text-sm text-slate-600">
              Start a new purchase, continue card intake, or find previous
              purchase batches and reward funding issues.
            </p>
          </div>
          <Link
            className="inline-flex h-11 cursor-pointer items-center justify-center rounded-md bg-slate-950 px-4 text-sm font-semibold text-white transition hover:bg-slate-800 active:bg-slate-900"
            href="/intake"
          >
            New Purchase
          </Link>
        </header>

        {error ? (
          <p className="rounded-md border border-red-200 bg-red-50 p-3 text-sm font-medium text-red-700">
            {error}
          </p>
        ) : null}

        {isReceiptAudit ? (
          <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-900">
            Showing purchases missing receipt audit trail.
          </div>
        ) : null}

        {isRewardAudit ? (
          <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-900">
            Showing purchases missing reward inputs or needing reward
            recalculation.
          </div>
        ) : null}

        <section className="grid gap-4 md:grid-cols-3">
          <Link
            className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md active:translate-y-0"
            href="/intake"
          >
            <h2 className="text-lg font-semibold">New Purchase</h2>
            <p className="mt-2 text-sm text-slate-600">
              Create a purchase, upload receipt, then add cards.
            </p>
          </Link>
          <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="text-lg font-semibold">Recent Purchases</h2>
            <p className="mt-2 text-sm text-slate-600">
              {isLoading
                ? "Loading purchase history..."
                : isRewardAudit
                  ? `${rewardAuditRows.length} purchase${
                      rewardAuditRows.length === 1 ? "" : "s"
                    } need reward review.`
                  : `${purchases.length} purchase batch${
                      purchases.length === 1 ? "" : "es"
                    } tracked.`}
            </p>
          </div>
          <label className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
            <span className="text-lg font-semibold">Search Purchases</span>
            <input
              className="mt-3 h-11 w-full rounded-md border border-slate-300 px-3 text-sm outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-200"
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Store, purchase id, amount, notes..."
              type="search"
              value={search}
            />
          </label>
        </section>

        <section className="grid gap-4 md:grid-cols-2">
          <Link
            className={`rounded-lg border p-4 text-sm shadow-sm transition hover:-translate-y-0.5 hover:shadow-md active:translate-y-0 ${
              isRewardAudit
                ? "border-amber-300 bg-amber-50 text-amber-950"
                : "border-slate-200 bg-white text-slate-700"
            }`}
            href="/purchases?rewardAudit=true"
          >
            <p className="font-semibold">Purchases missing reward inputs</p>
            <p className="mt-1">
              Find missing funding rows, missing credit cards, and reward
              transaction mismatches.
            </p>
          </Link>
          <Link
            className={`rounded-lg border p-4 text-sm shadow-sm transition hover:-translate-y-0.5 hover:shadow-md active:translate-y-0 ${
              isReceiptAudit
                ? "border-amber-300 bg-amber-50 text-amber-950"
                : "border-slate-200 bg-white text-slate-700"
            }`}
            href="/purchases?receiptAudit=true"
          >
            <p className="font-semibold">Purchases missing receipts</p>
            <p className="mt-1">Find purchases missing receipt audit trail.</p>
          </Link>
        </section>

        <section className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-200 px-5 py-4">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <h2 className="text-lg font-semibold">
                {isRewardAudit ? "Reward Funding Audit" : "Purchase History"}
              </h2>
              {selectedPurchaseIds.length > 0 ? (
                <a
                  className="inline-flex h-9 cursor-pointer items-center justify-center rounded-md border border-slate-300 px-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-100"
                  href={selectedExportHref}
                >
                  Export Selected ({selectedPurchaseIds.length})
                </a>
              ) : null}
            </div>
            <p className="text-sm text-slate-500">
              {isRewardAudit
                ? "Open a purchase to add funding rows or recalculate rewards."
                : "Open a batch to view receipts, financials, payments, and cards."}
            </p>
          </div>

          {isLoading ? (
            <p className="px-5 py-8 text-sm text-slate-500">
              Loading purchases...
            </p>
          ) : isRewardAudit ? (
            filteredRewardAuditRows.length === 0 ? (
              <div className="px-5 py-8 text-sm text-slate-500">
                <p className="font-medium text-slate-900">
                  No reward funding issues found.
                </p>
                <p className="mt-1">
                  Purchases with credit card funding have matching reward
                  transactions.
                </p>
              </div>
            ) : (
              <>
                <div className="hidden md:block">
                  <table className="w-full text-left text-sm">
                    <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                      <tr>
                        <th className="px-5 py-3">Purchase</th>
                        <th className="px-5 py-3">Date</th>
                        <th className="px-5 py-3">Paid</th>
                        <th className="px-5 py-3">Funding Status</th>
                        <th className="px-5 py-3">Reward Status</th>
                        <th className="px-5 py-3">Recommended Action</th>
                        <th className="px-5 py-3 text-right">Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200">
                      {filteredRewardAuditRows.map((row) => (
                        <tr className="transition hover:bg-slate-50" key={row.purchase_id}>
                          <td className="px-5 py-3">
                            <div className="font-semibold text-slate-950">
                              {row.store_name}
                            </div>
                            <div className="text-xs text-slate-500">
                              Purchase #{row.purchase_id}
                            </div>
                          </td>
                          <td className="px-5 py-3">
                            {formatDate(row.purchase_date)}
                          </td>
                          <td className="px-5 py-3">
                            {formatCurrency(row.paid_amount)}
                          </td>
                          <td className="px-5 py-3 text-slate-700">
                            {row.funding_status.replaceAll("_", " ")}
                            <div className="text-xs text-slate-500">
                              {row.payment_count} payment row
                              {row.payment_count === 1 ? "" : "s"} ·{" "}
                              {row.credit_card_payment_count} credit card
                            </div>
                          </td>
                          <td className="px-5 py-3 text-slate-700">
                            {row.reward_status.replaceAll("_", " ")}
                            <div className="text-xs text-slate-500">
                              {row.reward_transaction_count} reward transaction
                              {row.reward_transaction_count === 1 ? "" : "s"}
                            </div>
                          </td>
                          <td className="px-5 py-3 font-medium text-slate-900">
                            {row.recommended_action}
                          </td>
                          <td className="px-5 py-3 text-right">
                            <Link
                              className="inline-flex h-10 cursor-pointer items-center rounded-md border border-slate-300 px-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-100 active:bg-slate-200"
                              href={`/purchases/${row.purchase_id}`}
                            >
                              Fix
                            </Link>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div className="divide-y divide-slate-200 md:hidden">
                  {filteredRewardAuditRows.map((row) => (
                    <Link
                      className="block space-y-3 px-5 py-4 transition hover:bg-slate-50 active:bg-slate-100"
                      href={`/purchases/${row.purchase_id}`}
                      key={row.purchase_id}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="font-semibold">{row.store_name}</p>
                          <p className="text-sm text-slate-500">
                            {formatDate(row.purchase_date)}
                          </p>
                        </div>
                        <span className="rounded-full bg-amber-100 px-2 py-1 text-xs font-semibold text-amber-800">
                          {row.recommended_action}
                        </span>
                      </div>
                      <div className="grid grid-cols-2 gap-3 text-sm">
                        <div>
                          <p className="text-xs font-medium text-slate-500">
                            Paid
                          </p>
                          <p className="font-semibold">
                            {formatCurrency(row.paid_amount)}
                          </p>
                        </div>
                        <div>
                          <p className="text-xs font-medium text-slate-500">
                            Issue
                          </p>
                          <p className="font-semibold">
                            {row.issues
                              .map((issue) => issue.replaceAll("_", " "))
                              .join(", ")}
                          </p>
                        </div>
                      </div>
                    </Link>
                  ))}
                </div>
              </>
            )
          ) : filteredPurchases.length === 0 ? (
            <div className="px-5 py-8 text-sm text-slate-500">
              <p className="font-medium text-slate-900">No purchases found.</p>
              <p className="mt-1">
                {search
                  ? "Try a different search."
                  : "Create your first purchase to begin intake."}
              </p>
            </div>
          ) : (
            <>
              <div className="hidden md:block">
                <table className="w-full text-left text-sm">
                  <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                    <tr>
                      <th className="px-5 py-3">Purchase</th>
                      <th className="px-5 py-3">Date</th>
                      <th className="px-5 py-3">Face Value</th>
                      <th className="px-5 py-3">Paid</th>
                      <th className="px-5 py-3 text-right">Action</th>
                      <th className="w-48 px-5 py-3 text-right">Notes</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200">
                    {filteredPurchases.map((purchase) => (
                      <tr
                        className="transition hover:bg-slate-50"
                        key={purchase.id}
                      >
                        <td className="px-5 py-3">
                          <div className="flex items-start gap-3">
                            <input
                              checked={selectedPurchaseIds.includes(purchase.id)}
                              className="mt-1 h-4 w-4"
                              onChange={(event) =>
                                setSelectedPurchaseIds((current) =>
                                  event.target.checked
                                    ? [...current, purchase.id]
                                    : current.filter((id) => id !== purchase.id),
                                )
                              }
                              type="checkbox"
                            />
                            <div>
                              <div className="font-semibold text-slate-950">
                                {purchase.store_name}
                              </div>
                              <div className="text-xs text-slate-500">
                                Purchase #{purchase.id}
                              </div>
                            </div>
                          </div>
                        </td>
                        <td className="px-5 py-3">
                          {formatDate(purchase.purchase_date)}
                        </td>
                        <td className="px-5 py-3">
                          {formatCurrency(purchase.calculated_card_face_value)}
                          <div className="text-xs text-slate-500">
                            {purchase.card_count} card
                            {purchase.card_count === 1 ? "" : "s"}
                          </div>
                        </td>
                        <td className="px-5 py-3">
                          {formatCurrency(
                            purchase.purchase_total_paid ?? purchase.total_amount,
                          )}
                        </td>
                        <td className="px-5 py-3 text-right">
                          <Link
                            className="inline-flex h-10 cursor-pointer items-center rounded-md border border-slate-300 px-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-100 active:bg-slate-200"
                            href={`/purchases/${purchase.id}`}
                          >
                            Open
                          </Link>
                        </td>
                        <td className="w-48 max-w-48 px-5 py-3 text-right text-slate-500">
                          {purchase.notes ? (
                            <span
                              className="block truncate"
                              title={purchase.notes}
                            >
                              {purchase.notes}
                            </span>
                          ) : null}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="divide-y divide-slate-200 md:hidden">
                {filteredPurchases.map((purchase) => (
                  <Link
                    className="block space-y-3 px-5 py-4 transition hover:bg-slate-50 active:bg-slate-100"
                    href={`/purchases/${purchase.id}`}
                    key={purchase.id}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="font-semibold">{purchase.store_name}</p>
                        <p className="text-sm text-slate-500">
                          {formatDate(purchase.purchase_date)}
                        </p>
                      </div>
                      <span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-600">
                        #{purchase.id}
                      </span>
                    </div>
                    <div className="grid grid-cols-2 gap-3 text-sm">
                      <div>
                        <p className="text-xs font-medium text-slate-500">
                          Face Value
                        </p>
                        <p className="font-semibold">
                          {formatCurrency(purchase.calculated_card_face_value)}
                          <span className="ml-1 text-xs font-normal text-slate-500">
                            ({purchase.card_count})
                          </span>
                        </p>
                      </div>
                      <div>
                        <p className="text-xs font-medium text-slate-500">
                          Paid
                        </p>
                        <p className="font-semibold">
                          {formatCurrency(
                            purchase.purchase_total_paid ?? purchase.total_amount,
                          )}
                        </p>
                      </div>
                    </div>
                    {purchase.notes ? (
                      <p className="text-sm text-slate-500">{purchase.notes}</p>
                    ) : null}
                  </Link>
                ))}
              </div>
            </>
          )}
        </section>
      </div>
    </main>
  );
}
