"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";

import { API_BASE_URL } from "@/lib/api";

type CardIssuer = {
  id: number;
  name: string;
  short_name: string | null;
  active: boolean;
  notes: string | null;
  website: string | null;
  support_phone: string | null;
  issuer_type: string | null;
};

const emptyForm = {
  name: "",
  short_name: "",
  issuer_type: "",
  website: "",
  support_phone: "",
  notes: "",
  active: true,
};

function labelType(value: string | null) {
  return value ? value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase()) : "-";
}

export default function CardIssuersSettingsPage() {
  const [issuers, setIssuers] = useState<CardIssuer[]>([]);
  const [form, setForm] = useState(emptyForm);
  const [editingIssuer, setEditingIssuer] = useState<CardIssuer | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [showInactive, setShowInactive] = useState(true);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function loadIssuers() {
    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch(`${API_BASE_URL}/card-issuers/`);
      if (!response.ok) {
        throw new Error(`Failed to load issuers (${response.status})`);
      }
      setIssuers((await response.json()) as CardIssuer[]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load issuers.");
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    queueMicrotask(() => {
      void loadIssuers();
    });
  }, []);

  function openCreate() {
    setEditingIssuer(null);
    setForm(emptyForm);
    setIsModalOpen(true);
  }

  function editIssuer(issuer: CardIssuer) {
    setEditingIssuer(issuer);
    setForm({
      name: issuer.name,
      short_name: issuer.short_name ?? "",
      issuer_type: issuer.issuer_type ?? "",
      website: issuer.website ?? "",
      support_phone: issuer.support_phone ?? "",
      notes: issuer.notes ?? "",
      active: issuer.active,
    });
    setIsModalOpen(true);
  }

  function resetForm() {
    setEditingIssuer(null);
    setForm(emptyForm);
    setIsModalOpen(false);
  }

  async function saveIssuer(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSaving(true);
    setError(null);

    try {
      const response = await fetch(
        editingIssuer
          ? `${API_BASE_URL}/card-issuers/${editingIssuer.id}`
          : `${API_BASE_URL}/card-issuers/`,
        {
          method: editingIssuer ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: form.name.trim(),
            short_name: form.short_name.trim() || null,
            issuer_type: form.issuer_type || null,
            website: form.website.trim() || null,
            support_phone: form.support_phone.trim() || null,
            notes: form.notes.trim() || null,
            active: form.active,
          }),
        },
      );
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(body?.detail || `Failed to save issuer (${response.status})`);
      }
      resetForm();
      await loadIssuers();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save issuer.");
    } finally {
      setIsSaving(false);
    }
  }

  async function deleteIssuer(issuerId: number) {
    setError(null);
    const response = await fetch(`${API_BASE_URL}/card-issuers/${issuerId}`, {
      method: "DELETE",
    });
    if (!response.ok) {
      const body = await response.json().catch(() => null);
      setError(body?.detail || `Failed to delete issuer (${response.status})`);
      return;
    }
    resetForm();
    await loadIssuers();
  }

  const visibleIssuers = issuers.filter((issuer) => showInactive || issuer.active);

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-6 text-slate-950 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-6xl space-y-5">
        <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <Link className="mb-3 inline-flex h-8 items-center rounded-md border border-slate-300 px-3 text-xs font-semibold text-slate-700 hover:bg-slate-100" href="/settings">
              Back to Settings
            </Link>
            <p className="text-sm font-medium uppercase tracking-wide text-slate-500">
              Settings / Card Issuers
            </p>
            <h1 className="mt-1 text-3xl font-semibold tracking-tight">Card Issuers</h1>
          </div>
          <button
            className="h-10 rounded-md bg-slate-950 px-4 text-sm font-semibold text-white hover:bg-slate-800"
            onClick={openCreate}
            type="button"
          >
            Add Issuer
          </button>
        </header>

        {error ? <p className="rounded-md border border-red-200 bg-red-50 p-3 text-sm font-medium text-red-700">{error}</p> : null}

        <section className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
          <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3">
            <h2 className="font-semibold">Issuers</h2>
            <label className="flex items-center gap-2 text-sm font-medium text-slate-600">
              <input checked={showInactive} onChange={(event) => setShowInactive(event.target.checked)} type="checkbox" />
              Show inactive
            </label>
          </div>
          {isLoading ? (
            <p className="p-5 text-sm text-slate-500">Loading issuers...</p>
          ) : (
            <div className="divide-y divide-slate-200">
              {visibleIssuers.map((issuer) => (
                <div className="grid gap-3 px-5 py-3 text-sm md:grid-cols-[1.5fr_1fr_1fr_1fr_auto]" key={issuer.id}>
                  <div>
                    <p className="font-semibold">{issuer.name}</p>
                    <p className="text-xs text-slate-500">{issuer.short_name || "No short name"}</p>
                  </div>
                  <p>{labelType(issuer.issuer_type)}</p>
                  <p>{issuer.website || "-"}</p>
                  <p>{issuer.active ? "Active" : "Inactive"}</p>
                  <div className="flex justify-end gap-2">
                    <button className="h-8 rounded-md border border-slate-300 px-3 text-xs font-semibold hover:bg-slate-100" onClick={() => editIssuer(issuer)} type="button">Edit</button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
      {isModalOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center modal-backdrop p-4">
          <form
            className="max-h-[90vh] w-full max-w-2xl space-y-4 overflow-y-auto rounded-lg bg-white p-5 shadow-xl"
            id="card-issuer-settings-form"
            onSubmit={saveIssuer}
          >
            <div className="flex items-start justify-between gap-4 border-b border-slate-200 pb-4">
              <div>
                <h2 className="text-xl font-semibold">
                  {editingIssuer ? "Edit Issuer" : "Add Issuer"}
                </h2>
                <p className="mt-1 text-xs text-slate-500">
                  Configure issuer metadata used by credit cards.
                </p>
              </div>
              <div className="flex shrink-0 gap-2">
                <button
                  className="h-9 rounded-md border border-slate-300 px-3 text-sm font-semibold text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60"
                  disabled={isSaving}
                  onClick={resetForm}
                  type="button"
                >
                  Cancel
                </button>
                <button
                  className="h-9 rounded-md bg-slate-950 px-3 text-sm font-semibold text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
                  disabled={isSaving}
                  form="card-issuer-settings-form"
                  type="submit"
                >
                  {isSaving ? "Saving..." : "Save"}
                </button>
              </div>
            </div>
            <div className="grid gap-3 md:grid-cols-3">
              <label className="space-y-1 text-sm font-medium text-slate-700">
                <span>Name</span>
                <input className="h-10 w-full rounded-md border border-slate-300 px-3" onChange={(event) => setForm({ ...form, name: event.target.value })} required value={form.name} />
              </label>
              <label className="space-y-1 text-sm font-medium text-slate-700">
                <span>Short Name</span>
                <input className="h-10 w-full rounded-md border border-slate-300 px-3" onChange={(event) => setForm({ ...form, short_name: event.target.value })} value={form.short_name} />
              </label>
              <label className="space-y-1 text-sm font-medium text-slate-700">
                <span>Issuer Type</span>
                <select className="h-10 w-full rounded-md border border-slate-300 px-3" onChange={(event) => setForm({ ...form, issuer_type: event.target.value })} value={form.issuer_type}>
                  <option value="">Optional</option>
                  <option value="bank">Bank</option>
                  <option value="credit_union">Credit Union</option>
                  <option value="fintech">Fintech</option>
                  <option value="retail">Retail</option>
                  <option value="other">Other</option>
                </select>
              </label>
              <label className="space-y-1 text-sm font-medium text-slate-700">
                <span>Website</span>
                <input className="h-10 w-full rounded-md border border-slate-300 px-3" onChange={(event) => setForm({ ...form, website: event.target.value })} value={form.website} />
              </label>
              <label className="space-y-1 text-sm font-medium text-slate-700">
                <span>Support Phone</span>
                <input className="h-10 w-full rounded-md border border-slate-300 px-3" onChange={(event) => setForm({ ...form, support_phone: event.target.value })} value={form.support_phone} />
              </label>
              <label className="flex items-end gap-2 text-sm font-semibold text-slate-700">
                <input checked={form.active} onChange={(event) => setForm({ ...form, active: event.target.checked })} type="checkbox" />
                Active
              </label>
              <label className="space-y-1 text-sm font-medium text-slate-700 md:col-span-3">
                <span>Notes</span>
                <textarea className="min-h-20 w-full rounded-md border border-slate-300 px-3 py-2" onChange={(event) => setForm({ ...form, notes: event.target.value })} value={form.notes} />
              </label>
              {editingIssuer ? (
                <div className="rounded-md border border-red-200 bg-red-50 p-3 md:col-span-3">
                  <p className="text-sm font-semibold text-red-800">Danger Zone</p>
                  <p className="mt-1 text-xs text-red-700">
                    Delete this issuer if it is not protected by existing cards.
                  </p>
                  <button
                    className="mt-3 h-10 rounded-md border border-red-200 px-3 text-sm font-semibold text-red-700 hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-60"
                    disabled={isSaving}
                    onClick={() => void deleteIssuer(editingIssuer.id)}
                    type="button"
                  >
                    Delete Issuer
                  </button>
                </div>
              ) : null}
            </div>
          </form>
        </div>
      ) : null}
    </main>
  );
}
