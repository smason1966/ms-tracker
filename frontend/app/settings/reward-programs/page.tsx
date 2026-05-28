"use client";

import Link from "next/link";
import { FormEvent, useEffect, useMemo, useState } from "react";

import { API_BASE_URL } from "@/lib/api";

type RewardProgram = {
  id: number;
  name: string;
  short_code: string;
  category: string;
  estimated_value_cents_per_point: string | number | null;
  value_unit: string | null;
  eligible_for_credit_cards: boolean;
  transferable: boolean;
  active: boolean;
  notes: string | null;
  linked_card_count: number;
  linked_payment_count: number;
  linked_rule_count: number;
  ledger_entry_count: number;
  linked_store_count: number;
  system_default: boolean;
  protected: boolean;
  can_delete: boolean;
  can_deactivate: boolean;
  protection_reasons: string[];
};

type RewardProgramProtection = Pick<
  RewardProgram,
  | "linked_card_count"
  | "linked_payment_count"
  | "linked_rule_count"
  | "ledger_entry_count"
  | "linked_store_count"
  | "system_default"
  | "protected"
  | "can_delete"
  | "can_deactivate"
  | "protection_reasons"
>;

type RewardProgramCategory = {
  name: string;
  active: boolean;
  notes: string;
};

type RewardProgramForm = {
  name: string;
  short_code: string;
  category: string;
  estimated_value_cents_per_point: string;
  value_unit: string;
  eligible_for_credit_cards: boolean;
  transferable: boolean;
  active: boolean;
  notes: string;
};

type DuplicateProgramDetail = {
  message: string;
  code: string;
  duplicate_field: string;
  existing_program_id: number;
  existing_program_status: "active" | "inactive";
  existing_program?: RewardProgram;
};

const fallbackCategories = [
  "Cashback",
  "Transferable Points",
  "Airline Miles",
  "Hotel Points",
  "Fuel Rewards",
  "Store Loyalty",
  "Crypto",
  "Other",
];

const valueUnits = [
  ["cents_per_point", "Cents per point"],
  ["usd_per_token", "USD per token"],
  ["variable", "Variable"],
] as const;

const emptyForm: RewardProgramForm = {
  name: "",
  short_code: "",
  category: "Other",
  estimated_value_cents_per_point: "",
  value_unit: "cents_per_point",
  eligible_for_credit_cards: true,
  transferable: false,
  active: true,
  notes: "",
};

const emptyProtection: RewardProgramProtection = {
  linked_card_count: 0,
  linked_payment_count: 0,
  linked_rule_count: 0,
  ledger_entry_count: 0,
  linked_store_count: 0,
  system_default: false,
  protected: false,
  can_delete: false,
  can_deactivate: false,
  protection_reasons: [],
};

function withDefaultProtection(program: RewardProgram): RewardProgram {
  return {
    ...emptyProtection,
    ...program,
    protection_reasons: program.protection_reasons ?? [],
  };
}

function formFromProgram(program: RewardProgram): RewardProgramForm {
  return {
    name: program.name,
    short_code: program.short_code,
    category: program.category,
    estimated_value_cents_per_point:
      program.estimated_value_cents_per_point === null
        ? ""
        : String(program.estimated_value_cents_per_point),
    value_unit: program.value_unit || "cents_per_point",
    eligible_for_credit_cards: program.eligible_for_credit_cards,
    transferable: program.transferable,
    active: program.active,
    notes: program.notes ?? "",
  };
}

function formatValue(value: string | number | null, unit: string | null) {
  if (value === null || value === "") {
    return "-";
  }

  const label =
    valueUnits.find(([valueUnit]) => valueUnit === unit)?.[1] ?? "Cents per point";
  if (unit === "variable") {
    return "Variable";
  }
  return `${Number(value).toFixed(2)} ${label.toLowerCase()}`;
}

function filterLabel(filter: string) {
  if (filter === "inactive") {
    return "Inactive";
  }
  if (filter === "all") {
    return "All";
  }
  return "Active";
}

function defaultCreditCardEligibility(category: string) {
  return [
    "Cashback",
    "Transferable Points",
    "Airline Miles",
    "Hotel Points",
    "Crypto",
  ].includes(category);
}

function protectionSummary(program: RewardProgram) {
  if (program.system_default) {
    return "System default programs can be deactivated but not deleted.";
  }

  if (program.protection_reasons.length > 0) {
    return program.protection_reasons.join("; ");
  }

  return "Protected programs can be deactivated but not deleted.";
}

function formatApiDetail(detail: unknown, fallback: string) {
  if (typeof detail === "string") {
    return detail;
  }
  if (
    detail &&
    typeof detail === "object" &&
    "message" in detail &&
    typeof detail.message === "string"
  ) {
    const reasons =
      "reasons" in detail && Array.isArray(detail.reasons)
        ? ` ${detail.reasons.join("; ")}`
        : "";
    return `${detail.message}${reasons}`;
  }
  return fallback;
}

function parseApiBody(bodyText: string) {
  if (!bodyText) {
    return null;
  }

  try {
    return JSON.parse(bodyText) as { detail?: unknown };
  } catch {
    return null;
  }
}

function apiErrorMessage(endpoint: string, status: number, bodyText: string) {
  const parsedBody = parseApiBody(bodyText);
  const detail = parsedBody?.detail;
  return `Request failed: ${endpoint} (${status}). Response body: ${
    bodyText || formatApiDetail(detail, "No response body")
  }`;
}

function duplicateDetailFromBody(bodyText: string): DuplicateProgramDetail | null {
  const detail = parseApiBody(bodyText)?.detail;
  if (
    detail &&
    typeof detail === "object" &&
    "code" in detail &&
    detail.code === "reward_program_duplicate" &&
    "existing_program_id" in detail &&
    typeof detail.existing_program_id === "number" &&
    "existing_program_status" in detail &&
    (detail.existing_program_status === "active" ||
      detail.existing_program_status === "inactive") &&
    "message" in detail &&
    typeof detail.message === "string" &&
    "duplicate_field" in detail &&
    typeof detail.duplicate_field === "string"
  ) {
    return detail as DuplicateProgramDetail;
  }
  return null;
}

export default function RewardProgramsPage() {
  const [programs, setPrograms] = useState<RewardProgram[]>([]);
  const [categories, setCategories] = useState(fallbackCategories);
  const [form, setForm] = useState<RewardProgramForm>(emptyForm);
  const [editingProgram, setEditingProgram] = useState<RewardProgram | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [duplicateProgram, setDuplicateProgram] =
    useState<DuplicateProgramDetail | null>(null);
  const [filter, setFilter] = useState("active");
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingProtection, setIsLoadingProtection] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const visiblePrograms = useMemo(
    () =>
      programs.filter((program) => {
        if (filter === "active") {
          return program.active;
        }
        if (filter === "inactive") {
          return !program.active;
        }
        return true;
      }),
    [filter, programs],
  );
  const activeCount = useMemo(
    () => programs.filter((program) => program.active).length,
    [programs],
  );
  const inactiveCount = programs.length - activeCount;

  async function loadPrograms() {
    setIsLoading(true);
    setError(null);

    try {
      const programsEndpoint = `${API_BASE_URL}/reward-programs/?include_protection=true`;
      const categoriesEndpoint = `${API_BASE_URL}/reward-program-categories/`;
      const [response, categoriesResponse] = await Promise.all([
        fetch(programsEndpoint),
        fetch(categoriesEndpoint),
      ]);

      if (!response.ok) {
        const body = await response.text();
        throw new Error(
          `Failed to load reward programs from ${programsEndpoint} (${response.status}): ${
            body || response.statusText
          }`,
        );
      }
      if (!categoriesResponse.ok) {
        const body = await categoriesResponse.text();
        throw new Error(
          `Failed to load reward program categories from ${categoriesEndpoint} (${categoriesResponse.status}): ${
            body || categoriesResponse.statusText
          }`,
        );
      }

      const loadedPrograms = (await response.json()) as RewardProgram[];
      setPrograms(loadedPrograms.map(withDefaultProtection));
      const loadedCategories =
        (await categoriesResponse.json()) as RewardProgramCategory[];
      setCategories(
        loadedCategories
          .filter((category) => category.active)
          .map((category) => category.name),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load reward programs.");
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    queueMicrotask(() => {
      void loadPrograms();
    });
  }, []);

  async function loadProgramProtection(
    programId: number,
    options: { throwOnError?: boolean } = {},
  ) {
    const endpoint = `${API_BASE_URL}/reward-programs/${programId}/protection`;
    setIsLoadingProtection(true);

    try {
      const response = await fetch(endpoint);
      const bodyText = await response.text();
      if (!response.ok) {
        throw new Error(apiErrorMessage(endpoint, response.status, bodyText));
      }

      const protection = JSON.parse(bodyText) as RewardProgramProtection;
      setPrograms((currentPrograms) =>
        currentPrograms.map((program) =>
          program.id === programId ? { ...program, ...protection } : program,
        ),
      );
      setEditingProgram((currentProgram) =>
        currentProgram?.id === programId
          ? { ...currentProgram, ...protection }
          : currentProgram,
      );
      return protection;
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : "Failed to load reward program dependency details.";
      setError(message);
      if (options.throwOnError) {
        throw err;
      }
      return null;
    } finally {
      setIsLoadingProtection(false);
    }
  }

  function startEdit(program: RewardProgram) {
    const programWithProtectionDefaults = withDefaultProtection(program);
    setEditingProgram(programWithProtectionDefaults);
    setDuplicateProgram(null);
    setForm(formFromProgram(programWithProtectionDefaults));
    setError(null);
    setMessage(null);
    setIsModalOpen(true);
    void loadProgramProtection(program.id);
  }

  function openCreate() {
    setEditingProgram(null);
    setDuplicateProgram(null);
    setForm(emptyForm);
    setError(null);
    setMessage(null);
    setIsModalOpen(true);
  }

  function resetForm() {
    setEditingProgram(null);
    setDuplicateProgram(null);
    setForm(emptyForm);
    setIsModalOpen(false);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSaving(true);
    setError(null);
    setMessage(null);
    setDuplicateProgram(null);

    const payload = {
      name: form.name.trim(),
      short_code: form.short_code.trim().toUpperCase(),
      category: form.category,
      estimated_value_cents_per_point:
        form.estimated_value_cents_per_point === ""
          ? null
          : form.estimated_value_cents_per_point,
      value_unit: form.value_unit,
      eligible_for_credit_cards: form.eligible_for_credit_cards,
      transferable: form.transferable,
      active: form.active,
      notes: form.notes.trim() || null,
    };
    const endpoint = editingProgram
      ? `${API_BASE_URL}/reward-programs/${editingProgram.id}`
      : `${API_BASE_URL}/reward-programs/`;

    try {
      const response = await fetch(endpoint, {
        method: editingProgram ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const bodyText = await response.text();
        const duplicateDetail = duplicateDetailFromBody(bodyText);
        if (response.status === 409 && duplicateDetail) {
          setDuplicateProgram(duplicateDetail);
        }
        throw new Error(apiErrorMessage(endpoint, response.status, bodyText));
      }

      const savedProgram = withDefaultProtection((await response.json()) as RewardProgram);
      setMessage(editingProgram ? "Reward program updated." : "Reward program added.");
      setEditingProgram(savedProgram);
      setForm(formFromProgram(savedProgram));
      setIsModalOpen(false);
      await loadPrograms();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save reward program.");
    } finally {
      setIsSaving(false);
    }
  }

  async function reactivateDuplicateProgram() {
    if (!duplicateProgram) {
      return;
    }

    setIsSaving(true);
    setError(null);
    setMessage(null);

    const endpoint = `${API_BASE_URL}/reward-programs/${duplicateProgram.existing_program_id}`;
    const payload = {
      name: form.name.trim(),
      short_code: form.short_code.trim().toUpperCase(),
      category: form.category,
      estimated_value_cents_per_point:
        form.estimated_value_cents_per_point === ""
          ? null
          : form.estimated_value_cents_per_point,
      value_unit: form.value_unit,
      eligible_for_credit_cards: form.eligible_for_credit_cards,
      transferable: form.transferable,
      active: true,
      notes: form.notes.trim() || null,
    };

    try {
      const response = await fetch(endpoint, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const bodyText = await response.text();
        throw new Error(apiErrorMessage(endpoint, response.status, bodyText));
      }

      const savedProgram = withDefaultProtection((await response.json()) as RewardProgram);
      setMessage("Existing reward program reactivated.");
      setDuplicateProgram(null);
      setEditingProgram(savedProgram);
      setForm(formFromProgram(savedProgram));
      await loadPrograms();
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Failed to reactivate existing reward program.",
      );
    } finally {
      setIsSaving(false);
    }
  }

  async function setProgramActive(
    program: RewardProgram,
    active: boolean,
    showActiveAfter = false,
  ) {
    setError(null);
    setMessage(null);

    const endpoint = `${API_BASE_URL}/reward-programs/${program.id}`;

    try {
      const response = await fetch(endpoint, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ active }),
      });

      if (!response.ok) {
        const bodyText = await response.text();
        throw new Error(apiErrorMessage(endpoint, response.status, bodyText));
      }

      await response.json();
      setMessage(active ? "Reward program reactivated." : "Reward program deactivated.");
      if (showActiveAfter && active) {
        setFilter("active");
      }
      await loadPrograms();
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : active
            ? "Failed to reactivate reward program."
            : "Failed to deactivate reward program.",
      );
    }
  }

  async function updateEditingProgramActive(active: boolean, showActiveAfter = false) {
    if (!editingProgram) {
      return;
    }

    await setProgramActive(editingProgram, active, showActiveAfter);
    resetForm();
  }

  async function deleteProgram(program: RewardProgram) {
    setError(null);
    setMessage(null);

    try {
      const response = await fetch(`${API_BASE_URL}/reward-programs/${program.id}`, {
        method: "DELETE",
      });

      if (!response.ok) {
        const bodyText = await response.text();
        throw new Error(
          apiErrorMessage(
            `${API_BASE_URL}/reward-programs/${program.id}`,
            response.status,
            bodyText,
          ),
        );
      }

      setMessage("Reward program permanently deleted.");
      resetForm();
      await loadPrograms();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete reward program.");
    }
  }

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-6 text-slate-950 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-6xl space-y-5">
        <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <Link
              className="inline-flex h-9 cursor-pointer items-center rounded-md border border-slate-300 px-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-100"
              href="/settings"
            >
              Back to Settings
            </Link>
            <p className="mt-4 text-sm font-medium text-slate-500">
              Settings / Reward Programs
            </p>
            <h1 className="mt-1 text-3xl font-semibold tracking-tight">
              Reward Programs
            </h1>
          </div>
          <button
            className="h-10 rounded-md bg-slate-950 px-4 text-sm font-semibold text-white hover:bg-slate-800"
            onClick={openCreate}
            type="button"
          >
            Add Program
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

        <section className="grid gap-3 sm:grid-cols-3">
          {[
            ["active", "Active programs", activeCount],
            ["inactive", "Inactive programs", inactiveCount],
            ["all", "Total programs", programs.length],
          ].map(([value, label, count]) => (
            <button
              className={`rounded-lg border p-4 text-left shadow-sm transition ${
                filter === value
                  ? "border-slate-950 bg-slate-950 text-white"
                  : "border-slate-200 bg-white text-slate-950 hover:border-slate-400 hover:bg-slate-50"
              }`}
              key={label}
              onClick={() => setFilter(String(value))}
              type="button"
            >
              <p
                className={`text-xs font-semibold uppercase tracking-wide ${
                  filter === value ? "text-slate-300" : "text-slate-500"
                }`}
              >
                {label}
              </p>
              <p className="mt-1 text-2xl font-semibold">
                {count}
              </p>
            </button>
          ))}
        </section>

        <section className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-200 px-5 py-4">
              <div>
                <h2 className="text-lg font-semibold">Programs</h2>
                <p className="mt-1 text-xs text-slate-500">
                  Active controls whether a program can be used. Credit card
                  setup eligibility only controls card dropdown visibility.
                </p>
                <p className="mt-2 text-sm font-semibold text-slate-700">
                  Showing {filterLabel(filter).toLowerCase()} programs
                </p>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-slate-200 text-sm">
                <thead className="bg-slate-100 text-left text-xs font-semibold uppercase tracking-wide text-slate-600">
                  <tr>
                    <th className="px-4 py-3">Program</th>
                    <th className="px-4 py-3">Code</th>
                    <th className="px-4 py-3">Category</th>
                    <th className="px-4 py-3">Value</th>
                    <th className="px-4 py-3">Active</th>
                    <th className="px-4 py-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {isLoading ? (
                    <tr>
                      <td className="px-4 py-6 text-slate-500" colSpan={6}>
                        Loading...
                      </td>
                    </tr>
                  ) : visiblePrograms.length === 0 ? (
                    <tr>
                      <td className="px-4 py-6 text-slate-500" colSpan={6}>
                        {filter === "inactive"
                          ? "No inactive programs."
                          : `No ${filterLabel(filter).toLowerCase()} reward programs found.`}
                      </td>
                    </tr>
                  ) : visiblePrograms.map((program) => (
                    <tr
                      className={
                        program.active
                          ? "bg-white"
                          : "bg-slate-50 text-slate-500"
                      }
                      key={program.id}
                    >
                      <td className="px-4 py-3 font-medium">
                        <div>{program.name}</div>
                        <div className="mt-1 flex flex-wrap gap-1 text-[11px] font-semibold">
                          <span
                            className={`rounded-full px-2 py-0.5 ${
                              program.active
                                ? "bg-emerald-100 text-emerald-700"
                                : "bg-slate-200 text-slate-600"
                            }`}
                          >
                            {program.active ? "Active" : "Inactive"}
                          </span>
                          {program.protected ? (
                            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-amber-700">
                              Protected
                            </span>
                          ) : null}
                        </div>
                        {!program.active && program.protected ? (
                          <p className="mt-1 max-w-xs text-xs font-normal text-slate-500">
                            {protectionSummary(program)}
                          </p>
                        ) : null}
                      </td>
                      <td className="px-4 py-3">{program.short_code}</td>
                      <td className="px-4 py-3">{program.category}</td>
                      <td className="px-4 py-3">
                        {formatValue(program.estimated_value_cents_per_point, program.value_unit)}
                      </td>
                      <td className="px-4 py-3">{program.active ? "Active" : "Inactive"}</td>
                      <td className="px-4 py-3">
                        <div className="flex justify-end gap-2">
                          <button
                            className="h-9 rounded-md border border-slate-300 px-3 text-xs font-semibold"
                            onClick={() => startEdit(program)}
                            type="button"
                          >
                            Edit
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        {isModalOpen ? (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4">
            <form
              className="max-h-[90vh] w-full max-w-xl space-y-4 overflow-y-auto rounded-lg bg-white p-5 shadow-xl"
              id="reward-program-settings-form"
              onSubmit={handleSubmit}
            >
              <div className="flex items-start justify-between gap-4 border-b border-slate-200 pb-4">
                <div>
                  <h2 className="text-lg font-semibold">
                    {editingProgram ? "Edit Program" : "Add Program"}
                  </h2>
                  <p className="mt-1 text-xs text-slate-500">
                    Configure reward program setup and dropdown eligibility.
                  </p>
                </div>
                <div className="flex shrink-0 gap-2">
                  <button
                    className="h-9 rounded-md border border-slate-300 px-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-100 disabled:opacity-60"
                    disabled={isSaving}
                    onClick={resetForm}
                    type="button"
                  >
                    Cancel
                  </button>
                  <button
                    className="h-9 rounded-md bg-slate-950 px-3 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:opacity-60"
                    disabled={isSaving}
                    form="reward-program-settings-form"
                    type="submit"
                  >
                    {isSaving ? "Saving..." : "Save"}
                  </button>
                </div>
              </div>

              {editingProgram ? (
                <div className="rounded-md border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">
                  <p className="font-semibold text-slate-800">
                    Status: {editingProgram.active ? "Active" : "Inactive"}
                  </p>
                  <p className="mt-1">
                    {editingProgram.active
                      ? "Active programs can be selected where they are eligible."
                      : "Inactive programs are hidden from setup dropdowns but remain visible with the Inactive or All filters."}
                  </p>
                  <p className="mt-1">
                    Credit card setup:{" "}
                    {editingProgram.eligible_for_credit_cards
                      ? "Eligible"
                      : "Not eligible"}
                  </p>
                </div>
              ) : null}

              <label className="block space-y-2 text-sm font-medium text-slate-700">
                <span>Name</span>
                <input
                  className="h-11 w-full rounded-md border border-slate-300 px-3"
                  onChange={(event) => setForm({ ...form, name: event.target.value })}
                  required
                  value={form.name}
                />
              </label>
              <label className="block space-y-2 text-sm font-medium text-slate-700">
                <span>Code</span>
                <input
                  className="h-11 w-full rounded-md border border-slate-300 px-3 uppercase"
                  onChange={(event) =>
                    setForm({ ...form, short_code: event.target.value })
                  }
                  required
                  value={form.short_code}
                />
              </label>
              <label className="block space-y-2 text-sm font-medium text-slate-700">
                <span>Category</span>
                <select
                  className="h-11 w-full rounded-md border border-slate-300 px-3"
                  onChange={(event) => {
                    const category = event.target.value;
                    setForm({
                      ...form,
                      category,
                      eligible_for_credit_cards:
                        defaultCreditCardEligibility(category),
                    });
                  }}
                  value={form.category}
                >
                  {categories.map((category) => (
                    <option key={category} value={category}>
                      {category}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block space-y-2 text-sm font-medium text-slate-700">
                <span>Estimated Value</span>
                <input
                  className="h-11 w-full rounded-md border border-slate-300 px-3"
                  min="0"
                  onChange={(event) =>
                    setForm({
                      ...form,
                      estimated_value_cents_per_point: event.target.value,
                    })
                  }
                  step="0.01"
                  type="number"
                  value={form.estimated_value_cents_per_point}
                />
              </label>
              <label className="block space-y-2 text-sm font-medium text-slate-700">
                <span>Value Unit</span>
                <select
                  className="h-11 w-full rounded-md border border-slate-300 px-3"
                  onChange={(event) =>
                    setForm({ ...form, value_unit: event.target.value })
                  }
                  value={form.value_unit}
                >
                  {valueUnits.map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex h-10 items-center gap-2 text-sm font-medium text-slate-700">
                <input
                  checked={form.transferable}
                  onChange={(event) =>
                    setForm({ ...form, transferable: event.target.checked })
                  }
                  type="checkbox"
                />
                Transferable
              </label>
              <div className="space-y-1">
                <label className="flex min-h-10 items-center gap-2 text-sm font-medium text-slate-700">
                  <input
                    checked={form.eligible_for_credit_cards}
                    onChange={(event) =>
                      setForm({
                        ...form,
                        eligible_for_credit_cards: event.target.checked,
                      })
                    }
                    type="checkbox"
                  />
                  Eligible for credit card setup
                </label>
                <p className="text-xs text-slate-500">
                  Disable if this program should not appear in credit card reward
                  program selections.
                </p>
              </div>
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

              {duplicateProgram ? (
                <div className="space-y-3 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                  <p className="font-semibold">{duplicateProgram.message}</p>
                  {duplicateProgram.existing_program ? (
                    <p>
                      Existing record: {duplicateProgram.existing_program.name} (
                      {duplicateProgram.existing_program.short_code}) is{" "}
                      {duplicateProgram.existing_program.active ? "active" : "inactive"}.
                    </p>
                  ) : null}
                  {duplicateProgram.existing_program_status === "inactive" ? (
                    <button
                      className="h-10 rounded-md bg-amber-900 px-3 text-sm font-semibold text-white transition hover:bg-amber-800 disabled:opacity-60"
                      disabled={isSaving}
                      onClick={() => void reactivateDuplicateProgram()}
                      type="button"
                    >
                      Reactivate Existing Program
                    </button>
                  ) : null}
                </div>
              ) : null}

              {editingProgram ? (
                <div className="space-y-3 rounded-md border border-slate-200 bg-slate-50 p-3">
                  {isLoadingProtection ? (
                    <p className="text-xs font-semibold text-slate-600">
                      Checking linked cards, stores, payments, and reward history...
                    </p>
                  ) : null}
                  {editingProgram.protection_reasons.length > 0 ? (
                    <div className="space-y-1 text-xs text-slate-600">
                      <p className="font-semibold text-slate-700">
                        Deletion is blocked because this program is protected.
                      </p>
                      {editingProgram.protection_reasons.map((reason) => (
                        <p key={reason}>{reason}</p>
                      ))}
                    </div>
                  ) : (
                    <p className="text-xs text-slate-600">
                      This program is not linked to cards, rules, stores, payments, or reward history.
                    </p>
                  )}
                  <div className="grid gap-2">
                    {editingProgram.active ? (
                      <button
                        className="h-10 w-full rounded-md border border-amber-200 px-3 text-sm font-semibold text-amber-700 transition hover:bg-amber-50"
                        onClick={() => void updateEditingProgramActive(false)}
                        type="button"
                      >
                        Deactivate Program
                      </button>
                    ) : (
                      <button
                        className="h-10 w-full rounded-md border border-emerald-200 px-3 text-sm font-semibold text-emerald-700 transition hover:bg-emerald-50"
                        onClick={() => void updateEditingProgramActive(true, true)}
                        type="button"
                      >
                        Reactivate Program
                      </button>
                    )}
                  </div>
                  {editingProgram.can_delete ? (
                    <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
                      <p className="text-sm font-semibold text-slate-800">
                        Record cleanup
                      </p>
                      <p className="mt-1 text-xs text-slate-500">
                        Deletes if unused. Protected or referenced programs cannot be deleted.
                      </p>
                      <button
                        className="mt-3 h-10 w-full rounded-md border border-red-200 px-3 text-sm font-semibold text-red-700 transition hover:bg-red-100"
                        onClick={() => void deleteProgram(editingProgram)}
                        type="button"
                      >
                        Delete Program Permanently
                      </button>
                    </div>
                  ) : null}
                </div>
              ) : null}
            </form>
          </div>
        ) : null}
      </div>
    </main>
  );
}
