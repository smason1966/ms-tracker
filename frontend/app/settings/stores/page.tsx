"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";

import { API_BASE_URL } from "@/lib/api";

type SpendingCategory = {
  id: number;
  key: string;
  name: string;
};

type RewardProgram = {
  id: number;
  name: string;
  short_code: string;
  category: string;
  active: boolean;
};

type Store = {
  id: number;
  name: string;
  store_type: string | null;
  retailer_group: string | null;
  merchant_category: string | null;
  spending_category_id: number | null;
  spending_category: SpendingCategory | null;
  reward_program_id: number | null;
  reward_program: RewardProgram | null;
  active: boolean;
  earns_fuel_points: boolean;
  default_fuel_multiplier: number | null;
  notes: string | null;
};

type StoreForm = {
  name: string;
  store_type: string;
  retailer_group: string;
  spending_category_id: string;
  reward_program_id: string;
  earns_fuel_points: boolean;
  default_fuel_multiplier: string;
  notes: string;
  active: boolean;
};

const emptyForm: StoreForm = {
  name: "",
  store_type: "",
  retailer_group: "",
  spending_category_id: "",
  reward_program_id: "",
  earns_fuel_points: false,
  default_fuel_multiplier: "",
  notes: "",
  active: true,
};

function storeToForm(store: Store): StoreForm {
  return {
    name: store.name,
    store_type: store.store_type ?? "",
    retailer_group: store.retailer_group ?? "",
    spending_category_id:
      store.spending_category_id === null ? "" : String(store.spending_category_id),
    reward_program_id:
      store.reward_program_id === null ? "" : String(store.reward_program_id),
    earns_fuel_points: store.earns_fuel_points,
    default_fuel_multiplier:
      store.default_fuel_multiplier === null
        ? ""
        : String(store.default_fuel_multiplier),
    notes: store.notes ?? "",
    active: store.active,
  };
}

export default function StoresSettingsPage() {
  const [stores, setStores] = useState<Store[]>([]);
  const [categories, setCategories] = useState<SpendingCategory[]>([]);
  const [rewardPrograms, setRewardPrograms] = useState<RewardProgram[]>([]);
  const [form, setForm] = useState<StoreForm>(emptyForm);
  const [editingStore, setEditingStore] = useState<Store | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function loadData() {
    setIsLoading(true);
    setError(null);

    try {
      const [storesResponse, categoriesResponse, rewardProgramsResponse] = await Promise.all([
        fetch(`${API_BASE_URL}/stores/`),
        fetch(`${API_BASE_URL}/spending-categories/`),
        fetch(`${API_BASE_URL}/reward-programs/?active_only=true`),
      ]);

      if (!storesResponse.ok) {
        throw new Error(`Failed to load stores (${storesResponse.status})`);
      }

      if (!categoriesResponse.ok) {
        throw new Error(
          `Failed to load spending categories (${categoriesResponse.status})`,
        );
      }

      if (!rewardProgramsResponse.ok) {
        throw new Error(
          `Failed to load reward programs (${rewardProgramsResponse.status})`,
        );
      }

      setStores((await storesResponse.json()) as Store[]);
      setCategories((await categoriesResponse.json()) as SpendingCategory[]);
      setRewardPrograms((await rewardProgramsResponse.json()) as RewardProgram[]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load stores.");
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      void loadData();
    }, 0);

    return () => window.clearTimeout(timeoutId);
  }, []);

  function openCreate() {
    setEditingStore(null);
    setForm(emptyForm);
    setIsModalOpen(true);
  }

  function openEdit(store: Store) {
    setEditingStore(store);
    setForm(storeToForm(store));
    setIsModalOpen(true);
  }

  function updateFormField(field: keyof StoreForm, value: string) {
    setForm((currentForm) => ({
      ...currentForm,
      [field]: value,
    }));
  }

  async function saveStore(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSaving(true);
    setError(null);

    try {
      const response = await fetch(
        editingStore
          ? `${API_BASE_URL}/stores/${editingStore.id}`
          : `${API_BASE_URL}/stores/`,
        {
          method: editingStore ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: form.name.trim(),
            store_type: form.store_type.trim() || null,
            retailer_group: form.retailer_group.trim() || null,
            spending_category_id: form.spending_category_id
              ? Number(form.spending_category_id)
              : null,
            reward_program_id: form.reward_program_id
              ? Number(form.reward_program_id)
              : null,
            merchant_category:
              categories.find(
                (category) => String(category.id) === form.spending_category_id,
              )?.key ?? null,
            earns_fuel_points: form.earns_fuel_points,
            default_fuel_multiplier: form.default_fuel_multiplier
              ? Number(form.default_fuel_multiplier)
              : null,
            notes: form.notes.trim() || null,
            active: form.active,
          }),
        },
      );

      if (!response.ok) {
        throw new Error(`Failed to save store (${response.status})`);
      }

      setIsModalOpen(false);
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save store.");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-6 text-slate-950 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-7xl space-y-5">
        <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <Link
              className="mb-3 inline-flex h-8 cursor-pointer items-center rounded-md border border-slate-300 px-3 text-xs font-semibold text-slate-700 transition hover:bg-slate-100 active:bg-slate-200"
              href="/settings"
            >
              Back to Settings
            </Link>
            <p className="text-sm font-medium uppercase tracking-wide text-slate-500">
              Settings / Stores
            </p>
            <h1 className="mt-1 text-3xl font-semibold tracking-tight">
              Stores
            </h1>
            <p className="mt-2 max-w-2xl text-sm text-slate-600">
              Manage merchant setup, fuel point eligibility, and spending
              category mapping used by purchase intake.
            </p>
          </div>
          <button
            className="h-10 cursor-pointer rounded-md bg-slate-950 px-4 text-sm font-semibold text-white transition hover:bg-slate-800 active:bg-slate-900"
            onClick={openCreate}
            type="button"
          >
            Add Store
          </button>
        </header>

        {error ? (
          <p className="rounded-md border border-red-200 bg-red-50 p-3 text-sm font-medium text-red-700">
            {error}
          </p>
        ) : null}

        {isLoading ? (
          <section className="rounded-lg border border-slate-200 bg-white p-8 text-center text-sm text-slate-500">
            Loading stores...
          </section>
        ) : null}

        {!isLoading ? (
          <section className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
            <table className="min-w-full divide-y divide-slate-200 text-sm">
              <thead className="bg-slate-100 text-left text-xs font-semibold uppercase tracking-wide text-slate-600">
                <tr>
                  <th className="px-4 py-3">Store</th>
                  <th className="px-4 py-3">Group</th>
                  <th className="px-4 py-3">Category</th>
                  <th className="px-4 py-3">Fuel</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {stores.map((store) => (
                  <tr key={store.id}>
                    <td className="px-4 py-3">
                      <p className="font-semibold">{store.name}</p>
                      {store.notes ? (
                        <p className="mt-1 text-xs text-slate-500">{store.notes}</p>
                      ) : null}
                    </td>
                    <td className="px-4 py-3 text-slate-600">
                      {store.retailer_group || "-"}
                    </td>
                    <td className="px-4 py-3">
                      {store.spending_category?.name ??
                        store.merchant_category ??
                        "-"}
                    </td>
                    <td className="px-4 py-3">
                      {store.earns_fuel_points ? (
                        <>
                          <p>{store.default_fuel_multiplier ?? 4}x</p>
                          <p className="text-xs text-slate-500">
                            {store.reward_program
                              ? `${store.reward_program.short_code} · ${store.reward_program.name}`
                              : "No program"}
                          </p>
                        </>
                      ) : (
                        "No"
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {store.active ? "Active" : "Inactive"}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        className="h-8 cursor-pointer rounded-md border border-slate-300 px-3 text-xs font-semibold hover:bg-slate-100 active:bg-slate-200"
                        onClick={() => openEdit(store)}
                        type="button"
                      >
                        Edit
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        ) : null}
      </div>

      {isModalOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center modal-backdrop p-4">
          <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-lg bg-white p-5 shadow-xl">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-xl font-semibold">
                {editingStore ? "Edit Store" : "Add Store"}
              </h2>
              <button
                className="h-9 cursor-pointer rounded-md border border-slate-300 px-3 text-sm font-semibold hover:bg-slate-100"
                onClick={() => setIsModalOpen(false)}
                type="button"
              >
                Close
              </button>
            </div>
            <form className="mt-5 grid gap-4 sm:grid-cols-2" onSubmit={saveStore}>
              <label className="space-y-2 text-sm font-medium text-slate-700">
                <span>Store Name</span>
                <input
                  className="h-11 w-full rounded-md border border-slate-300 px-3"
                  onChange={(event) => updateFormField("name", event.target.value)}
                  required
                  value={form.name}
                />
              </label>
              <label className="space-y-2 text-sm font-medium text-slate-700">
                <span>Retailer Group</span>
                <input
                  className="h-11 w-full rounded-md border border-slate-300 px-3"
                  onChange={(event) =>
                    updateFormField("retailer_group", event.target.value)
                  }
                  placeholder="Kroger, Blackhawk, etc."
                  value={form.retailer_group}
                />
              </label>
              <label className="space-y-2 text-sm font-medium text-slate-700">
                <span>Store Type</span>
                <input
                  className="h-11 w-full rounded-md border border-slate-300 px-3"
                  onChange={(event) =>
                    updateFormField("store_type", event.target.value)
                  }
                  value={form.store_type}
                />
              </label>
              <label className="space-y-2 text-sm font-medium text-slate-700">
                <span>Spending Category</span>
                <select
                  className="h-11 w-full rounded-md border border-slate-300 px-3"
                  onChange={(event) =>
                    updateFormField("spending_category_id", event.target.value)
                  }
                  value={form.spending_category_id}
                >
                  <option value="">No category</option>
                  {categories.map((category) => (
                    <option key={category.id} value={category.id}>
                      {category.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex h-11 items-center gap-2 text-sm font-medium text-slate-700">
                <input
                  checked={form.earns_fuel_points}
                  className="h-4 w-4"
                  onChange={(event) =>
                    setForm((currentForm) => ({
                      ...currentForm,
                      earns_fuel_points: event.target.checked,
                      default_fuel_multiplier: event.target.checked
                        ? currentForm.default_fuel_multiplier || "4"
                        : "",
                      reward_program_id: event.target.checked
                        ? currentForm.reward_program_id ||
                          String(
                            rewardPrograms.find(
                              (program) => program.short_code === "KROGER_FUEL",
                            )?.id ?? "",
                          )
                        : "",
                    }))
                  }
                  type="checkbox"
                />
                <span>Earns Fuel Points</span>
              </label>
              <label className="space-y-2 text-sm font-medium text-slate-700">
                <span>Default Fuel Multiplier</span>
                <input
                  className="h-11 w-full rounded-md border border-slate-300 px-3"
                  disabled={!form.earns_fuel_points}
                  min="1"
                  onChange={(event) =>
                    updateFormField("default_fuel_multiplier", event.target.value)
                  }
                  type="number"
                  value={form.default_fuel_multiplier}
                />
              </label>
              <label className="space-y-2 text-sm font-medium text-slate-700">
                <span>Fuel Reward Program</span>
                <select
                  className="h-11 w-full rounded-md border border-slate-300 px-3"
                  disabled={!form.earns_fuel_points}
                  onChange={(event) =>
                    updateFormField("reward_program_id", event.target.value)
                  }
                  value={form.reward_program_id}
                >
                  <option value="">No program</option>
                  {rewardPrograms
                    .filter((program) => program.category === "Fuel Rewards")
                    .map((program) => (
                      <option key={program.id} value={program.id}>
                        {program.short_code} · {program.name}
                      </option>
                    ))}
                </select>
              </label>
              <label className="flex h-11 items-center gap-2 text-sm font-medium text-slate-700">
                <input
                  checked={form.active}
                  className="h-4 w-4"
                  onChange={(event) =>
                    setForm((currentForm) => ({
                      ...currentForm,
                      active: event.target.checked,
                    }))
                  }
                  type="checkbox"
                />
                <span>Active</span>
              </label>
              <label className="space-y-2 text-sm font-medium text-slate-700 sm:col-span-2">
                <span>Notes</span>
                <textarea
                  className="min-h-24 w-full rounded-md border border-slate-300 px-3 py-2"
                  onChange={(event) => updateFormField("notes", event.target.value)}
                  value={form.notes}
                />
              </label>
              <div className="flex justify-end gap-2 sm:col-span-2">
                <button
                  className="h-10 cursor-pointer rounded-md border border-slate-300 px-4 text-sm font-semibold hover:bg-slate-100"
                  onClick={() => setIsModalOpen(false)}
                  type="button"
                >
                  Cancel
                </button>
                <button
                  className="h-10 cursor-pointer rounded-md bg-slate-950 px-4 text-sm font-semibold text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
                  disabled={isSaving}
                  type="submit"
                >
                  {isSaving ? "Saving..." : "Save Store"}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </main>
  );
}
