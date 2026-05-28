"use client";

import Link from "next/link";
import { FormEvent, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";

import { API_BASE_URL } from "@/lib/api";

type Buyer = {
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
  default_payment_account: PaymentAccount | null;
  expected_payment_reference: string | null;
  settlement_behavior_notes: string | null;
  payment_timing_notes: string | null;
  payment_reference_format: string | null;
  payment_instructions: string | null;
  group_card_exports_by_brand: boolean;
  preserve_blank_export_columns: boolean;
  zip_organization: string;
  external_identifiers: BuyerExternalIdentifier[];
  notes: string | null;
  total_sales_volume: string | number;
  outstanding_payouts: string | number;
  total_settled_payouts: string | number;
  avg_payout_days: number | null;
};

type BuyerExternalIdentifier = {
  id?: number;
  platform_source: string;
  identifier: string;
  notes: string;
};

type PaymentAccount = {
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
};

type BuyerForm = {
  name: string;
  buyer_category: string;
  buyer_type: string;
  preferred_contact_method: string;
  contact_handle: string;
  backup_contact: string;
  contact_email: string;
  default_payout_days: string;
  default_payout_rate: string;
  requires_card_images: boolean;
  requires_receipt_images: boolean;
  preferred_export_type: string;
  card_export_format: string;
  fuel_export_format: string;
  default_payment_account_id: string;
  expected_payment_reference: string;
  settlement_behavior_notes: string;
  payment_timing_notes: string;
  payment_reference_format: string;
  payment_instructions: string;
  group_card_exports_by_brand: boolean;
  preserve_blank_export_columns: boolean;
  zip_organization: string;
  external_identifiers: BuyerExternalIdentifier[];
  notes: string;
  active: boolean;
};

const DEFAULT_CARD_EXPORT_FORMAT = "brand,face_value,card_number,pin";
const DEFAULT_FUEL_EXPORT_FORMAT =
  "retailer,points_sold,email_login,password,alt_id";
const BUYER_CATEGORIES = [
  "Direct Buyer",
  "Marketplace",
  "Broker",
  "Bulk Reseller",
  "Fuel Buyer",
  "Internal Transfer",
  "Other",
];
const CONTACT_METHODS = [
  "Email",
  "WhatsApp",
  "Slack",
  "Discord",
  "Telegram",
  "Signal",
  "SMS/Text",
  "Other",
];

const emptyForm: BuyerForm = {
  name: "",
  buyer_category: "Direct Buyer",
  buyer_type: "",
  preferred_contact_method: "Email",
  contact_handle: "",
  backup_contact: "",
  contact_email: "",
  default_payout_days: "",
  default_payout_rate: "100",
  requires_card_images: false,
  requires_receipt_images: false,
  preferred_export_type: "TXT",
  card_export_format: "",
  fuel_export_format: "",
  default_payment_account_id: "",
  expected_payment_reference: "",
  settlement_behavior_notes: "",
  payment_timing_notes: "",
  payment_reference_format: "",
  payment_instructions: "",
  group_card_exports_by_brand: true,
  preserve_blank_export_columns: true,
  zip_organization: "GROUP_BY_BRAND",
  external_identifiers: [],
  notes: "",
  active: true,
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

function formatStoredRateAsPercent(value: string | number | null) {
  if (value === null || value === "") {
    return "";
  }

  const rate = Number(value);

  if (Number.isNaN(rate)) {
    return String(value);
  }

  return String(Number((rate * 100).toFixed(4)));
}

function isDecimalStylePayoutRate(value: string) {
  const rate = Number(value);
  return value.trim() !== "" && rate > 0 && rate < 1;
}

async function errorMessageFromResponse(response: Response, endpoint: string) {
  const body = await response.text();
  return `Request failed: ${endpoint} (${response.status}). Response body: ${
    body || response.statusText
  }`;
}

function paymentAccountLabel(account: PaymentAccount) {
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

function buyerToForm(buyer: Buyer): BuyerForm {
  return {
    name: buyer.name,
    buyer_category: buyer.buyer_category ?? buyer.buyer_type ?? "Direct Buyer",
    buyer_type: buyer.buyer_type ?? "",
    preferred_contact_method:
      buyer.preferred_contact_method ?? (buyer.contact_email ? "Email" : "Email"),
    contact_handle: buyer.contact_handle ?? buyer.contact_email ?? "",
    backup_contact: buyer.backup_contact ?? "",
    contact_email: buyer.contact_email ?? "",
    default_payout_days:
      buyer.default_payout_days === null ? "" : String(buyer.default_payout_days),
    default_payout_rate:
      formatStoredRateAsPercent(buyer.default_payout_rate),
    requires_card_images: buyer.requires_card_images,
    requires_receipt_images: buyer.requires_receipt_images,
    preferred_export_type: buyer.preferred_export_type ?? "TXT",
    card_export_format: buyer.card_export_format ?? "",
    fuel_export_format: buyer.fuel_export_format ?? "",
    default_payment_account_id:
      buyer.default_payment_account_id === null
        ? ""
        : String(buyer.default_payment_account_id),
    expected_payment_reference:
      buyer.expected_payment_reference ?? buyer.payment_reference_format ?? "",
    settlement_behavior_notes:
      buyer.settlement_behavior_notes ?? buyer.payment_timing_notes ?? "",
    payment_timing_notes: buyer.payment_timing_notes ?? "",
    payment_reference_format: buyer.payment_reference_format ?? "",
    payment_instructions: buyer.payment_instructions ?? "",
    group_card_exports_by_brand: buyer.group_card_exports_by_brand ?? true,
    preserve_blank_export_columns: buyer.preserve_blank_export_columns ?? true,
    zip_organization: buyer.zip_organization ?? "GROUP_BY_BRAND",
    external_identifiers: (buyer.external_identifiers ?? []).map((identifier) => ({
      id: identifier.id,
      platform_source: identifier.platform_source,
      identifier: identifier.identifier,
      notes: identifier.notes ?? "",
    })),
    notes: buyer.notes ?? "",
    active: buyer.active,
  };
}

export default function BuyersPage() {
  const [buyers, setBuyers] = useState<Buyer[]>([]);
  const [paymentAccounts, setPaymentAccounts] = useState<PaymentAccount[]>([]);
  const [editingBuyer, setEditingBuyer] = useState<Buyer | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [form, setForm] = useState<BuyerForm>(emptyForm);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const totals = useMemo(
    () => ({
      volume: buyers.reduce(
        (total, buyer) => total + Number(buyer.total_sales_volume || 0),
        0,
      ),
      outstanding: buyers.reduce(
        (total, buyer) => total + Number(buyer.outstanding_payouts || 0),
        0,
      ),
      settled: buyers.reduce(
        (total, buyer) => total + Number(buyer.total_settled_payouts || 0),
        0,
      ),
    }),
    [buyers],
  );

  async function loadBuyers() {
    setIsLoading(true);
    setError(null);

    try {
      const endpoint = `${API_BASE_URL}/buyers/`;
      const response = await fetch(endpoint);

      if (!response.ok) {
        throw new Error(await errorMessageFromResponse(response, endpoint));
      }

      setBuyers((await response.json()) as Buyer[]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load buyers.");
    } finally {
      setIsLoading(false);
    }
  }

  async function loadPaymentAccounts() {
    try {
      const endpoint = `${API_BASE_URL}/payment-accounts/?active_only=true`;
      const response = await fetch(endpoint);

      if (!response.ok) {
        throw new Error(await errorMessageFromResponse(response, endpoint));
      }

      setPaymentAccounts((await response.json()) as PaymentAccount[]);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to load payment accounts.",
      );
    }
  }

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      void loadBuyers();
      void loadPaymentAccounts();
    }, 0);

    return () => window.clearTimeout(timeoutId);
  }, []);

  function openCreate() {
    setEditingBuyer(null);
    setForm(emptyForm);
    setIsModalOpen(true);
  }

  function openEdit(buyer: Buyer) {
    setEditingBuyer(buyer);
    setForm(buyerToForm(buyer));
    setIsModalOpen(true);
  }

  async function saveBuyer(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSaving(true);
    setError(null);

    try {
      const endpoint = editingBuyer
        ? `${API_BASE_URL}/buyers/${editingBuyer.id}`
        : `${API_BASE_URL}/buyers/`;
      const payload = {
        name: form.name.trim(),
        buyer_category: form.buyer_category.trim() || null,
        buyer_type: form.buyer_category.trim() || null,
        preferred_contact_method:
          form.contact_handle.trim() === ""
            ? null
            : form.preferred_contact_method,
        contact_handle: form.contact_handle.trim() || null,
        backup_contact: form.backup_contact.trim() || null,
        contact_email: form.contact_email.trim() || null,
        default_payout_days:
          form.default_payout_days.trim() === ""
            ? null
            : Number(form.default_payout_days),
        default_payout_rate:
          form.default_payout_rate.trim() === ""
            ? "100"
            : form.default_payout_rate,
        requires_card_images: form.requires_card_images,
        requires_receipt_images: form.requires_receipt_images,
        preferred_export_type: form.preferred_export_type,
        card_export_format: form.card_export_format.trim() || null,
        fuel_export_format: form.fuel_export_format.trim() || null,
        default_payment_account_id:
          form.default_payment_account_id === ""
            ? null
            : Number(form.default_payment_account_id),
        expected_payment_reference:
          form.expected_payment_reference.trim() || null,
        settlement_behavior_notes:
          form.settlement_behavior_notes.trim() || null,
        payment_timing_notes: form.payment_timing_notes.trim() || null,
        payment_reference_format: form.payment_reference_format.trim() || null,
        payment_instructions: form.payment_instructions.trim() || null,
        group_card_exports_by_brand: form.group_card_exports_by_brand,
        preserve_blank_export_columns: form.preserve_blank_export_columns,
        zip_organization: form.zip_organization,
        external_identifiers: form.external_identifiers
          .map((identifier) => ({
            platform_source: identifier.platform_source.trim(),
            identifier: identifier.identifier.trim(),
            notes: identifier.notes.trim() || null,
          }))
          .filter(
            (identifier) =>
              identifier.platform_source !== "" &&
              identifier.identifier !== "",
          ),
        notes: form.notes.trim() || null,
        active: form.active,
      };
      const response = await fetch(endpoint, {
        method: editingBuyer ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        throw new Error(
          `${await errorMessageFromResponse(response, endpoint)} Payload: ${JSON.stringify(payload)}`,
        );
      }

      setIsModalOpen(false);
      await loadBuyers();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save buyer.");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-8 text-slate-950 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-7xl space-y-6">
        <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <Link
              className="mb-3 inline-flex h-8 cursor-pointer items-center rounded-md border border-slate-300 px-3 text-xs font-semibold text-slate-700 transition hover:bg-slate-100 active:bg-slate-200"
              href="/settings"
            >
              Back to Settings
            </Link>
            <p className="text-sm font-medium uppercase tracking-wide text-slate-500">
              Settings / Buyers
            </p>
            <h1 className="mt-1 text-3xl font-semibold tracking-tight">
              Buyers
            </h1>
            <p className="mt-2 max-w-2xl text-sm text-slate-600">
              Manage buyers, payout timelines, export formats, and sales
              history.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              className="h-11 cursor-pointer rounded-md bg-slate-950 px-4 text-sm font-semibold text-white hover:bg-slate-800 active:bg-slate-900"
              onClick={openCreate}
              type="button"
            >
              Add Buyer
            </button>
          </div>
        </header>

        {error ? (
          <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-800">
            {error}
          </div>
        ) : null}

        <section className="grid gap-3 sm:grid-cols-3">
          <SummaryCard label="Total Sales Volume" value={formatCurrency(totals.volume)} />
          <SummaryCard label="Outstanding Payouts" value={formatCurrency(totals.outstanding)} tone="yellow" />
          <SummaryCard label="Settled Payouts" value={formatCurrency(totals.settled)} tone="green" />
        </section>

        {isLoading ? (
          <div className="rounded-lg border border-slate-200 bg-white p-8 text-center text-sm text-slate-500">
            Loading buyers...
          </div>
        ) : null}

        {!isLoading && buyers.length === 0 ? (
          <section className="rounded-lg border border-dashed border-slate-300 bg-white p-8 text-center shadow-sm">
            <h2 className="text-lg font-semibold">No buyers yet</h2>
            <p className="mt-2 text-sm text-slate-500">
              Add your first buyer to track payout timing and seller export
              formats.
            </p>
            <button
              className="mt-4 h-11 cursor-pointer rounded-md bg-slate-950 px-4 text-sm font-semibold text-white hover:bg-slate-800"
              onClick={openCreate}
              type="button"
            >
              Add Buyer
            </button>
          </section>
        ) : null}

        {buyers.length > 0 ? (
          <>
            <section className="hidden overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm md:block">
              <table className="min-w-full divide-y divide-slate-200 text-sm">
                <thead className="bg-slate-100 text-left text-xs font-semibold uppercase tracking-wide text-slate-600">
                  <tr>
                    <th className="px-4 py-3">Buyer</th>
                    <th className="px-4 py-3">Category</th>
                    <th className="px-4 py-3">Default Rate</th>
                    <th className="px-4 py-3">Avg Days</th>
                    <th className="px-4 py-3">Sales Volume</th>
                    <th className="px-4 py-3">Outstanding</th>
                    <th className="px-4 py-3">Settled</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {buyers.map((buyer) => (
                    <tr key={buyer.id}>
                      <td className="px-4 py-3">
                        <Link
                          className="font-semibold text-slate-950 hover:text-slate-700"
                          href={`/buyers/${buyer.id}`}
                        >
                          {buyer.name}
                        </Link>
                        {buyer.contact_handle ?? buyer.contact_email ? (
                          <p className="text-xs text-slate-500">
                            {[buyer.preferred_contact_method, buyer.contact_handle ?? buyer.contact_email]
                              .filter(Boolean)
                              .join(" · ")}
                          </p>
                        ) : null}
                      </td>
                      <td className="px-4 py-3 text-slate-600">
                        {buyer.buyer_category ?? buyer.buyer_type ?? ""}
                      </td>
                      <td className="px-4 py-3">
                        {formatPercent(buyer.default_payout_rate)}
                      </td>
                      <td className="px-4 py-3">
                        {buyer.avg_payout_days === null
                          ? "-"
                          : `${Math.round(buyer.avg_payout_days)}d`}
                      </td>
                      <td className="px-4 py-3">
                        {formatCurrency(buyer.total_sales_volume)}
                      </td>
                      <td className="px-4 py-3">
                        {formatCurrency(buyer.outstanding_payouts)}
                      </td>
                      <td className="px-4 py-3">
                        {formatCurrency(buyer.total_settled_payouts)}
                      </td>
                      <td className="px-4 py-3">
                        <StatusBadge active={buyer.active} />
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex justify-end gap-2">
                          <Link
                            className="inline-flex h-9 cursor-pointer items-center rounded-md border border-slate-300 px-3 text-sm font-semibold hover:bg-slate-100 active:bg-slate-200"
                            href={`/buyers/${buyer.id}`}
                          >
                            Details
                          </Link>
                          <button
                            className="h-9 cursor-pointer rounded-md bg-slate-900 px-3 text-sm font-semibold text-white hover:bg-slate-700 active:bg-slate-950"
                            onClick={() => openEdit(buyer)}
                            type="button"
                          >
                            Edit
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>

            <section className="space-y-3 md:hidden">
              {buyers.map((buyer) => (
                <article
                  className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm"
                  key={buyer.id}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <Link
                        className="text-lg font-semibold hover:text-slate-700"
                        href={`/buyers/${buyer.id}`}
                      >
                        {buyer.name}
                      </Link>
                      <p className="text-sm text-slate-500">
                        {buyer.buyer_category ?? buyer.buyer_type ?? "Buyer"}
                      </p>
                    </div>
                    <StatusBadge active={buyer.active} />
                  </div>
                  <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
                    <MiniStat label="Volume" value={formatCurrency(buyer.total_sales_volume)} />
                    <MiniStat label="Outstanding" value={formatCurrency(buyer.outstanding_payouts)} />
                    <MiniStat label="Settled" value={formatCurrency(buyer.total_settled_payouts)} />
                    <MiniStat label="Default Rate" value={formatPercent(buyer.default_payout_rate)} />
                  </div>
                  <div className="mt-4 flex gap-2">
                    <Link
                      className="inline-flex h-10 flex-1 cursor-pointer items-center justify-center rounded-md border border-slate-300 px-3 text-sm font-semibold hover:bg-slate-100"
                      href={`/buyers/${buyer.id}`}
                    >
                      Details
                    </Link>
                    <button
                      className="h-10 flex-1 cursor-pointer rounded-md bg-slate-900 px-3 text-sm font-semibold text-white hover:bg-slate-700"
                      onClick={() => openEdit(buyer)}
                      type="button"
                    >
                      Edit
                    </button>
                  </div>
                </article>
              ))}
            </section>
          </>
        ) : null}
      </div>

      {isModalOpen ? (
        <BuyerModal
          editingBuyer={editingBuyer}
          form={form}
          isSaving={isSaving}
          paymentAccounts={paymentAccounts}
          setForm={setForm}
          onClose={() => setIsModalOpen(false)}
          onSubmit={saveBuyer}
        />
      ) : null}
    </main>
  );
}

function SummaryCard({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: string;
  tone?: "default" | "yellow" | "green";
}) {
  const toneClass =
    tone === "green"
      ? "border-emerald-200 bg-emerald-50"
      : tone === "yellow"
        ? "border-yellow-200 bg-yellow-50"
        : "border-slate-200 bg-white";

  return (
    <div className={`rounded-lg border p-4 shadow-sm ${toneClass}`}>
      <p className="text-sm font-medium text-slate-600">{label}</p>
      <p className="mt-2 text-2xl font-semibold tracking-tight">{value}</p>
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md bg-slate-50 px-3 py-2">
      <p className="text-xs text-slate-500">{label}</p>
      <p className="font-semibold">{value}</p>
    </div>
  );
}

function StatusBadge({ active }: { active: boolean }) {
  return (
    <span
      className={`inline-flex rounded-full px-2 py-1 text-xs font-semibold ${
        active
          ? "bg-emerald-100 text-emerald-800"
          : "bg-slate-100 text-slate-600"
      }`}
    >
      {active ? "Active" : "Inactive"}
    </span>
  );
}

function FormSection({
  children,
  title,
}: {
  children: ReactNode;
  title: string;
}) {
  return (
    <section className="rounded-lg border border-slate-200 bg-slate-50 p-4">
      <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
      <div className="mt-3">{children}</div>
    </section>
  );
}

function AdvancedFormSection({
  children,
  title,
}: {
  children: ReactNode;
  title: string;
}) {
  return (
    <details className="rounded-lg border border-slate-200 bg-slate-50 p-4">
      <summary className="cursor-pointer text-sm font-semibold text-slate-900">
        {title}
      </summary>
      <div className="mt-3">{children}</div>
    </details>
  );
}

function BuyerModal({
  editingBuyer,
  form,
  isSaving,
  paymentAccounts,
  setForm,
  onClose,
  onSubmit,
}: {
  editingBuyer: Buyer | null;
  form: BuyerForm;
  isSaving: boolean;
  paymentAccounts: PaymentAccount[];
  setForm: (form: BuyerForm) => void;
  onClose: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  const hasInvalidPayoutRate = isDecimalStylePayoutRate(
    form.default_payout_rate,
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center modal-backdrop p-4">
      <form
        className="max-h-[90vh] w-full max-w-3xl space-y-4 overflow-y-auto rounded-lg bg-white p-5 shadow-xl"
        id="buyer-settings-form"
        onSubmit={onSubmit}
      >
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-xl font-semibold">
            {editingBuyer ? "Edit Buyer" : "Create Buyer"}
          </h2>
          <div className="flex shrink-0 gap-2">
            <button
              className="h-9 cursor-pointer rounded-md border border-slate-300 px-3 text-sm font-semibold hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60"
              disabled={isSaving}
              onClick={onClose}
              type="button"
            >
              Cancel
            </button>
            <button
              className="h-9 cursor-pointer rounded-md bg-slate-950 px-3 text-sm font-semibold text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
              disabled={isSaving || hasInvalidPayoutRate}
              form="buyer-settings-form"
              type="submit"
            >
              {isSaving ? "Saving..." : "Save"}
            </button>
          </div>
        </div>

        <FormSection title="General">
          <div className="grid gap-4 sm:grid-cols-3">
            <label className="block space-y-2 text-sm font-medium text-slate-700 sm:col-span-2">
              <span>Buyer Name</span>
              <input
                className="h-11 w-full rounded-md border border-slate-300 px-3"
                onChange={(event) => setForm({ ...form, name: event.target.value })}
                required
                value={form.name}
              />
            </label>
            <label className="block space-y-2 text-sm font-medium text-slate-700">
              <span>Buyer Category</span>
              <select
                className="h-11 w-full rounded-md border border-slate-300 px-3"
                onChange={(event) =>
                  setForm({ ...form, buyer_category: event.target.value })
                }
                value={form.buyer_category}
              >
                {BUYER_CATEGORIES.map((category) => (
                  <option key={category} value={category}>
                    {category}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex items-center gap-2 text-sm font-medium text-slate-700">
              <input
                checked={form.active}
                className="h-4 w-4"
                onChange={(event) =>
                  setForm({ ...form, active: event.target.checked })
                }
                type="checkbox"
              />
              Active buyer
            </label>
          </div>
        </FormSection>

        <FormSection title="Contact">
          <div className="grid gap-4 sm:grid-cols-3">
            <label className="block space-y-2 text-sm font-medium text-slate-700">
              <span>Preferred Contact Method</span>
              <select
                className="h-11 w-full rounded-md border border-slate-300 px-3"
                onChange={(event) =>
                  setForm({
                    ...form,
                    preferred_contact_method: event.target.value,
                  })
                }
                value={form.preferred_contact_method}
              >
                {CONTACT_METHODS.map((method) => (
                  <option key={method} value={method}>
                    {method}
                  </option>
                ))}
              </select>
            </label>
            <label className="block space-y-2 text-sm font-medium text-slate-700">
              <span>Contact Handle</span>
              <input
                className="h-11 w-full rounded-md border border-slate-300 px-3"
                onChange={(event) =>
                  setForm({ ...form, contact_handle: event.target.value })
                }
                placeholder="email, phone, @telegram, Discord username"
                value={form.contact_handle}
              />
            </label>
            <label className="block space-y-2 text-sm font-medium text-slate-700">
              <span>Backup Contact</span>
              <input
                className="h-11 w-full rounded-md border border-slate-300 px-3"
                onChange={(event) =>
                  setForm({ ...form, backup_contact: event.target.value })
                }
                placeholder="Optional"
                value={form.backup_contact}
              />
            </label>
          </div>
        </FormSection>

        <FormSection title="Settlement">
          <div className="grid gap-4 sm:grid-cols-3">
            <label className="block space-y-2 text-sm font-medium text-slate-700">
              <span>Default Payout Days</span>
              <input
                className="h-11 w-full rounded-md border border-slate-300 px-3"
                min="0"
                onChange={(event) =>
                  setForm({ ...form, default_payout_days: event.target.value })
                }
                type="number"
                value={form.default_payout_days}
              />
            </label>
            <label className="block space-y-2 text-sm font-medium text-slate-700">
              <span>Default Payout Rate (%)</span>
              <input
                className="h-11 w-full rounded-md border border-slate-300 px-3"
                min="0"
                onChange={(event) =>
                  setForm({ ...form, default_payout_rate: event.target.value })
                }
                placeholder="92"
                step="0.01"
                type="number"
                value={form.default_payout_rate}
              />
              <p
                className={`text-xs ${
                  hasInvalidPayoutRate
                    ? "font-medium text-red-700"
                    : "text-slate-500"
                }`}
              >
                {hasInvalidPayoutRate
                  ? "Enter payout rate as a percentage."
                  : "Enter percent, e.g. 92 for 92%."}
              </p>
            </label>
            <label className="block space-y-2 text-sm font-medium text-slate-700">
              <span>Expected Payment Account</span>
              <select
                className="h-11 w-full rounded-md border border-slate-300 px-3"
                onChange={(event) =>
                  setForm({
                    ...form,
                    default_payment_account_id: event.target.value,
                  })
                }
                value={form.default_payment_account_id}
              >
                <option value="">No default account</option>
                {paymentAccounts.map((account) => (
                  <option key={account.id} value={account.id}>
                    {paymentAccountLabel(account)}
                  </option>
                ))}
              </select>
            </label>
            <label className="block space-y-2 text-sm font-medium text-slate-700">
              <span>Expected Payment Reference</span>
              <input
                className="h-11 w-full rounded-md border border-slate-300 px-3"
                onChange={(event) =>
                  setForm({
                    ...form,
                    expected_payment_reference: event.target.value,
                  })
                }
                placeholder="Sale ID, seller ID, invoice number, username"
                value={form.expected_payment_reference}
              />
              <p className="text-xs text-slate-500">
                How this buyer labels incoming payments, such as sale ID,
                seller ID, invoice number, or username.
              </p>
            </label>
            <label className="block space-y-2 text-sm font-medium text-slate-700">
              <span>Settlement Behavior Notes</span>
              <textarea
                className="min-h-20 w-full rounded-md border border-slate-300 px-3 py-2"
                onChange={(event) =>
                  setForm({
                    ...form,
                    settlement_behavior_notes: event.target.value,
                  })
                }
                placeholder="Pays Fridays, ACH next business day, usually within 48h"
                value={form.settlement_behavior_notes}
              />
            </label>
            <label className="block space-y-2 text-sm font-medium text-slate-700">
              <span>Payment Instructions</span>
              <textarea
                className="min-h-20 w-full rounded-md border border-slate-300 px-3 py-2"
                onChange={(event) =>
                  setForm({
                    ...form,
                    payment_instructions: event.target.value,
                  })
                }
                value={form.payment_instructions}
              />
            </label>
          </div>
        </FormSection>

        <AdvancedFormSection title="Advanced Export Template">
          <div className="mt-3 grid gap-4 sm:grid-cols-3">
            <label className="block space-y-2 text-sm font-medium text-slate-700">
              <span>Preferred Export Type</span>
              <select
                className="h-11 w-full rounded-md border border-slate-300 px-3"
                onChange={(event) =>
                  setForm({
                    ...form,
                    preferred_export_type: event.target.value,
                  })
                }
                value={form.preferred_export_type}
              >
                <option value="TXT">TXT</option>
                <option value="CSV">CSV</option>
                <option value="TSV">TSV</option>
                <option value="GOOGLE_SHEETS_PASTE">
                  Google Sheets Paste
                </option>
                <option value="CUSTOM">Custom</option>
              </select>
            </label>
            <label className="block space-y-2 text-sm font-medium text-slate-700">
              <span>ZIP Organization</span>
              <select
                className="h-11 w-full rounded-md border border-slate-300 px-3"
                onChange={(event) =>
                  setForm({
                    ...form,
                    zip_organization: event.target.value,
                  })
                }
                value={form.zip_organization}
              >
                <option value="GROUP_BY_BRAND">Group by brand</option>
                <option value="GROUP_BY_ASSET_TYPE">Group by asset type</option>
                <option value="FLAT">Flat</option>
              </select>
            </label>
            <label className="flex items-center gap-2 text-sm font-medium text-slate-700 sm:mt-8">
              <input
                checked={form.requires_card_images}
                className="h-4 w-4"
                onChange={(event) =>
                  setForm({
                    ...form,
                    requires_card_images: event.target.checked,
                  })
                }
                type="checkbox"
              />
              Requires card images
            </label>
            <label className="flex items-center gap-2 text-sm font-medium text-slate-700 sm:mt-8">
              <input
                checked={form.requires_receipt_images}
                className="h-4 w-4"
                onChange={(event) =>
                  setForm({
                    ...form,
                    requires_receipt_images: event.target.checked,
                  })
                }
                type="checkbox"
              />
              Requires receipt images
            </label>
            <label className="flex items-center gap-2 text-sm font-medium text-slate-700">
              <input
                checked={form.group_card_exports_by_brand}
                className="h-4 w-4"
                onChange={(event) =>
                  setForm({
                    ...form,
                    group_card_exports_by_brand: event.target.checked,
                  })
                }
                type="checkbox"
              />
              Group cards by brand
            </label>
            <label className="flex items-center gap-2 text-sm font-medium text-slate-700">
              <input
                checked={form.preserve_blank_export_columns}
                className="h-4 w-4"
                onChange={(event) =>
                  setForm({
                    ...form,
                    preserve_blank_export_columns: event.target.checked,
                  })
                }
                type="checkbox"
              />
              Preserve blank export columns
            </label>
          </div>

          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            <label className="block space-y-2 text-sm font-medium text-slate-700">
              <span>Card Export Template</span>
              <textarea
                className="min-h-24 w-full rounded-md border border-slate-300 px-3 py-2 font-mono text-sm"
                onChange={(event) =>
                  setForm({ ...form, card_export_format: event.target.value })
                }
                placeholder={DEFAULT_CARD_EXPORT_FORMAT}
                value={form.card_export_format}
              />
              <p className="text-xs text-slate-500">
                Placeholders: {"{brand}"} {"{face_value}"} {"{card_number}"}{" "}
                {"{pin}"}. Bare comma-separated fields also work:
                card_number,pin,face_value.
              </p>
            </label>
            <label className="block space-y-2 text-sm font-medium text-slate-700">
              <span>Fuel Export Template</span>
              <textarea
                className="min-h-24 w-full rounded-md border border-slate-300 px-3 py-2 font-mono text-sm"
                onChange={(event) =>
                  setForm({ ...form, fuel_export_format: event.target.value })
                }
                placeholder={DEFAULT_FUEL_EXPORT_FORMAT}
                value={form.fuel_export_format}
              />
              <p className="text-xs text-slate-500">
                Placeholders: {"{retailer}"} {"{points_sold}"} {"{email_login}"}{" "}
                {"{password}"} {"{alt_id}"}. Unknown fields export blank.
              </p>
            </label>
          </div>
        </AdvancedFormSection>

        <AdvancedFormSection title="Advanced External IDs">
          <div className="space-y-3">
            {form.external_identifiers.map((identifier, index) => (
              <div
                className="grid gap-2 rounded-md border border-slate-200 bg-white p-3 sm:grid-cols-[1fr_1fr_1fr_auto]"
                key={index}
              >
                <input
                  className="h-10 rounded-md border border-slate-300 px-3 text-sm"
                  onChange={(event) => {
                    const next = [...form.external_identifiers];
                    next[index] = {
                      ...identifier,
                      platform_source: event.target.value,
                    };
                    setForm({ ...form, external_identifiers: next });
                  }}
                  placeholder="Platform/source"
                  value={identifier.platform_source}
                />
                <input
                  className="h-10 rounded-md border border-slate-300 px-3 text-sm"
                  onChange={(event) => {
                    const next = [...form.external_identifiers];
                    next[index] = {
                      ...identifier,
                      identifier: event.target.value,
                    };
                    setForm({ ...form, external_identifiers: next });
                  }}
                  placeholder="Identifier"
                  value={identifier.identifier}
                />
                <input
                  className="h-10 rounded-md border border-slate-300 px-3 text-sm"
                  onChange={(event) => {
                    const next = [...form.external_identifiers];
                    next[index] = { ...identifier, notes: event.target.value };
                    setForm({ ...form, external_identifiers: next });
                  }}
                  placeholder="Notes"
                  value={identifier.notes}
                />
                <button
                  className="h-10 rounded-md border border-slate-300 px-3 text-sm font-semibold hover:bg-slate-100"
                  onClick={() =>
                    setForm({
                      ...form,
                      external_identifiers: form.external_identifiers.filter(
                        (_, rowIndex) => rowIndex !== index,
                      ),
                    })
                  }
                  type="button"
                >
                  Remove
                </button>
              </div>
            ))}
            <button
              className="h-10 rounded-md border border-slate-300 px-3 text-sm font-semibold hover:bg-slate-100"
              onClick={() =>
                setForm({
                  ...form,
                  external_identifiers: [
                    ...form.external_identifiers,
                    { platform_source: "", identifier: "", notes: "" },
                  ],
                })
              }
              type="button"
            >
              Add External ID
            </button>
          </div>
        </AdvancedFormSection>

        <AdvancedFormSection title="Advanced Notes">
          <label className="block space-y-2 text-sm font-medium text-slate-700">
            <span>Notes</span>
            <textarea
              className="min-h-20 w-full rounded-md border border-slate-300 px-3 py-2"
              onChange={(event) => setForm({ ...form, notes: event.target.value })}
              value={form.notes}
            />
          </label>
        </AdvancedFormSection>

      </form>
    </div>
  );
}
