"use client";

import { useState } from "react";

import { API_BASE_URL } from "@/lib/api";

type RetentionCandidate = {
  attachment_table: string;
  attachment_id: number;
  attachment_type: string;
  original_filename: string | null;
  file_path: string | null;
  uploaded_at: string;
  retention_until: string | null;
  safe_to_purge: boolean;
  blocked_reasons: string[];
  metadata: Record<string, string | number | boolean | null | string[] | number[]>;
};

type RetentionPreview = {
  total_candidates: number;
  safe_to_purge_count: number;
  blocked_count: number;
  candidates: RetentionCandidate[];
};

type RetentionRunResult = {
  dry_run: boolean;
  purged_count: number;
  would_purge_count: number;
  blocked_count: number;
  purged: RetentionCandidate[];
  would_purge: RetentionCandidate[];
  blocked: RetentionCandidate[];
};

async function readError(response: Response) {
  const body = await response.text();
  return `${response.url} failed (${response.status}): ${body}`;
}

export default function RetentionSettingsPage() {
  const [preview, setPreview] = useState<RetentionPreview | null>(null);
  const [runResult, setRunResult] = useState<RetentionRunResult | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const payload = {
    card_image_months: 12,
    receipt_image_months: 12,
    digital_pdf_months: 12,
  };

  async function runPreview() {
    setIsLoading(true);
    setError(null);
    setRunResult(null);

    try {
      const response = await fetch(`${API_BASE_URL}/retention/preview`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...payload, dry_run: true }),
      });

      if (!response.ok) {
        throw new Error(await readError(response));
      }

      setPreview((await response.json()) as RetentionPreview);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to preview cleanup.");
    } finally {
      setIsLoading(false);
    }
  }

  async function runCleanup() {
    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch(`${API_BASE_URL}/retention/run`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...payload, dry_run: false }),
      });

      if (!response.ok) {
        throw new Error(await readError(response));
      }

      const result = (await response.json()) as RetentionRunResult;
      setRunResult(result);
      setPreview(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to run cleanup.");
    } finally {
      setIsLoading(false);
    }
  }

  const candidates = preview?.candidates ?? [];

  return (
    <main className="min-h-screen bg-slate-950 px-4 py-8 text-slate-100 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-6xl space-y-6">
        <header>
          <p className="text-sm font-medium uppercase tracking-wide text-cyan-300">
            Settings
          </p>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight">
            Retention
          </h1>
          <p className="mt-2 max-w-3xl text-sm text-slate-400">
            Uploaded card images, receipt images, and digital PDFs are retained
            for 12 months, then safely purged when they are no longer needed for
            verification, disputes, or unpaid sales.
          </p>
        </header>

        <section className="grid gap-4 md:grid-cols-3">
          {[
            ["Card/receipt images retention", "12 months"],
            ["Digital PDFs retention", "12 months"],
            ["Purged records", "Metadata retained"],
          ].map(([label, value]) => (
            <div
              className="rounded-lg border border-slate-800 bg-slate-900 p-4"
              key={label}
            >
              <p className="text-sm text-slate-400">{label}</p>
              <p className="mt-2 text-2xl font-semibold text-white">{value}</p>
            </div>
          ))}
        </section>

        {error ? (
          <div className="rounded-lg border border-red-500/40 bg-red-950/60 p-4 text-sm text-red-100">
            {error}
          </div>
        ) : null}

        <section className="rounded-lg border border-slate-800 bg-slate-900 p-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-lg font-semibold">Cleanup Preview</h2>
              <p className="mt-1 text-sm text-slate-400">
                Preview before purging. Blocked files remain active and list their
                reason.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                className="h-10 rounded-md border border-slate-700 px-4 text-sm font-semibold text-slate-100 hover:bg-slate-800 disabled:opacity-60"
                disabled={isLoading}
                onClick={() => void runPreview()}
                type="button"
              >
                {isLoading ? "Working..." : "Run cleanup preview"}
              </button>
              <button
                className="h-10 rounded-md bg-cyan-300 px-4 text-sm font-semibold text-slate-950 hover:bg-cyan-200 disabled:opacity-60"
                disabled={isLoading || !preview || preview.safe_to_purge_count === 0}
                onClick={() => void runCleanup()}
                type="button"
              >
                Run cleanup now
              </button>
            </div>
          </div>

          {preview ? (
            <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-3">
              <div className="rounded-md bg-slate-950 p-3">
                <dt className="text-slate-400">Candidates</dt>
                <dd className="mt-1 text-xl font-semibold">
                  {preview.total_candidates}
                </dd>
              </div>
              <div className="rounded-md bg-slate-950 p-3">
                <dt className="text-slate-400">Safe to purge</dt>
                <dd className="mt-1 text-xl font-semibold">
                  {preview.safe_to_purge_count}
                </dd>
              </div>
              <div className="rounded-md bg-slate-950 p-3">
                <dt className="text-slate-400">Blocked</dt>
                <dd className="mt-1 text-xl font-semibold">
                  {preview.blocked_count}
                </dd>
              </div>
            </dl>
          ) : null}

          {runResult ? (
            <p className="mt-4 rounded-md border border-emerald-500/40 bg-emerald-950/50 px-3 py-2 text-sm text-emerald-100">
              Cleanup complete. Purged {runResult.purged_count} attachment
              {runResult.purged_count === 1 ? "" : "s"}; blocked{" "}
              {runResult.blocked_count}.
            </p>
          ) : null}

          {preview && candidates.length === 0 ? (
            <p className="mt-4 text-sm text-slate-400">
              No attachments are eligible for retention cleanup.
            </p>
          ) : null}

          {candidates.length > 0 ? (
            <div className="mt-4 overflow-x-auto">
              <table className="min-w-full divide-y divide-slate-800 text-sm">
                <thead className="text-left text-xs uppercase tracking-wide text-slate-400">
                  <tr>
                    <th className="px-3 py-2">Attachment</th>
                    <th className="px-3 py-2">Uploaded</th>
                    <th className="px-3 py-2">Status</th>
                    <th className="px-3 py-2">Context</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800">
                  {candidates.map((candidate) => (
                    <tr key={`${candidate.attachment_table}-${candidate.attachment_id}`}>
                      <td className="px-3 py-3">
                        <p className="font-semibold text-slate-100">
                          {candidate.original_filename ||
                            `${candidate.attachment_type} #${candidate.attachment_id}`}
                        </p>
                        <p className="mt-1 break-all text-xs text-slate-500">
                          {candidate.file_path}
                        </p>
                      </td>
                      <td className="whitespace-nowrap px-3 py-3 text-slate-300">
                        {candidate.uploaded_at?.slice(0, 10)}
                      </td>
                      <td className="px-3 py-3">
                        {candidate.safe_to_purge ? (
                          <span className="rounded bg-emerald-500/20 px-2 py-1 text-xs font-semibold text-emerald-100">
                            Safe to purge
                          </span>
                        ) : (
                          <div className="space-y-1">
                            <span className="rounded bg-amber-500/20 px-2 py-1 text-xs font-semibold text-amber-100">
                              Blocked
                            </span>
                            {candidate.blocked_reasons.map((reason) => (
                              <p className="text-xs text-slate-400" key={reason}>
                                {reason}
                              </p>
                            ))}
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-3 text-xs text-slate-400">
                        <p>Purchase: {candidate.metadata.purchase_id ?? "-"}</p>
                        <p>Card: {candidate.metadata.card_id ?? "-"}</p>
                        <p>Brand: {candidate.metadata.brand ?? "-"}</p>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </section>
      </div>
    </main>
  );
}
