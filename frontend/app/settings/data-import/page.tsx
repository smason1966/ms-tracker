"use client";

import Link from "next/link";
import { ChangeEvent, useState } from "react";

import { API_BASE_URL } from "@/lib/api";

type ImportPreview = {
  manifest: {
    export_version: string;
    exported_at: string;
    source_environment: string;
    source_record_ids: {
      purchases: number[];
      sales: number[];
    };
    sha256?: string;
  };
  counts: Record<string, number>;
  conflicts: {
    duplicate_cards: Array<{
      source_id: number;
      existing_id: number;
      brand: string;
      card_ending: string;
    }>;
    duplicate_purchases: Array<{
      source_id: number;
      existing_id: number;
    }>;
  };
};

type ImportResult = {
  imported_at: string;
  source_environment: string;
  created: {
    purchases: number;
    cards: number;
    sales: number;
  };
  skipped: {
    duplicate_cards: number;
  };
};

export default function DataImportPage() {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [allowDuplicates, setAllowDuplicates] = useState(false);
  const [isPreviewing, setIsPreviewing] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function onFileChange(event: ChangeEvent<HTMLInputElement>) {
    setFile(event.target.files?.[0] ?? null);
    setPreview(null);
    setResult(null);
    setError(null);
  }

  async function previewImport() {
    if (!file) {
      return;
    }

    setIsPreviewing(true);
    setError(null);

    try {
      const formData = new FormData();
      formData.append("file", file);
      const response = await fetch(`${API_BASE_URL}/data-transfer/import/preview`, {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(body?.detail || `Preview failed (${response.status})`);
      }

      setPreview((await response.json()) as ImportPreview);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Preview failed.");
    } finally {
      setIsPreviewing(false);
    }
  }

  async function applyImport() {
    if (!file || !preview) {
      return;
    }

    setIsImporting(true);
    setError(null);

    try {
      const formData = new FormData();
      formData.append("file", file);
      const params = new URLSearchParams({
        allow_duplicates: String(allowDuplicates),
      });
      const response = await fetch(
        `${API_BASE_URL}/data-transfer/import/apply?${params.toString()}`,
        {
          method: "POST",
          body: formData,
        },
      );

      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(
          body?.detail?.message || body?.detail || `Import failed (${response.status})`,
        );
      }

      setResult((await response.json()) as ImportResult);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Import failed.");
    } finally {
      setIsImporting(false);
    }
  }

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-6 text-slate-950 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-5xl space-y-5">
        <header>
          <Link
            className="mb-3 inline-flex h-8 cursor-pointer items-center rounded-md border border-slate-300 px-3 text-xs font-semibold text-slate-700 transition hover:bg-slate-100 active:bg-slate-200"
            href="/settings"
          >
            Back to Settings
          </Link>
          <p className="text-sm font-medium uppercase tracking-wide text-slate-500">
            Settings / Data Import
          </p>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight">
            Data Import
          </h1>
          <p className="mt-2 max-w-2xl text-sm text-slate-600">
            Preview and import curated purchase/sale transfer packages from test
            into production.
          </p>
        </header>

        {error ? (
          <p className="rounded-md border border-red-200 bg-red-50 p-3 text-sm font-medium text-red-700">
            {error}
          </p>
        ) : null}

        <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
          <label className="block space-y-2 text-sm font-medium text-slate-700">
            <span>Transfer ZIP</span>
            <input
              accept=".zip,application/zip"
              className="block w-full rounded-md border border-slate-300 p-2"
              onChange={onFileChange}
              type="file"
            />
          </label>
          <div className="mt-4 flex flex-wrap gap-2">
            <button
              className="h-10 cursor-pointer rounded-md bg-slate-950 px-4 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
              disabled={!file || isPreviewing}
              onClick={previewImport}
              type="button"
            >
              {isPreviewing ? "Previewing..." : "Preview Import"}
            </button>
            <button
              className="h-10 cursor-pointer rounded-md border border-slate-300 px-4 text-sm font-semibold text-slate-700 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60"
              disabled={!preview || isImporting}
              onClick={applyImport}
              type="button"
            >
              {isImporting ? "Importing..." : "Apply Import"}
            </button>
          </div>
        </section>

        {preview ? (
          <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="text-lg font-semibold">Preview</h2>
            <div className="mt-3 grid gap-3 sm:grid-cols-3">
              {Object.entries(preview.counts).map(([key, value]) => (
                <div className="rounded-md border border-slate-200 p-3" key={key}>
                  <p className="text-xs font-semibold uppercase text-slate-500">
                    {key.replaceAll("_", " ")}
                  </p>
                  <p className="mt-1 text-2xl font-semibold">{value}</p>
                </div>
              ))}
            </div>
            <div className="mt-4 rounded-md border border-slate-200 bg-slate-50 p-3 text-sm">
              <p>
                Source: {preview.manifest.source_environment} · Exported{" "}
                {preview.manifest.exported_at}
              </p>
              {preview.manifest.sha256 ? (
                <p className="mt-1 break-all text-xs text-slate-500">
                  SHA256: {preview.manifest.sha256}
                </p>
              ) : null}
            </div>

            {preview.conflicts.duplicate_cards.length > 0 ? (
              <div className="mt-4 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                <p className="font-semibold">Duplicate cards detected</p>
                <ul className="mt-2 list-disc space-y-1 pl-5">
                  {preview.conflicts.duplicate_cards.map((card) => (
                    <li key={`${card.source_id}-${card.existing_id}`}>
                      {card.brand} ending {card.card_ending}: source #{card.source_id} matches existing #{card.existing_id}
                    </li>
                  ))}
                </ul>
                <label className="mt-3 flex items-center gap-2 font-medium">
                  <input
                    checked={allowDuplicates}
                    onChange={(event) => setAllowDuplicates(event.target.checked)}
                    type="checkbox"
                  />
                  Import duplicates anyway
                </label>
              </div>
            ) : null}
          </section>
        ) : null}

        {result ? (
          <section className="rounded-lg border border-emerald-200 bg-emerald-50 p-5 text-sm text-emerald-900 shadow-sm">
            <h2 className="text-lg font-semibold">Import Complete</h2>
            <p className="mt-2">
              Created {result.created.purchases} purchases, {result.created.cards} cards,
              and {result.created.sales} sales.
            </p>
            <p className="mt-1">
              Skipped duplicate cards: {result.skipped.duplicate_cards}
            </p>
          </section>
        ) : null}
      </div>
    </main>
  );
}
