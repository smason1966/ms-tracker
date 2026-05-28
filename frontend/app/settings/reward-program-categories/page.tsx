"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";

import { API_BASE_URL } from "@/lib/api";

type RewardProgramCategory = {
  name: string;
  active: boolean;
  notes: string;
};

type CategoryForm = {
  name: string;
  active: boolean;
  notes: string;
};

const emptyForm: CategoryForm = {
  name: "",
  active: true,
  notes: "",
};

function categoryPath(name: string) {
  return encodeURIComponent(name);
}

export default function RewardProgramCategoriesPage() {
  const [categories, setCategories] = useState<RewardProgramCategory[]>([]);
  const [form, setForm] = useState<CategoryForm>(emptyForm);
  const [editingCategory, setEditingCategory] =
    useState<RewardProgramCategory | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [modalMessage, setModalMessage] = useState<string | null>(null);

  async function loadCategories() {
    setIsLoading(true);
    setError(null);

    try {
      const endpoint = `${API_BASE_URL}/reward-program-categories/`;
      const response = await fetch(endpoint);

      if (!response.ok) {
        const body = await response.text();
        throw new Error(
          `Failed to load reward program categories from ${endpoint} (${response.status}): ${
            body || response.statusText
          }`,
        );
      }

      setCategories((await response.json()) as RewardProgramCategory[]);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Failed to load reward program categories.",
      );
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    queueMicrotask(() => {
      void loadCategories();
    });
  }, []);

  function openCreate() {
    setEditingCategory(null);
    setForm(emptyForm);
    setError(null);
    setMessage(null);
    setModalMessage(null);
    setIsModalOpen(true);
  }

  function startEdit(category: RewardProgramCategory) {
    setEditingCategory(category);
    setForm({
      name: category.name,
      active: category.active,
      notes: category.notes || "",
    });
    setError(null);
    setMessage(null);
    setModalMessage(null);
    setIsModalOpen(true);
  }

  function resetForm() {
    setEditingCategory(null);
    setForm(emptyForm);
    setIsModalOpen(false);
    setModalMessage(null);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSaving(true);
    setError(null);
    setMessage(null);

    const payload = {
      name: form.name.trim(),
      active: form.active,
      notes: form.notes.trim() || null,
    };

    try {
      const response = await fetch(
        editingCategory
          ? `${API_BASE_URL}/reward-program-categories/${categoryPath(
              editingCategory.name,
            )}`
          : `${API_BASE_URL}/reward-program-categories/`,
        {
          method: editingCategory ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        },
      );

      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(
          body?.detail ||
            `Failed to save reward program category (${response.status})`,
        );
      }

      setMessage(
        editingCategory ? "Reward category updated." : "Reward category added.",
      );
      resetForm();
      await loadCategories();
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Failed to save reward program category.",
      );
    } finally {
      setIsSaving(false);
    }
  }

  async function deleteOrDeactivateCategory(category: RewardProgramCategory) {
    if (
      !window.confirm(
        `Delete ${category.name}? If this category is a default or in use, it will be deactivated instead.`,
      )
    ) {
      return;
    }

    setIsSaving(true);
    setError(null);
    setMessage(null);
    setModalMessage(null);

    try {
      const endpoint = `${API_BASE_URL}/reward-program-categories/${categoryPath(
        category.name,
      )}`;
      const response = await fetch(endpoint, { method: "DELETE" });
      const body = await response.json().catch(() => null);

      if (!response.ok) {
        throw new Error(
          body?.detail?.message ||
            body?.detail ||
            `Failed to delete or deactivate reward category (${response.status})`,
        );
      }

      setMessage(body?.message ?? "Reward category updated.");
      resetForm();
      await loadCategories();
    } catch (err) {
      setModalMessage(
        err instanceof Error
          ? err.message
          : "Failed to delete or deactivate reward category.",
      );
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-6 text-slate-950 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-5xl space-y-5">
        <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <Link
              className="inline-flex h-9 cursor-pointer items-center rounded-md border border-slate-300 px-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-100"
              href="/settings"
            >
              Back to Settings
            </Link>
            <p className="mt-4 text-sm font-medium text-slate-500">
              Settings / Reward Program Categories
            </p>
            <h1 className="mt-1 text-3xl font-semibold tracking-tight">
              Reward Program Categories
            </h1>
          </div>
          <button
            className="h-10 rounded-md bg-slate-950 px-4 text-sm font-semibold text-white hover:bg-slate-800"
            onClick={openCreate}
            type="button"
          >
            Add Category
          </button>
        </header>

        {error ? (
          <p className="rounded-md border border-red-200 bg-red-50 p-3 text-sm font-medium text-red-700">
            {error}
          </p>
        ) : null}
        {message ? (
          <p className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm font-medium text-emerald-800">
            {message}
          </p>
        ) : null}

        <section className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-200 px-5 py-4">
              <h2 className="text-lg font-semibold">Categories</h2>
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-slate-200 text-sm">
                <thead className="bg-slate-100 text-left text-xs font-semibold uppercase tracking-wide text-slate-600">
                  <tr>
                    <th className="px-4 py-3">Name</th>
                    <th className="px-4 py-3">Active</th>
                    <th className="px-4 py-3">Notes</th>
                    <th className="px-4 py-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {isLoading ? (
                    <tr>
                      <td className="px-4 py-6 text-slate-500" colSpan={4}>
                        Loading...
                      </td>
                    </tr>
                  ) : (
                    categories.map((category) => (
                      <tr key={category.name}>
                        <td className="px-4 py-3 font-medium">{category.name}</td>
                        <td className="px-4 py-3">
                          {category.active ? "Active" : "Inactive"}
                        </td>
                        <td className="px-4 py-3 text-slate-600">
                          {category.notes || "-"}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <button
                            className="h-9 rounded-md border border-slate-300 px-3 text-xs font-semibold"
                            onClick={() => startEdit(category)}
                            type="button"
                          >
                            Edit
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </section>
        {isModalOpen ? (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4">
            <form
              className="max-h-[90vh] w-full max-w-lg space-y-4 overflow-y-auto rounded-lg bg-white p-5 shadow-xl"
              id="reward-category-settings-form"
              onSubmit={handleSubmit}
            >
              <div className="flex items-start justify-between gap-4 border-b border-slate-200 pb-4">
                <div>
                  <h2 className="text-lg font-semibold">
                    {editingCategory ? "Edit Category" : "Add Category"}
                  </h2>
                  <p className="mt-1 text-xs text-slate-500">
                    Configure categories used to group reward programs.
                  </p>
                </div>
                <div className="flex shrink-0 gap-2">
                  <button
                    className="h-9 cursor-pointer rounded-md border border-slate-300 px-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-100 disabled:opacity-60"
                    disabled={isSaving}
                    onClick={resetForm}
                    type="button"
                  >
                    Cancel
                  </button>
                  <button
                    className="h-9 cursor-pointer rounded-md bg-slate-950 px-3 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:opacity-60"
                    disabled={isSaving}
                    form="reward-category-settings-form"
                    type="submit"
                  >
                    {isSaving ? "Saving..." : "Save"}
                  </button>
                </div>
              </div>
              <label className="block space-y-2 text-sm font-medium text-slate-700">
                <span>Name</span>
                <input
                  className="h-11 w-full rounded-md border border-slate-300 px-3"
                  onChange={(event) => setForm({ ...form, name: event.target.value })}
                  required
                  value={form.name}
                />
              </label>
              <label className="flex h-10 items-center gap-2 text-sm font-medium text-slate-700">
                <input
                  checked={form.active}
                  onChange={(event) => setForm({ ...form, active: event.target.checked })}
                  type="checkbox"
                />
                Active
              </label>
              <label className="block space-y-2 text-sm font-medium text-slate-700">
                <span>Notes</span>
                <textarea
                  className="min-h-20 w-full rounded-md border border-slate-300 px-3 py-2"
                  onChange={(event) => setForm({ ...form, notes: event.target.value })}
                  value={form.notes}
                />
              </label>
              {modalMessage ? (
                <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-medium text-amber-900">
                  {modalMessage}
                </div>
              ) : null}
              {editingCategory ? (
                <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
                  <p className="text-sm font-semibold text-slate-800">
                    Record cleanup
                  </p>
                  <p className="mt-1 text-xs text-slate-500">
                    Deletes if unused. Default or referenced records will be deactivated instead.
                  </p>
                  <button
                    className="mt-3 h-10 cursor-pointer rounded-md border border-red-200 px-3 text-sm font-semibold text-red-700 hover:bg-red-100 disabled:opacity-60"
                    disabled={isSaving}
                    onClick={() => void deleteOrDeactivateCategory(editingCategory)}
                    type="button"
                  >
                    Delete / Deactivate
                  </button>
                </div>
              ) : null}
            </form>
          </div>
        ) : null}
      </div>
    </main>
  );
}
