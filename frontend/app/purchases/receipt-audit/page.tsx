"use client";

import Link from "next/link";
import { ChangeEvent, useEffect, useMemo, useRef, useState } from "react";

import { API_BASE_URL } from "@/lib/api";

type FuelAccountSummary = {
  id: number;
  retailer: string;
  email: string | null;
  alt_id: string | null;
};

type FuelPointEntry = {
  id: number;
  points_earned: number;
  expires_on: string;
  fuel_account: FuelAccountSummary | null;
};

type PurchaseBatch = {
  id: number;
  store_name: string;
  purchase_date: string;
  total_amount: string | number | null;
  purchase_total_paid: string | number | null;
  calculated_card_face_value: string | number | null;
  card_count: number;
  receipt_count?: number;
  fuel_point_entries?: FuelPointEntry[];
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

function fuelAccountLabel(purchase: PurchaseBatch) {
  const entry = purchase.fuel_point_entries?.[0];
  const account = entry?.fuel_account;

  if (!entry || !account) {
    return "-";
  }

  return [
    account.retailer,
    account.email,
    account.alt_id ? `Alt ${account.alt_id}` : null,
    `${entry.points_earned.toLocaleString()} pts`,
  ]
    .filter(Boolean)
    .join(" · ");
}

export default function ReceiptAuditQueuePage() {
  const fileInputs = useRef<Record<number, HTMLInputElement | null>>({});
  const [purchases, setPurchases] = useState<PurchaseBatch[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [uploadingId, setUploadingId] = useState<number | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function loadPurchases() {
    setIsLoading(true);
    setError(null);

    try {
      const endpoint = `${API_BASE_URL}/purchase-batches/receipt-audit`;
      const response = await fetch(endpoint);

      if (!response.ok) {
        const body = await response.text().catch(() => "");
        console.error("Receipt audit queue fetch failed", {
          endpoint,
          status: response.status,
          body,
        });
        throw new Error(`Failed to load purchases (${response.status})`);
      }

      setPurchases((await response.json()) as PurchaseBatch[]);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to load receipt audit queue.",
      );
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    queueMicrotask(() => {
      void loadPurchases();
    });
  }, []);

  const missingReceiptPurchases = useMemo(
    () =>
      [...purchases].sort((purchaseA, purchaseB) => {
        const dateA = new Date(purchaseA.purchase_date).getTime();
        const dateB = new Date(purchaseB.purchase_date).getTime();

        if (Number.isNaN(dateA) || Number.isNaN(dateB)) {
          return purchaseB.id - purchaseA.id;
        }

        return dateB - dateA;
      }),
    [purchases],
  );

  async function uploadReceipt(
    purchaseId: number,
    event: ChangeEvent<HTMLInputElement>,
  ) {
    const file = event.target.files?.[0];

    if (!file) {
      return;
    }

    setUploadingId(purchaseId);
    setError(null);
    setMessage(null);

    try {
      const formData = new FormData();
      formData.append("purchase_batch_id", String(purchaseId));
      formData.append("file", file);

      const endpoint = `${API_BASE_URL}/receipts/upload`;
      const response = await fetch(endpoint, {
        body: formData,
        method: "POST",
      });

      if (!response.ok) {
        const body = await response.text().catch(() => "");
        console.error("Receipt upload failed", {
          endpoint,
          purchaseId,
          status: response.status,
          body,
        });
        throw new Error(`Failed to upload receipt (${response.status})`);
      }

      setMessage(`Receipt uploaded for purchase #${purchaseId}.`);
      await loadPurchases();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to upload receipt.");
    } finally {
      setUploadingId(null);
      event.target.value = "";
    }
  }

  return (
    <main className="min-h-screen bg-[#070b12] px-4 py-6 text-slate-100 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-7xl space-y-5">
        <header className="flex flex-col gap-3 border-b border-white/10 pb-4 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-cyan-200/80">
              Receipt Queue
            </p>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight text-white">
              Purchases Needing Receipts
            </h1>
            <p className="mt-1 text-sm text-slate-400">
              Attach missing receipts for audit trail and buyer delivery.
            </p>
          </div>
          <Link
            className="inline-flex h-10 cursor-pointer items-center rounded-lg border border-white/10 px-3 text-sm font-semibold text-slate-200 transition hover:bg-white/10 active:bg-white/15"
            href="/purchases"
          >
            Purchase History
          </Link>
        </header>

        <section className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-xl border border-white/10 bg-white/[0.04] px-4 py-3">
            <p className="text-xs uppercase tracking-[0.16em] text-slate-500">
              Missing Receipts
            </p>
            <p className="mt-1 text-xl font-semibold text-white">
              {isLoading ? "..." : missingReceiptPurchases.length}
            </p>
          </div>
          <div className="rounded-xl border border-white/10 bg-white/[0.04] px-4 py-3">
            <p className="text-xs uppercase tracking-[0.16em] text-slate-500">
              Total Paid
            </p>
            <p className="mt-1 text-xl font-semibold text-white">
              {formatCurrency(
                missingReceiptPurchases.reduce(
                  (total, purchase) =>
                    total + Number(purchase.purchase_total_paid ?? 0),
                  0,
                ),
              )}
            </p>
          </div>
          <div className="rounded-xl border border-white/10 bg-white/[0.04] px-4 py-3">
            <p className="text-xs uppercase tracking-[0.16em] text-slate-500">
              Sort
            </p>
            <p className="mt-1 text-sm font-medium text-slate-200">
              Newest missing purchases first
            </p>
          </div>
        </section>

        {message ? (
          <p className="rounded-lg border border-emerald-300/30 bg-emerald-400/10 px-4 py-3 text-sm font-medium text-emerald-100">
            {message}
          </p>
        ) : null}

        {error ? (
          <p className="rounded-lg border border-red-400/30 bg-red-500/10 px-4 py-3 text-sm font-medium text-red-100">
            {error}
          </p>
        ) : null}

        <section className="overflow-hidden rounded-xl border border-white/10 bg-slate-950/70 shadow-2xl shadow-black/20">
          <div className="border-b border-white/10 px-4 py-3">
            <h2 className="text-sm font-semibold uppercase tracking-[0.18em] text-slate-300">
              Receipt Audit Work Queue
            </h2>
          </div>

          {isLoading ? (
            <p className="px-4 py-8 text-sm text-slate-400">
              Loading purchases...
            </p>
          ) : missingReceiptPurchases.length === 0 ? (
            <div className="px-4 py-8 text-sm text-slate-400">
              <p className="font-medium text-slate-100">
                No purchases need receipts.
              </p>
              <p className="mt-1">Receipt audit is clear.</p>
            </div>
          ) : (
            <div className="divide-y divide-white/10">
              {missingReceiptPurchases.map((purchase) => (
                <article
                  className="grid gap-3 px-4 py-3 transition hover:bg-white/[0.04] lg:grid-cols-[1fr_0.7fr_0.7fr_1.2fr_auto]"
                  key={purchase.id}
                >
                  <div>
                    <p className="text-sm font-semibold text-white">
                      {purchase.store_name}
                    </p>
                    <p className="mt-0.5 text-xs text-slate-500">
                      Purchase #{purchase.id} · {formatDate(purchase.purchase_date)}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-slate-500">Total paid</p>
                    <p className="text-sm font-semibold text-slate-100">
                      {formatCurrency(purchase.purchase_total_paid)}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-slate-500">Cards</p>
                    <p className="text-sm font-semibold text-slate-100">
                      {purchase.card_count} ·{" "}
                      {formatCurrency(purchase.calculated_card_face_value)}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-slate-500">Fuel account</p>
                    <p className="line-clamp-2 text-sm text-slate-200">
                      {fuelAccountLabel(purchase)}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center justify-start gap-2 lg:justify-end">
                    <input
                      accept="image/jpeg,image/png,image/webp,image/heic"
                      className="hidden"
                      onChange={(event) => void uploadReceipt(purchase.id, event)}
                      ref={(element) => {
                        fileInputs.current[purchase.id] = element;
                      }}
                      type="file"
                    />
                    <button
                      className="inline-flex h-9 cursor-pointer items-center rounded-lg bg-cyan-300 px-3 text-xs font-semibold text-slate-950 transition hover:bg-cyan-200 active:bg-cyan-100 disabled:cursor-not-allowed disabled:opacity-60"
                      disabled={uploadingId === purchase.id}
                      onClick={() => fileInputs.current[purchase.id]?.click()}
                      type="button"
                    >
                      {uploadingId === purchase.id
                        ? "Uploading..."
                        : "Upload Receipt"}
                    </button>
                    <Link
                      className="inline-flex h-9 cursor-pointer items-center rounded-lg border border-white/10 px-3 text-xs font-semibold text-slate-200 transition hover:bg-white/10 active:bg-white/15"
                      href={`/purchases/${purchase.id}`}
                    >
                      View Purchase
                    </Link>
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
