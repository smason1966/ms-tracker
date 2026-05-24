"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";

import { API_BASE_URL } from "@/lib/api";

type RewardProgram = {
  id: number;
  name: string;
  short_code: string;
  category: string;
  active: boolean;
};

type CreditCard = {
  id: number;
  nickname: string;
  issuer: string;
  network: string | null;
  last_four: string | null;
  credit_limit: string | number;
  current_balance: string | number | null;
  statement_close_day: number | null;
  payment_due_day: number | null;
  signup_bonus_spend: string | number | null;
  signup_bonus_deadline: string | null;
  current_spend_progress: string | number;
  reward_program_id: number | null;
  reward_program: RewardProgram | null;
  rewards_type: string;
  rewards_rate: string | number | null;
  is_active: boolean;
  notes: string | null;
  utilization_percent: number | null;
  msr_remaining: string | number | null;
  days_until_statement_close: number | null;
  days_until_payment_due: number | null;
};

type CardForm = {
  nickname: string;
  issuer: string;
  network: string;
  last_four: string;
  credit_limit: string;
  current_balance: string;
  statement_close_day: string;
  payment_due_day: string;
  signup_bonus_spend: string;
  signup_bonus_deadline: string;
  current_spend_progress: string;
  reward_program_id: string;
  rewards_rate: string;
  notes: string;
};

const emptyForm: CardForm = {
  nickname: "",
  issuer: "",
  network: "",
  last_four: "",
  credit_limit: "",
  current_balance: "",
  statement_close_day: "",
  payment_due_day: "",
  signup_bonus_spend: "",
  signup_bonus_deadline: "",
  current_spend_progress: "0",
  reward_program_id: "",
  rewards_rate: "",
  notes: "",
};

function formatAmount(value: string | number | null) {
  if (value === null || value === "") {
    return "-";
  }

  const amount = Number(value);

  if (Number.isNaN(amount)) {
    return String(value);
  }

  return amount.toLocaleString(undefined, {
    style: "currency",
    currency: "USD",
  });
}

function formatPercent(value: number | null) {
  if (value === null) {
    return "-";
  }

  return `${Math.round(value)}%`;
}

function getProgress(card: CreditCard) {
  const target = Number(card.signup_bonus_spend ?? 0);
  const current = Number(card.current_spend_progress ?? 0);

  if (!target || Number.isNaN(target)) {
    return 0;
  }

  return Math.min(100, Math.round((current / target) * 100));
}

function isDeadlineSoon(value: string | null) {
  if (!value) {
    return false;
  }

  const deadline = new Date(`${value}T00:00:00`);
  const today = new Date();
  const days = Math.ceil(
    (deadline.getTime() - today.getTime()) / (1000 * 60 * 60 * 24),
  );

  return days >= 0 && days <= 30;
}

export default function CreditCardsPage() {
  const [cards, setCards] = useState<CreditCard[]>([]);
  const [rewardPrograms, setRewardPrograms] = useState<RewardProgram[]>([]);
  const [form, setForm] = useState<CardForm>(emptyForm);
  const [editingCard, setEditingCard] = useState<CreditCard | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const activeCards = useMemo(
    () => cards.filter((card) => card.is_active),
    [cards],
  );

  const loadCards = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const [cardsResponse, programsResponse] = await Promise.all([
        fetch(`${API_BASE_URL}/credit-cards`),
        fetch(
          `${API_BASE_URL}/reward-programs/?active_only=true&eligible_for_credit_cards=true`,
        ),
      ]);

      if (!cardsResponse.ok) {
        throw new Error(`Failed to load credit cards (${cardsResponse.status})`);
      }
      if (!programsResponse.ok) {
        throw new Error(
          `Failed to load reward programs (${programsResponse.status})`,
        );
      }

      setCards((await cardsResponse.json()) as CreditCard[]);
      setRewardPrograms((await programsResponse.json()) as RewardProgram[]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load cards.");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    queueMicrotask(() => {
      void loadCards();
    });
  }, [loadCards]);

  function openCreateModal() {
    setEditingCard(null);
    setForm(emptyForm);
    setIsModalOpen(true);
  }

  function openEditModal(card: CreditCard) {
    setEditingCard(card);
    setForm({
      nickname: card.nickname,
      issuer: card.issuer,
      network: card.network ?? "",
      last_four: card.last_four ?? "",
      credit_limit: String(card.credit_limit),
      current_balance:
        card.current_balance === null ? "" : String(card.current_balance),
      statement_close_day:
        card.statement_close_day === null ? "" : String(card.statement_close_day),
      payment_due_day:
        card.payment_due_day === null ? "" : String(card.payment_due_day),
      signup_bonus_spend:
        card.signup_bonus_spend === null ? "" : String(card.signup_bonus_spend),
      signup_bonus_deadline: card.signup_bonus_deadline ?? "",
      current_spend_progress: String(card.current_spend_progress ?? 0),
      reward_program_id:
        card.reward_program_id === null ? "" : String(card.reward_program_id),
      rewards_rate: card.rewards_rate === null ? "" : String(card.rewards_rate),
      notes: card.notes ?? "",
    });
    setIsModalOpen(true);
  }

  function updateFormField(field: keyof CardForm, value: string) {
    setForm((currentForm) => ({
      ...currentForm,
      [field]: value,
    }));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSaving(true);
    setError(null);

    const payload = {
      nickname: form.nickname.trim(),
      issuer: form.issuer.trim(),
      network: form.network.trim() || null,
      last_four: form.last_four.trim() || null,
      credit_limit: form.credit_limit,
      current_balance: form.current_balance || null,
      statement_close_day: form.statement_close_day
        ? Number(form.statement_close_day)
        : null,
      payment_due_day: form.payment_due_day ? Number(form.payment_due_day) : null,
      signup_bonus_spend: form.signup_bonus_spend || null,
      signup_bonus_deadline: form.signup_bonus_deadline || null,
      current_spend_progress: form.current_spend_progress || "0",
      reward_program_id: form.reward_program_id
        ? Number(form.reward_program_id)
        : null,
      rewards_rate: form.rewards_rate || null,
      notes: form.notes.trim() || null,
    };

    try {
      const response = await fetch(
        editingCard
          ? `${API_BASE_URL}/credit-cards/${editingCard.id}`
          : `${API_BASE_URL}/credit-cards`,
        {
          method: editingCard ? "PATCH" : "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(payload),
        },
      );

      if (!response.ok) {
        throw new Error(`Failed to save credit card (${response.status})`);
      }

      setIsModalOpen(false);
      await loadCards();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save card.");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-8 text-slate-950 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-7xl space-y-6">
        <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-sm font-medium text-slate-500">Funding Sources</p>
            <h1 className="mt-1 text-3xl font-semibold tracking-tight">
              Credit Cards
            </h1>
          </div>
          <button
            className="h-11 cursor-pointer rounded-md bg-slate-950 px-4 text-sm font-semibold text-white transition hover:bg-slate-800 active:bg-slate-900"
            onClick={openCreateModal}
            type="button"
          >
            Add Card
          </button>
        </header>

        {error ? (
          <p className="rounded-md border border-red-200 bg-red-50 p-3 text-sm font-medium text-red-700">
            {error}
          </p>
        ) : null}

        {isLoading ? (
          <div className="rounded-lg border border-slate-200 bg-white p-6 text-slate-600 shadow-sm">
            Loading credit cards...
          </div>
        ) : activeCards.length === 0 ? (
          <div className="rounded-lg border border-slate-200 bg-white p-6 text-slate-600 shadow-sm">
            No active credit cards yet.
          </div>
        ) : (
          <section className="grid gap-4 lg:grid-cols-2">
            {activeCards.map((card) => {
              const progress = getProgress(card);
              const utilizationWarning =
                (card.utilization_percent ?? 0) > 30;
              const statementSoon =
                card.days_until_statement_close !== null &&
                card.days_until_statement_close <= 5;
              const deadlineSoon = isDeadlineSoon(card.signup_bonus_deadline);

              return (
                <article
                  className="space-y-4 rounded-lg border border-slate-200 bg-white p-5 shadow-sm"
                  key={card.id}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h2 className="text-xl font-semibold">{card.nickname}</h2>
                      <p className="text-sm text-slate-500">
                        {card.issuer}
                        {card.network ? ` · ${card.network}` : ""}
                        {card.last_four ? ` · ${card.last_four}` : ""}
                      </p>
                    </div>
                    <button
                      className="h-10 cursor-pointer rounded-md border border-slate-300 px-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-100 active:bg-slate-200"
                      onClick={() => openEditModal(card)}
                      type="button"
                    >
                      Edit
                    </button>
                  </div>

                  <dl className="grid gap-3 text-sm sm:grid-cols-4">
                    <div>
                      <dt className="font-medium text-slate-500">Limit</dt>
                      <dd className="font-semibold">
                        {formatAmount(card.credit_limit)}
                      </dd>
                    </div>
                    <div>
                      <dt className="font-medium text-slate-500">
                        Estimated Balance
                      </dt>
                      <dd className="font-semibold">
                        {formatAmount(card.current_balance)}
                      </dd>
                    </div>
                    <div>
                      <dt className="font-medium text-slate-500">Utilization</dt>
                      <dd
                        className={
                          utilizationWarning
                            ? "font-semibold text-red-700"
                            : "font-semibold"
                        }
                      >
                        {formatPercent(card.utilization_percent)}
                      </dd>
                    </div>
                    <div>
                      <dt className="font-medium text-slate-500">Rewards</dt>
                      <dd className="font-semibold">
                        {card.reward_program
                          ? card.reward_program.name
                          : card.rewards_type}
                      </dd>
                    </div>
                  </dl>

                  {card.signup_bonus_spend ? (
                    <div>
                      <div className="flex justify-between text-sm">
                        <span className="font-medium text-slate-600">
                          MSR Progress
                        </span>
                        <span>
                          {formatAmount(card.current_spend_progress)} /{" "}
                          {formatAmount(card.signup_bonus_spend)}
                        </span>
                      </div>
                      <div className="mt-2 h-3 overflow-hidden rounded-full bg-slate-100">
                        <div
                          className="h-full rounded-full bg-emerald-600"
                          style={{ width: `${progress}%` }}
                        />
                      </div>
                      <p className="mt-1 text-xs text-slate-500">
                        Remaining: {formatAmount(card.msr_remaining)}
                      </p>
                    </div>
                  ) : null}

                  <div className="flex flex-wrap gap-2 text-xs font-semibold">
                    <span
                      className={`rounded-full px-2 py-1 ${
                        statementSoon
                          ? "bg-amber-100 text-amber-800"
                          : "bg-slate-100 text-slate-700"
                      }`}
                    >
                      Statement closes in{" "}
                      {card.days_until_statement_close ?? "-"} days
                    </span>
                    <span className="rounded-full bg-slate-100 px-2 py-1 text-slate-700">
                      Payment due in {card.days_until_payment_due ?? "-"} days
                    </span>
                    {deadlineSoon ? (
                      <span className="rounded-full bg-red-100 px-2 py-1 text-red-800">
                        MSR deadline soon
                      </span>
                    ) : null}
                  </div>
                </article>
              );
            })}
          </section>
        )}
      </div>

      {isModalOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4">
          <div className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-lg bg-white p-5 shadow-xl">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-xl font-semibold">
                {editingCard ? "Edit Credit Card" : "Add Credit Card"}
              </h2>
              <button
                className="h-10 cursor-pointer rounded-md border border-slate-300 px-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-100"
                onClick={() => setIsModalOpen(false)}
                type="button"
              >
                Close
              </button>
            </div>

            <form className="mt-5 grid gap-4 sm:grid-cols-2" onSubmit={handleSubmit}>
              {([
                ["nickname", "Nickname", "text", true],
                ["issuer", "Issuer", "text", true],
                ["network", "Network", "text", false],
                ["last_four", "Last Four", "text", false],
                ["credit_limit", "Credit Limit", "number", true],
                ["current_balance", "Estimated Balance", "number", false],
                ["statement_close_day", "Statement Close Day", "number", false],
                ["payment_due_day", "Payment Due Day", "number", false],
                ["signup_bonus_spend", "Signup Bonus Spend", "number", false],
                ["signup_bonus_deadline", "Signup Bonus Deadline", "date", false],
                ["current_spend_progress", "Current Spend Progress", "number", false],
                ["rewards_rate", "Rewards Rate", "number", false],
              ] as const).map(([field, label, type, required]) => (
                <label className="space-y-2 text-sm font-medium text-slate-700" key={field}>
                  <span>{label}</span>
                  <input
                    className="h-11 w-full rounded-md border border-slate-300 px-3 text-slate-950 outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-200"
                    min={type === "number" ? "0" : undefined}
                    onChange={(event) => updateFormField(field, event.target.value)}
                    required={required}
                    step={type === "number" ? "0.01" : undefined}
                    type={type}
                    value={form[field]}
                  />
                  {field === "current_balance" ? (
                    <p className="text-xs text-slate-500">
                      This only tracks MS Tracker purchases unless manually
                      updated.
                    </p>
                  ) : null}
                </label>
              ))}

              <label className="space-y-2 text-sm font-medium text-slate-700">
                <span>Reward Program</span>
                <select
                  className="h-11 w-full rounded-md border border-slate-300 px-3 text-slate-950 outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-200"
                  onChange={(event) => updateFormField("reward_program_id", event.target.value)}
                  value={form.reward_program_id}
                >
                  <option value="">No default program</option>
                  {rewardPrograms.map((program) => (
                    <option key={program.id} value={program.id}>
                      {program.name} ({program.short_code})
                    </option>
                  ))}
                </select>
              </label>

              <label className="space-y-2 text-sm font-medium text-slate-700 sm:col-span-2">
                <span>Notes</span>
                <textarea
                  className="min-h-24 w-full rounded-md border border-slate-300 px-3 py-2 text-slate-950 outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-200"
                  onChange={(event) => updateFormField("notes", event.target.value)}
                  value={form.notes}
                />
              </label>

              <div className="flex justify-end gap-2 sm:col-span-2">
                <button
                  className="h-11 cursor-pointer rounded-md border border-slate-300 px-4 text-sm font-semibold text-slate-700 transition hover:bg-slate-100"
                  onClick={() => setIsModalOpen(false)}
                  type="button"
                >
                  Cancel
                </button>
                <button
                  className="h-11 cursor-pointer rounded-md bg-slate-950 px-4 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
                  disabled={isSaving}
                  type="submit"
                >
                  {isSaving ? "Saving..." : "Save Card"}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </main>
  );
}
