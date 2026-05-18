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
  notes: string | null;
};

type IntakeForm = {
  store_name: string;
  purchase_date: string;
  total_amount: string;
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
    notes: "",
  };
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
              <span>Total Amount</span>
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
                className="block w-full rounded-md border border-slate-300 bg-white text-sm text-slate-700 file:mr-4 file:h-12 file:border-0 file:bg-slate-900 file:px-4 file:text-sm file:font-semibold file:text-white"
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
