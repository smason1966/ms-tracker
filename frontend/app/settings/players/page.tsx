"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";

import { API_BASE_URL } from "@/lib/api";

type Player = {
  id: number;
  label: string;
  name: string | null;
  notes: string | null;
  active: boolean;
  linked_credit_card_count: number;
  linked_purchase_count: number;
};

type PlayerForm = {
  label: string;
  name: string;
  notes: string;
  active: boolean;
};

const emptyForm: PlayerForm = {
  label: "",
  name: "",
  notes: "",
  active: true,
};

export default function PlayersSettingsPage() {
  const [players, setPlayers] = useState<Player[]>([]);
  const [form, setForm] = useState<PlayerForm>(emptyForm);
  const [editingPlayer, setEditingPlayer] = useState<Player | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pendingPlayerAction, setPendingPlayerAction] = useState<{
    player: Player;
    action: "delete" | "deactivate";
  } | null>(null);

  async function loadPlayers() {
    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch(`${API_BASE_URL}/players/`);

      if (!response.ok) {
        throw new Error(`Failed to load players (${response.status})`);
      }

      setPlayers((await response.json()) as Player[]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load players.");
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    queueMicrotask(() => {
      void loadPlayers();
    });
  }, []);

  function startEdit(player: Player) {
    setEditingPlayer(player);
    setForm({
      label: player.label,
      name: player.name ?? "",
      notes: player.notes ?? "",
      active: player.active,
    });
    setMessage(null);
    setError(null);
  }

  function resetForm() {
    setEditingPlayer(null);
    setForm(emptyForm);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSaving(true);
    setError(null);
    setMessage(null);

    const payload = {
      label: form.label.trim(),
      name: form.name.trim() || null,
      notes: form.notes.trim() || null,
      active: form.active,
    };

    try {
      const response = await fetch(
        editingPlayer
          ? `${API_BASE_URL}/players/${editingPlayer.id}`
          : `${API_BASE_URL}/players/`,
        {
          method: editingPlayer ? "PATCH" : "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(payload),
        },
      );

      if (!response.ok) {
        const body = await response.text();
        throw new Error(
          body || `Failed to save player (${response.status})`,
        );
      }

      setMessage(editingPlayer ? "Player updated." : "Player created.");
      resetForm();
      await loadPlayers();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save player.");
    } finally {
      setIsSaving(false);
    }
  }

  async function performPlayerAction(
    player: Player,
    action: "delete" | "deactivate",
  ) {
    setError(null);
    setMessage(null);

    try {
      const response = await fetch(
        action === "deactivate"
          ? `${API_BASE_URL}/players/${player.id}/deactivate`
          : `${API_BASE_URL}/players/${player.id}`,
        {
          method: action === "deactivate" ? "POST" : "DELETE",
        },
      );

      if (!response.ok) {
        const body = await response.json().catch(() => null);
        if (response.status === 409 && body?.detail?.error === "player_has_linked_records") {
          setPendingPlayerAction({ player, action: "deactivate" });
          return;
        }

        throw new Error(
          body?.detail?.message ||
            body?.detail ||
            `Failed to ${action} player (${response.status})`,
        );
      }

      const result = (await response.json()) as {
        deleted: boolean;
        deactivated: boolean;
        message?: string;
      };
      setMessage(
        result.message ||
          (result.deleted ? "Player deleted." : "Player deactivated."),
      );
      setPendingPlayerAction(null);
      if (editingPlayer?.id === player.id) {
        resetForm();
      }
      await loadPlayers();
    } catch (err) {
      setError(err instanceof Error ? err.message : `Failed to ${action} player.`);
    }
  }

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-6 text-slate-950 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-5xl space-y-5">
        <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <Link
              className="inline-flex h-9 cursor-pointer items-center rounded-md border border-slate-300 px-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-100 active:bg-slate-200"
              href="/settings"
            >
              Back to Settings
            </Link>
            <p className="mt-4 text-sm font-medium text-slate-500">
              Settings / Players
            </p>
            <h1 className="mt-1 text-3xl font-semibold tracking-tight">
              Players
            </h1>
            <p className="mt-2 max-w-2xl text-sm text-slate-600">
              Configure compact P1/P2/P3 ownership labels for credit cards and
              future player-level reporting.
            </p>
          </div>
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

        <section className="grid gap-5 lg:grid-cols-[1fr_1.2fr]">
          <form
            className="space-y-4 rounded-lg border border-slate-200 bg-white p-5 shadow-sm"
            onSubmit={handleSubmit}
          >
            <div>
              <h2 className="text-lg font-semibold">
                {editingPlayer ? "Edit Player" : "Add Player"}
              </h2>
              <p className="mt-1 text-sm text-slate-600">
                Labels should stay short, like P1, P2, or P3.
              </p>
            </div>

            <label className="block space-y-2 text-sm font-medium text-slate-700">
              <span>Label</span>
              <input
                className="h-11 w-full rounded-md border border-slate-300 px-3 text-slate-950 outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-200"
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    label: event.target.value,
                  }))
                }
                placeholder="P1"
                required
                value={form.label}
              />
            </label>

            <label className="block space-y-2 text-sm font-medium text-slate-700">
              <span>Name</span>
              <input
                className="h-11 w-full rounded-md border border-slate-300 px-3 text-slate-950 outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-200"
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    name: event.target.value,
                  }))
                }
                placeholder="Optional"
                value={form.name}
              />
            </label>

            <label className="flex h-11 items-center gap-2 text-sm font-medium text-slate-700">
              <input
                checked={form.active}
                className="h-4 w-4"
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    active: event.target.checked,
                  }))
                }
                type="checkbox"
              />
              Active
            </label>

            <label className="block space-y-2 text-sm font-medium text-slate-700">
              <span>Notes</span>
              <textarea
                className="min-h-24 w-full rounded-md border border-slate-300 px-3 py-2 text-slate-950 outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-200"
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    notes: event.target.value,
                  }))
                }
                value={form.notes}
              />
            </label>

            <div className="flex gap-2">
              <button
                className="h-11 cursor-pointer rounded-md bg-slate-950 px-4 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
                disabled={isSaving}
                type="submit"
              >
                {isSaving ? "Saving..." : editingPlayer ? "Save Player" : "Add Player"}
              </button>
              {editingPlayer ? (
                <button
                  className="h-11 cursor-pointer rounded-md border border-slate-300 px-4 text-sm font-semibold text-slate-700 transition hover:bg-slate-100 active:bg-slate-200"
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
              <h2 className="text-lg font-semibold">Configured Players</h2>
            </div>
            {isLoading ? (
              <p className="p-5 text-sm text-slate-600">Loading players...</p>
            ) : players.length === 0 ? (
              <p className="p-5 text-sm text-slate-600">
                No players yet. Enabling multi-player mode creates P1
                automatically if needed.
              </p>
            ) : (
              <div className="divide-y divide-slate-200">
                {players.map((player) => (
                  <div
                    className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between"
                    key={player.id}
                  >
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="rounded-md border border-cyan-200 bg-cyan-50 px-2 py-1 text-xs font-bold text-cyan-800">
                          {player.label}
                        </span>
                        <span className="font-semibold">
                          {player.name || "Unnamed player"}
                        </span>
                        <span
                          className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                            player.active
                              ? "bg-emerald-50 text-emerald-700"
                              : "bg-slate-100 text-slate-500"
                          }`}
                        >
                          {player.active ? "Active" : "Inactive"}
                        </span>
                      </div>
                      {player.notes ? (
                        <p className="mt-2 text-sm text-slate-600">
                          {player.notes}
                        </p>
                      ) : null}
                      <p className="mt-2 text-xs text-slate-500">
                        {player.linked_credit_card_count} linked card
                        {player.linked_credit_card_count === 1 ? "" : "s"} ·{" "}
                        {player.linked_purchase_count} linked purchase
                        {player.linked_purchase_count === 1 ? "" : "s"}
                      </p>
                    </div>
                    <div className="flex gap-2">
                      <button
                        className="h-10 cursor-pointer rounded-md border border-slate-300 px-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-100 active:bg-slate-200"
                        onClick={() => startEdit(player)}
                        type="button"
                      >
                        Edit
                      </button>
                      <button
                        className="h-10 cursor-pointer rounded-md border border-red-200 px-3 text-sm font-semibold text-red-700 transition hover:bg-red-50 active:bg-red-100"
                        onClick={() =>
                          setPendingPlayerAction({
                            player,
                            action:
                              player.linked_credit_card_count > 0 ||
                              player.linked_purchase_count > 0
                                ? "deactivate"
                                : "delete",
                          })
                        }
                        type="button"
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        </section>
      </div>
      {pendingPlayerAction ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center modal-backdrop p-4">
          <div className="w-full max-w-md rounded-lg bg-white p-5 text-slate-950 shadow-xl">
            <h2 className="text-lg font-semibold">
              {pendingPlayerAction.action === "delete"
                ? "Delete player?"
                : "Deactivate instead?"}
            </h2>
            {pendingPlayerAction.action === "delete" ? (
              <p className="mt-3 text-sm leading-6 text-slate-600">
                {pendingPlayerAction.player.label} has no linked cards or purchase
                history, so it can be permanently deleted.
              </p>
            ) : (
              <div className="mt-3 space-y-2 text-sm leading-6 text-slate-600">
                <p>
                  {pendingPlayerAction.player.label} has linked records. It will
                  be deactivated instead of deleted.
                </p>
                <p>
                  Current credit cards assigned to this player will move to
                  Unassigned.
                </p>
              </div>
            )}
            <div className="mt-5 flex justify-end gap-2">
              <button
                className="h-10 cursor-pointer rounded-md border border-slate-300 px-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-100 active:bg-slate-200"
                onClick={() => setPendingPlayerAction(null)}
                type="button"
              >
                Cancel
              </button>
              <button
                className={`h-10 cursor-pointer rounded-md px-3 text-sm font-semibold text-white transition disabled:cursor-not-allowed disabled:opacity-60 ${
                  pendingPlayerAction.action === "delete"
                    ? "bg-red-700 hover:bg-red-800 active:bg-red-900"
                    : "bg-slate-950 hover:bg-slate-800 active:bg-slate-900"
                }`}
                onClick={() =>
                  void performPlayerAction(
                    pendingPlayerAction.player,
                    pendingPlayerAction.action,
                  )
                }
                type="button"
              >
                {pendingPlayerAction.action === "delete"
                  ? "Delete Player"
                  : "Deactivate Player"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}
