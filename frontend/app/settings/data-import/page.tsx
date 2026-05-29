"use client";

import Link from "next/link";
import { ChangeEvent, useState } from "react";

import { API_BASE_URL } from "@/lib/api";

const TRANSFER_EXPORT_ENABLED =
  process.env.NEXT_PUBLIC_ALLOW_TRANSFER_EXPORT !== "false";
const TRANSFER_IMPORT_ENABLED =
  process.env.NEXT_PUBLIC_ALLOW_TRANSFER_IMPORT !== "false";
const SENSITIVE_TRANSFER_EXPORT_ENABLED =
  process.env.NEXT_PUBLIC_ALLOW_SENSITIVE_TRANSFER_EXPORT === "true";
const SENSITIVE_TRANSFER_IMPORT_ENABLED =
  process.env.NEXT_PUBLIC_ALLOW_SENSITIVE_TRANSFER_IMPORT === "true";

type ImportPreview = {
  manifest: {
    export_version: string;
    exported_at: string;
    source_environment: string;
    sensitive_transfer?: boolean;
    warning?: string | null;
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
  const [purchaseIds, setPurchaseIds] = useState("");
  const [saleIds, setSaleIds] = useState("");
  const [includeSensitiveCredentials, setIncludeSensitiveCredentials] =
    useState(false);
  const [acknowledgeSensitiveExport, setAcknowledgeSensitiveExport] =
    useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [allowDuplicates, setAllowDuplicates] = useState(false);
  const [acknowledgeSensitiveImport, setAcknowledgeSensitiveImport] =
    useState(false);
  const [isPreviewing, setIsPreviewing] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sensitiveImportPackage = Boolean(preview?.manifest.sensitive_transfer);
  const pageTitle =
    TRANSFER_EXPORT_ENABLED && TRANSFER_IMPORT_ENABLED
      ? "Data Transfer"
      : TRANSFER_EXPORT_ENABLED
        ? "Data Export"
        : "Data Import";
  const pageDescription =
    TRANSFER_EXPORT_ENABLED && TRANSFER_IMPORT_ENABLED
      ? "Export and import curated purchase/sale transfer packages between environments."
      : TRANSFER_EXPORT_ENABLED
        ? "Export curated purchase/sale transfer packages for another environment."
        : "Preview and import curated purchase/sale transfer packages from another environment.";

  function backendErrorMessage(body: unknown, fallback: string) {
    if (!body || typeof body !== "object") {
      return fallback;
    }

    const detail = (body as { detail?: unknown }).detail;
    if (typeof detail === "string") {
      return detail;
    }
    if (detail && typeof detail === "object") {
      const message = (detail as { message?: unknown }).message;
      if (typeof message === "string") {
        return message;
      }
    }
    return fallback;
  }

  function filenameFromDisposition(disposition: string | null) {
    if (!disposition) {
      return null;
    }

    const utf8Match = disposition.match(/filename\*=UTF-8''([^;]+)/i);
    if (utf8Match?.[1]) {
      return decodeURIComponent(utf8Match[1].replaceAll('"', ""));
    }

    const filenameMatch = disposition.match(/filename="?([^";]+)"?/i);
    return filenameMatch?.[1] ?? null;
  }

  function downloadBlob(blob: Blob, filename: string) {
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.URL.revokeObjectURL(url);
  }

  async function exportTransfer(sensitive: boolean) {
    const purchases = purchaseIds.trim();
    const sales = saleIds.trim();
    if (!purchases && !sales) {
      setError("Select purchases or sales to export.");
      return;
    }
    if (sensitive && !acknowledgeSensitiveExport) {
      setError(
        "Confirm that you understand this file contains sensitive credentials before exporting.",
      );
      return;
    }

    setIsExporting(true);
    setError(null);

    try {
      const params = new URLSearchParams();
      if (purchases) {
        params.set("purchases", purchases);
      }
      if (sales) {
        params.set("sales", sales);
      }
      if (sensitive) {
        params.set("sensitive", "true");
        params.set("acknowledge_sensitive", "true");
      }

      const response = await fetch(
        `${API_BASE_URL}/data-transfer/export?${params.toString()}`,
      );

      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(
          backendErrorMessage(body, `Export failed (${response.status})`),
        );
      }

      const blob = await response.blob();
      const filename =
        filenameFromDisposition(response.headers.get("Content-Disposition")) ??
        (sensitive ? "sensitive-transfer.zip" : "transfer.zip");
      downloadBlob(blob, filename);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Export failed.");
    } finally {
      setIsExporting(false);
    }
  }

  function onFileChange(event: ChangeEvent<HTMLInputElement>) {
    setFile(event.target.files?.[0] ?? null);
    setPreview(null);
    setResult(null);
    setError(null);
    setAcknowledgeSensitiveImport(false);
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
        throw new Error(
          backendErrorMessage(body, `Preview failed (${response.status})`),
        );
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
    if (sensitiveImportPackage && !acknowledgeSensitiveImport) {
      setError(
        "Confirm that you understand this file contains sensitive credentials before importing.",
      );
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
      if (sensitiveImportPackage && acknowledgeSensitiveImport) {
        params.set("acknowledge_sensitive", "true");
      }
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
          backendErrorMessage(body, `Import failed (${response.status})`),
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
            Settings / {pageTitle}
          </p>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight">
            {pageTitle}
          </h1>
          <p className="mt-2 max-w-2xl text-sm text-slate-600">
            {pageDescription}
          </p>
        </header>

        {error ? (
          <p className="rounded-md border border-red-200 bg-red-50 p-3 text-sm font-medium text-red-700">
            {error}
          </p>
        ) : null}

        {TRANSFER_EXPORT_ENABLED ? (
        <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h2 className="text-lg font-semibold">Export Transfer Package</h2>
              <p className="mt-1 text-sm text-slate-600">
                Create a curated ZIP from selected purchases, sales, or both.
              </p>
            </div>
          </div>

          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <label className="block space-y-2 text-sm font-medium text-slate-700">
              <span>Purchase IDs</span>
              <input
                className="h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-950 outline-none transition placeholder:text-slate-400 focus:border-slate-500 focus:ring-2 focus:ring-slate-200"
                onChange={(event) => setPurchaseIds(event.target.value)}
                placeholder="101,102,103"
                type="text"
                value={purchaseIds}
              />
            </label>
            <label className="block space-y-2 text-sm font-medium text-slate-700">
              <span>Sale IDs</span>
              <input
                className="h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-950 outline-none transition placeholder:text-slate-400 focus:border-slate-500 focus:ring-2 focus:ring-slate-200"
                onChange={(event) => setSaleIds(event.target.value)}
                placeholder="12,13,14"
                type="text"
                value={saleIds}
              />
            </label>
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            <button
              className="h-10 cursor-pointer rounded-md bg-slate-950 px-4 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
              disabled={isExporting}
              onClick={() => exportTransfer(false)}
              type="button"
            >
              {isExporting ? "Exporting..." : "Export Transfer"}
            </button>
          </div>

          <div className="mt-5 rounded-md border border-amber-200 bg-amber-50/80 p-4 text-sm text-amber-950">
            {SENSITIVE_TRANSFER_EXPORT_ENABLED ? (
              <>
                <label className="flex items-start gap-3 font-semibold">
                  <input
                    checked={includeSensitiveCredentials}
                    className="mt-1"
                    onChange={(event) => {
                      setIncludeSensitiveCredentials(event.target.checked);
                      if (!event.target.checked) {
                        setAcknowledgeSensitiveExport(false);
                      }
                    }}
                    type="checkbox"
                  />
                  <span>Include sensitive credentials</span>
                </label>

                {includeSensitiveCredentials ? (
                  <div className="mt-3 space-y-3">
                    <p>
                      This export includes sensitive card numbers, PINs, and account
                      credentials. Store securely and delete after import.
                    </p>
                    <label className="flex items-start gap-3 font-medium">
                      <input
                        checked={acknowledgeSensitiveExport}
                        className="mt-1"
                        onChange={(event) =>
                          setAcknowledgeSensitiveExport(event.target.checked)
                        }
                        type="checkbox"
                      />
                      <span>
                        I understand this file contains sensitive credentials and
                        will delete it after import.
                      </span>
                    </label>
                    <button
                      className="h-10 cursor-pointer rounded-md border border-amber-500 bg-amber-900 px-4 text-sm font-semibold text-amber-50 transition hover:bg-amber-800 disabled:cursor-not-allowed disabled:opacity-60"
                      disabled={!acknowledgeSensitiveExport || isExporting}
                      onClick={() => exportTransfer(true)}
                      type="button"
                    >
                      {isExporting ? "Exporting..." : "Export Sensitive Transfer"}
                    </button>
                  </div>
                ) : null}
              </>
            ) : (
              <div>
                <p className="font-semibold">Sensitive credential export disabled</p>
                <p className="mt-1">
                  Normal transfer export remains available. Enable the sensitive
                  transfer flag only for temporary credential migration windows.
                </p>
              </div>
            )}
          </div>
        </section>
        ) : null}

        {TRANSFER_IMPORT_ENABLED ? (
        <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
          <div className="mb-4">
            <h2 className="text-lg font-semibold">Import Transfer Package</h2>
            <p className="mt-1 text-sm text-slate-600">
              Preview a transfer ZIP before applying it to this environment.
            </p>
          </div>
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
              disabled={
                !preview ||
                isImporting ||
                (sensitiveImportPackage &&
                  (!acknowledgeSensitiveImport ||
                    !SENSITIVE_TRANSFER_IMPORT_ENABLED))
              }
              onClick={applyImport}
              type="button"
            >
              {isImporting ? "Importing..." : "Apply Import"}
            </button>
          </div>
        </section>
        ) : (
          <section className="rounded-lg border border-slate-200 bg-white p-5 text-sm text-slate-600 shadow-sm">
            Import is disabled for this environment.
          </section>
        )}

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
              {preview.manifest.sensitive_transfer ? (
                <p className="mt-1 font-semibold text-amber-700">
                  Sensitive credential transfer
                </p>
              ) : null}
              {preview.manifest.sha256 ? (
                <p className="mt-1 break-all text-xs text-slate-500">
                  SHA256: {preview.manifest.sha256}
                </p>
              ) : null}
            </div>

            {preview.manifest.sensitive_transfer ? (
              <div className="mt-4 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950">
                {SENSITIVE_TRANSFER_IMPORT_ENABLED ? (
                  <>
                    <p className="font-semibold">Sensitive import acknowledgement</p>
                    <p className="mt-1">
                      This import contains sensitive card numbers, PINs, and account
                      credentials. Store securely and delete the ZIP after import.
                    </p>
                    <label className="mt-3 flex items-start gap-2 font-medium">
                      <input
                        checked={acknowledgeSensitiveImport}
                        className="mt-1"
                        onChange={(event) =>
                          setAcknowledgeSensitiveImport(event.target.checked)
                        }
                        type="checkbox"
                      />
                      <span>
                        I understand this file contains sensitive credentials and
                        will delete it after import.
                      </span>
                    </label>
                  </>
                ) : (
                  <>
                    <p className="font-semibold">Sensitive import disabled</p>
                    <p className="mt-1">
                      This package contains sensitive credentials, but sensitive
                      import is disabled for this environment.
                    </p>
                  </>
                )}
              </div>
            ) : null}

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
