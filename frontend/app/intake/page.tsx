"use client";

import { ChangeEvent, FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { API_BASE_URL } from "@/lib/api";

type Store = {
  id: number;
  name: string;
  store_type: string | null;
  active: boolean;
};

type PurchaseBatch = {
  id: number;
  store_name: string;
  purchase_date: string;
  total_amount: string | number;
  purchase_total_paid: string | number | null;
  fuel_points_quantity: number | null;
  fuel_points_unit: number | null;
  fuel_points_notes: string | null;
  financial_notes: string | null;
  notes: string | null;
};

type IntakeForm = {
  store_name: string;
  purchase_date: string;
  total_amount: string;
  purchase_total_paid: string;
  fuel_points_amount: string;
  fuel_points_unit: string;
  financial_notes: string;
  notes: string;
};

function getTodayDateString() {
  const today = new Date();
  const year = today.getFullYear();
  const month = String(today.getMonth() + 1).padStart(2, "0");
  const day = String(today.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

function createInitialForm(): IntakeForm {
  return {
    store_name: "",
    purchase_date: getTodayDateString(),
    total_amount: "",
    purchase_total_paid: "",
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

export default function PurchaseIntakePage() {
  const router = useRouter();
  const [stores, setStores] = useState<Store[]>([]);
  const [form, setForm] = useState<IntakeForm>(() => createInitialForm());
  const [receiptFile, setReceiptFile] = useState<File | null>(null);
  const [isLoadingStores, setIsLoadingStores] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [storesError, setStoresError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const fuelPointsQuantity = calculateFuelPointsQuantity(
    form.fuel_points_amount,
    form.fuel_points_unit,
  );

  useEffect(() => {
    let isMounted = true;

    async function loadStores() {
      setIsLoadingStores(true);
      setStoresError(null);

      try {
        const response = await fetch(`${API_BASE_URL}/stores/`);

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

    loadStores();

    return () => {
      isMounted = false;
    };
  }, []);

  function updateFormField(field: keyof IntakeForm, value: string) {
    setForm((currentForm) => ({
      ...currentForm,
      [field]: value,
    }));
  }

  function handleReceiptChange(event: ChangeEvent<HTMLInputElement>) {
    setReceiptFile(event.target.files?.[0] ?? null);
  }

  async function uploadReceipt(purchaseId: number) {
    if (!receiptFile) {
      return;
    }

    const receiptFormData = new FormData();
    receiptFormData.append("purchase_batch_id", String(purchaseId));
    receiptFormData.append("file", receiptFile);

    const response = await fetch(`${API_BASE_URL}/receipts/upload`, {
      method: "POST",
      body: receiptFormData,
    });

    if (!response.ok) {
      throw new Error(
        `Purchase created, but receipt upload failed (${response.status})`,
      );
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitError(null);
    setIsSubmitting(true);

    try {
      const response = await fetch(`${API_BASE_URL}/purchase-batches/`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          store_name: form.store_name.trim(),
          purchase_date: new Date(form.purchase_date).toISOString(),
          total_amount: form.total_amount || "0",
          purchase_total_paid: form.purchase_total_paid || null,
          fuel_points_quantity: fuelPointsQuantity,
          fuel_points_unit: fuelPointsQuantity
            ? Number(form.fuel_points_unit)
            : null,
          financial_notes: form.financial_notes.trim() || null,
          notes: form.notes.trim() || null,
        }),
      });

      if (!response.ok) {
        throw new Error(`Failed to create purchase (${response.status})`);
      }

      const purchase = (await response.json()) as PurchaseBatch;
      await uploadReceipt(purchase.id);

      router.push(`/intake/${purchase.id}`);
    } catch (err) {
      setSubmitError(
        err instanceof Error ? err.message : "Failed to create purchase.",
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  const isSubmitDisabled =
    isSubmitting ||
    isLoadingStores ||
    Boolean(storesError) ||
    stores.length === 0;

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-6 text-slate-950">
      <div className="mx-auto flex min-h-[calc(100vh-3rem)] max-w-md flex-col">
        <header className="pb-5">
          <p className="text-sm font-medium text-slate-500">Purchase Intake</p>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight">
            New Purchase
          </h1>
        </header>

        <form className="flex flex-1 flex-col" onSubmit={handleSubmit}>
          <section className="space-y-5 rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
            <label className="block space-y-2 text-sm font-medium text-slate-700">
              <span>Store</span>
              <select
                className="h-12 w-full rounded-md border border-slate-300 px-3 text-base text-slate-950 outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-200"
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
                <p className="text-sm font-medium text-red-700">
                  {storesError}
                </p>
              ) : null}
            </label>

            <label className="block space-y-2 text-sm font-medium text-slate-700">
              <span>Purchase Date</span>
              <input
                className="h-12 w-full rounded-md border border-slate-300 px-3 text-base text-slate-950 outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-200"
                type="date"
                value={form.purchase_date}
                onChange={(event) =>
                  updateFormField("purchase_date", event.target.value)
                }
                required
              />
            </label>

            <label className="block space-y-2 text-sm font-medium text-slate-700">
              <span>Face Value</span>
              <input
                className="h-12 w-full rounded-md border border-slate-300 px-3 text-base text-slate-950 outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-200"
                type="number"
                min="0"
                step="0.01"
                value={form.total_amount}
                onChange={(event) =>
                  updateFormField("total_amount", event.target.value)
                }
                placeholder="Optional"
              />
              <p className="text-sm text-slate-500">
                Total value of cards expected in the batch.
              </p>
            </label>

            <label className="block space-y-2 text-sm font-medium text-slate-700">
              <span>Total Paid</span>
              <input
                className="h-12 w-full rounded-md border border-slate-300 px-3 text-base text-slate-950 outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-200"
                type="number"
                min="0"
                step="0.01"
                value={form.purchase_total_paid}
                onChange={(event) =>
                  updateFormField("purchase_total_paid", event.target.value)
                }
                placeholder="Optional"
              />
              <p className="text-sm text-slate-500">
                Actual amount spent for the purchase.
              </p>
            </label>

            <div className="block space-y-2 text-sm font-medium text-slate-700">
              <span>Fuel Points</span>
              <div className="grid grid-cols-[1fr_auto] gap-3">
                <input
                  className="h-12 w-full rounded-md border border-slate-300 px-3 text-base text-slate-950 outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-200"
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
                  className="h-12 rounded-md border border-slate-300 px-3 text-base text-slate-950 outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-200"
                  value={form.fuel_points_unit}
                  onChange={(event) =>
                    updateFormField("fuel_points_unit", event.target.value)
                  }
                >
                  <option value="100">100</option>
                  <option value="1000">1,000</option>
                </select>
              </div>
              <p className="text-sm text-slate-500">
                Total:{" "}
                {fuelPointsQuantity
                  ? `${fuelPointsQuantity.toLocaleString()} points`
                  : ""}
              </p>
            </div>

            <label className="block space-y-2 text-sm font-medium text-slate-700">
              <span>Financial Notes</span>
              <textarea
                className="min-h-24 w-full rounded-md border border-slate-300 px-3 py-3 text-base text-slate-950 outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-200"
                value={form.financial_notes}
                onChange={(event) =>
                  updateFormField("financial_notes", event.target.value)
                }
                placeholder="Optional"
              />
            </label>

            <label className="block space-y-2 text-sm font-medium text-slate-700">
              <span>Notes</span>
              <textarea
                className="min-h-28 w-full rounded-md border border-slate-300 px-3 py-3 text-base text-slate-950 outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-200"
                value={form.notes}
                onChange={(event) =>
                  updateFormField("notes", event.target.value)
                }
                placeholder="Optional"
              />
            </label>

            <label className="block space-y-2 text-sm font-medium text-slate-700">
              <span>Receipt Image</span>
              <input
                className="block w-full cursor-pointer rounded-md border border-slate-300 bg-white text-sm text-slate-700 file:mr-4 file:h-12 file:cursor-pointer file:border-0 file:bg-slate-900 file:px-4 file:text-sm file:font-semibold file:text-white file:transition file:hover:bg-slate-700"
                type="file"
                accept="image/*"
                onChange={handleReceiptChange}
              />
              {receiptFile ? (
                <p className="text-sm text-slate-500">{receiptFile.name}</p>
              ) : null}
            </label>
          </section>

          {submitError ? (
            <div className="mt-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-800">
              {submitError}
            </div>
          ) : null}

          <div className="sticky bottom-0 mt-auto bg-slate-50 py-4">
            <button
              className="h-12 w-full rounded-md bg-slate-900 px-5 text-base font-semibold text-white shadow-sm transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:bg-slate-400"
              type="submit"
              disabled={isSubmitDisabled}
            >
              {isSubmitting ? "Saving..." : "Continue to Card Intake"}
            </button>
          </div>
        </form>
      </div>
    </main>
  );
}
