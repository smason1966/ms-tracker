"use client";

import Link from "next/link";
import { FormEvent, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";

import { API_BASE_URL } from "@/lib/api";

type CardBrand = {
  id: number;
  name: string;
  active: boolean;
  supports_barcode: boolean;
  supports_magstripe: boolean;
  supports_ocr_template: boolean;
  parser_type: string | null;
  parsing_profile: string | null;
  notes: string | null;
  magstripe_parser_type: string | null;
  magstripe_parser_notes: string | null;
  sample_magstripe_data: string | null;
  card_number_regex: string | null;
  pin_regex: string | null;
  pin_label_keywords: string | null;
  expected_pin_length: number | null;
  card_number_source_priority: string | null;
  pin_spatial_rule: string | null;
  gift_code_regex: string | null;
  gift_code_prefixes: string | null;
  gift_code_expected_length: number | null;
  gift_code_normalization: string | null;
  ocr_confusion_map: string | null;
  ocr_orientation_preference: string | null;
  credential_type: string | null;
  ocr_zones: string | null;
};

type CardBrandForm = {
  name: string;
  active: boolean;
  supports_barcode: boolean;
  supports_magstripe: boolean;
  supports_ocr_template: boolean;
  parser_type: string;
  parsing_profile: string;
  notes: string;
  magstripe_parser_type: string;
  magstripe_parser_notes: string;
  sample_magstripe_data: string;
  card_number_regex: string;
  pin_regex: string;
  pin_label_keywords: string;
  expected_pin_length: string;
  card_number_source_priority: string;
  pin_spatial_rule: string;
  gift_code_regex: string;
  gift_code_prefixes: string;
  gift_code_expected_length: string;
  gift_code_normalization: string;
  ocr_confusion_map: string;
  ocr_orientation_preference: string;
  credential_type: string;
  ocr_zones: string;
};

const emptyForm: CardBrandForm = {
  name: "",
  active: true,
  supports_barcode: true,
  supports_magstripe: false,
  supports_ocr_template: true,
  parser_type: "",
  parsing_profile: "",
  notes: "",
  magstripe_parser_type: "",
  magstripe_parser_notes: "",
  sample_magstripe_data: "",
  card_number_regex: "",
  pin_regex: "",
  pin_label_keywords: "",
  expected_pin_length: "",
  card_number_source_priority: "",
  pin_spatial_rule: "",
  gift_code_regex: "",
  gift_code_prefixes: "",
  gift_code_expected_length: "",
  gift_code_normalization: "",
  ocr_confusion_map: "",
  ocr_orientation_preference: "auto",
  credential_type: "",
  ocr_zones: "",
};

function brandToForm(brand: CardBrand): CardBrandForm {
  return {
    name: brand.name,
    active: brand.active,
    supports_barcode: brand.supports_barcode ?? false,
    supports_magstripe: brand.supports_magstripe ?? false,
    supports_ocr_template: brand.supports_ocr_template ?? false,
    parser_type: brand.parser_type ?? "",
    parsing_profile: brand.parsing_profile ?? "",
    notes: brand.notes ?? "",
    magstripe_parser_type: brand.magstripe_parser_type ?? "",
    magstripe_parser_notes: brand.magstripe_parser_notes ?? "",
    sample_magstripe_data: brand.sample_magstripe_data ?? "",
    card_number_regex: brand.card_number_regex ?? "",
    pin_regex: brand.pin_regex ?? "",
    pin_label_keywords: brand.pin_label_keywords ?? "",
    expected_pin_length: brand.expected_pin_length?.toString() ?? "",
    card_number_source_priority: brand.card_number_source_priority ?? "",
    pin_spatial_rule: brand.pin_spatial_rule ?? "",
    gift_code_regex: brand.gift_code_regex ?? "",
    gift_code_prefixes: brand.gift_code_prefixes ?? "",
    gift_code_expected_length: brand.gift_code_expected_length?.toString() ?? "",
    gift_code_normalization: brand.gift_code_normalization ?? "",
    ocr_confusion_map: brand.ocr_confusion_map ?? "",
    ocr_orientation_preference: brand.ocr_orientation_preference ?? "auto",
    credential_type: brand.credential_type ?? "",
    ocr_zones: brand.ocr_zones ?? "",
  };
}

function filterLabel(filter: string) {
  if (filter === "inactive") {
    return "inactive";
  }
  if (filter === "all") {
    return "all";
  }
  return "active";
}

async function apiErrorMessage(
  endpoint: string,
  method: string,
  response: Response,
) {
  const bodyText = await response.text();
  return `Request failed: ${method} ${endpoint} (${response.status}). Response body: ${
    bodyText || response.statusText || "No response body"
  }`;
}

function AdvancedSection({
  children,
  defaultOpen = false,
  description,
  title,
}: {
  children: ReactNode;
  defaultOpen?: boolean;
  description: string;
  title: string;
}) {
  return (
    <details
      className="rounded-lg border border-slate-200 bg-slate-50 p-4"
      open={defaultOpen}
    >
      <summary className="cursor-pointer text-sm font-semibold text-slate-900">
        {title}
      </summary>
      <p className="mt-1 text-xs text-slate-500">{description}</p>
      <div className="mt-4 space-y-4">{children}</div>
    </details>
  );
}

export default function CardBrandsPage() {
  const [brands, setBrands] = useState<CardBrand[]>([]);
  const [editingBrand, setEditingBrand] = useState<CardBrand | null>(null);
  const [form, setForm] = useState<CardBrandForm>(emptyForm);
  const [filter, setFilter] = useState("active");
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const visibleBrands = useMemo(
    () =>
      brands.filter((brand) => {
        if (filter === "active") {
          return brand.active;
        }
        if (filter === "inactive") {
          return !brand.active;
        }
        return true;
      }),
    [brands, filter],
  );
  const activeCount = useMemo(
    () => brands.filter((brand) => brand.active).length,
    [brands],
  );
  const inactiveCount = brands.length - activeCount;

  async function loadBrands() {
    setIsLoading(true);
    setError(null);

    try {
      const endpoint = `${API_BASE_URL}/card-brands/`;
      const response = await fetch(endpoint);

      if (!response.ok) {
        throw new Error(await apiErrorMessage(endpoint, "GET", response));
      }

      setBrands((await response.json()) as CardBrand[]);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to load card brands.",
      );
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      void loadBrands();
    }, 0);

    return () => window.clearTimeout(timeoutId);
  }, []);

  function openCreate() {
    setEditingBrand(null);
    setForm(emptyForm);
    setIsModalOpen(true);
  }

  function openEdit(brand: CardBrand) {
    setEditingBrand(brand);
    setForm(brandToForm(brand));
    setIsModalOpen(true);
  }

  async function saveBrand(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSaving(true);
    setError(null);

    try {
      const endpoint = editingBrand
        ? `${API_BASE_URL}/card-brands/${editingBrand.id}`
        : `${API_BASE_URL}/card-brands/`;
      const method = editingBrand ? "PATCH" : "POST";
      const response = await fetch(endpoint, {
          method,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: form.name.trim(),
            active: form.active,
            supports_barcode: form.supports_barcode,
            supports_magstripe: form.supports_magstripe,
            supports_ocr_template: form.supports_ocr_template,
            parser_type: form.parser_type.trim() || null,
            parsing_profile: form.parsing_profile.trim() || null,
            notes: form.notes.trim() || null,
            magstripe_parser_type: form.supports_magstripe
              ? form.magstripe_parser_type.trim() || null
              : null,
            magstripe_parser_notes: form.supports_magstripe
              ? form.magstripe_parser_notes.trim() || null
              : null,
            sample_magstripe_data: form.supports_magstripe
              ? form.sample_magstripe_data.trim() || null
              : null,
            card_number_regex: form.card_number_regex.trim() || null,
            pin_regex: form.pin_regex.trim() || null,
            pin_label_keywords: form.pin_label_keywords.trim() || null,
            expected_pin_length:
              form.expected_pin_length.trim() === ""
                ? null
                : Number(form.expected_pin_length),
            card_number_source_priority:
              form.card_number_source_priority.trim() || null,
            pin_spatial_rule: form.pin_spatial_rule.trim() || null,
            gift_code_regex: form.gift_code_regex.trim() || null,
            gift_code_prefixes: form.gift_code_prefixes.trim() || null,
            gift_code_expected_length:
              form.gift_code_expected_length.trim() === ""
                ? null
                : Number(form.gift_code_expected_length),
            gift_code_normalization: form.gift_code_normalization.trim() || null,
            ocr_confusion_map: form.ocr_confusion_map.trim() || null,
            ocr_orientation_preference:
              form.ocr_orientation_preference.trim() || "auto",
            credential_type: form.credential_type.trim() || null,
            ocr_zones: form.ocr_zones.trim() || null,
          }),
        });

      if (!response.ok) {
        throw new Error(await apiErrorMessage(endpoint, method, response));
      }

      setIsModalOpen(false);
      setMessage(editingBrand ? "Card brand updated." : "Card brand added.");
      await loadBrands();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to save card brand.",
      );
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-8 text-slate-950 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-7xl space-y-6">
        <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <Link
              className="mb-3 inline-flex h-8 cursor-pointer items-center rounded-md border border-slate-300 px-3 text-xs font-semibold text-slate-700 transition hover:bg-slate-100 active:bg-slate-200"
              href="/settings"
            >
              Back to Settings
            </Link>
            <p className="text-sm font-medium uppercase tracking-wide text-slate-500">
              Settings / Card Brands
            </p>
            <h1 className="mt-1 text-3xl font-semibold tracking-tight">
              Card Brands
            </h1>
            <p className="mt-2 max-w-2xl text-sm text-slate-600">
              Track barcode support, OCR parsing rules, and future magnetic
              stripe parser metadata.
            </p>
          </div>
          <button
            className="h-11 cursor-pointer rounded-md bg-slate-950 px-4 text-sm font-semibold text-white hover:bg-slate-800"
            onClick={openCreate}
            type="button"
          >
            Add Brand
          </button>
        </header>

        {error ? (
          <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-800">
            {error}
          </div>
        ) : null}
        {message ? (
          <div className="rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-800">
            {message}
          </div>
        ) : null}

        <section className="grid gap-3 sm:grid-cols-3">
          {[
            ["active", "Active Brands", activeCount],
            ["inactive", "Inactive Brands", inactiveCount],
            ["all", "Total Brands", brands.length],
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
              <p className="mt-1 text-2xl font-semibold">{count}</p>
            </button>
          ))}
        </section>

        {isLoading ? (
          <section className="rounded-lg border border-slate-200 bg-white p-8 text-center text-sm text-slate-500 shadow-sm">
            Loading card brands...
          </section>
        ) : null}

        {!isLoading && brands.length === 0 ? (
          <section className="rounded-lg border border-dashed border-slate-300 bg-white p-8 text-center shadow-sm">
            <h2 className="text-lg font-semibold">No card brands yet</h2>
            <p className="mt-2 text-sm text-slate-500">
              Add brands to power intake dropdowns and future parser behavior.
            </p>
            <button
              className="mt-4 h-11 rounded-md bg-slate-950 px-4 text-sm font-semibold text-white"
              onClick={openCreate}
              type="button"
            >
              Add Brand
            </button>
          </section>
        ) : null}

        {brands.length > 0 ? (
          <section className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-200 px-5 py-4">
              <h2 className="text-lg font-semibold">Brands</h2>
              <p className="mt-1 text-sm font-semibold text-slate-700">
                Showing {filterLabel(filter)} brands
              </p>
            </div>
            <table className="min-w-full divide-y divide-slate-200 text-sm">
              <thead className="bg-slate-100 text-left text-xs font-semibold uppercase tracking-wide text-slate-600">
                <tr>
                  <th className="px-4 py-3">Brand</th>
                  <th className="px-4 py-3">Barcode</th>
                  <th className="px-4 py-3">OCR</th>
                  <th className="px-4 py-3">Magstripe</th>
                  <th className="px-4 py-3">Parser</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {visibleBrands.length === 0 ? (
                  <tr>
                    <td className="px-4 py-6 text-slate-500" colSpan={7}>
                      {filter === "inactive"
                        ? "No inactive card brands."
                        : `No ${filterLabel(filter)} card brands found.`}
                    </td>
                  </tr>
                ) : visibleBrands.map((brand) => (
                  <tr
                    className={brand.active ? "bg-white" : "bg-slate-50 text-slate-500"}
                    key={brand.id}
                  >
                    <td className="px-4 py-3 font-semibold">{brand.name}</td>
                    <td className="px-4 py-3">
                      {brand.supports_barcode ? "Supported" : "No"}
                    </td>
                    <td className="px-4 py-3">
                      {brand.supports_ocr_template ? "Supported" : "No"}
                    </td>
                    <td className="px-4 py-3">
                      {brand.supports_magstripe ? "Supported" : "No"}
                    </td>
                    <td className="px-4 py-3 text-slate-600">
                      {brand.parser_type ||
                      brand.parsing_profile ||
                      brand.card_number_regex ||
                      brand.pin_regex
                        ? "Parsing rules"
                        : brand.magstripe_parser_type ?? ""}
                      {brand.parsing_profile ? (
                        <span className="ml-2 text-xs text-slate-400">
                          {brand.parsing_profile}
                        </span>
                      ) : null}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`rounded-full px-2 py-1 text-xs font-semibold ${
                          brand.active
                            ? "bg-emerald-100 text-emerald-800"
                            : "bg-slate-100 text-slate-600"
                        }`}
                      >
                        {brand.active ? "Active" : "Inactive"}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        className="h-9 rounded-md border border-slate-300 px-3 text-sm font-semibold hover:bg-slate-100"
                        onClick={() => openEdit(brand)}
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
        <CardBrandModal
          editingBrand={editingBrand}
          form={form}
          isSaving={isSaving}
          setForm={setForm}
          onClose={() => setIsModalOpen(false)}
          onSubmit={saveBrand}
        />
      ) : null}
    </main>
  );
}

function CardBrandModal({
  editingBrand,
  form,
  isSaving,
  setForm,
  onClose,
  onSubmit,
}: {
  editingBrand: CardBrand | null;
  form: CardBrandForm;
  isSaving: boolean;
  setForm: (form: CardBrandForm) => void;
  onClose: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center modal-backdrop p-4">
      <form
        className="max-h-[90vh] w-full max-w-2xl space-y-4 overflow-y-auto rounded-lg bg-white p-5 shadow-xl"
        id="card-brand-settings-form"
        onSubmit={onSubmit}
      >
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-xl font-semibold">
            {editingBrand ? "Edit Card Brand" : "Add Card Brand"}
          </h2>
          <div className="flex shrink-0 gap-2">
            <button
              className="h-9 rounded-md border border-slate-300 px-3 text-sm font-semibold hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60"
              disabled={isSaving}
              onClick={onClose}
              type="button"
            >
              Cancel
            </button>
            <button
              className="h-9 rounded-md bg-slate-950 px-3 text-sm font-semibold text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
              disabled={isSaving}
              form="card-brand-settings-form"
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

        <div className="grid gap-3 sm:grid-cols-4">
          <label className="flex items-center gap-2 text-sm font-medium text-slate-700">
            <input
              checked={form.active}
              onChange={(event) =>
                setForm({ ...form, active: event.target.checked })
              }
              type="checkbox"
            />
            Active
          </label>
          <label className="flex items-center gap-2 text-sm font-medium text-slate-700">
            <input
              checked={form.supports_barcode}
              onChange={(event) =>
                setForm({ ...form, supports_barcode: event.target.checked })
              }
              type="checkbox"
            />
            Supports barcode
          </label>
          <label className="flex items-center gap-2 text-sm font-medium text-slate-700">
            <input
              checked={form.supports_ocr_template}
              onChange={(event) =>
                setForm({
                  ...form,
                  supports_ocr_template: event.target.checked,
                })
              }
              type="checkbox"
            />
            OCR template eligible
          </label>
          <label className="flex items-center gap-2 text-sm font-medium text-slate-700">
            <input
              checked={form.supports_magstripe}
              onChange={(event) =>
                setForm({ ...form, supports_magstripe: event.target.checked })
              }
              type="checkbox"
            />
            Supports magnetic stripe
          </label>
        </div>

        <label className="block space-y-2 text-sm font-medium text-slate-700">
          <span>Notes</span>
          <textarea
            className="min-h-20 w-full rounded-md border border-slate-300 px-3 py-2"
            onChange={(event) =>
              setForm({
                ...form,
                notes: event.target.value,
              })
            }
            value={form.notes}
          />
        </label>

        {form.supports_magstripe ? (
          <AdvancedSection
            description="Optional magnetic stripe parsing metadata for brands that support swipes."
            title="Advanced Magstripe Settings"
          >
            <label className="block space-y-2 text-sm font-medium text-slate-700">
              <span>Magstripe Parser Type</span>
              <input
                className="h-11 w-full rounded-md border border-slate-300 px-3"
                onChange={(event) =>
                  setForm({
                    ...form,
                    magstripe_parser_type: event.target.value,
                  })
                }
                placeholder="generic_track2"
                value={form.magstripe_parser_type}
              />
            </label>
            <label className="block space-y-2 text-sm font-medium text-slate-700">
              <span>Parser Notes</span>
              <textarea
                className="min-h-24 w-full rounded-md border border-slate-300 px-3 py-2"
                onChange={(event) =>
                  setForm({
                    ...form,
                    magstripe_parser_notes: event.target.value,
                  })
                }
                value={form.magstripe_parser_notes}
              />
            </label>
            <label className="block space-y-2 text-sm font-medium text-slate-700">
              <span>Sample Magstripe Data</span>
              <textarea
                className="min-h-24 w-full rounded-md border border-slate-300 px-3 py-2 font-mono text-xs"
                onChange={(event) =>
                  setForm({
                    ...form,
                    sample_magstripe_data: event.target.value,
                  })
                }
                value={form.sample_magstripe_data}
              />
            </label>
          </AdvancedSection>
        ) : null}

        <AdvancedSection
          description="Optional OCR hints for card number and PIN detection. Use one capture group when possible."
          title="Advanced PIN/Card Number Detection"
        >
          <label className="block space-y-2 text-sm font-medium text-slate-700">
            <span>Card Number Regex</span>
            <textarea
              className="min-h-20 w-full rounded-md border border-slate-300 px-3 py-2 font-mono text-xs"
              onChange={(event) =>
                setForm({
                  ...form,
                  card_number_regex: event.target.value,
                })
              }
              placeholder="(?:CARD\\s*#?)[^\\d]{0,40}((?:\\d[\\s-]?){12,24})"
              value={form.card_number_regex}
            />
          </label>
          <label className="block space-y-2 text-sm font-medium text-slate-700">
            <span>PIN Regex</span>
            <textarea
              className="min-h-20 w-full rounded-md border border-slate-300 px-3 py-2 font-mono text-xs"
              onChange={(event) =>
                setForm({
                  ...form,
                  pin_regex: event.target.value,
                })
              }
              placeholder="(?:PIN|SECURITY\\s*CODE)[^\\d]{0,50}(\\d{6})"
              value={form.pin_regex}
            />
          </label>
          <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_160px]">
            <label className="block space-y-2 text-sm font-medium text-slate-700">
              <span>PIN Label Keywords</span>
              <input
                className="h-11 w-full rounded-md border border-slate-300 px-3"
                onChange={(event) =>
                  setForm({
                    ...form,
                    pin_label_keywords: event.target.value,
                  })
                }
                placeholder="PIN, Security Code, Scratch"
                value={form.pin_label_keywords}
              />
            </label>
            <label className="block space-y-2 text-sm font-medium text-slate-700">
              <span>Expected PIN Length</span>
              <input
                className="h-11 w-full rounded-md border border-slate-300 px-3"
                min="1"
                onChange={(event) =>
                  setForm({
                    ...form,
                    expected_pin_length: event.target.value,
                  })
                }
                type="number"
                value={form.expected_pin_length}
              />
            </label>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block space-y-2 text-sm font-medium text-slate-700">
              <span>Card Number Source Priority</span>
              <input
                className="h-11 w-full rounded-md border border-slate-300 px-3"
                onChange={(event) =>
                  setForm({
                    ...form,
                    card_number_source_priority: event.target.value,
                  })
                }
                placeholder="barcode,ocr"
                value={form.card_number_source_priority}
              />
            </label>
            <label className="block space-y-2 text-sm font-medium text-slate-700">
              <span>PIN Spatial Rule</span>
              <input
                className="h-11 w-full rounded-md border border-slate-300 px-3"
                onChange={(event) =>
                  setForm({
                    ...form,
                    pin_spatial_rule: event.target.value,
                  })
                }
                placeholder="four_digits_right_of_card_number"
              value={form.pin_spatial_rule}
            />
          </label>
          </div>
        </AdvancedSection>

        <AdvancedSection
          description="Brand-aware formats for alphanumeric redemption codes like Uber NAAD or DoorDash NAAW codes."
          title="Advanced Gift Code Template"
        >
          <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_160px]">
              <label className="block space-y-2 text-sm font-medium text-slate-700">
                <span>Gift Code Prefixes</span>
                <input
                  className="h-11 w-full rounded-md border border-slate-300 px-3"
                  onChange={(event) =>
                    setForm({
                      ...form,
                      gift_code_prefixes: event.target.value,
                    })
                  }
                  placeholder="NAAD, NAAW"
                  value={form.gift_code_prefixes}
                />
              </label>
              <label className="block space-y-2 text-sm font-medium text-slate-700">
                <span>Expected Code Length</span>
                <input
                  className="h-11 w-full rounded-md border border-slate-300 px-3"
                  min="1"
                  onChange={(event) =>
                    setForm({
                      ...form,
                      gift_code_expected_length: event.target.value,
                    })
                  }
                  type="number"
                  value={form.gift_code_expected_length}
                />
              </label>
          </div>
          <label className="block space-y-2 text-sm font-medium text-slate-700">
              <span>Gift Code Regex</span>
              <textarea
                className="min-h-20 w-full rounded-md border border-slate-300 px-3 py-2 font-mono text-xs"
                onChange={(event) =>
                  setForm({
                    ...form,
                    gift_code_regex: event.target.value,
                  })
                }
                placeholder="NAAD[\\s-]*[A-Z0-9]{4}[\\s-]*[A-Z0-9]{4}[\\s-]*[A-Z0-9]{4}"
              value={form.gift_code_regex}
            />
          </label>
          <div className="grid gap-3 sm:grid-cols-2">
              <label className="block space-y-2 text-sm font-medium text-slate-700">
                <span>Gift Code Normalization</span>
                <input
                  className="h-11 w-full rounded-md border border-slate-300 px-3"
                  onChange={(event) =>
                    setForm({
                      ...form,
                      gift_code_normalization: event.target.value,
                    })
                  }
                  placeholder="uppercase,remove_special_chars"
                  value={form.gift_code_normalization}
                />
              </label>
              <label className="block space-y-2 text-sm font-medium text-slate-700">
                <span>OCR Confusion Map</span>
                <input
                  className="h-11 w-full rounded-md border border-slate-300 px-3"
                  onChange={(event) =>
                    setForm({
                      ...form,
                      ocr_confusion_map: event.target.value,
                    })
                  }
                  placeholder="O=0,I=1,S=5,B=8"
                  value={form.ocr_confusion_map}
                />
              </label>
          </div>
        </AdvancedSection>

        <AdvancedSection
          description="Parser profiles and percentage-based scan zones for brand-specific OCR tuning."
          title="Advanced OCR Template"
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block space-y-2 text-sm font-medium text-slate-700">
              <span>Parser Type</span>
              <input
                className="h-11 w-full rounded-md border border-slate-300 px-3"
                onChange={(event) =>
                  setForm({
                    ...form,
                    parser_type: event.target.value,
                  })
                }
                placeholder="barcode_ocr"
                value={form.parser_type}
              />
            </label>
            <label className="block space-y-2 text-sm font-medium text-slate-700">
              <span>Parsing Profile</span>
              <input
                className="h-11 w-full rounded-md border border-slate-300 px-3"
                onChange={(event) =>
                  setForm({
                    ...form,
                    parsing_profile: event.target.value,
                  })
                }
                placeholder="best_buy"
                value={form.parsing_profile}
              />
            </label>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block space-y-2 text-sm font-medium text-slate-700">
              <span>Orientation Preference</span>
              <select
                className="h-11 w-full rounded-md border border-slate-300 bg-white px-3"
                onChange={(event) =>
                  setForm({
                    ...form,
                    ocr_orientation_preference: event.target.value,
                  })
                }
                value={form.ocr_orientation_preference}
              >
                <option value="auto">Auto</option>
                <option value="landscape">Landscape</option>
                <option value="portrait">Portrait</option>
              </select>
            </label>
            <label className="block space-y-2 text-sm font-medium text-slate-700">
              <span>Credential Type</span>
              <select
                className="h-11 w-full rounded-md border border-slate-300 bg-white px-3"
                onChange={(event) =>
                  setForm({
                    ...form,
                    credential_type: event.target.value,
                  })
                }
                value={form.credential_type}
              >
                <option value="">Use brand default</option>
                <option value="card_number_plus_pin">Card Number + PIN</option>
                <option value="redemption_code_only">Redemption Code Only</option>
              </select>
            </label>
          </div>
          <label className="block space-y-2 text-sm font-medium text-slate-700">
            <span>Scan Zones JSON</span>
            <textarea
              className="min-h-44 w-full rounded-md border border-slate-300 px-3 py-2 font-mono text-xs"
              onChange={(event) =>
                setForm({
                  ...form,
                  ocr_zones: event.target.value,
                })
              }
              placeholder={`[
  {
    "zone_name": "redemption_strip",
    "zone_type": "redemption_code",
    "x_pct": 10,
    "y_pct": 60,
    "width_pct": 80,
    "height_pct": 25,
    "priority": 1,
    "expected_pattern": "",
    "expected_length": 16,
    "notes": "Lower scratch-off strip"
  }
]`}
              value={form.ocr_zones}
            />
            <span className="block text-xs font-normal text-slate-500">
              Zone types: card_number, pin, redemption_code, barcode, ignore.
              Coordinates are percentages of the image after rotation.
            </span>
          </label>
        </AdvancedSection>

      </form>
    </div>
  );
}
