"use client";

import { useEffect, useState } from "react";

import { API_BASE_URL } from "@/lib/api";

type MissingReference = {
  table: string;
  id: number;
  column: string;
  path: string | null;
  physical_path: string | null;
  exists: boolean;
};

type OrphanedFile = {
  path: string;
  category: string;
  size_bytes: number;
  modified_at: string | null;
  age_hours: number | null;
  protection_reason?: string;
  protected_until?: string | null;
};

type FileCategoryCount = {
  category: string;
  count: number;
  size_bytes: number;
};

type UploadHealth = {
  upload_root: string;
  public_root: string;
  total_upload_files: number;
  total_upload_bytes: number;
  db_reference_count: number;
  missing_file_reference_count: number;
  orphaned_file_count: number;
  orphaned_file_type_counts: FileCategoryCount[];
  ocr_debug_file_count: number;
  ocr_debug_bytes: number;
  missing_file_references: MissingReference[];
  orphaned_files: (string | OrphanedFile)[];
};

type OrphanPreview = {
  older_than_days: number;
  minimum_age_hours: number;
  orphaned_file_count: number;
  protected_recent_file_count: number;
  eligible_file_count: number;
  recent_or_unknown_file_count: number;
  eligible_bytes: number;
  next_eligible_cleanup_time: string | null;
  protection_explanation: string | null;
  category_counts: FileCategoryCount[];
  eligible_category_counts: FileCategoryCount[];
  orphaned_files: OrphanedFile[];
  eligible_files: OrphanedFile[];
  protected_files: OrphanedFile[];
  dry_run?: boolean;
  deleted_count?: number;
  deleted_bytes?: number;
  failed_count?: number;
};

function formatBytes(value: number) {
  if (!Number.isFinite(value) || value <= 0) {
    return "0 B";
  }
  const units = ["B", "KB", "MB", "GB", "TB"];
  let amount = value;
  let unitIndex = 0;
  while (amount >= 1024 && unitIndex < units.length - 1) {
    amount /= 1024;
    unitIndex += 1;
  }
  return `${amount.toFixed(amount >= 10 || unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}

function formatDateTime(value: string | null | undefined) {
  if (!value) {
    return "-";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

export default function UploadHealthPage() {
  const [health, setHealth] = useState<UploadHealth | null>(null);
  const [orphanPreview, setOrphanPreview] = useState<OrphanPreview | null>(null);
  const [olderThanDays, setOlderThanDays] = useState("1");
  const [isPreviewingOrphans, setIsPreviewingOrphans] = useState(false);
  const [isDeletingOrphans, setIsDeletingOrphans] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [orphanCleanupMessage, setOrphanCleanupMessage] = useState<string | null>(null);

  async function loadHealth() {
    setIsLoading(true);
    setError(null);
    try {
      const response = await fetch(`${API_BASE_URL}/retention/upload-health`);
      if (!response.ok) {
        throw new Error(`Failed to load upload health (${response.status})`);
      }
      setHealth((await response.json()) as UploadHealth);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load upload health.");
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    queueMicrotask(() => {
      void loadHealth();
    });
  }, []);

  async function previewOrphans() {
    setIsPreviewingOrphans(true);
    setOrphanCleanupMessage(null);
    setError(null);
    try {
      const response = await fetch(`${API_BASE_URL}/retention/upload-health/orphans/preview`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          dry_run: true,
          older_than_days: Number(olderThanDays) || 1,
          minimum_age_hours: 24,
        }),
      });
      if (!response.ok) {
        throw new Error(`Failed to preview orphan cleanup (${response.status})`);
      }
      setOrphanPreview((await response.json()) as OrphanPreview);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to preview orphan cleanup.");
    } finally {
      setIsPreviewingOrphans(false);
    }
  }

  async function deleteOrphans() {
    setIsDeletingOrphans(true);
    setOrphanCleanupMessage(null);
    setError(null);
    try {
      const response = await fetch(`${API_BASE_URL}/retention/upload-health/orphans/cleanup`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          dry_run: false,
          older_than_days: Number(olderThanDays) || 1,
          minimum_age_hours: 24,
        }),
      });
      if (!response.ok) {
        throw new Error(`Failed to delete orphaned files (${response.status})`);
      }
      const result = (await response.json()) as OrphanPreview;
      setOrphanPreview(result);
      setOrphanCleanupMessage(
        `Deleted ${result.deleted_count ?? 0} orphaned files (${formatBytes(result.deleted_bytes ?? 0)}).`,
      );
      await loadHealth();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete orphaned files.");
    } finally {
      setIsDeletingOrphans(false);
    }
  }

  const orphanedFiles = (health?.orphaned_files ?? []).map((item) =>
    typeof item === "string"
      ? {
          path: item,
          category: "unknown",
          size_bytes: 0,
          modified_at: null,
          age_hours: null,
        }
      : item,
  );

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-6 text-slate-950 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-7xl space-y-5">
        <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-sm font-medium uppercase tracking-wide text-slate-500">
              Admin
            </p>
            <h1 className="mt-1 text-3xl font-semibold tracking-tight">
              Upload Health
            </h1>
            <p className="mt-2 max-w-2xl text-sm text-slate-600">
              Storage checks for uploaded artifacts and database file references.
            </p>
          </div>
          <button
            className="h-10 rounded-md border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-700 shadow-sm transition hover:bg-slate-100"
            disabled={isLoading}
            onClick={() => void loadHealth()}
            type="button"
          >
            Refresh
          </button>
        </header>

        {error ? (
          <section className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm font-medium text-red-700">
            {error}
          </section>
        ) : null}

        <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-sm font-medium text-slate-500">Upload root</p>
          <p className="mt-1 break-all text-sm font-semibold text-slate-900">
            {health?.upload_root ?? (isLoading ? "Loading..." : "-")}
          </p>
        </section>

        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {[
            ["Total uploads", health?.total_upload_files ?? 0],
            ["DB references", health?.db_reference_count ?? 0],
            ["Missing references", health?.missing_file_reference_count ?? 0],
            ["Orphaned files", health?.orphaned_file_count ?? 0],
          ].map(([label, value]) => (
            <div
              className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm"
              key={label}
            >
              <p className="text-sm font-medium text-slate-500">{label}</p>
              <p className="mt-2 text-3xl font-semibold">{value}</p>
            </div>
          ))}
        </section>

        <section className="grid gap-4 md:grid-cols-2">
          <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="text-lg font-semibold">Storage Size</h2>
            <dl className="mt-4 space-y-3 text-sm">
              <div className="flex items-center justify-between gap-4">
                <dt className="text-slate-500">All upload files</dt>
                <dd className="font-semibold">{formatBytes(health?.total_upload_bytes ?? 0)}</dd>
              </div>
              <div className="flex items-center justify-between gap-4">
                <dt className="text-slate-500">OCR debug</dt>
                <dd className="font-semibold">
                  {formatBytes(health?.ocr_debug_bytes ?? 0)} across{" "}
                  {health?.ocr_debug_file_count ?? 0} files
                </dd>
              </div>
            </dl>
          </div>

          <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="text-lg font-semibold">Status</h2>
            <p className="mt-4 text-sm font-medium text-slate-700">
              {isLoading
                ? "Checking storage..."
                : (health?.missing_file_reference_count ?? 0) > 0
                  ? "Some database references point to files that are not present."
                  : (health?.orphaned_file_count ?? 0) > 0
                    ? "Some files are not referenced by the database."
                    : "Upload storage references look consistent."}
            </p>
          </div>
        </section>

        <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="text-lg font-semibold">Missing File References</h2>
          <div className="mt-4 overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead className="border-b border-slate-200 text-slate-500">
                <tr>
                  <th className="py-2 pr-4 font-semibold">Source</th>
                  <th className="py-2 pr-4 font-semibold">Stored path</th>
                  <th className="py-2 font-semibold">Expected file</th>
                </tr>
              </thead>
              <tbody>
                {(health?.missing_file_references ?? []).map((item) => (
                  <tr className="border-b border-slate-100" key={`${item.table}-${item.id}-${item.column}`}>
                    <td className="py-2 pr-4 font-medium">
                      {item.table} #{item.id} {item.column}
                    </td>
                    <td className="max-w-sm break-all py-2 pr-4 text-slate-600">{item.path}</td>
                    <td className="max-w-sm break-all py-2 text-slate-600">{item.physical_path}</td>
                  </tr>
                ))}
                {!isLoading && (health?.missing_file_references.length ?? 0) === 0 ? (
                  <tr>
                    <td className="py-3 text-slate-500" colSpan={3}>
                      No missing file references.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </section>

        <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="text-lg font-semibold">Orphaned Files</h2>
          <div className="mt-4 grid gap-4 lg:grid-cols-[1fr_auto] lg:items-end">
            <label className="space-y-2 text-sm font-medium text-slate-700">
              <span>Delete files older than days</span>
              <input
                className="h-10 w-full max-w-xs rounded-md border border-slate-300 px-3"
                min="1"
                onChange={(event) => setOlderThanDays(event.target.value)}
                step="1"
                type="number"
                value={olderThanDays}
              />
              <p className="text-xs text-slate-500">
                Files newer than 24 hours are always excluded.
              </p>
            </label>
            <div className="flex flex-wrap gap-2">
              <button
                className="h-10 rounded-md border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-700 shadow-sm transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60"
                disabled={isPreviewingOrphans || isDeletingOrphans}
                onClick={() => void previewOrphans()}
                type="button"
              >
                {isPreviewingOrphans ? "Previewing..." : "Preview Cleanup"}
              </button>
              <button
                className="h-10 rounded-md bg-red-700 px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-red-800 disabled:cursor-not-allowed disabled:opacity-60"
                disabled={
                  isPreviewingOrphans ||
                  isDeletingOrphans ||
                  (orphanPreview?.eligible_file_count ?? 0) === 0
                }
                onClick={() => void deleteOrphans()}
                type="button"
              >
                {isDeletingOrphans ? "Deleting..." : "Delete Eligible Orphans"}
              </button>
            </div>
          </div>

          {orphanCleanupMessage ? (
            <p className="mt-3 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-700">
              {orphanCleanupMessage}
            </p>
          ) : null}

          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
              <h3 className="text-sm font-semibold text-slate-700">Current Orphan Types</h3>
              <ul className="mt-2 space-y-1 text-sm text-slate-600">
                {(health?.orphaned_file_type_counts ?? []).map((item) => (
                  <li className="flex justify-between gap-3" key={item.category}>
                    <span>{item.category.replaceAll("_", " ")}</span>
                    <span className="font-semibold">
                      {item.count} · {formatBytes(item.size_bytes)}
                    </span>
                  </li>
                ))}
                {!isLoading && (health?.orphaned_file_type_counts.length ?? 0) === 0 ? (
                  <li>No orphaned file categories.</li>
                ) : null}
              </ul>
            </div>
            <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
              <h3 className="text-sm font-semibold text-slate-700">Cleanup Preview</h3>
              <dl className="mt-2 space-y-1 text-sm text-slate-600">
                <div className="flex justify-between gap-3">
                  <dt>Total orphaned</dt>
                  <dd className="font-semibold">{orphanPreview?.orphaned_file_count ?? 0}</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt>Eligible files</dt>
                  <dd className="font-semibold">{orphanPreview?.eligible_file_count ?? 0}</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt>Eligible size</dt>
                  <dd className="font-semibold">{formatBytes(orphanPreview?.eligible_bytes ?? 0)}</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt>Recent/unknown skipped</dt>
                  <dd className="font-semibold">
                    {orphanPreview?.protected_recent_file_count ??
                      orphanPreview?.recent_or_unknown_file_count ??
                      0}
                  </dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt>Next eligible cleanup</dt>
                  <dd className="font-semibold">
                    {formatDateTime(orphanPreview?.next_eligible_cleanup_time)}
                  </dd>
                </div>
              </dl>
              {orphanPreview?.protection_explanation ? (
                <p className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-800">
                  {orphanPreview.protection_explanation}
                </p>
              ) : null}
            </div>
          </div>

          <div className="mt-4 max-h-72 overflow-auto rounded-md border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
            {(orphanPreview
              ? orphanPreview.eligible_files.length > 0
                ? orphanPreview.eligible_files
                : orphanPreview.protected_files
              : orphanedFiles
            ).length > 0 ? (
              <ul className="space-y-1">
                {(orphanPreview
                  ? orphanPreview.eligible_files.length > 0
                    ? orphanPreview.eligible_files
                    : orphanPreview.protected_files
                  : orphanedFiles
                ).map((file) => (
                  <li className="break-all" key={file.path}>
                    {file.path}
                    <span className="ml-2 text-xs text-slate-500">
                      {file.category} · {formatBytes(file.size_bytes)}
                      {file.age_hours !== null ? ` · ${file.age_hours}h old` : ""}
                      {file.protection_reason ? ` · ${file.protection_reason}` : ""}
                      {file.protected_until
                        ? ` Next eligible ${formatDateTime(file.protected_until)}`
                        : ""}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-slate-500">
                {isLoading ? "Checking..." : "No orphaned files found."}
              </p>
            )}
          </div>
        </section>
      </div>
    </main>
  );
}
