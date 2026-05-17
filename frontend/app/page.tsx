"use client";

import { FormEvent, useEffect, useState } from "react";

type PurchaseBatch = {
  id: number;
  store_name: string;
  purchase_date: string;
  total_amount: string | number;
  notes: string | null;
  created_at?: string;
  updated_at?: string;
};

type PurchaseBatchForm = {
  store_name: string;
  purchase_date: string;
  total_amount: string;
  notes: string;
};

const API_URL = "http://localhost:8000/purchase-batches/";

const emptyForm: PurchaseBatchForm = {
  store_name: "",
  purchase_date: "",
  total_amount: "",
  notes: "",
};

export default function PurchaseBatchDashboard() {
  const [batches, setBatches] = useState<PurchaseBatch[]>([]);
  const [form, setForm] = useState<PurchaseBatchForm>(emptyForm);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
          notes: form.notes.trim() || null,
        }),
      });

      if (!response.ok) {
        throw new Error(`Failed to create purchase batch (${response.status})`);
      }

      setForm(emptyForm);
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
              <span>Store Name</span>
              <input
                className="h-11 w-full rounded-md border border-slate-300 px-3 text-slate-950 outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-200"
                type="text"
                value={form.store_name}
                onChange={(event) =>
                  updateFormField("store_name", event.target.value)
                }
                placeholder="Costco"
                required
              />
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
              <span>Total Amount</span>
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
            </label>

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

            <div className="flex items-end">
              <button
                className="h-11 rounded-md bg-slate-900 px-5 text-sm font-semibold text-white transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:bg-slate-400"
                type="submit"
                disabled={isSubmitting}
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
                    <th className="px-6 py-3">Total Amount</th>
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
