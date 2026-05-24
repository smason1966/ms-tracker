"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";

import { API_BASE_URL } from "@/lib/api";

type CardNetwork = {
  id: number;
  name: string;
  code: string;
  active: boolean;
  notes: string | null;
};

const emptyForm = {
  name: "",
  code: "",
  notes: "",
  active: true,
};

export default function CardNetworksSettingsPage() {
  const [networks, setNetworks] = useState<CardNetwork[]>([]);
  const [form, setForm] = useState(emptyForm);
  const [editingNetwork, setEditingNetwork] = useState<CardNetwork | null>(null);
  const [showInactive, setShowInactive] = useState(true);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function loadNetworks() {
    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch(`${API_BASE_URL}/card-networks/`);
      if (!response.ok) {
        throw new Error(`Failed to load networks (${response.status})`);
      }
      setNetworks((await response.json()) as CardNetwork[]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load networks.");
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    queueMicrotask(() => {
      void loadNetworks();
    });
  }, []);

  function editNetwork(network: CardNetwork) {
    setEditingNetwork(network);
    setForm({
      name: network.name,
      code: network.code,
      notes: network.notes ?? "",
      active: network.active,
    });
  }

  function resetForm() {
    setEditingNetwork(null);
    setForm(emptyForm);
  }

  async function saveNetwork(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSaving(true);
    setError(null);

    try {
      const response = await fetch(
        editingNetwork
          ? `${API_BASE_URL}/card-networks/${editingNetwork.id}`
          : `${API_BASE_URL}/card-networks/`,
        {
          method: editingNetwork ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: form.name.trim(),
            code: form.code.trim(),
            notes: form.notes.trim() || null,
            active: form.active,
          }),
        },
      );
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(body?.detail || `Failed to save network (${response.status})`);
      }
      resetForm();
      await loadNetworks();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save network.");
    } finally {
      setIsSaving(false);
    }
  }

  async function deleteNetwork(networkId: number) {
    setError(null);
    const response = await fetch(`${API_BASE_URL}/card-networks/${networkId}`, {
      method: "DELETE",
    });
    if (!response.ok) {
      const body = await response.json().catch(() => null);
      setError(body?.detail || `Failed to delete network (${response.status})`);
      return;
    }
    await loadNetworks();
  }

  const visibleNetworks = networks.filter((network) => showInactive || network.active);

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-6 text-slate-950 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-5xl space-y-5">
        <header>
          <Link className="mb-3 inline-flex h-8 items-center rounded-md border border-slate-300 px-3 text-xs font-semibold text-slate-700 hover:bg-slate-100" href="/settings">
            Back to Settings
          </Link>
          <p className="text-sm font-medium uppercase tracking-wide text-slate-500">
            Settings / Card Networks
          </p>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight">Card Networks</h1>
        </header>

        {error ? <p className="rounded-md border border-red-200 bg-red-50 p-3 text-sm font-medium text-red-700">{error}</p> : null}

        <form className="grid gap-3 rounded-lg border border-slate-200 bg-white p-5 shadow-sm md:grid-cols-[1fr_10rem_auto]" onSubmit={saveNetwork}>
          <label className="space-y-1 text-sm font-medium text-slate-700">
            <span>Name</span>
            <input className="h-10 w-full rounded-md border border-slate-300 px-3" onChange={(event) => setForm({ ...form, name: event.target.value })} required value={form.name} />
          </label>
          <label className="space-y-1 text-sm font-medium text-slate-700">
            <span>Code</span>
            <input className="h-10 w-full rounded-md border border-slate-300 px-3" onChange={(event) => setForm({ ...form, code: event.target.value })} required value={form.code} />
          </label>
          <label className="flex items-end gap-2 text-sm font-semibold text-slate-700">
            <input checked={form.active} onChange={(event) => setForm({ ...form, active: event.target.checked })} type="checkbox" />
            Active
          </label>
          <label className="space-y-1 text-sm font-medium text-slate-700 md:col-span-3">
            <span>Notes</span>
            <textarea className="min-h-20 w-full rounded-md border border-slate-300 px-3 py-2" onChange={(event) => setForm({ ...form, notes: event.target.value })} value={form.notes} />
          </label>
          <div className="flex gap-2 md:col-span-3">
            <button className="h-10 rounded-md bg-slate-950 px-4 text-sm font-semibold text-white disabled:opacity-60" disabled={isSaving} type="submit">
              {editingNetwork ? "Save Network" : "Add Network"}
            </button>
            {editingNetwork ? (
              <button className="h-10 rounded-md border border-slate-300 px-4 text-sm font-semibold text-slate-700" onClick={resetForm} type="button">
                Cancel
              </button>
            ) : null}
          </div>
        </form>

        <section className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
          <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3">
            <h2 className="font-semibold">Networks</h2>
            <label className="flex items-center gap-2 text-sm font-medium text-slate-600">
              <input checked={showInactive} onChange={(event) => setShowInactive(event.target.checked)} type="checkbox" />
              Show inactive
            </label>
          </div>
          {isLoading ? (
            <p className="p-5 text-sm text-slate-500">Loading networks...</p>
          ) : (
            <div className="divide-y divide-slate-200">
              {visibleNetworks.map((network) => (
                <div className="grid gap-3 px-5 py-3 text-sm md:grid-cols-[1fr_8rem_8rem_auto]" key={network.id}>
                  <p className="font-semibold">{network.name}</p>
                  <p>{network.code}</p>
                  <p>{network.active ? "Active" : "Inactive"}</p>
                  <div className="flex justify-end gap-2">
                    <button className="h-8 rounded-md border border-slate-300 px-3 text-xs font-semibold hover:bg-slate-100" onClick={() => editNetwork(network)} type="button">Edit</button>
                    <button className="h-8 rounded-md border border-slate-300 px-3 text-xs font-semibold hover:bg-slate-100" onClick={() => void deleteNetwork(network.id)} type="button">Delete</button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
