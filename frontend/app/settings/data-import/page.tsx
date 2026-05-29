"use client";

import Link from "next/link";
import { ChangeEvent, useEffect, useState } from "react";

import { API_BASE_URL } from "@/lib/api";

type ImportPreview = {
  manifest: {
    export_version?: string;
    exported_at?: string;
    source_environment?: string;
    sensitive_transfer?: boolean;
    warning?: string | null;
    package_type?: string;
    image_mode?: string;
    include_images?: boolean;
    binary_payload_bytes?: number;
    image_counts?: Record<string, number>;
    source_record_ids?: {
      purchases?: number[];
      sales?: number[];
    };
    sha256?: string;
  };
  counts: Record<string, number>;
  plan?: {
    create: Record<string, number>;
    reuse: Record<string, number>;
    missing_dependencies: Array<Record<string, unknown>>;
    binary_payload_bytes: number;
    package_size_bytes?: number;
  };
  conflicts: {
    duplicate_cards: Array<{
      source_id: number;
      existing_id: number;
      brand?: string;
      card_ending?: string;
      match_type?: string;
    }>;
    duplicate_purchases: Array<{
      source_id: number;
      existing_id: number;
    }>;
    missing_dependencies?: Array<Record<string, unknown>>;
  };
  warnings?: {
    duplicate_check_limited?: Array<Record<string, unknown>>;
    large_package?: {
      message: string;
      package_size_bytes: number;
    };
  };
};

type ImportResult = {
  imported_at: string;
  source_environment: string;
  created: {
    purchases: number;
    cards: number;
    sales: number;
    receipts?: number;
    card_images?: number;
  };
  skipped: {
    duplicate_cards: number;
    duplicate_receipts?: number;
    duplicate_card_images?: number;
  };
};

type TransferCapabilities = {
  export_enabled: boolean;
  import_enabled: boolean;
  sensitive_export_enabled: boolean;
  sensitive_import_enabled: boolean;
};

const DEFAULT_TRANSFER_CAPABILITIES: TransferCapabilities = {
  export_enabled: true,
  import_enabled: true,
  sensitive_export_enabled: false,
  sensitive_import_enabled: false,
};
const sensitiveWarningPanelClass =
  "rounded-md border border-orange-400/70 bg-amber-950/80 p-4 text-sm text-slate-100 shadow-sm";
const sensitiveWarningHeadingClass = "font-semibold text-amber-100";
const sensitiveWarningTextClass = "mt-1 text-slate-100";
const sensitiveWarningLabelClass =
  "flex items-start gap-3 font-medium text-slate-100";
const sensitiveWarningCheckboxClass =
  "mt-1 h-4 w-4 rounded border-amber-300 bg-slate-950 accent-amber-400";
const COUNT_KEYS = [
  "purchases",
  "cards",
  "sales",
  "purchase_payments",
  "fuel_transactions",
  "receipts",
  "card_images",
  "sale_events",
];

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

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function asNumberRecord(value: unknown): Record<string, number> {
  if (!isRecord(value)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(value).map(([key, rawValue]) => [
      key,
      typeof rawValue === "number" && Number.isFinite(rawValue) ? rawValue : 0,
    ]),
  );
}

function asArray(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value)
    ? value.filter((item): item is Record<string, unknown> => isRecord(item))
    : [];
}

function formatBytes(bytes: number | undefined) {
  if (!bytes) {
    return "0 MB";
  }
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

function totalRecordCount(record: Record<string, number> | undefined) {
  return Object.values(record ?? {}).reduce((sum, value) => sum + value, 0);
}

function normalizePreviewResponse(value: unknown): ImportPreview | string {
  if (!isRecord(value)) {
    return "Preview response was not a JSON object.";
  }

  if (!isRecord(value.manifest) || !isRecord(value.counts)) {
    return "Preview response is missing manifest or counts.";
  }

  const conflicts = isRecord(value.conflicts) ? value.conflicts : {};
  const rawPlan = isRecord(value.plan) ? value.plan : {};
  const rawWarnings = isRecord(value.warnings) ? value.warnings : {};
  const duplicateCards = asArray(conflicts.duplicate_cards).map((card) => ({
    source_id: Number(card.source_id ?? 0),
    existing_id: Number(card.existing_id ?? 0),
    brand: typeof card.brand === "string" ? card.brand : undefined,
    card_ending:
      typeof card.card_ending === "string" ? card.card_ending : undefined,
    match_type:
      typeof card.match_type === "string" ? card.match_type : undefined,
  }));
  const duplicatePurchases = asArray(conflicts.duplicate_purchases).map(
    (purchase) => ({
      source_id: Number(purchase.source_id ?? 0),
      existing_id: Number(purchase.existing_id ?? 0),
    }),
  );

  return {
    manifest: value.manifest as ImportPreview["manifest"],
    counts: asNumberRecord(value.counts),
    plan: {
      create: asNumberRecord(rawPlan.create),
      reuse: asNumberRecord(rawPlan.reuse),
      missing_dependencies: asArray(rawPlan.missing_dependencies),
      binary_payload_bytes:
        typeof rawPlan.binary_payload_bytes === "number"
          ? rawPlan.binary_payload_bytes
          : 0,
      package_size_bytes:
        typeof rawPlan.package_size_bytes === "number"
          ? rawPlan.package_size_bytes
          : undefined,
    },
    conflicts: {
      duplicate_cards: duplicateCards,
      duplicate_purchases: duplicatePurchases,
      missing_dependencies: asArray(conflicts.missing_dependencies),
    },
    warnings: {
      duplicate_check_limited: asArray(rawWarnings.duplicate_check_limited),
      large_package: isRecord(rawWarnings.large_package)
        ? {
            message:
              typeof rawWarnings.large_package.message === "string"
                ? rawWarnings.large_package.message
                : "This package is large and may hit upload limits.",
            package_size_bytes:
              typeof rawWarnings.large_package.package_size_bytes === "number"
                ? rawWarnings.large_package.package_size_bytes
                : 0,
          }
        : undefined,
    },
  };
}

export default function DataImportPage() {
  const [capabilities, setCapabilities] = useState<TransferCapabilities>(
    DEFAULT_TRANSFER_CAPABILITIES,
  );
  const [isLoadingCapabilities, setIsLoadingCapabilities] = useState(true);
  const [purchaseIds, setPurchaseIds] = useState("");
  const [saleIds, setSaleIds] = useState("");
  const [includeSensitiveCredentials, setIncludeSensitiveCredentials] =
    useState(false);
  const [imageMode, setImageMode] = useState<"exclude" | "inline" | "linked">(
    "exclude",
  );
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
  const transferExportEnabled = capabilities.export_enabled;
  const transferImportEnabled = capabilities.import_enabled;
  const sensitiveTransferExportEnabled = capabilities.sensitive_export_enabled;
  const sensitiveTransferImportEnabled = capabilities.sensitive_import_enabled;
  const sensitiveImportPackage = Boolean(preview?.manifest.sensitive_transfer);
  const duplicateCards = preview?.conflicts.duplicate_cards ?? [];
  const duplicatePurchases = preview?.conflicts.duplicate_purchases ?? [];
  const missingDependencies = [
    ...(preview?.conflicts.missing_dependencies ?? []),
    ...(preview?.plan?.missing_dependencies ?? []),
  ];
  const blockingMissingDependencyCount = missingDependencies.length;
  const duplicateConflictCount =
    duplicateCards.length + duplicatePurchases.length;
  const importBlockedByDuplicates = duplicateConflictCount > 0 && !allowDuplicates;
  const applyImportDisabled =
    !preview ||
    isImporting ||
    blockingMissingDependencyCount > 0 ||
    importBlockedByDuplicates ||
    (sensitiveImportPackage &&
      (!acknowledgeSensitiveImport || !sensitiveTransferImportEnabled));
  const noImportableRecords =
    Boolean(preview) &&
    totalRecordCount(preview?.plan?.create) === 0 &&
    totalRecordCount(preview?.plan?.reuse) === 0 &&
    totalRecordCount(preview?.manifest.image_counts) === 0 &&
    totalRecordCount(preview?.counts) === 0;
  const pageTitle =
    transferExportEnabled && transferImportEnabled
      ? "Data Transfer"
      : transferExportEnabled
        ? "Data Export"
        : "Data Import";
  const pageDescription =
    transferExportEnabled && transferImportEnabled
      ? "Export and import curated purchase/sale transfer packages between environments."
      : transferExportEnabled
        ? "Export curated purchase/sale transfer packages for another environment."
        : "Preview and import curated purchase/sale transfer packages from another environment.";

  useEffect(() => {
    let isMounted = true;

    async function loadCapabilities() {
      setIsLoadingCapabilities(true);
      try {
        const response = await fetch(`${API_BASE_URL}/data-transfer/capabilities`);
        if (!response.ok) {
          const body = await response.json().catch(() => null);
          throw new Error(
            backendErrorMessage(
              body,
              `Failed to load transfer capabilities (${response.status})`,
            ),
          );
        }
        const data = (await response.json()) as TransferCapabilities;
        if (isMounted) {
          setCapabilities(data);
        }
      } catch (err) {
        if (isMounted) {
          setError(
            err instanceof Error
              ? err.message
              : "Failed to load transfer capabilities.",
          );
        }
      } finally {
        if (isMounted) {
          setIsLoadingCapabilities(false);
        }
      }
    }

    loadCapabilities();

    return () => {
      isMounted = false;
    };
  }, []);

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
      params.set("image_mode", imageMode);

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

      const normalized = normalizePreviewResponse(await response.json());
      if (typeof normalized === "string") {
        setPreview(null);
        throw new Error(normalized);
      }
      setPreview(normalized);
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
    if (blockingMissingDependencyCount > 0) {
      setError("Resolve missing linked records before applying this import.");
      return;
    }
    if (importBlockedByDuplicates) {
      setError("Review duplicate records or choose Import duplicates anyway.");
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

        {isLoadingCapabilities ? (
          <section className="rounded-lg border border-slate-200 bg-white p-5 text-sm text-slate-600 shadow-sm">
            Loading transfer capabilities...
          </section>
        ) : null}

        {transferExportEnabled ? (
        <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h2 className="text-lg font-semibold">Export Transfer Package</h2>
              <p className="mt-1 text-sm text-slate-600">
                Create a curated ZIP from selected purchases, sales, or both.
                Linked cards, purchases, sales, payments, and lookup records are
                included automatically.
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

          <div className="mt-4 space-y-3">
            <fieldset className="rounded-md border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
              <legend className="px-1 font-semibold">Image handling</legend>
              <p className="mt-1 text-slate-600">
                Images are useful for later card-number/PIN verification. For large
                migrations, export the core data first, then import the linked image
                package.
              </p>
              <div className="mt-3 grid gap-2">
                {[
                  {
                    value: "exclude",
                    label: "Exclude images",
                    helper: "Recommended for the first core migration package.",
                  },
                  {
                    value: "inline",
                    label: "Include images in same package",
                    helper: "Best for small transfers.",
                  },
                  {
                    value: "linked",
                    label: "Export images as separate linked package",
                    helper: "Import this after the core package has been imported.",
                  },
                ].map((option) => (
                  <label
                    className="flex items-start gap-3 rounded border border-slate-200 bg-white p-2"
                    key={option.value}
                  >
                    <input
                      checked={imageMode === option.value}
                      className="mt-1 h-4 w-4"
                      onChange={() =>
                        setImageMode(option.value as "exclude" | "inline" | "linked")
                      }
                      type="radio"
                    />
                    <span>
                      <span className="block font-medium">{option.label}</span>
                      <span className="block text-xs text-slate-600">
                        {option.helper}
                      </span>
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>
            <button
              className="h-10 cursor-pointer rounded-md bg-slate-950 px-4 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
              disabled={isExporting}
              onClick={() => exportTransfer(false)}
              type="button"
            >
              {isExporting
                ? "Exporting..."
                : imageMode === "linked"
                  ? "Export Linked Image Package"
                  : "Export Transfer"}
            </button>
          </div>

          <div className={`mt-5 ${sensitiveWarningPanelClass}`}>
            {sensitiveTransferExportEnabled && imageMode !== "linked" ? (
              <>
                <label className={sensitiveWarningLabelClass}>
                  <input
                    checked={includeSensitiveCredentials}
                    className={sensitiveWarningCheckboxClass}
                    onChange={(event) => {
                      setIncludeSensitiveCredentials(event.target.checked);
                      if (!event.target.checked) {
                        setAcknowledgeSensitiveExport(false);
                      }
                    }}
                    type="checkbox"
                  />
                  <span className={sensitiveWarningHeadingClass}>
                    Include sensitive credentials
                  </span>
                </label>

                {includeSensitiveCredentials ? (
                  <div className="mt-3 space-y-3">
                    <p className="text-slate-100">
                      This export includes sensitive card numbers, PINs, and account
                      credentials. Store securely and delete after import.
                    </p>
                    <label className={sensitiveWarningLabelClass}>
                      <input
                        checked={acknowledgeSensitiveExport}
                        className={sensitiveWarningCheckboxClass}
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
                      className="h-10 cursor-pointer rounded-md border border-orange-400 bg-amber-700 px-4 text-sm font-semibold text-white transition hover:bg-amber-600 disabled:cursor-not-allowed disabled:opacity-60"
                      disabled={!acknowledgeSensitiveExport || isExporting}
                      onClick={() => exportTransfer(true)}
                      type="button"
                    >
                      {isExporting ? "Exporting..." : "Export Sensitive Transfer"}
                    </button>
                  </div>
                ) : null}
              </>
            ) : imageMode === "linked" ? (
              <div>
                <p className={sensitiveWarningHeadingClass}>
                  Linked image packages do not include credentials
                </p>
                <p className={sensitiveWarningTextClass}>
                  Export the sensitive core package separately if credentials need
                  to move between environments.
                </p>
              </div>
            ) : (
              <div>
                <p className={sensitiveWarningHeadingClass}>
                  Sensitive credential export disabled
                </p>
                <p className={sensitiveWarningTextClass}>
                  Normal transfer export remains available. Enable the sensitive
                  transfer flag only for temporary credential migration windows.
                </p>
              </div>
            )}
          </div>
        </section>
        ) : null}

        {transferImportEnabled ? (
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
              disabled={applyImportDisabled}
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
            <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <h2 className="text-lg font-semibold">Preview</h2>
                <p className="mt-1 text-sm text-slate-600">
                  {preview.manifest.package_type ?? "core"} package from{" "}
                  {preview.manifest.source_environment ?? "unknown environment"}
                </p>
              </div>
              <span className="inline-flex w-fit rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-semibold uppercase text-slate-600">
                {preview.manifest.sensitive_transfer
                  ? "Sensitive"
                  : "Non-sensitive"}
              </span>
            </div>

            {noImportableRecords ? (
              <div className="mt-4 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                No importable records found in this package.
              </div>
            ) : null}

            <div className="mt-3 grid gap-3 sm:grid-cols-4">
              {COUNT_KEYS.map((key) => (
                <div className="rounded-md border border-slate-200 p-3" key={key}>
                  <p className="text-xs font-semibold uppercase text-slate-500">
                    {key.replaceAll("_", " ")}
                  </p>
                  <p className="mt-1 text-2xl font-semibold">
                    {preview.counts[key] ?? 0}
                  </p>
                </div>
              ))}
            </div>
            <div className="mt-4 rounded-md border border-slate-200 bg-slate-50 p-3 text-sm">
              <div className="grid gap-2 sm:grid-cols-2">
                <p>
                  <span className="font-semibold">Source:</span>{" "}
                  {preview.manifest.source_environment ?? "Unknown"}
                </p>
                <p>
                  <span className="font-semibold">Exported:</span>{" "}
                  {preview.manifest.exported_at ?? "Unknown"}
                </p>
                <p>
                  <span className="font-semibold">Package type:</span>{" "}
                  {preview.manifest.package_type ?? "core"}
                </p>
                <p>
                  <span className="font-semibold">Images:</span>{" "}
                  {preview.manifest.image_mode ?? "unknown"} · include images{" "}
                  {preview.manifest.include_images ? "yes" : "no"}
                </p>
                <p>
                  <span className="font-semibold">Package size:</span>{" "}
                  {formatBytes(preview.plan?.package_size_bytes)}
                </p>
                <p>
                  <span className="font-semibold">Image payload:</span>{" "}
                  {formatBytes(
                    preview.plan?.binary_payload_bytes ??
                      preview.manifest.binary_payload_bytes,
                  )}
                </p>
              </div>
              {preview.manifest.package_type === "linked_images" ? (
                <p className="mt-1 font-semibold text-slate-700">
                  Linked image package. Import the matching core package first.
                </p>
              ) : null}
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

            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <div className="rounded-md border border-slate-200 p-3 text-sm">
                <p className="font-semibold text-slate-700">Create</p>
                <div className="mt-2 grid grid-cols-2 gap-2">
                  {Object.entries(preview.plan?.create ?? {}).map(([key, value]) => (
                    <p key={key}>
                      {key.replaceAll("_", " ")}:{" "}
                      <span className="font-semibold">{value}</span>
                    </p>
                  ))}
                </div>
              </div>
              <div className="rounded-md border border-slate-200 p-3 text-sm">
                <p className="font-semibold text-slate-700">Reuse</p>
                <div className="mt-2 grid grid-cols-2 gap-2">
                  {Object.entries(preview.plan?.reuse ?? {}).map(([key, value]) => (
                    <p key={key}>
                      {key.replaceAll("_", " ")}:{" "}
                      <span className="font-semibold">{value}</span>
                    </p>
                  ))}
                </div>
              </div>
            </div>

            {preview.manifest.sensitive_transfer ? (
              <div className={`mt-4 ${sensitiveWarningPanelClass}`}>
                {sensitiveTransferImportEnabled ? (
                  <>
                    <p className={sensitiveWarningHeadingClass}>
                      Sensitive import acknowledgement
                    </p>
                    <p className={sensitiveWarningTextClass}>
                      This import contains sensitive card numbers, PINs, and account
                      credentials. Store securely and delete the ZIP after import.
                    </p>
                    <label className={`mt-3 ${sensitiveWarningLabelClass}`}>
                      <input
                        checked={acknowledgeSensitiveImport}
                        className={sensitiveWarningCheckboxClass}
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
                    <p className={sensitiveWarningHeadingClass}>
                      Sensitive import disabled
                    </p>
                    <p className={sensitiveWarningTextClass}>
                      This package contains sensitive credentials, but sensitive
                      import is disabled for this environment.
                    </p>
                  </>
                )}
              </div>
            ) : null}

            {preview.warnings?.large_package ? (
              <div className="mt-4 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                <p className="font-semibold">Large transfer package</p>
                <p className="mt-1">{preview.warnings.large_package.message}</p>
              </div>
            ) : null}

            {duplicateCards.length > 0 || duplicatePurchases.length > 0 ? (
              <div className="mt-4 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                <p className="font-semibold">Duplicate records detected</p>
                {duplicateCards.length > 0 ? (
                  <ul className="mt-2 list-disc space-y-1 pl-5">
                    {duplicateCards.map((card) => (
                    <li key={`${card.source_id}-${card.existing_id}`}>
                        {card.brand ?? "Card"} ending{" "}
                        {card.card_ending ?? "unknown"}: source #{card.source_id}{" "}
                        matches existing #{card.existing_id}
                    </li>
                    ))}
                  </ul>
                ) : null}
                {duplicatePurchases.length > 0 ? (
                  <ul className="mt-2 list-disc space-y-1 pl-5">
                    {duplicatePurchases.map((purchase) => (
                      <li key={`${purchase.source_id}-${purchase.existing_id}`}>
                        Purchase source #{purchase.source_id} matches existing #
                        {purchase.existing_id}
                      </li>
                    ))}
                  </ul>
                ) : null}
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

            {missingDependencies.length ? (
              <div className="mt-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">
                <p className="font-semibold">Missing linked records</p>
                <p className="mt-1">
                  This package is missing required dependencies and cannot be
                  imported safely.
                </p>
                <ul className="mt-2 list-disc space-y-1 pl-5">
                  {missingDependencies.map((dependency, index) => (
                    <li key={`${dependency.entity}-${dependency.source_id}-${index}`}>
                      {String(dependency.entity ?? "Record")} source #
                      {String(dependency.source_id ?? "unknown")} is missing{" "}
                      {String(dependency.missing ?? "dependency")} source #
                      {String(dependency.missing_source_id ?? "unknown")}
                      {typeof dependency.message === "string"
                        ? ` — ${dependency.message}`
                        : ""}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            {preview.warnings?.duplicate_check_limited?.length ? (
              <div className="mt-4 rounded-md border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
                <p className="font-semibold">Duplicate check limited</p>
                <ul className="mt-2 list-disc space-y-1 pl-5">
                  {preview.warnings.duplicate_check_limited.map((warning, index) => (
                    <li key={index}>
                      {String(warning.message ?? "Some existing credentials could not be checked.")}
                    </li>
                  ))}
                </ul>
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
            {result.created.receipts || result.created.card_images ? (
              <p className="mt-1">
                Added {result.created.receipts ?? 0} receipts and{" "}
                {result.created.card_images ?? 0} card images.
              </p>
            ) : null}
            <p className="mt-1">
              Skipped duplicate cards: {result.skipped.duplicate_cards}
            </p>
            {result.skipped.duplicate_receipts ||
            result.skipped.duplicate_card_images ? (
              <p className="mt-1">
                Skipped duplicate images:{" "}
                {(result.skipped.duplicate_receipts ?? 0) +
                  (result.skipped.duplicate_card_images ?? 0)}
              </p>
            ) : null}
          </section>
        ) : null}
      </div>
    </main>
  );
}
