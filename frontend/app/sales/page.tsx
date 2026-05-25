"use client";

import Link from "next/link";
import { Fragment, Suspense, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { useSearchParams } from "next/navigation";

import { API_BASE_URL } from "@/lib/api";

type Sale = {
  id: number;
  buyer_id: number;
  buyer_name: string | null;
  sold_at: string;
  expected_payment_date: string | null;
  expected_payout: string | number;
  card_payout_rate: string | number | null;
  fuel_rate_per_1000: string | number | null;
  payout_received: string | number | null;
  payment_account_id: number | null;
  payment_account: {
    id: number;
    name: string;
    account_type: string;
    institution: string | null;
    last_four: string | null;
    account_identifier: string | null;
    payment_identifier: string | null;
    is_business_account: boolean;
    bank_account_type: string | null;
  } | null;
  status: string;
  status_label: string | null;
  export_access_revoked: boolean;
  sensitive_details_revoked: boolean;
  exported_before_void: boolean;
  buyer_reference: string | null;
  internal_tags: string | null;
  export_profile: string | null;
  settlement_status_notes: string | null;
  manual_payout_override_amount: string | number | null;
  linked_external_reference_ids: string | null;
  notes: string | null;
  asset_count: number;
  gift_cards: Array<{
    id: number;
    purchase_batch_id: number;
    brand: string;
    face_value: string | number;
    card_number_ending: string | null;
    pin_ending: string | null;
    confirmed_at: string | null;
    confirmed_source: string | null;
    export_value_source: string | null;
    status: string;
    expected_payout: string | number | null;
    notes: string | null;
    sensitive_details_removed?: boolean;
  }>;
  fuel_accounts: Array<{
    id: number;
    retailer: string;
    points_sold: number;
    email: string | null;
    alt_id: string | null;
    status: string;
    sensitive_details_removed?: boolean;
  }>;
  events: Array<{
    id: number;
    action: string;
    affected_asset_count: number | null;
    user_label: string | null;
    field_name: string | null;
    old_value: string | null;
    new_value: string | null;
    reason: string | null;
    notes: string | null;
    created_at: string;
  }>;
};

type Buyer = {
  id: number;
  name: string;
  active: boolean;
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

type SaleEditForm = {
  buyer_id: string;
  expected_payment_date: string;
  expected_payout: string;
  payment_account_id: string;
  buyer_reference: string;
  notes: string;
  internal_tags: string;
  export_profile: string;
  settlement_status_notes: string;
  manual_payout_override_amount: string;
  card_payout_rate: string;
  fuel_rate_per_1000: string;
  sold_date: string;
  linked_external_reference_ids: string;
  reason: string;
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

function formatDateInput(value: string | null) {
  if (!value) {
    return "";
  }

  return value.slice(0, 10);
}

function decimalRateToPercent(value: string | number | null) {
  if (value === null || value === undefined || value === "") {
    return "";
  }

  const amount = Number(value);

  if (Number.isNaN(amount)) {
    return "";
  }

  return String(Number((amount * 100).toFixed(2)));
}

function saleToEditForm(sale: Sale): SaleEditForm {
  return {
    buyer_id: String(sale.buyer_id),
    expected_payment_date: formatDateInput(sale.expected_payment_date),
    expected_payout: String(sale.expected_payout ?? ""),
    payment_account_id:
      sale.payment_account_id === null ? "" : String(sale.payment_account_id),
    buyer_reference: sale.buyer_reference ?? "",
    notes: sale.notes ?? "",
    internal_tags: sale.internal_tags ?? "",
    export_profile: sale.export_profile ?? "",
    settlement_status_notes: sale.settlement_status_notes ?? "",
    manual_payout_override_amount:
      sale.manual_payout_override_amount === null
        ? ""
        : String(sale.manual_payout_override_amount),
    card_payout_rate: decimalRateToPercent(sale.card_payout_rate),
    fuel_rate_per_1000:
      sale.fuel_rate_per_1000 === null ? "" : String(sale.fuel_rate_per_1000),
    sold_date: formatDateInput(sale.sold_at),
    linked_external_reference_ids: sale.linked_external_reference_ids ?? "",
    reason: "",
  };
}

function statusLabel(status: string) {
  if (status === "VOIDED") {
    return "Voided";
  }

  if (status === "ACTIVE") {
    return "Active";
  }

  if (status === "SOLD_PENDING_PAYMENT") {
    return "Awaiting Payment";
  }

  if (status === "PARTIALLY_SETTLED") {
    return "Partially Paid";
  }

  if (status === "SETTLED" || status === "COMPLETED") {
    return "Paid / Settled";
  }

  return status.replaceAll("_", " ");
}

function isVoidLocked(sale: Sale) {
  return sale.status === "VOIDED";
}

function paymentAccountLabel(account: Sale["payment_account"]) {
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

const saleStatusLabels: Record<string, string> = {
  draft: "Draft / Created",
  created: "Draft / Created",
  awaiting_payment: "Awaiting Payment",
  partially_paid: "Partially Paid",
  settled: "Settled",
  voided: "Voided",
};

function matchesStatusFilter(sale: Sale, statusFilter: string | null) {
  if (!statusFilter) {
    return true;
  }

  if (statusFilter === "draft" || statusFilter === "created") {
    return sale.status === "DRAFT" || sale.status === "ACTIVE";
  }
  if (statusFilter === "awaiting_payment" || statusFilter === "awaiting") {
    return (
      ["ACTIVE", "SOLD_PENDING_PAYMENT"].includes(sale.status) &&
      Number(sale.payout_received ?? 0) === 0
    );
  }
  if (statusFilter === "partially_paid") {
    return (
      sale.status === "PARTIALLY_SETTLED" ||
      (["ACTIVE", "SOLD_PENDING_PAYMENT"].includes(sale.status) &&
        Number(sale.payout_received ?? 0) > 0)
    );
  }
  if (statusFilter === "settled") {
    return sale.status === "COMPLETED" || sale.status === "SETTLED";
  }
  if (statusFilter === "voided") {
    return sale.status === "VOIDED";
  }
  return true;
}

function focusLabel(focus: string | null) {
  if (focus === "profit") {
    return "Profit";
  }
  return null;
}

function dateRangeLabel(dateRange: string | null) {
  if (dateRange === "ytd") {
    return "Year to date";
  }
  if (dateRange === "mtd") {
    return "Month to date";
  }
  return null;
}

function matchesDateRange(sale: Sale, dateRange: string | null) {
  if (!dateRange) {
    return true;
  }

  const soldAt = new Date(sale.sold_at);
  if (Number.isNaN(soldAt.getTime())) {
    return true;
  }

  const now = new Date();
  if (dateRange === "ytd") {
    return soldAt.getFullYear() === now.getFullYear();
  }
  if (dateRange === "mtd") {
    return (
      soldAt.getFullYear() === now.getFullYear() &&
      soldAt.getMonth() === now.getMonth()
    );
  }
  return true;
}

export default function SalesPage() {
  return (
    <Suspense
      fallback={
        <main className="min-h-screen bg-slate-50 px-4 py-8 text-slate-950 sm:px-6 lg:px-8">
          <div className="mx-auto max-w-7xl rounded-lg border border-slate-200 bg-white p-8 text-sm text-slate-500">
            Loading sales...
          </div>
        </main>
      }
    >
      <SalesContent />
    </Suspense>
  );
}

function SalesContent() {
  const searchParams = useSearchParams();
  const statusFilter = searchParams.get("status");
  const focus = searchParams.get("focus");
  const dateRange = searchParams.get("date_range");
  const saleIdFilter = searchParams.get("sale");
  const [sales, setSales] = useState<Sale[]>([]);
  const [buyers, setBuyers] = useState<Buyer[]>([]);
  const [paymentAccounts, setPaymentAccounts] = useState<PaymentAccount[]>([]);
  const [search, setSearch] = useState("");
  const [expandedSaleIds, setExpandedSaleIds] = useState<Record<number, boolean>>(
    {},
  );
  const [selectedSaleIds, setSelectedSaleIds] = useState<number[]>([]);
  const [copyMessage, setCopyMessage] = useState<string | null>(null);
  const [voidingSale, setVoidingSale] = useState<Sale | null>(null);
  const [voidNotes, setVoidNotes] = useState("");
  const [isVoiding, setIsVoiding] = useState(false);
  const [editingSale, setEditingSale] = useState<Sale | null>(null);
  const [editForm, setEditForm] = useState<SaleEditForm | null>(null);
  const [isSavingEdit, setIsSavingEdit] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const activeFilterParts = [
    statusFilter ? saleStatusLabels[statusFilter] ?? statusFilter : null,
    focusLabel(focus),
    dateRangeLabel(dateRange),
    saleIdFilter ? `Sale #${saleIdFilter}` : null,
  ].filter(Boolean);

  async function loadSales() {
    setIsLoading(true);
    setError(null);

    try {
      const query = new URLSearchParams();

      if (search.trim()) {
        query.set("q", search.trim());
      }

      const endpoint = `${API_BASE_URL}/sales/${
        query.toString() ? `?${query}` : ""
      }`;
      const response = await fetch(endpoint);

      if (!response.ok) {
        console.error("Sales history fetch failed", {
          endpoint,
          status: response.status,
          statusText: response.statusText,
        });
        throw new Error(`Failed to load sales from ${endpoint} (${response.status})`);
      }

      setSales((await response.json()) as Sale[]);
    } catch (err) {
      console.error("Sales history fetch failed", err);
      setError(err instanceof Error ? err.message : "Failed to load sales.");
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      void loadSales();
    }, 0);

    return () => window.clearTimeout(timeoutId);
  }, [search]);

  const visibleSales = useMemo(
    () => {
      const filteredSales = sales.filter((sale) => {
        if (dateRange && sale.status === "VOIDED") {
          return false;
        }
        if (!matchesStatusFilter(sale, statusFilter)) {
          return false;
        }
        if (!matchesDateRange(sale, dateRange)) {
          return false;
        }
        if (saleIdFilter && String(sale.id) !== saleIdFilter) {
          return false;
        }
        return true;
      });

      if (focus === "profit") {
        return filteredSales.sort(
          (first, second) =>
            Number(second.expected_payout ?? 0) - Number(first.expected_payout ?? 0),
        );
      }

      return filteredSales;
    },
    [dateRange, focus, sales, saleIdFilter, statusFilter],
  );

  useEffect(() => {
    async function loadEditReferences() {
      try {
        const [buyersResponse, accountsResponse] = await Promise.all([
          fetch(`${API_BASE_URL}/buyers/`),
          fetch(`${API_BASE_URL}/payment-accounts/`),
        ]);

        if (buyersResponse.ok) {
          setBuyers((await buyersResponse.json()) as Buyer[]);
        }

        if (accountsResponse.ok) {
          setPaymentAccounts((await accountsResponse.json()) as PaymentAccount[]);
        }
      } catch (err) {
        console.error("Sale edit reference fetch failed", err);
      }
    }

    void loadEditReferences();
  }, []);

  function toggleSale(saleId: number) {
    setExpandedSaleIds((currentValue) => ({
      ...currentValue,
      [saleId]: !currentValue[saleId],
    }));
  }

  function toggleSelectedSale(saleId: number, isSelected: boolean) {
    const sale = sales.find((currentSale) => currentSale.id === saleId);
    if (sale && isVoidLocked(sale)) {
      return;
    }

    setSelectedSaleIds((current) =>
      isSelected
        ? [...new Set([...current, saleId])]
        : current.filter((id) => id !== saleId),
    );
  }

  async function copySaleExport(saleId: number, exportType: "card" | "fuel") {
    setCopyMessage(null);

    const endpoint = `${API_BASE_URL}/sales/${saleId}/export`;
    const response = await fetch(endpoint);

    if (!response.ok) {
      console.error("Sale export fetch failed", {
        endpoint,
        status: response.status,
        statusText: response.statusText,
      });
      setCopyMessage(`Failed to load ${exportType} export.`);
      return;
    }

    const data = (await response.json()) as {
      card_export: string;
      fuel_export: string;
    };
    const text = exportType === "card" ? data.card_export : data.fuel_export;

    if (!text) {
      setCopyMessage(`No ${exportType} export for this sale.`);
      return;
    }

    await navigator.clipboard.writeText(text);
    setCopyMessage(`${exportType === "card" ? "Card" : "Fuel"} export copied.`);
  }

  async function confirmVoidSale() {
    if (!voidingSale) {
      return;
    }

    setIsVoiding(true);
    setError(null);

    const endpoint = `${API_BASE_URL}/sales/${voidingSale.id}/void`;

    try {
      const response = await fetch(endpoint, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notes: voidNotes.trim() || null }),
      });

      if (!response.ok) {
        const body = await response.text();
        console.error("Void sale failed", {
          endpoint,
          status: response.status,
          body,
        });
        throw new Error(`Failed to void sale #${voidingSale.id} (${response.status})`);
      }

      setVoidingSale(null);
      setVoidNotes("");
      setCopyMessage(`Sale #${voidingSale.id} voided. Assets returned to inventory.`);
      await loadSales();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to void sale.");
    } finally {
      setIsVoiding(false);
    }
  }

  function openEditSale(sale: Sale) {
    setEditingSale(sale);
    setEditForm(saleToEditForm(sale));
  }

  function updateEditForm(field: keyof SaleEditForm, value: string) {
    setEditForm((current) => (current ? { ...current, [field]: value } : current));
  }

  function editPayload() {
    if (!editForm || !editingSale) {
      return null;
    }

    const payload: Record<string, string | number | null> = {};

    function addIfChanged(
      field: string,
      nextValue: string | number | null,
      currentValue: string | number | null,
    ) {
      if (String(nextValue ?? "") !== String(currentValue ?? "")) {
        payload[field] = nextValue;
      }
    }

    addIfChanged("buyer_id", Number(editForm.buyer_id), editingSale.buyer_id);
    addIfChanged(
      "expected_payment_date",
      editForm.expected_payment_date || null,
      formatDateInput(editingSale.expected_payment_date) || null,
    );
    addIfChanged(
      "expected_payout",
      editForm.expected_payout ? Number(editForm.expected_payout) : null,
      Number(editingSale.expected_payout),
    );
    addIfChanged(
      "payment_account_id",
      editForm.payment_account_id ? Number(editForm.payment_account_id) : null,
      editingSale.payment_account_id,
    );
    addIfChanged("buyer_reference", editForm.buyer_reference || null, editingSale.buyer_reference);
    addIfChanged("notes", editForm.notes || null, editingSale.notes);
    addIfChanged("internal_tags", editForm.internal_tags || null, editingSale.internal_tags);
    addIfChanged("export_profile", editForm.export_profile || null, editingSale.export_profile);
    addIfChanged(
      "settlement_status_notes",
      editForm.settlement_status_notes || null,
      editingSale.settlement_status_notes,
    );
    addIfChanged(
      "manual_payout_override_amount",
      editForm.manual_payout_override_amount
        ? Number(editForm.manual_payout_override_amount)
        : null,
      editingSale.manual_payout_override_amount === null
        ? null
        : Number(editingSale.manual_payout_override_amount),
    );
    addIfChanged(
      "card_payout_rate",
      editForm.card_payout_rate ? Number(editForm.card_payout_rate) : null,
      decimalRateToPercent(editingSale.card_payout_rate) || null,
    );
    addIfChanged(
      "fuel_rate_per_1000",
      editForm.fuel_rate_per_1000 ? Number(editForm.fuel_rate_per_1000) : null,
      editingSale.fuel_rate_per_1000 === null
        ? null
        : Number(editingSale.fuel_rate_per_1000),
    );
    addIfChanged("sold_date", editForm.sold_date || null, formatDateInput(editingSale.sold_at));
    addIfChanged(
      "linked_external_reference_ids",
      editForm.linked_external_reference_ids || null,
      editingSale.linked_external_reference_ids,
    );

    if (editForm.reason) {
      payload.reason = editForm.reason;
    }

    return payload;
  }

  async function saveSaleEdit() {
    if (!editingSale || !editForm) {
      return;
    }

    setIsSavingEdit(true);
    setError(null);

    const endpoint = `${API_BASE_URL}/sales/${editingSale.id}`;

    try {
      const response = await fetch(endpoint, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(editPayload()),
      });

      if (!response.ok) {
        const body = await response.text();
        console.error("Edit sale failed", {
          endpoint,
          status: response.status,
          body,
        });
        throw new Error(`Failed to edit sale #${editingSale.id} (${response.status})`);
      }

      setEditingSale(null);
      setEditForm(null);
      setCopyMessage(`Sale #${editingSale.id} updated with audit history.`);
      await loadSales();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to edit sale.");
    } finally {
      setIsSavingEdit(false);
    }
  }

  const selectedExportableSaleIds = selectedSaleIds.filter((saleId) => {
    const sale = sales.find((currentSale) => currentSale.id === saleId);
    return sale ? !isVoidLocked(sale) : false;
  });

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-8 text-slate-950 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-7xl space-y-6">
        <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-sm font-medium uppercase tracking-wide text-slate-500">
              Sales
            </p>
            <h1 className="mt-1 text-3xl font-semibold tracking-tight">
              Sales History
            </h1>
            <p className="mt-2 text-sm text-slate-600">
              Bundled card and fuel account sales, exports, and settlement
              status.
            </p>
          </div>
          <Link
            className="inline-flex h-11 items-center justify-center rounded-md bg-slate-950 px-4 text-sm font-semibold text-white hover:bg-slate-800"
            href="/sales/new"
          >
            Create Sale
          </Link>
        </header>

        {error ? (
          <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-800">
            {error}
          </div>
        ) : null}

        {activeFilterParts.length > 0 ? (
          <div className="flex flex-col gap-3 rounded-md border border-cyan-200 bg-cyan-50 px-4 py-3 text-sm text-cyan-950 sm:flex-row sm:items-center sm:justify-between">
            <p className="font-semibold">
              Showing: {activeFilterParts.join(" · ")}
            </p>
            <Link className="font-semibold hover:underline" href="/sales">
              Clear filter
            </Link>
          </div>
        ) : null}

        <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
          <label className="block space-y-2 text-sm font-medium text-slate-700">
            <span>Search Sales History</span>
            <input
              className="h-11 w-full rounded-md border border-slate-300 px-3 text-base text-slate-950 outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-200"
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Buyer, sale #, brand, face value, card ending, alt ID, email, notes..."
              type="search"
              value={search}
            />
          </label>
          {copyMessage ? (
            <p className="mt-3 text-sm font-medium text-slate-700">
              {copyMessage}
            </p>
          ) : null}
        </section>

        {isLoading ? (
          <section className="rounded-lg border border-slate-200 bg-white p-8 text-center text-sm text-slate-500 shadow-sm">
            Loading sales...
          </section>
        ) : null}

        {!isLoading && visibleSales.length === 0 ? (
          <section className="rounded-lg border border-dashed border-slate-300 bg-white p-8 text-center shadow-sm">
            <h2 className="text-lg font-semibold">No sales found</h2>
            <p className="mt-2 text-sm text-slate-500">
              {activeFilterParts.length > 0
                ? "No sales match the active filter."
                : "Create a sale to bundle cards and fuel accounts for one buyer."}
            </p>
            <Link
              className="mt-4 inline-flex h-11 items-center rounded-md bg-slate-950 px-4 text-sm font-semibold text-white"
              href="/sales/new"
            >
              Create Sale
            </Link>
          </section>
        ) : null}

        {visibleSales.length > 0 ? (
          <section className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
            <div className="flex flex-col gap-2 border-b border-slate-200 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
                  Sales Export
                </h2>
                <p className="text-xs text-slate-500">
                  Select sales to create a curated transfer package.
                </p>
              </div>
              {selectedExportableSaleIds.length > 0 ? (
                <a
                  className="inline-flex h-9 cursor-pointer items-center justify-center rounded-md border border-slate-300 px-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-100 active:bg-slate-200"
                  href={`${API_BASE_URL}/data-transfer/export?sales=${selectedExportableSaleIds.join(",")}`}
                >
                  Export Selected ({selectedExportableSaleIds.length})
                </a>
              ) : null}
            </div>
            <table className="min-w-full divide-y divide-slate-200 text-sm">
              <thead className="bg-slate-100 text-left text-xs font-semibold uppercase tracking-wide text-slate-600">
                <tr>
                  <th className="px-4 py-3">Sale</th>
                  <th className="px-4 py-3">Buyer</th>
                  <th className="px-4 py-3">Assets</th>
                  <th className="px-4 py-3">Expected Payout</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3 text-right">Package</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {visibleSales.map((sale) => {
                  const isExpanded =
                    Boolean(expandedSaleIds[sale.id]) ||
                    String(sale.id) === saleIdFilter;
                  const voidLocked = isVoidLocked(sale);

                  return (
                    <Fragment key={sale.id}>
                      <tr key={`sale-${sale.id}`}>
                        <td className="px-4 py-3">
                          <button
                            className="mr-2 inline-flex h-8 w-8 cursor-pointer items-center justify-center rounded-md border border-slate-300 font-semibold hover:bg-slate-100 active:bg-slate-200"
                            onClick={() => toggleSale(sale.id)}
                            type="button"
                            aria-label={
                              isExpanded
                                ? `Collapse sale ${sale.id}`
                                : `Expand sale ${sale.id}`
                            }
                          >
                            {isExpanded ? "−" : "+"}
                          </button>
                          <input
                            checked={selectedSaleIds.includes(sale.id)}
                            className="mr-2 h-4 w-4 align-middle disabled:cursor-not-allowed disabled:opacity-40"
                            disabled={voidLocked}
                            onChange={(event) =>
                              toggleSelectedSale(sale.id, event.target.checked)
                            }
                            onClick={(event) => event.stopPropagation()}
                            type="checkbox"
                            aria-label={`Select sale ${sale.id} for export`}
                          />
                          <span className="font-semibold">#{sale.id}</span>
                          <p className="mt-1 text-xs text-slate-500">
                            {formatDate(sale.sold_at)}
                          </p>
                        </td>
                        <td className="px-4 py-3">{sale.buyer_name ?? "-"}</td>
                        <td className="px-4 py-3">
                          <p>{sale.asset_count} assets</p>
                          <p className="text-xs text-slate-500">
                            {sale.gift_cards.length} cards ·{" "}
                            {sale.fuel_accounts.length} fuel accounts
                          </p>
                        </td>
                        <td className="px-4 py-3">
                          {formatCurrency(sale.expected_payout)}
                        </td>
                        <td className="px-4 py-3">
                          {sale.status_label ?? statusLabel(sale.status)}
                          {sale.exported_before_void && sale.status === "VOIDED" ? (
                            <p className="mt-1 text-xs font-medium text-amber-700">
                              Previously exported
                            </p>
                          ) : null}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <div className="flex justify-end gap-2">
                            {voidLocked ? (
                              <span className="inline-flex h-9 items-center rounded-md border border-slate-300 bg-slate-100 px-3 text-sm font-semibold text-slate-500">
                                Export revoked
                              </span>
                            ) : (
                              <>
                                <a
                                  className="inline-flex h-9 cursor-pointer items-center rounded-md border border-slate-300 px-3 text-sm font-semibold hover:bg-slate-100 active:bg-slate-200"
                                  href={`${API_BASE_URL}/data-transfer/export?sales=${sale.id}`}
                                >
                                  Export
                                </a>
                                <a
                                  className="inline-flex h-9 cursor-pointer items-center rounded-md border border-slate-300 px-3 text-sm font-semibold hover:bg-slate-100 active:bg-slate-200"
                                  href={`${API_BASE_URL}/sales/${sale.id}/package.zip`}
                                >
                                  Download ZIP
                                </a>
                              </>
                            )}
                            {sale.status !== "VOIDED" ? (
                              <button
                                className="inline-flex h-9 cursor-pointer items-center rounded-md border border-slate-300 px-3 text-sm font-semibold hover:bg-slate-100 active:bg-slate-200"
                                onClick={() => openEditSale(sale)}
                                type="button"
                              >
                                Edit
                              </button>
                            ) : null}
                            {sale.status !== "VOIDED" ? (
                              <button
                                className="inline-flex h-9 cursor-pointer items-center rounded-md border border-red-200 px-3 text-sm font-semibold text-red-700 hover:bg-red-50 active:bg-red-100"
                                onClick={() => setVoidingSale(sale)}
                                type="button"
                              >
                                Void
                              </button>
                            ) : null}
                          </div>
                        </td>
                      </tr>
                      {isExpanded ? (
                        <tr key={`sale-${sale.id}-details`}>
                          <td className="bg-slate-50 px-4 py-4" colSpan={6}>
                            <div className="space-y-4">
                              {sale.status === "VOIDED" ? (
                                <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-900">
                                  <p className="font-semibold">
                                    VOIDED — ASSETS RETURNED
                                  </p>
                                  <p className="mt-1">
                                    Transaction cancelled. Export actions are
                                    locked, and assets were restored to
                                    inventory.
                                  </p>
                                  {sale.exported_before_void ? (
                                    <p className="mt-1 font-medium">
                                      This sale was previously exported before
                                      being voided.
                                    </p>
                                  ) : null}
                                </div>
                              ) : null}
                              <div className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-5">
                                <Info label="Expected Payout" value={formatCurrency(sale.expected_payout)} />
                                <Info label="Payout Received" value={sale.payout_received === null ? "-" : formatCurrency(sale.payout_received)} />
                                <Info label="Expected Payment" value={sale.expected_payment_date ? formatDate(sale.expected_payment_date) : "-"} />
                                <Info label="Expected Destination" value={paymentAccountLabel(sale.payment_account)} />
                                <Info label="Status" value={sale.status_label ?? statusLabel(sale.status)} />
                              </div>

                              <div className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
                                <Info label="Buyer Reference" value={sale.buyer_reference || "-"} />
                                <Info label="Export Profile" value={sale.export_profile || "-"} />
                                <Info label="Internal Tags" value={sale.internal_tags || "-"} />
                                <Info
                                  label="External References"
                                  value={sale.linked_external_reference_ids || "-"}
                                />
                              </div>

                              {sale.notes ? (
                                <div className="rounded-md border border-slate-200 bg-white p-3 text-sm">
                                  <p className="font-semibold">Sale Notes</p>
                                  <p className="mt-1 whitespace-pre-wrap text-slate-600">
                                    {sale.notes}
                                  </p>
                                </div>
                              ) : null}

                              <div className="flex flex-wrap gap-2">
                                {voidLocked ? (
                                  <span className="inline-flex h-9 items-center rounded-md border border-slate-300 bg-slate-100 px-3 text-sm font-semibold text-slate-500">
                                    Void locked
                                  </span>
                                ) : (
                                  <>
                                    <a
                                      className="inline-flex h-9 cursor-pointer items-center rounded-md border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-700 hover:bg-slate-100 active:bg-slate-200"
                                      href={`${API_BASE_URL}/data-transfer/export?sales=${sale.id}`}
                                    >
                                      Export Transfer
                                    </a>
                                    <a
                                      className="inline-flex h-9 cursor-pointer items-center rounded-md bg-slate-900 px-3 text-sm font-semibold text-white hover:bg-slate-700 active:bg-slate-950"
                                      href={`${API_BASE_URL}/sales/${sale.id}/package.zip`}
                                    >
                                      Download ZIP
                                    </a>
                                    <button
                                      className="h-9 cursor-pointer rounded-md border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-700 hover:bg-slate-100 active:bg-slate-200"
                                      onClick={() => copySaleExport(sale.id, "card")}
                                      type="button"
                                    >
                                      Copy card export
                                    </button>
                                    <button
                                      className="h-9 cursor-pointer rounded-md border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-700 hover:bg-slate-100 active:bg-slate-200"
                                      onClick={() => copySaleExport(sale.id, "fuel")}
                                      type="button"
                                    >
                                      Copy fuel export
                                    </button>
                                  </>
                                )}
                                {sale.status !== "VOIDED" ? (
                                  <button
                                    className="h-9 cursor-pointer rounded-md border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-700 hover:bg-slate-100 active:bg-slate-200"
                                    onClick={() => openEditSale(sale)}
                                    type="button"
                                  >
                                    Edit Sale
                                  </button>
                                ) : null}
                                {sale.status !== "VOIDED" ? (
                                  <button
                                    className="h-9 cursor-pointer rounded-md border border-red-200 bg-white px-3 text-sm font-semibold text-red-700 hover:bg-red-50 active:bg-red-100"
                                    onClick={() => setVoidingSale(sale)}
                                    type="button"
                                  >
                                    Void Sale
                                  </button>
                                ) : null}
                              </div>

                              {sale.events.length > 0 ? (
                                <section className="rounded-md border border-slate-200 bg-white p-3 text-sm">
                                  <h3 className="font-semibold">Audit History</h3>
                                  <div className="mt-2 space-y-2">
                                    {sale.events.map((event) => (
                                      <div
                                        className="flex flex-col gap-1 border-t border-slate-100 pt-2 first:border-t-0 first:pt-0 sm:flex-row sm:items-center sm:justify-between"
                                        key={event.id}
                                      >
                                        <span className="font-medium">
                                          {event.action.replaceAll("_", " ")}
                                          {event.affected_asset_count !== null
                                            ? ` · ${event.affected_asset_count} assets`
                                            : ""}
                                        </span>
                                        <span className="text-xs text-slate-500">
                                          {formatDate(event.created_at)}
                                        </span>
                                        {event.field_name ? (
                                          <span className="text-slate-600">
                                            {event.field_name}: {event.old_value || "—"} →{" "}
                                            {event.new_value || "—"}
                                            {event.reason ? ` · ${event.reason}` : ""}
                                          </span>
                                        ) : null}
                                        {event.notes ? (
                                          <span className="text-slate-600">
                                            {event.notes}
                                          </span>
                                        ) : null}
                                      </div>
                                    ))}
                                  </div>
                                </section>
                              ) : null}

                              {sale.status === "VOIDED" ? (
                                <section className="rounded-md border border-slate-200 bg-white p-3 text-sm">
                                  <h3 className="font-semibold">
                                    Assets returned to inventory
                                  </h3>
                                  <div className="mt-3 grid gap-2 sm:grid-cols-2">
                                    <Info
                                      label="Gift cards"
                                      value={`${sale.gift_cards.length} gift ${
                                        sale.gift_cards.length === 1
                                          ? "card"
                                          : "cards"
                                      }`}
                                    />
                                    <Info
                                      label="Fuel accounts"
                                      value={`${sale.fuel_accounts.length} fuel ${
                                        sale.fuel_accounts.length === 1
                                          ? "account"
                                          : "accounts"
                                      }`}
                                    />
                                  </div>
                                </section>
                              ) : sale.gift_cards.length > 0 ? (
                                <section>
                                  <h3 className="text-sm font-semibold">
                                    Gift Cards
                                  </h3>
                                  <div className="mt-2 overflow-x-auto rounded-md border border-slate-200 bg-white">
                                    <table className="min-w-full text-sm">
                                      <thead className="bg-slate-100 text-left text-xs uppercase text-slate-500">
                                        <tr>
                                          <th className="px-3 py-2">Brand</th>
                                          <th className="px-3 py-2">Face</th>
                                          <th className="px-3 py-2">Card</th>
                                          <th className="px-3 py-2">PIN</th>
                                          <th className="px-3 py-2">Purchase</th>
                                          <th className="px-3 py-2">Status</th>
                                          <th className="px-3 py-2">Actions</th>
                                        </tr>
                                      </thead>
                                      <tbody className="divide-y divide-slate-200">
                                        {sale.gift_cards.map((card) => (
                                          <tr key={card.id}>
                                            <td className="px-3 py-2 font-medium">
                                              {card.brand}
                                            </td>
                                            <td className="px-3 py-2">
                                              {formatCurrency(card.face_value)}
                                            </td>
                                            <td className="px-3 py-2">
                                              {sale.sensitive_details_revoked
                                                ? "Sensitive details removed after void"
                                                : card.card_number_ending
                                                ? `Card ending ${card.card_number_ending}`
                                                : "-"}
                                            </td>
                                            <td className="px-3 py-2">
                                              {sale.sensitive_details_revoked
                                                ? "Sensitive details removed after void"
                                                : card.pin_ending
                                                ? `PIN ending ${card.pin_ending}`
                                                : "-"}
                                              {!sale.sensitive_details_revoked &&
                                              card.export_value_source ? (
                                                <p className="mt-1 text-[11px] font-medium text-slate-500">
                                                  Source:{" "}
                                                  {card.export_value_source.replaceAll(
                                                    "_",
                                                    " ",
                                                  )}
                                                </p>
                                              ) : null}
                                            </td>
                                            <td className="px-3 py-2">
                                              #{card.purchase_batch_id}
                                            </td>
                                            <td className="px-3 py-2">
                                              {statusLabel(card.status)}
                                            </td>
                                            <td className="px-3 py-2">
                                              <div className="flex flex-wrap gap-2">
                                                <Link
                                                  className="inline-flex h-8 items-center rounded-md border border-slate-300 px-2 text-xs font-semibold hover:bg-slate-100"
                                                  href={`/purchases/${card.purchase_batch_id}`}
                                                >
                                                  View purchase
                                                </Link>
                                                {!sale.sensitive_details_revoked ? (
                                                  <Link
                                                    className="inline-flex h-8 items-center rounded-md border border-slate-300 px-2 text-xs font-semibold hover:bg-slate-100"
                                                    href={`/gift-cards/${card.id}/verify?returnTo=/sales`}
                                                  >
                                                    View card
                                                  </Link>
                                                ) : null}
                                              </div>
                                            </td>
                                          </tr>
                                        ))}
                                      </tbody>
                                    </table>
                                  </div>
                                </section>
                              ) : null}

                              {sale.status !== "VOIDED" && sale.fuel_accounts.length > 0 ? (
                                <section>
                                  <h3 className="text-sm font-semibold">
                                    Fuel Accounts
                                  </h3>
                                  <div className="mt-2 grid gap-2 sm:grid-cols-2">
                                    {sale.fuel_accounts.map((account) => (
                                      <div
                                        className="rounded-md border border-slate-200 bg-white p-3 text-sm"
                                        key={account.id}
                                      >
                                        <p className="font-semibold">
                                          {account.retailer}
                                        </p>
                                        <p className="text-slate-600">
                                          {account.points_sold?.toLocaleString()} points
                                        </p>
                                        <p className="text-slate-500">
                                          {sale.sensitive_details_revoked
                                            ? "Sensitive details removed after void"
                                            : `${account.email || "No email"} · Alt ID ${
                                                account.alt_id || "-"
                                              }`}
                                        </p>
                                      </div>
                                    ))}
                                  </div>
                                </section>
                              ) : null}
                            </div>
                          </td>
                        </tr>
                      ) : null}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </section>
        ) : null}
      </div>

      {voidingSale ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center modal-backdrop p-4">
          <div className="w-full max-w-lg rounded-lg bg-white p-5 shadow-xl">
            <h2 className="text-lg font-semibold text-slate-950">
              Void sale #{voidingSale.id}?
            </h2>
            <p className="mt-2 text-sm text-slate-600">
              Assets will return to inventory and payment expectations will be
              removed. This is not deletion; the sale record remains for audit
              history.
            </p>
            <label className="mt-4 block space-y-2 text-sm font-medium text-slate-700">
              <span>Void notes</span>
              <textarea
                className="min-h-24 w-full rounded-md border border-slate-300 px-3 py-2"
                onChange={(event) => setVoidNotes(event.target.value)}
                value={voidNotes}
              />
            </label>
            <div className="mt-5 grid gap-2 sm:grid-cols-2">
              <button
                className="h-11 cursor-pointer rounded-md border border-slate-300 px-4 text-sm font-semibold text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60"
                disabled={isVoiding}
                onClick={() => {
                  setVoidingSale(null);
                  setVoidNotes("");
                }}
                type="button"
              >
                Cancel
              </button>
              <button
                className="h-11 cursor-pointer rounded-md bg-red-700 px-4 text-sm font-semibold text-white hover:bg-red-800 disabled:cursor-not-allowed disabled:opacity-60"
                disabled={isVoiding}
                onClick={() => void confirmVoidSale()}
                type="button"
              >
                {isVoiding ? "Voiding..." : "Confirm Void Sale"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {editingSale && editForm ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center modal-backdrop p-4">
          <div className="max-h-[92vh] w-full max-w-5xl overflow-y-auto rounded-lg bg-white p-5 shadow-xl">
            <div className="flex flex-col gap-2 border-b border-slate-200 pb-4 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <h2 className="text-lg font-semibold text-slate-950">
                  Edit sale #{editingSale.id}
                </h2>
                <p className="mt-1 text-sm text-slate-600">
                  Operational corrections are audited. Inventory acquisition,
                  purchase linkage, export timestamps, and void lineage remain
                  protected.
                </p>
              </div>
              <button
                className="h-9 cursor-pointer rounded-md border border-slate-300 px-3 text-sm font-semibold text-slate-700 hover:bg-slate-100"
                disabled={isSavingEdit}
                onClick={() => {
                  setEditingSale(null);
                  setEditForm(null);
                }}
                type="button"
              >
                Close
              </button>
            </div>

            {editingSale.events.some((event) => event.action === "exported") ? (
              <div className="mt-4 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                <p className="font-semibold">Previously Exported</p>
                <p>
                  Buyer may already possess the prior export package. Saving an
                  edit records this warning in audit history and does not
                  automatically regenerate exports.
                </p>
              </div>
            ) : null}

            <div className="mt-4 grid gap-4 lg:grid-cols-2">
              <EditSection title="Buyer & payout">
                <EditSelect
                  label="Buyer"
                  onChange={(value) => updateEditForm("buyer_id", value)}
                  value={editForm.buyer_id}
                >
                  {buyers.map((buyer) => (
                    <option key={buyer.id} value={buyer.id}>
                      {buyer.name}
                      {buyer.active ? "" : " (inactive)"}
                    </option>
                  ))}
                </EditSelect>
                <EditInput
                  label="Expected payout"
                  onChange={(value) => updateEditForm("expected_payout", value)}
                  type="number"
                  value={editForm.expected_payout}
                />
                <EditInput
                  label="Card payout rate (%)"
                  onChange={(value) => updateEditForm("card_payout_rate", value)}
                  type="number"
                  value={editForm.card_payout_rate}
                />
                <EditInput
                  label="Fuel rate per 1,000"
                  onChange={(value) => updateEditForm("fuel_rate_per_1000", value)}
                  type="number"
                  value={editForm.fuel_rate_per_1000}
                />
                <EditInput
                  label="Manual payout override"
                  onChange={(value) =>
                    updateEditForm("manual_payout_override_amount", value)
                  }
                  type="number"
                  value={editForm.manual_payout_override_amount}
                />
                <EditSelect
                  label="Payment destination account"
                  onChange={(value) => updateEditForm("payment_account_id", value)}
                  value={editForm.payment_account_id}
                >
                  <option value="">No payment account</option>
                  {paymentAccounts.map((account) => (
                    <option key={account.id} value={account.id}>
                      {paymentAccountLabel(account)}
                      {account.active ? "" : " (inactive)"}
                    </option>
                  ))}
                </EditSelect>
              </EditSection>

              <EditSection title="Timeline">
                <EditInput
                  label="Sold date"
                  onChange={(value) => updateEditForm("sold_date", value)}
                  type="date"
                  value={editForm.sold_date}
                />
                <EditInput
                  label="Expected payment date"
                  onChange={(value) =>
                    updateEditForm("expected_payment_date", value)
                  }
                  type="date"
                  value={editForm.expected_payment_date}
                />
                <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                  Changing sale date or payout totals requires a reason and
                  recalculates downstream expected values.
                </div>
              </EditSection>

              <EditSection title="Export settings">
                <EditInput
                  label="Export format/profile"
                  onChange={(value) => updateEditForm("export_profile", value)}
                  value={editForm.export_profile}
                />
                <EditInput
                  label="Buyer reference / seller ID"
                  onChange={(value) => updateEditForm("buyer_reference", value)}
                  value={editForm.buyer_reference}
                />
                <EditTextarea
                  label="Linked external transaction/reference IDs"
                  onChange={(value) =>
                    updateEditForm("linked_external_reference_ids", value)
                  }
                  value={editForm.linked_external_reference_ids}
                />
              </EditSection>

              <EditSection title="Notes & references">
                <EditTextarea
                  label="Sale notes"
                  onChange={(value) => updateEditForm("notes", value)}
                  value={editForm.notes}
                />
                <EditTextarea
                  label="Settlement status notes"
                  onChange={(value) =>
                    updateEditForm("settlement_status_notes", value)
                  }
                  value={editForm.settlement_status_notes}
                />
                <EditTextarea
                  label="Internal tags"
                  onChange={(value) => updateEditForm("internal_tags", value)}
                  value={editForm.internal_tags}
                />
              </EditSection>
            </div>

            <details className="mt-4 rounded-md border border-slate-200 bg-slate-50 p-3 text-sm">
              <summary className="cursor-pointer font-semibold">
                Asset adjustments (advanced)
              </summary>
              <p className="mt-2 text-slate-600">
                Adding or removing sale assets is protected in this workflow.
                Void and recreate the sale for major asset composition mistakes,
                or add a future audited asset adjustment endpoint when partial
                sale edits are needed.
              </p>
            </details>

            <label className="mt-4 block space-y-2 text-sm font-medium text-slate-700">
              <span>Reason / audit note</span>
              <textarea
                className="min-h-20 w-full rounded-md border border-slate-300 px-3 py-2"
                onChange={(event) => updateEditForm("reason", event.target.value)}
                placeholder="Required for payout, payout-rate, fuel-rate, or sale-date changes."
                value={editForm.reason}
              />
            </label>

            <div className="mt-5 grid gap-2 border-t border-slate-200 pt-4 sm:grid-cols-2">
              <button
                className="h-11 cursor-pointer rounded-md border border-slate-300 px-4 text-sm font-semibold text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60"
                disabled={isSavingEdit}
                onClick={() => {
                  setEditingSale(null);
                  setEditForm(null);
                }}
                type="button"
              >
                Cancel
              </button>
              <button
                className="h-11 cursor-pointer rounded-md bg-slate-950 px-4 text-sm font-semibold text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
                disabled={isSavingEdit}
                onClick={() => void saveSaleEdit()}
                type="button"
              >
                {isSavingEdit ? "Saving..." : "Save Sale Edits"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-slate-200 bg-white p-3">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
        {label}
      </p>
      <p className="mt-1 font-semibold">{value}</p>
    </div>
  );
}

function EditSection({
  children,
  title,
}: {
  children: ReactNode;
  title: string;
}) {
  return (
    <section className="rounded-md border border-slate-200 bg-slate-50 p-3">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
        {title}
      </h3>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">{children}</div>
    </section>
  );
}

function EditInput({
  label,
  onChange,
  type = "text",
  value,
}: {
  label: string;
  onChange: (value: string) => void;
  type?: string;
  value: string;
}) {
  return (
    <label className="space-y-1 text-sm font-medium text-slate-700">
      <span>{label}</span>
      <input
        className="h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-slate-950 outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-200"
        onChange={(event) => onChange(event.target.value)}
        step={type === "number" ? "0.01" : undefined}
        type={type}
        value={value}
      />
    </label>
  );
}

function EditSelect({
  children,
  label,
  onChange,
  value,
}: {
  children: ReactNode;
  label: string;
  onChange: (value: string) => void;
  value: string;
}) {
  return (
    <label className="space-y-1 text-sm font-medium text-slate-700">
      <span>{label}</span>
      <select
        className="h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-slate-950 outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-200"
        onChange={(event) => onChange(event.target.value)}
        value={value}
      >
        {children}
      </select>
    </label>
  );
}

function EditTextarea({
  label,
  onChange,
  value,
}: {
  label: string;
  onChange: (value: string) => void;
  value: string;
}) {
  return (
    <label className="space-y-1 text-sm font-medium text-slate-700 sm:col-span-2">
      <span>{label}</span>
      <textarea
        className="min-h-20 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-slate-950 outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-200"
        onChange={(event) => onChange(event.target.value)}
        value={value}
      />
    </label>
  );
}
