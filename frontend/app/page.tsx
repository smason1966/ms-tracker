"use client";

import { FormEvent, useEffect, useState } from "react";

import { API_BASE_URL } from "@/lib/api";

type PurchaseBatch = {
  id: number;
  store_name: string;
  purchase_date: string;
  total_amount: string | number;
  purchase_total_paid: string | number | null;
  sales_tax: string | number | null;
  activation_fees: string | number | null;
  discounts: string | number | null;
  fuel_points_quantity: number | null;
  fuel_points_unit: number | null;
  fuel_points_notes: string | null;
  financial_notes: string | null;
  notes: string | null;
  created_at?: string;
  updated_at?: string;
};

type PurchaseBatchForm = {
  store_name: string;
  purchase_date: string;
  total_amount: string;
  purchase_total_paid: string;
  sales_tax: string;
  activation_fees: string;
  discounts: string;
  fuel_points_amount: string;
  fuel_points_unit: string;
  financial_notes: string;
  notes: string;
};

type Store = {
  id: number;
  name: string;
  store_type: string | null;
  active: boolean;
};

const API_URL = `${API_BASE_URL}/purchase-batches/`;
const STORES_URL = `${API_BASE_URL}/stores/`;

function getTodayDateString() {
  const today = new Date();
  const year = today.getFullYear();
  const month = String(today.getMonth() + 1).padStart(2, "0");
  const day = String(today.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

function createEmptyForm(): PurchaseBatchForm {
  return {
    store_name: "",
    purchase_date: getTodayDateString(),
    total_amount: "",
    purchase_total_paid: "",
    sales_tax: "",
    activation_fees: "",
    discounts: "",
    fuel_points_amount: "",
    fuel_points_unit: "1000",
    financial_notes: "",
    notes: "",
  };
}

function calculateFuelPointsQuantity(amount: string, unit: string) {
  const parsedAmount = Number(amount);
  const parsedUnit = Number(unit);

  if (!amount || Number.isNaN(parsedAmount) || Number.isNaN(parsedUnit)) {
    return null;
  }

  return Math.max(0, Math.round(parsedAmount * parsedUnit));
}

export default function PurchaseBatchDashboard() {
  const [batches, setBatches] = useState<PurchaseBatch[]>([]);
  const [stores, setStores] = useState<Store[]>([]);
  const [form, setForm] = useState<PurchaseBatchForm>(() => createEmptyForm());
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingStores, setIsLoadingStores] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [storesError, setStoresError] = useState<string | null>(null);
  const fuelPointsQuantity = calculateFuelPointsQuantity(
    form.fuel_points_amount,
    form.fuel_points_unit,
  );

  async function loadBatches(options: { showLoading?: boolean } = {}) {
    if (options.showLoading ?? true) {
      setIsLoading(true);
    }

    setError(null);

    try {
      const response = await fetch(API_URL);

      if (!response.ok) {
        throw new Error(`Failed to load purchase batches (${response.status})`);
      }

      const data = (await response.json()) as PurchaseBatch[];
      setBatches(data);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Failed to load purchase batches.",
      );
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    let isMounted = true;

    async function loadStores() {
      setIsLoadingStores(true);
      setStoresError(null);

      try {
        const response = await fetch(STORES_URL);

        if (!response.ok) {
          throw new Error(`Failed to load stores (${response.status})`);
        }

        const data = (await response.json()) as Store[];

        if (isMounted) {
          setStores(data);
        }
      } catch (err) {
        if (isMounted) {
          setStoresError(
            err instanceof Error ? err.message : "Failed to load stores.",
          );
        }
      } finally {
        if (isMounted) {
          setIsLoadingStores(false);
        }
      }
    }

    async function loadInitialBatches() {
      try {
        const response = await fetch(API_URL);

        if (!response.ok) {
          throw new Error(`Failed to load purchase batches (${response.status})`);
        }

        const data = (await response.json()) as PurchaseBatch[];

        if (isMounted) {
          setBatches(data);
        }
      } catch (err) {
        if (isMounted) {
          setError(
            err instanceof Error
              ? err.message
              : "Failed to load purchase batches.",
          );
        }
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    }

    loadStores();
    loadInitialBatches();

    return () => {
      isMounted = false;
    };
  }, []);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);

    try {
      const response = await fetch(API_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          store_name: form.store_name.trim(),
          purchase_date: new Date(form.purchase_date).toISOString(),
          total_amount: form.total_amount,
          purchase_total_paid: form.purchase_total_paid || null,
          sales_tax: form.sales_tax || null,
          activation_fees: form.activation_fees || null,
          discounts: form.discounts || null,
          fuel_points_quantity: fuelPointsQuantity,
          fuel_points_unit: fuelPointsQuantity
            ? Number(form.fuel_points_unit)
            : null,
          financial_notes: form.financial_notes.trim() || null,
          notes: form.notes.trim() || null,
        }),
      });

      if (!response.ok) {
        throw new Error(`Failed to create purchase batch (${response.status})`);
      }

      setForm(createEmptyForm());
      await loadBatches({ showLoading: false });
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Failed to create purchase batch.",
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  function updateFormField(field: keyof PurchaseBatchForm, value: string) {
    setForm((currentForm) => ({
      ...currentForm,
      [field]: value,
    }));
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

  function formatAmount(value: string | number) {
    const amount = Number(value);

    if (Number.isNaN(amount)) {
      return String(value);
    }

    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
    }).format(amount);
  }

  function formatOptionalAmount(value: string | number | null) {
    if (value === null || value === "") {
      return "-";
    }

    return formatAmount(value);
  }

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-8 text-slate-950 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-6xl space-y-8">
        <header>
          <p className="text-sm font-medium text-slate-500">Dashboard</p>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight">
            Purchase Batches
          </h1>
        </header>

        <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-lg font-semibold">Create Purchase Batch</h2>

          <form
            className="mt-5 grid gap-5 md:grid-cols-2"
            onSubmit={handleSubmit}
          >
            <label className="space-y-2 text-sm font-medium text-slate-700">
              <span>Store</span>
              <select
                className="h-11 w-full rounded-md border border-slate-300 px-3 text-slate-950 outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-200"
                value={form.store_name}
                onChange={(event) =>
                  updateFormField("store_name", event.target.value)
                }
                disabled={isLoadingStores || Boolean(storesError)}
                required
              >
                <option value="">
                  {isLoadingStores
                    ? "Loading stores..."
                    : stores.length === 0
                      ? "No stores available"
                      : "Select a store"}
                </option>
                {stores.map((store) => (
                  <option key={store.id} value={store.name}>
                    {store.name}
                    {store.active ? "" : " (Inactive)"}
                  </option>
                ))}
              </select>
              {storesError ? (
                <p className="text-xs font-medium text-red-700">
                  {storesError}
                </p>
              ) : null}
            </label>

            <label className="space-y-2 text-sm font-medium text-slate-700">
              <span>Purchase Date</span>
              <input
                className="h-11 w-full rounded-md border border-slate-300 px-3 text-slate-950 outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-200"
                type="date"
                value={form.purchase_date}
                onChange={(event) =>
                  updateFormField("purchase_date", event.target.value)
                }
                required
              />
            </label>

            <label className="space-y-2 text-sm font-medium text-slate-700">
              <span>Face Value</span>
              <input
                className="h-11 w-full rounded-md border border-slate-300 px-3 text-slate-950 outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-200"
                type="number"
                min="0"
                step="0.01"
                value={form.total_amount}
                onChange={(event) =>
                  updateFormField("total_amount", event.target.value)
                }
                placeholder="125.50"
                required
              />
              <p className="text-xs text-slate-500">
                Total value of cards expected in the batch.
              </p>
            </label>

            <label className="space-y-2 text-sm font-medium text-slate-700">
              <span>Total Paid</span>
              <input
                className="h-11 w-full rounded-md border border-slate-300 px-3 text-slate-950 outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-200"
                type="number"
                min="0"
                step="0.01"
                value={form.purchase_total_paid}
                onChange={(event) =>
                  updateFormField("purchase_total_paid", event.target.value)
                }
                placeholder="Optional"
              />
              <p className="text-xs text-slate-500">
                Actual amount spent for the purchase.
              </p>
            </label>

            <label className="space-y-2 text-sm font-medium text-slate-700">
              <span>Sales Tax</span>
              <input
                className="h-11 w-full rounded-md border border-slate-300 px-3 text-slate-950 outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-200"
                type="number"
                min="0"
                step="0.01"
                value={form.sales_tax}
                onChange={(event) =>
                  updateFormField("sales_tax", event.target.value)
                }
                placeholder="Optional"
              />
            </label>

            <label className="space-y-2 text-sm font-medium text-slate-700">
              <span>Activation Fees</span>
              <input
                className="h-11 w-full rounded-md border border-slate-300 px-3 text-slate-950 outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-200"
                type="number"
                min="0"
                step="0.01"
                value={form.activation_fees}
                onChange={(event) =>
                  updateFormField("activation_fees", event.target.value)
                }
                placeholder="Optional"
              />
            </label>

            <label className="space-y-2 text-sm font-medium text-slate-700">
              <span>Discounts</span>
              <input
                className="h-11 w-full rounded-md border border-slate-300 px-3 text-slate-950 outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-200"
                type="number"
                min="0"
                step="0.01"
                value={form.discounts}
                onChange={(event) =>
                  updateFormField("discounts", event.target.value)
                }
                placeholder="Optional"
              />
            </label>

            <div className="space-y-2 text-sm font-medium text-slate-700">
              <span>Fuel Points</span>
              <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
                <input
                  className="h-11 w-full rounded-md border border-slate-300 px-3 text-slate-950 outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-200"
                  type="number"
                  min="0"
                  step="1"
                  value={form.fuel_points_amount}
                  onChange={(event) =>
                    updateFormField("fuel_points_amount", event.target.value)
                  }
                  placeholder="Amount"
                />
                <select
                  className="h-11 rounded-md border border-slate-300 px-3 text-slate-950 outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-200"
                  value={form.fuel_points_unit}
                  onChange={(event) =>
                    updateFormField("fuel_points_unit", event.target.value)
                  }
                >
                  <option value="100">100</option>
                  <option value="1000">1,000</option>
                </select>
              </div>
              <p className="text-xs text-slate-500">
                Total:{" "}
                {fuelPointsQuantity
                  ? `${fuelPointsQuantity.toLocaleString()} points`
                  : ""}
              </p>
            </div>

            <label className="space-y-2 text-sm font-medium text-slate-700 md:row-span-2">
              <span>Notes</span>
              <textarea
                className="min-h-28 w-full rounded-md border border-slate-300 px-3 py-2 text-slate-950 outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-200"
                value={form.notes}
                onChange={(event) =>
                  updateFormField("notes", event.target.value)
                }
                placeholder="Optional notes"
              />
            </label>

            <label className="space-y-2 text-sm font-medium text-slate-700 md:row-span-2">
              <span>Financial Notes</span>
              <textarea
                className="min-h-28 w-full rounded-md border border-slate-300 px-3 py-2 text-slate-950 outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-200"
                value={form.financial_notes}
                onChange={(event) =>
                  updateFormField("financial_notes", event.target.value)
                }
                placeholder="Optional financial notes"
              />
            </label>

            <div className="flex items-end">
              <button
                className="h-11 rounded-md bg-slate-900 px-5 text-sm font-semibold text-white transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:bg-slate-400"
                type="submit"
                disabled={
                  isSubmitting ||
                  isLoadingStores ||
                  Boolean(storesError) ||
                  stores.length === 0
                }
              >
                {isSubmitting ? "Creating..." : "Create Batch"}
              </button>
            </div>
          </form>
        </section>

        {error ? (
          <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-800">
            {error}
          </div>
        ) : null}

        <section className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
          <div className="flex flex-col gap-3 border-b border-slate-200 px-6 py-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-lg font-semibold">Existing Batches</h2>
              <p className="mt-1 text-sm text-slate-500">
                {batches.length} {batches.length === 1 ? "batch" : "batches"}
              </p>
            </div>

            <button
              className="h-10 rounded-md border border-slate-300 px-4 text-sm font-medium text-slate-700 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:text-slate-400"
              type="button"
              onClick={() => loadBatches()}
              disabled={isLoading}
            >
              {isLoading ? "Loading..." : "Refresh"}
            </button>
          </div>

          {isLoading ? (
            <div className="px-6 py-12 text-center text-sm text-slate-500">
              Loading purchase batches...
            </div>
          ) : batches.length === 0 ? (
            <div className="px-6 py-12 text-center text-sm text-slate-500">
              No purchase batches found.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-slate-200 text-sm">
                <thead className="bg-slate-100 text-left text-xs font-semibold uppercase tracking-wide text-slate-600">
                  <tr>
                    <th className="px-6 py-3">Store</th>
                    <th className="px-6 py-3">Purchase Date</th>
                    <th className="px-6 py-3">Face Value</th>
                    <th className="px-6 py-3">Paid</th>
                    <th className="px-6 py-3">Notes</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 bg-white">
                  {batches.map((batch) => (
                    <tr key={batch.id} className="hover:bg-slate-50">
                      <td className="whitespace-nowrap px-6 py-4 font-medium">
                        {batch.store_name}
                      </td>
                      <td className="whitespace-nowrap px-6 py-4 text-slate-700">
                        {formatDate(batch.purchase_date)}
                      </td>
                      <td className="whitespace-nowrap px-6 py-4 text-slate-700">
                        {formatAmount(batch.total_amount)}
                      </td>
                      <td className="whitespace-nowrap px-6 py-4 text-slate-700">
                        {formatOptionalAmount(batch.purchase_total_paid)}
                      </td>
                      <td className="max-w-md px-6 py-4 text-slate-700">
                        {batch.notes || "-"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
