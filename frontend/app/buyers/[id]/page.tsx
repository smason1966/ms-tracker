"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { API_BASE_URL } from "@/lib/api";

type GiftCardSale = {
  id: number;
  brand: string;
  face_value: string | number;
  acquisition_cost: string | number | null;
  expected_payout: string | number | null;
  payout_received: string | number | null;
  expected_profit: string | number | null;
  realized_profit: string | number | null;
  purchase_batch_id: number;
  status: string;
  sold_date: string | null;
  expected_payment_date: string | null;
  settlement_received_at: string | null;
};

type FuelAccountSale = {
  id: number;
  retailer: string;
  email: string | null;
  alt_id: string | null;
  target_points: number | null;
  status: string;
  sold_date: string | null;
  expected_payment_date: string | null;
  sale_price: string | number | null;
};

type ExportHistoryItem = {
  type: string;
  id: number;
  label: string;
  sold_date: string | null;
  amount: string | number | null;
  status: string;
};

type BuyerDetail = {
  id: number;
  name: string;
  buyer_category: string | null;
  buyer_type: string | null;
  preferred_contact_method: string | null;
  contact_handle: string | null;
  backup_contact: string | null;
  contact_email: string | null;
  active: boolean;
  default_payout_days: number | null;
  default_payout_rate: string | number | null;
  requires_card_images: boolean;
  requires_receipt_images: boolean;
  preferred_export_type: string;
  card_export_format: string | null;
  fuel_export_format: string | null;
  default_payment_account_id: number | null;
  default_payment_account: {
    id: number;
    name: string;
    account_type: string;
    institution: string | null;
    last_four: string | null;
    account_identifier: string | null;
    payment_identifier: string | null;
    is_business_account: boolean;
    bank_account_type: string | null;
    active: boolean;
  } | null;
  expected_payment_reference: string | null;
  settlement_behavior_notes: string | null;
  payment_timing_notes: string | null;
  payment_reference_format: string | null;
  payment_instructions: string | null;
  group_card_exports_by_brand: boolean;
  preserve_blank_export_columns: boolean;
  external_identifiers: {
    id: number;
    platform_source: string;
    identifier: string;
    notes: string | null;
  }[];
  notes: string | null;
  awaiting_payment_total: string | number;
  settled_total: string | number;
  avg_profit: string | number;
  avg_settlement_days: number | null;
  overdue_count: number;
  gift_cards: GiftCardSale[];
  fuel_accounts: FuelAccountSale[];
  export_history: ExportHistoryItem[];
};

type FilterOption = "all" | "awaiting" | "settled" | "overdue";

function todayString() {
  return new Date().toISOString().slice(0, 10);
}

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

function formatPercent(value: string | number | null) {
  if (value === null || value === "") {
    return "-";
  }

  const rate = Number(value);

  if (Number.isNaN(rate)) {
    return String(value);
  }

  return `${(rate * 100).toFixed(1)}%`;
}

function isOverdue(expectedPaymentDate: string | null, status: string) {
  if (!expectedPaymentDate || status !== "SOLD_PENDING_PAYMENT") {
    return false;
  }

  return expectedPaymentDate < todayString();
}

function statusLabel(status: string) {
  if (status === "SOLD_PENDING_PAYMENT") {
    return "Awaiting Payment";
  }

  if (status === "SETTLED") {
    return "Settled";
  }

  if (status === "SOLD") {
    return "Sold";
  }

  return status.replaceAll("_", " ");
}

function paymentAccountLabel(account: BuyerDetail["default_payment_account"]) {
  if (!account) {
    return "-";
  }

  const type = account.account_type.toLowerCase();
  const identifier = account.payment_identifier ?? account.account_identifier;

  if (type === "paypal" || type === "venmo" || type === "zelle") {
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

export default function BuyerDetailPage() {
  const params = useParams<{ id: string | string[] }>();
  const buyerId = Array.isArray(params.id) ? params.id[0] : params.id;
  const [buyer, setBuyer] = useState<BuyerDetail | null>(null);
  const [filter, setFilter] = useState<FilterOption>("all");
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      async function loadBuyer() {
        setIsLoading(true);
        setError(null);

        try {
          const response = await fetch(`${API_BASE_URL}/buyers/${buyerId}`);

          if (!response.ok) {
            throw new Error(`Failed to load buyer (${response.status})`);
          }

          setBuyer((await response.json()) as BuyerDetail);
        } catch (err) {
          setError(err instanceof Error ? err.message : "Failed to load buyer.");
        } finally {
          setIsLoading(false);
        }
      }

      void loadBuyer();
    }, 0);

    return () => window.clearTimeout(timeoutId);
  }, [buyerId]);

  const filteredCards = useMemo(() => {
    if (!buyer) {
      return [];
    }

    return buyer.gift_cards.filter((card) => {
      if (filter === "awaiting") {
        return card.status === "SOLD_PENDING_PAYMENT";
      }

      if (filter === "settled") {
        return card.status === "SETTLED";
      }

      if (filter === "overdue") {
        return isOverdue(card.expected_payment_date, card.status);
      }

      return true;
    });
  }, [buyer, filter]);

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-8 text-slate-950 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-7xl space-y-6">
        <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-sm font-medium uppercase tracking-wide text-slate-500">
              Buyer Detail
            </p>
            <h1 className="mt-1 text-3xl font-semibold tracking-tight">
              {buyer?.name ?? "Buyer"}
            </h1>
            {buyer ? (
              <p className="mt-2 text-sm text-slate-600">
                {buyer.buyer_category ?? buyer.buyer_type ?? "Buyer"} ·{" "}
                {buyer.contact_handle ?? buyer.contact_email ?? "No contact"} ·{" "}
                {buyer.active ? "Active" : "Inactive"}
              </p>
            ) : null}
          </div>
          <div className="flex flex-wrap gap-2">
            <Link
              className="inline-flex h-11 cursor-pointer items-center rounded-md border border-slate-300 px-4 text-sm font-semibold hover:bg-slate-100 active:bg-slate-200"
              href="/buyers"
            >
              Back to Buyers
            </Link>
            <Link
              className="inline-flex h-11 cursor-pointer items-center rounded-md bg-emerald-700 px-4 text-sm font-semibold text-white hover:bg-emerald-800 active:bg-emerald-900"
              href={`/payments/receive?buyer_id=${buyerId}`}
            >
              Receive Payment
            </Link>
            <Link
              className="inline-flex h-11 cursor-pointer items-center rounded-md bg-slate-950 px-4 text-sm font-semibold text-white hover:bg-slate-800"
              href="/inventory"
            >
              Inventory
            </Link>
          </div>
        </header>

        {error ? (
          <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-800">
            {error}
          </div>
        ) : null}

        {isLoading ? (
          <div className="rounded-lg border border-slate-200 bg-white p-8 text-center text-sm text-slate-500">
            Loading buyer...
          </div>
        ) : null}

        {buyer ? (
          <>
            <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Metric label="Awaiting Payment" tone={buyer.overdue_count > 0 ? "red" : "yellow"} value={formatCurrency(buyer.awaiting_payment_total)} />
              <Metric label="Settled Total" tone="green" value={formatCurrency(buyer.settled_total)} />
              <Metric label="Avg Profit" value={formatCurrency(buyer.avg_profit)} />
              <Metric
                label="Avg Settlement Days"
                value={
                  buyer.avg_settlement_days === null
                    ? "-"
                    : `${Math.round(buyer.avg_settlement_days)}d`
                }
              />
            </section>

            <section className="grid gap-4 lg:grid-cols-3">
              <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
                <h2 className="font-semibold">Defaults</h2>
                <dl className="mt-3 space-y-2 text-sm">
                  <InfoRow label="Default payout days" value={buyer.default_payout_days === null ? "-" : `${buyer.default_payout_days}d`} />
                  <InfoRow label="Default payout rate" value={formatPercent(buyer.default_payout_rate)} />
                  <InfoRow label="Expected deposit to" value={paymentAccountLabel(buyer.default_payment_account)} />
                  <InfoRow label="Expected payment reference" value={buyer.expected_payment_reference ?? buyer.payment_reference_format ?? "-"} />
                  <InfoRow label="Contact method" value={buyer.preferred_contact_method ?? "-"} />
                  <InfoRow label="Contact handle" value={buyer.contact_handle ?? buyer.contact_email ?? "-"} />
                  <InfoRow label="Export type" value={buyer.preferred_export_type} />
                  <InfoRow label="Card images" value={buyer.requires_card_images ? "Required" : "Not required"} />
                  <InfoRow label="Receipt images" value={buyer.requires_receipt_images ? "Required" : "Not required"} />
                  <InfoRow label="Overdue payouts" value={String(buyer.overdue_count)} />
                </dl>
              </div>
              <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm lg:col-span-2">
                <h2 className="font-semibold">Export Formats</h2>
                <div className="mt-3 grid gap-3 text-sm md:grid-cols-2">
                  <code className="rounded-md bg-slate-50 p-3 text-xs">
                    {buyer.card_export_format || "brand,face_value,card_number,pin"}
                  </code>
                  <code className="rounded-md bg-slate-50 p-3 text-xs">
                    {buyer.fuel_export_format ||
                      "retailer,points_sold,email_login,password,alt_id"}
                  </code>
                </div>
              </div>
            </section>

            <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
              <h2 className="font-semibold">External IDs</h2>
              {buyer.external_identifiers.length === 0 ? (
                <p className="mt-3 text-sm text-slate-500">
                  No external identifiers configured.
                </p>
              ) : (
                <div className="mt-3 grid gap-2 text-sm md:grid-cols-2">
                  {buyer.external_identifiers.map((identifier) => (
                    <div
                      className="rounded-md border border-slate-200 bg-slate-50 p-3"
                      key={identifier.id}
                    >
                      <p className="font-semibold text-slate-900">
                        {identifier.platform_source}
                      </p>
                      <p className="text-slate-700">{identifier.identifier}</p>
                      {identifier.notes ? (
                        <p className="mt-1 text-xs text-slate-500">
                          {identifier.notes}
                        </p>
                      ) : null}
                    </div>
                  ))}
                </div>
              )}
            </section>

            <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <h2 className="text-lg font-semibold">Cards Sold</h2>
                <div className="flex flex-wrap gap-2">
                  {(["all", "awaiting", "settled", "overdue"] as FilterOption[]).map(
                    (option) => (
                      <button
                        className={`h-9 cursor-pointer rounded-md px-3 text-sm font-semibold capitalize ${
                          filter === option
                            ? "bg-slate-950 text-white"
                            : "border border-slate-300 bg-white hover:bg-slate-100"
                        }`}
                        key={option}
                        onClick={() => setFilter(option)}
                        type="button"
                      >
                        {option === "all" ? "All" : option}
                      </button>
                    ),
                  )}
                </div>
              </div>

              <div className="mt-4 hidden overflow-hidden rounded-md border border-slate-200 md:block">
                <table className="min-w-full divide-y divide-slate-200 text-sm">
                  <thead className="bg-slate-100 text-left text-xs font-semibold uppercase tracking-wide text-slate-600">
                    <tr>
                      <th className="px-3 py-2">Card</th>
                      <th className="px-3 py-2">Payout</th>
                      <th className="px-3 py-2">Profit</th>
                      <th className="px-3 py-2">Due</th>
                      <th className="px-3 py-2">Status</th>
                      <th className="px-3 py-2">Purchase</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200">
                    {filteredCards.map((card) => (
                      <tr
                        className={
                          isOverdue(card.expected_payment_date, card.status)
                            ? "bg-red-50"
                            : ""
                        }
                        key={card.id}
                      >
                        <td className="px-3 py-2 font-medium">
                          {card.brand} · {formatCurrency(card.face_value)}
                        </td>
                        <td className="px-3 py-2">
                          {formatCurrency(card.expected_payout ?? card.payout_received)}
                        </td>
                        <td className="px-3 py-2">
                          {formatCurrency(card.realized_profit ?? card.expected_profit)}
                        </td>
                        <td className="px-3 py-2">
                          {formatDate(card.expected_payment_date)}
                        </td>
                        <td className="px-3 py-2">{statusLabel(card.status)}</td>
                        <td className="px-3 py-2">
                          <Link
                            className="font-semibold text-slate-700 hover:text-slate-950"
                            href={`/purchases/${card.purchase_batch_id}`}
                          >
                            #{card.purchase_batch_id}
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="mt-4 space-y-3 md:hidden">
                {filteredCards.map((card) => (
                  <article
                    className={`rounded-md border p-3 ${
                      isOverdue(card.expected_payment_date, card.status)
                        ? "border-red-200 bg-red-50"
                        : "border-slate-200 bg-slate-50"
                    }`}
                    key={card.id}
                  >
                    <div className="flex justify-between gap-3">
                      <p className="font-semibold">{card.brand}</p>
                      <p>{formatCurrency(card.face_value)}</p>
                    </div>
                    <p className="mt-1 text-sm text-slate-600">
                      Payout {formatCurrency(card.expected_payout ?? card.payout_received)} · Profit{" "}
                      {formatCurrency(card.realized_profit ?? card.expected_profit)}
                    </p>
                    <p className="mt-1 text-xs text-slate-500">
                      {statusLabel(card.status)} · Due {formatDate(card.expected_payment_date)}
                    </p>
                  </article>
                ))}
              </div>

              {filteredCards.length === 0 ? (
                <p className="mt-4 text-sm text-slate-500">No cards match this filter.</p>
              ) : null}
            </section>

            <section className="grid gap-4 lg:grid-cols-2">
              <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
                <h2 className="text-lg font-semibold">Fuel Accounts Sold</h2>
                <div className="mt-3 space-y-2">
                  {buyer.fuel_accounts.map((account) => (
                    <div
                      className="rounded-md bg-slate-50 px-3 py-2 text-sm"
                      key={account.id}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <span className="font-medium">{account.retailer}</span>
                        <span>{formatCurrency(account.sale_price)}</span>
                      </div>
                      <p className="text-xs text-slate-500">
                        Sold {formatDate(account.sold_date)} · Due{" "}
                        {formatDate(account.expected_payment_date)}
                      </p>
                    </div>
                  ))}
                  {buyer.fuel_accounts.length === 0 ? (
                    <p className="text-sm text-slate-500">No fuel account sales yet.</p>
                  ) : null}
                </div>
              </div>

              <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
                <h2 className="text-lg font-semibold">Export History</h2>
                <div className="mt-3 space-y-2">
                  {buyer.export_history.map((item) => (
                    <div
                      className="rounded-md bg-slate-50 px-3 py-2 text-sm"
                      key={`${item.type}-${item.id}`}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <span className="font-medium">{item.label}</span>
                        <span>{formatCurrency(item.amount)}</span>
                      </div>
                      <p className="text-xs text-slate-500">
                        {item.type.replace("_", " ")} · {formatDate(item.sold_date)} ·{" "}
                        {statusLabel(item.status)}
                      </p>
                    </div>
                  ))}
                  {buyer.export_history.length === 0 ? (
                    <p className="text-sm text-slate-500">No export history yet.</p>
                  ) : null}
                </div>
              </div>
            </section>
          </>
        ) : null}
      </div>
    </main>
  );
}

function Metric({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: string;
  tone?: "default" | "yellow" | "green" | "red";
}) {
  const toneClass =
    tone === "green"
      ? "border-emerald-200 bg-emerald-50"
      : tone === "yellow"
        ? "border-yellow-200 bg-yellow-50"
        : tone === "red"
          ? "border-red-200 bg-red-50"
          : "border-slate-200 bg-white";

  return (
    <div className={`rounded-lg border p-4 shadow-sm ${toneClass}`}>
      <p className="text-sm font-medium text-slate-600">{label}</p>
      <p className="mt-2 text-2xl font-semibold tracking-tight">{value}</p>
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-slate-500">{label}</dt>
      <dd className="font-medium">{value}</dd>
    </div>
  );
}
