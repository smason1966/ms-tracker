"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";

import { API_BASE_URL } from "@/lib/api";

type SpendingCategory = {
  id: number;
  key: string;
  name: string;
  active: boolean;
  notes: string | null;
};

type CategoryForm = {
  key: string;
  name: string;
  notes: string;
  active: boolean;
};

const emptyForm: CategoryForm = {
  key: "",
  name: "",
  notes: "",
  active: true,
};

function categoryToForm(category: SpendingCategory): CategoryForm {
  return {
    key: category.key,
    name: category.name,
    notes: category.notes ?? "",
    active: category.active,
  };
}

export default function SpendingCategoriesSettingsPage() {
  const [categories, setCategories] = useState<SpendingCategory[]>([]);
  const [form, setForm] = useState<CategoryForm>(emptyForm);
  const [editingCategory, setEditingCategory] =
    useState<SpendingCategory | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function loadCategories() {
    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch(`${API_BASE_URL}/spending-categories/`);

      if (!response.ok) {
        throw new Error(`Failed to load categories (${response.status})`);
      }

      setCategories((await response.json()) as SpendingCategory[]);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to load categories.",
      );
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      void loadCategories();
    }, 0);

    return () => window.clearTimeout(timeoutId);
  }, []);

  function openCreate() {
    setEditingCategory(null);
    setForm(emptyForm);
    setIsModalOpen(true);
  }

  function openEdit(category: SpendingCategory) {
    setEditingCategory(category);
    setForm(categoryToForm(category));
    setIsModalOpen(true);
  }

  async function saveCategory(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSaving(true);
    setError(null);

    try {
      const response = await fetch(
        editingCategory
          ? `${API_BASE_URL}/spending-categories/${editingCategory.id}`
          : `${API_BASE_URL}/spending-categories/`,
        {
          method: editingCategory ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            key: form.key.trim(),
            name: form.name.trim(),
            active: form.active,
            notes: form.notes.trim() || null,
          }),
        },
      );

      if (!response.ok) {
        throw new Error(`Failed to save category (${response.status})`);
      }

      setIsModalOpen(false);
      await loadCategories();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save category.");
    } finally {
      setIsSaving(false);
    }
  }

  async function deleteOrDeactivateCategory(category: SpendingCategory) {
    setIsSaving(true);
    setError(null);

    try {
      const response = await fetch(
        `${API_BASE_URL}/spending-categories/${category.id}`,
        { method: "DELETE" },
      );

      if (!response.ok) {
        const body = await response.text().catch(() => "");
        throw new Error(
          `Failed to delete or deactivate category (${response.status})${
            body ? `: ${body}` : ""
          }`,
        );
      }

      setIsModalOpen(false);
      setEditingCategory(null);
      await loadCategories();
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Failed to delete or deactivate category.",
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
              className="mb-3 inline-flex h-8 cursor-pointer items-center rounded-md border border-slate-300 px-3 text-xs font-semibold text-slate-700 transition hover:bg-slate-100 active:bg-slate-200"
              href="/settings"
            >
              Back to Settings
            </Link>
            <p className="text-sm font-medium uppercase tracking-wide text-slate-500">
              Settings / Spending Categories
            </p>
            <h1 className="mt-1 text-3xl font-semibold tracking-tight">
              Spending Categories
            </h1>
          </div>
          <button
            className="h-10 cursor-pointer rounded-md bg-slate-950 px-4 text-sm font-semibold text-white hover:bg-slate-800"
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

        <section className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
          {isLoading ? (
            <p className="p-6 text-sm text-slate-500">Loading categories...</p>
          ) : (
            <table className="min-w-full divide-y divide-slate-200 text-sm">
              <thead className="bg-slate-100 text-left text-xs font-semibold uppercase tracking-wide text-slate-600">
                <tr>
                  <th className="px-4 py-3">Name</th>
                  <th className="px-4 py-3">Key</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Notes</th>
                  <th className="px-4 py-3 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {categories.map((category) => (
                  <tr key={category.id}>
                    <td className="px-4 py-3 font-semibold">{category.name}</td>
                    <td className="px-4 py-3 font-mono text-xs text-slate-600">
                      {category.key}
                    </td>
                    <td className="px-4 py-3">
                      {category.active ? "Active" : "Inactive"}
                    </td>
                    <td className="px-4 py-3 text-slate-600">
                      {category.notes || "-"}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        className="h-8 cursor-pointer rounded-md border border-slate-300 px-3 text-xs font-semibold hover:bg-slate-100"
                        onClick={() => openEdit(category)}
                        type="button"
                      >
                        Edit
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </div>

      {isModalOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center modal-backdrop p-4">
          <div className="w-full max-w-lg rounded-lg bg-white p-5 shadow-xl">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-xl font-semibold">
                {editingCategory ? "Edit Category" : "Add Category"}
              </h2>
              <div className="flex shrink-0 gap-2">
                <button
                  className="h-9 cursor-pointer rounded-md border border-slate-300 px-3 text-sm font-semibold hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60"
                  disabled={isSaving}
                  onClick={() => setIsModalOpen(false)}
                  type="button"
                >
                  Cancel
                </button>
                <button
                  className="h-9 cursor-pointer rounded-md bg-slate-950 px-3 text-sm font-semibold text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
                  disabled={isSaving}
                  form="spending-category-settings-form"
                  type="submit"
                >
                  {isSaving ? "Saving..." : "Save"}
                </button>
              </div>
            </div>
            <form
              className="mt-5 grid gap-4"
              id="spending-category-settings-form"
              onSubmit={saveCategory}
            >
              <label className="space-y-2 text-sm font-medium text-slate-700">
                <span>Name</span>
                <input
                  className="h-11 w-full rounded-md border border-slate-300 px-3"
                  onChange={(event) =>
                    setForm((currentForm) => ({
                      ...currentForm,
                      name: event.target.value,
                    }))
                  }
                  required
                  value={form.name}
                />
              </label>
              <label className="space-y-2 text-sm font-medium text-slate-700">
                <span>Key</span>
                <input
                  className="h-11 w-full rounded-md border border-slate-300 px-3"
                  onChange={(event) =>
                    setForm((currentForm) => ({
                      ...currentForm,
                      key: event.target.value,
                    }))
                  }
                  placeholder="office_supply"
                  required
                  value={form.key}
                />
              </label>
              <label className="space-y-2 text-sm font-medium text-slate-700">
                <span>Notes</span>
                <textarea
                  className="min-h-24 w-full rounded-md border border-slate-300 px-3 py-2"
                  onChange={(event) =>
                    setForm((currentForm) => ({
                      ...currentForm,
                      notes: event.target.value,
                    }))
                  }
                  value={form.notes}
                />
              </label>
              <label className="flex h-10 items-center gap-2 text-sm font-medium text-slate-700">
                <input
                  checked={form.active}
                  className="h-4 w-4 rounded border-slate-300"
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
              {editingCategory ? (
                <div className="rounded-md border border-red-200 bg-red-50 p-3">
                  <p className="text-sm font-semibold text-red-800">
                    Danger Zone
                  </p>
                  <p className="mt-1 text-xs text-red-700">
                    Delete this category if unused, or deactivate it when linked
                    records prevent deletion.
                  </p>
                  <button
                    className="mt-3 h-10 cursor-pointer rounded-md border border-red-200 px-3 text-sm font-semibold text-red-700 hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-60"
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
        </div>
      ) : null}
    </main>
  );
}
