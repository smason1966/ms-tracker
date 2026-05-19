"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import {
  ChangeEvent,
  FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";

import { API_BASE_URL } from "@/lib/api";

type FuelAccount = {
  id: number;
  retailer: string;
  email: string | null;
  alt_id: string | null;
  status: string;
  target_points: number | null;
  barcode_image_url: string | null;
  barcode_value: string | null;
  notes: string | null;
  current_points: number;
  remaining_to_target: number | null;
  nearest_expiration_date: string | null;
  expiration_cycle: string | null;
  entries_count: number;
};

type FuelPointEntry = {
  id: number;
  fuel_reward_account_id: number;
  purchase_batch_id: number;
  earned_date: string;
  expires_on: string;
  multiplier: number | null;
  qualifying_spend: string | number | null;
  points_earned: number;
  notes: string | null;
  created_at: string;
  purchase: {
    id: number;
    store_name: string;
    purchase_date: string;
    total_amount: string | number;
    purchase_total_paid: string | number | null;
  };
};

type HistoryEntry = FuelPointEntry & {
  running_points: number;
};

function formatNumber(value: number | null) {
  if (value === null) {
    return "-";
  }

  return value.toLocaleString();
}

function formatDate(value: string | null) {
  if (!value) {
    return "-";
  }

  const date = value.includes("T")
    ? new Date(value)
    : new Date(`${value}T00:00:00`);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date);
}

function formatCycle(value: string | null) {
  return value ? formatDate(value) : "No cycle yet";
}

function formatAmount(value: string | number | null) {
  if (value === null || value === "") {
    return "-";
  }

  const amount = Number(value);

  if (Number.isNaN(amount)) {
    return String(value);
  }

  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(amount);
}

function getUploadUrl(path: string | null) {
  if (!path) {
    return null;
  }

  if (path.startsWith("http://") || path.startsWith("https://")) {
    return path;
  }

  return `${API_BASE_URL}/${path.replace(/^\/+/, "")}`;
}

function getProgressPercent(account: FuelAccount) {
  if (!account.target_points || account.target_points <= 0) {
    return null;
  }

  return Math.min(
    100,
    Math.round((account.current_points / account.target_points) * 100),
  );
}

function getProgressBarClass(progressPercent: number | null) {
  if (progressPercent === null) {
    return "bg-slate-300";
  }

  if (progressPercent >= 100) {
    return "bg-emerald-600";
  }

  if (progressPercent > 75) {
    return "bg-amber-500";
  }

  return "bg-blue-600";
}

export default function FuelAccountDetailPage() {
  const params = useParams<{ id: string | string[] }>();
  const accountId = Array.isArray(params.id) ? params.id[0] : params.id;

  const [account, setAccount] = useState<FuelAccount | null>(null);
  const [entries, setEntries] = useState<FuelPointEntry[]>([]);
  const [targetPoints, setTargetPoints] = useState("");
  const [barcodeFileInputKey, setBarcodeFileInputKey] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isUploadingBarcode, setIsUploadingBarcode] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const loadAccount = useCallback(async () => {
    if (!accountId) {
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const [accountResponse, entriesResponse] = await Promise.all([
        fetch(`${API_BASE_URL}/fuel-accounts/${accountId}`),
        fetch(`${API_BASE_URL}/fuel-accounts/${accountId}/entries`),
      ]);

      if (!accountResponse.ok) {
        throw new Error(`Failed to load account (${accountResponse.status})`);
      }

      if (!entriesResponse.ok) {
        throw new Error(`Failed to load entries (${entriesResponse.status})`);
      }

      const accountData = (await accountResponse.json()) as FuelAccount;
      const entriesData = (await entriesResponse.json()) as FuelPointEntry[];

      setAccount(accountData);
      setTargetPoints(
        accountData.target_points !== null ? String(accountData.target_points) : "",
      );
      setEntries(entriesData);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to load fuel account.",
      );
    } finally {
      setIsLoading(false);
    }
  }, [accountId]);

  useEffect(() => {
    queueMicrotask(() => {
      void loadAccount();
    });
  }, [loadAccount]);

  async function updateAccount(payload: Partial<FuelAccount>) {
    if (!accountId) {
      return;
    }

    setIsSaving(true);
    setError(null);
    setSuccessMessage(null);

    try {
      const response = await fetch(`${API_BASE_URL}/fuel-accounts/${accountId}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        throw new Error(`Failed to update account (${response.status})`);
      }

      await loadAccount();
      setSuccessMessage("Account updated.");
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to update account.",
      );
    } finally {
      setIsSaving(false);
    }
  }

  async function handleTargetSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await updateAccount({
      target_points: targetPoints.trim() === "" ? null : Number(targetPoints),
    });
  }

  async function handleBarcodeImageChange(
    event: ChangeEvent<HTMLInputElement>,
  ) {
    if (!accountId || !event.target.files?.[0]) {
      return;
    }

    const file = event.target.files[0];
    const formData = new FormData();
    formData.append("file", file);

    setIsUploadingBarcode(true);
    setError(null);
    setSuccessMessage(null);

    try {
      const response = await fetch(
        `${API_BASE_URL}/fuel-accounts/${accountId}/barcode-image`,
        {
          method: "POST",
          body: formData,
        },
      );

      if (!response.ok) {
        throw new Error(`Failed to upload barcode image (${response.status})`);
      }

      const updatedAccount = (await response.json()) as FuelAccount;
      setAccount(updatedAccount);
      setBarcodeFileInputKey((currentKey) => currentKey + 1);
      setSuccessMessage("Barcode image uploaded.");
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to upload barcode image.",
      );
    } finally {
      setIsUploadingBarcode(false);
    }
  }

  const totalAccumulatedPoints = useMemo(
    () => entries.reduce((total, entry) => total + entry.points_earned, 0),
    [entries],
  );
  const progressPercent = account ? getProgressPercent(account) : null;
  const progressBarClass = getProgressBarClass(progressPercent);
  const barcodeImageUrl = account
    ? getUploadUrl(account.barcode_image_url)
    : null;

  const history = useMemo<HistoryEntry[]>(() => {
    const withRunningPoints = [...entries]
      .sort((first, second) => {
        const firstDate = new Date(first.earned_date).getTime();
        const secondDate = new Date(second.earned_date).getTime();

        return firstDate - secondDate || first.id - second.id;
      })
      .reduce<HistoryEntry[]>((historyEntries, entry) => {
        const previousRunningPoints =
          historyEntries[historyEntries.length - 1]?.running_points ?? 0;

        return [
          ...historyEntries,
          {
            ...entry,
            running_points: previousRunningPoints + entry.points_earned,
          },
        ];
      }, []);

    return [...withRunningPoints].reverse();
  }, [entries]);

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-8 text-slate-950 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-6xl space-y-6">
        <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <Link
              className="text-sm font-semibold text-slate-600 transition hover:text-slate-950"
              href="/fuel-accounts"
            >
              Back to Fuel Accounts
            </Link>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight">
              {account?.retailer ?? "Fuel Account"}
            </h1>
            {account ? (
              <p className="mt-1 text-sm text-slate-500">
                {account.email || account.alt_id || "No account identifier"} ·{" "}
                {account.status}
              </p>
            ) : null}
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              className="h-11 cursor-pointer rounded-md border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-700 transition hover:bg-slate-100 active:bg-slate-200 disabled:cursor-not-allowed disabled:opacity-60"
              disabled={isLoading || isSaving}
              onClick={loadAccount}
              type="button"
            >
              Refresh
            </button>
            <button
              className="h-11 cursor-pointer rounded-md bg-emerald-700 px-4 text-sm font-semibold text-white transition hover:bg-emerald-600 active:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-60"
              disabled={isSaving || !account || account.status === "SOLD"}
              onClick={() => updateAccount({ status: "SOLD" })}
              type="button"
            >
              Mark SOLD
            </button>
            <button
              className="h-11 cursor-pointer rounded-md bg-slate-700 px-4 text-sm font-semibold text-white transition hover:bg-slate-600 active:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
              disabled={isSaving || !account || account.status === "INACTIVE"}
              onClick={() => updateAccount({ status: "INACTIVE" })}
              type="button"
            >
              Mark INACTIVE
            </button>
          </div>
        </header>

        {error ? (
          <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-800">
            {error}
          </div>
        ) : null}

        {successMessage ? (
          <div className="rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-800">
            {successMessage}
          </div>
        ) : null}

        {isLoading ? (
          <div className="rounded-lg border border-slate-200 bg-white px-6 py-12 text-center text-sm text-slate-500 shadow-sm">
            Loading fuel account...
          </div>
        ) : account ? (
          <>
            <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h2 className="text-lg font-semibold">Target Progress</h2>
                  <p className="mt-1 text-sm text-slate-500">
                    {formatNumber(account.current_points)} /{" "}
                    {formatNumber(account.target_points)} points{" "}
                    {progressPercent !== null ? `(${progressPercent}%)` : ""}
                  </p>
                </div>
                {account.target_points !== null &&
                account.current_points >= account.target_points ? (
                  <span className="inline-flex rounded-full border border-emerald-300 bg-emerald-50 px-3 py-1 text-sm font-semibold text-emerald-800">
                    Ready to Sell
                  </span>
                ) : null}
              </div>
              <div className="mt-4 h-3 overflow-hidden rounded-full bg-slate-200">
                <div
                  className={`h-full rounded-full ${progressBarClass}`}
                  style={{ width: `${progressPercent ?? 0}%` }}
                />
              </div>
            </section>

            <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
              <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Current Points
                </p>
                <p className="mt-2 text-2xl font-semibold">
                  {formatNumber(account.current_points)}
                </p>
              </div>
              <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Target
                </p>
                <p className="mt-2 text-2xl font-semibold">
                  {formatNumber(account.target_points)}
                </p>
              </div>
              <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Remaining
                </p>
                <p className="mt-2 text-2xl font-semibold">
                  {formatNumber(account.remaining_to_target)}
                </p>
              </div>
              <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Expiration
                </p>
                <p className="mt-2 text-lg font-semibold">
                  {formatDate(account.nearest_expiration_date)}
                </p>
              </div>
              <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Expiration Cycle
                </p>
                <p className="mt-2 text-lg font-semibold">
                  {formatCycle(account.expiration_cycle)}
                </p>
              </div>
              <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Total Accumulated
                </p>
                <p className="mt-2 text-2xl font-semibold">
                  {formatNumber(totalAccumulatedPoints)}
                </p>
              </div>
            </section>

            <section className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
              <div className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
                <div className="border-b border-slate-200 px-5 py-4">
                  <h2 className="text-lg font-semibold">Point History</h2>
                  <p className="mt-1 text-sm text-slate-500">
                    {entries.length} {entries.length === 1 ? "entry" : "entries"}
                  </p>
                </div>

                {history.length === 0 ? (
                  <div className="px-5 py-10 text-sm text-slate-500">
                    No point entries yet.
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="min-w-full divide-y divide-slate-200 text-sm">
                      <thead className="bg-slate-100 text-left text-xs font-semibold uppercase tracking-wide text-slate-600">
                        <tr>
                          <th className="px-5 py-3">Earned</th>
                          <th className="px-5 py-3">Purchase</th>
                          <th className="px-5 py-3">Spend</th>
                          <th className="px-5 py-3">Multiplier</th>
                          <th className="px-5 py-3">Points</th>
                          <th className="px-5 py-3">Running</th>
                          <th className="px-5 py-3">Expires</th>
                          <th className="px-5 py-3">Notes</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-200 bg-white">
                        {history.map((entry) => (
                          <tr key={entry.id} className="hover:bg-slate-50">
                            <td className="whitespace-nowrap px-5 py-4">
                              {formatDate(entry.earned_date)}
                            </td>
                            <td className="whitespace-nowrap px-5 py-4">
                              <Link
                                className="font-semibold text-slate-900 transition hover:text-slate-600"
                                href={`/purchases/${entry.purchase_batch_id}`}
                              >
                                {entry.purchase.store_name} #
                                {entry.purchase_batch_id}
                              </Link>
                            </td>
                            <td className="whitespace-nowrap px-5 py-4 text-slate-700">
                              {formatAmount(entry.qualifying_spend)}
                            </td>
                            <td className="whitespace-nowrap px-5 py-4 text-slate-700">
                              {entry.multiplier ? `${entry.multiplier}x` : "-"}
                            </td>
                            <td className="whitespace-nowrap px-5 py-4 font-semibold">
                              {formatNumber(entry.points_earned)}
                            </td>
                            <td className="whitespace-nowrap px-5 py-4 text-slate-700">
                              {formatNumber(entry.running_points)}
                            </td>
                            <td className="whitespace-nowrap px-5 py-4 text-slate-700">
                              {formatDate(entry.expires_on)}
                            </td>
                            <td className="max-w-xs px-5 py-4 text-slate-600">
                              {entry.notes || ""}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              <aside className="space-y-4">
                <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
                  <h2 className="text-lg font-semibold">Barcode</h2>
                  {barcodeImageUrl ? (
                    <div className="mt-4 rounded-md border border-slate-200 bg-white p-3">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        alt={`${account.retailer} barcode`}
                        className="mx-auto max-h-80 w-full object-contain"
                        src={barcodeImageUrl}
                      />
                    </div>
                  ) : (
                    <p className="mt-3 text-sm text-slate-500">
                      No barcode image uploaded.
                    </p>
                  )}
                  {account.barcode_value ? (
                    <p className="mt-3 break-all rounded-md bg-slate-50 px-3 py-2 text-sm font-medium text-slate-700">
                      {account.barcode_value}
                    </p>
                  ) : null}
                  <label className="mt-4 flex h-11 cursor-pointer items-center justify-center rounded-md bg-slate-900 px-4 text-sm font-semibold text-white transition hover:bg-slate-700 active:bg-slate-800">
                    <span>
                      {isUploadingBarcode
                        ? "Uploading..."
                        : barcodeImageUrl
                          ? "Replace Barcode Image"
                          : "Upload Barcode Image"}
                    </span>
                    <input
                      className="sr-only"
                      disabled={isUploadingBarcode}
                      key={barcodeFileInputKey}
                      onChange={handleBarcodeImageChange}
                      type="file"
                      accept="image/jpeg,image/png,image/webp,image/heic,.jpg,.jpeg,.png,.webp,.heic"
                    />
                  </label>
                </section>

                <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
                  <h2 className="text-lg font-semibold">Edit Target</h2>
                  <form className="mt-4 space-y-3" onSubmit={handleTargetSubmit}>
                    <label className="block space-y-2 text-sm font-medium text-slate-700">
                      <span>Target Points</span>
                      <input
                        className="h-11 w-full rounded-md border border-slate-300 px-3 text-slate-950 outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-200"
                        min="0"
                        onChange={(event) => setTargetPoints(event.target.value)}
                        step="1"
                        type="number"
                        value={targetPoints}
                      />
                    </label>
                    <button
                      className="h-11 w-full cursor-pointer rounded-md bg-slate-900 px-4 text-sm font-semibold text-white transition hover:bg-slate-700 active:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
                      disabled={isSaving}
                      type="submit"
                    >
                      {isSaving ? "Saving..." : "Save Target"}
                    </button>
                  </form>
                </section>

                <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
                  <h2 className="text-lg font-semibold">Notes</h2>
                  <p className="mt-3 whitespace-pre-wrap text-sm text-slate-600">
                    {account.notes || "No notes."}
                  </p>
                </section>
              </aside>
            </section>
          </>
        ) : (
          <div className="rounded-lg border border-slate-200 bg-white px-6 py-12 text-center text-sm text-slate-500 shadow-sm">
            Fuel account not found.
          </div>
        )}
      </div>
    </main>
  );
}
