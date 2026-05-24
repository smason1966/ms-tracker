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
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

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

  function startEdit(category: RewardProgramCategory) {
    setEditingCategory(category);
    setForm({
      name: category.name,
      active: category.active,
      notes: category.notes || "",
    });
    setError(null);
    setMessage(null);
  }

  function resetForm() {
    setEditingCategory(null);
    setForm(emptyForm);
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

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-6 text-slate-950 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-5xl space-y-5">
        <header>
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

        <section className="grid gap-5 lg:grid-cols-[20rem_1fr]">
          <form
            className="space-y-4 rounded-lg border border-slate-200 bg-white p-5 shadow-sm"
            onSubmit={handleSubmit}
          >
            <h2 className="text-lg font-semibold">
              {editingCategory ? "Edit Category" : "Add Category"}
            </h2>
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
            <div className="flex gap-2">
              <button
                className="h-11 cursor-pointer rounded-md bg-slate-950 px-4 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:opacity-60"
                disabled={isSaving}
                type="submit"
              >
                {isSaving ? "Saving..." : "Save Category"}
              </button>
              {editingCategory ? (
                <button
                  className="h-11 cursor-pointer rounded-md border border-slate-300 px-4 text-sm font-semibold text-slate-700 transition hover:bg-slate-100"
                  onClick={resetForm}
                  type="button"
                >
                  Cancel
                </button>
              ) : null}
            </div>
          </form>

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
        </section>
      </div>
    </main>
  );
}
