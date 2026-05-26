"use client";

import Link from "next/link";
import {
  ChangeEvent,
  FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";

import { API_BASE_URL } from "@/lib/api";

type FuelAccountDashboardRow = {
  id: number;
  retailer: string;
  email: string | null;
  alt_id: string | null;
  barcode_image_url: string | null;
  barcode_value: string | null;
  status: string;
  target_points: number | null;
  current_points: number;
  remaining_to_target: number | null;
  nearest_expiration_date: string | null;
  expiration_cycle: string | null;
  entries_count: number;
};

type StoreRow = {
  id: number;
  name: string;
  retailer_group: string | null;
  active: boolean;
  earns_fuel_points: boolean;
  default_fuel_multiplier: number | null;
};

type SortOption = "closest" | "expiration" | "balance";
type LifecycleFilter = "active" | "sold" | "expired" | "inactive" | "all";

type FuelAccountForm = {
  retailer: string;
  email: string;
  login_password: string;
  alt_id: string;
  barcode_value: string;
  target_points: string;
  status: string;
  notes: string;
};

const emptyFuelAccountForm: FuelAccountForm = {
  retailer: "",
  email: "",
  login_password: "",
  alt_id: "",
  barcode_value: "",
  target_points: "",
  status: "ACTIVE",
  notes: "",
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

  const date = new Date(`${value}T00:00:00`);

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
  return value ? formatDate(value) : "Fresh";
}

function getDaysUntil(value: string | null) {
  if (!value) {
    return null;
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const expiration = new Date(`${value}T00:00:00`);

  if (Number.isNaN(expiration.getTime())) {
    return null;
  }

  return Math.ceil((expiration.getTime() - today.getTime()) / 86400000);
}

function isKnownPastDate(value: string | null) {
  const daysUntil = getDaysUntil(value);
  return daysUntil !== null && daysUntil < 0;
}

function isExpiredAccount(account: FuelAccountDashboardRow) {
  if (account.status !== "ACTIVE") {
    return false;
  }

  const knownExpirationDate =
    account.nearest_expiration_date || account.expiration_cycle;

  return (
    account.entries_count > 0 &&
    account.current_points <= 0 &&
    isKnownPastDate(knownExpirationDate)
  );
}

function isUsableAccount(account: FuelAccountDashboardRow) {
  return account.status === "ACTIVE" && !isExpiredAccount(account);
}

function hasBarcodeData(account: FuelAccountDashboardRow) {
  return Boolean(
    account.barcode_image_url ||
      account.barcode_value?.trim() ||
      account.alt_id?.trim() ||
      account.email?.trim(),
  );
}

function emptyStateLabel(filter: LifecycleFilter) {
  if (filter === "sold") {
    return "No sold fuel accounts found.";
  }

  if (filter === "expired") {
    return "No expired fuel accounts found.";
  }

  if (filter === "inactive") {
    return "No inactive or closed fuel accounts found.";
  }

  if (filter === "all") {
    return "No fuel accounts found.";
  }

  return "No active fuel accounts found.";
}

function getProgressPercent(account: FuelAccountDashboardRow) {
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

function getIndicator(account: FuelAccountDashboardRow) {
  if (account.status === "SOLD") {
    return {
      label: "Sold",
      className: "border-slate-300 bg-slate-100 text-slate-700",
    };
  }

  if (account.status === "INACTIVE") {
    return {
      label: "Inactive",
      className: "border-slate-300 bg-slate-50 text-slate-600",
    };
  }

  if (isExpiredAccount(account)) {
    return {
      label: "Expired",
      className: "border-red-300 bg-red-50 text-red-800",
    };
  }

  const daysUntilExpiration = getDaysUntil(account.nearest_expiration_date);

  if (
    daysUntilExpiration !== null &&
    daysUntilExpiration >= 0 &&
    daysUntilExpiration <= 7
  ) {
    return {
      label: "Expiring soon",
      className: "border-red-300 bg-red-50 text-red-800",
    };
  }

  if (
    daysUntilExpiration !== null &&
    daysUntilExpiration >= 0 &&
    daysUntilExpiration <= 14
  ) {
    return {
      label: "Expires within 14 days",
      className: "border-amber-300 bg-amber-50 text-amber-800",
    };
  }

  if (
    account.target_points !== null &&
    account.current_points >= account.target_points
  ) {
    return {
      label: "Target reached",
      className: "border-emerald-300 bg-emerald-50 text-emerald-800",
    };
  }

  if (
    account.remaining_to_target !== null &&
    account.remaining_to_target <= 2000
  ) {
    return {
      label: "Near target",
      className: "border-amber-300 bg-amber-50 text-amber-800",
    };
  }

  return {
    label: "Active",
    className: "border-slate-200 bg-slate-50 text-slate-700",
  };
}

export default function FuelAccountsPage() {
  const [accounts, setAccounts] = useState<FuelAccountDashboardRow[]>([]);
  const [stores, setStores] = useState<StoreRow[]>([]);
  const [sortOption, setSortOption] = useState<SortOption>("closest");
  const [lifecycleFilter, setLifecycleFilter] =
    useState<LifecycleFilter>("active");
  const [form, setForm] = useState<FuelAccountForm>(emptyFuelAccountForm);
  const [barcodeImageFile, setBarcodeImageFile] = useState<File | null>(null);
  const [barcodeImageInputKey, setBarcodeImageInputKey] = useState(0);
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [isSavingAccount, setIsSavingAccount] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [createError, setCreateError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const loadAccounts = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch(`${API_BASE_URL}/fuel-accounts/dashboard`);

      if (!response.ok) {
        throw new Error(`Failed to load fuel accounts (${response.status})`);
      }

      const data = (await response.json()) as FuelAccountDashboardRow[];
      setAccounts(data);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to load fuel accounts.",
      );
    } finally {
      setIsLoading(false);
    }
  }, []);

  const loadStores = useCallback(async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/stores/`);

      if (!response.ok) {
        throw new Error(`Failed to load stores (${response.status})`);
      }

      const data = (await response.json()) as StoreRow[];
      setStores(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load stores.");
    }
  }, []);

  useEffect(() => {
    queueMicrotask(() => {
      void loadAccounts();
      void loadStores();
    });
  }, [loadAccounts, loadStores]);

  const visibleAccounts = useMemo(
    () =>
      accounts
        .filter((account) => {
          if (lifecycleFilter === "all") {
            return true;
          }

          if (lifecycleFilter === "active") {
            return isUsableAccount(account);
          }

          if (lifecycleFilter === "expired") {
            return isExpiredAccount(account);
          }

          if (lifecycleFilter === "sold") {
            return account.status === "SOLD";
          }

          return account.status === "INACTIVE";
        })
        .sort((first, second) => {
          if (sortOption === "expiration") {
            const firstTime = first.nearest_expiration_date
              ? new Date(`${first.nearest_expiration_date}T00:00:00`).getTime()
              : Number.POSITIVE_INFINITY;
            const secondTime = second.nearest_expiration_date
              ? new Date(`${second.nearest_expiration_date}T00:00:00`).getTime()
              : Number.POSITIVE_INFINITY;

            return firstTime - secondTime;
          }

          if (sortOption === "balance") {
            return second.current_points - first.current_points;
          }

          const firstRemaining =
            first.remaining_to_target ?? Number.POSITIVE_INFINITY;
          const secondRemaining =
            second.remaining_to_target ?? Number.POSITIVE_INFINITY;

          return firstRemaining - secondRemaining;
        }),
    [accounts, lifecycleFilter, sortOption],
  );

  const fuelEligibleRetailerOptions = useMemo(() => {
    const retailerNames = new Set<string>();

    stores
      .filter(
        (store) =>
          store.active &&
          (store.earns_fuel_points || store.default_fuel_multiplier !== null),
      )
      .forEach((store) => {
        const retailer = (store.retailer_group || store.name).trim();

        if (retailer) {
          retailerNames.add(retailer);
        }
      });

    return [...retailerNames].sort((first, second) =>
      first.localeCompare(second),
    );
  }, [stores]);

  const retailerOptions = useMemo(() => {
    const retailerNames = new Set<string>(fuelEligibleRetailerOptions);

    accounts.forEach((account) => {
      const retailer = account.retailer.trim();

      if (retailer) {
        retailerNames.add(retailer);
      }
    });

    return [...retailerNames].sort((first, second) =>
      first.localeCompare(second),
    );
  }, [accounts, fuelEligibleRetailerOptions]);

  function updateFormField(field: keyof FuelAccountForm, value: string) {
    setForm((currentForm) => ({
      ...currentForm,
      [field]: value,
    }));
  }

  function getOptionalValue(value: string) {
    const trimmedValue = value.trim();
    return trimmedValue === "" ? null : trimmedValue;
  }

  function openCreateModal() {
    setForm(emptyFuelAccountForm);
    setBarcodeImageFile(null);
    setBarcodeImageInputKey((currentKey) => currentKey + 1);
    setCreateError(null);
    setIsCreateModalOpen(true);
  }

  function closeCreateModal() {
    if (isSavingAccount) {
      return;
    }

    setIsCreateModalOpen(false);
    setCreateError(null);
  }

  function handleBarcodeImageChange(event: ChangeEvent<HTMLInputElement>) {
    setBarcodeImageFile(event.target.files?.[0] ?? null);
  }

  async function handleCreateAccount(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const targetPoints = form.target_points.trim()
      ? Number(form.target_points)
      : null;

    if (targetPoints !== null && Number.isNaN(targetPoints)) {
      setCreateError("Target points must be a number.");
      return;
    }

    setIsSavingAccount(true);
    setCreateError(null);
    setSuccessMessage(null);

    try {
      const response = await fetch(`${API_BASE_URL}/fuel-accounts/`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          retailer: form.retailer.trim(),
          email: getOptionalValue(form.email),
          login_password: getOptionalValue(form.login_password),
          alt_id: getOptionalValue(form.alt_id),
          barcode_value: getOptionalValue(form.barcode_value),
          target_points: targetPoints,
          status: form.status,
          notes: getOptionalValue(form.notes),
        }),
      });

      if (!response.ok) {
        const responseBody = await response.text();
        throw new Error(
          `Failed to create fuel account (${response.status}): ${responseBody}`,
        );
      }

      const createdAccount = (await response.json()) as FuelAccountDashboardRow;

      if (barcodeImageFile) {
        const formData = new FormData();
        formData.append("file", barcodeImageFile);

        const uploadResponse = await fetch(
          `${API_BASE_URL}/fuel-accounts/${createdAccount.id}/barcode-image`,
          {
            method: "POST",
            body: formData,
          },
        );

        if (!uploadResponse.ok) {
          const responseBody = await uploadResponse.text();
          throw new Error(
            `Fuel account was created, but barcode upload failed (${uploadResponse.status}): ${responseBody}`,
          );
        }
      }

      setSuccessMessage(`${form.retailer.trim()} fuel account created.`);
      setIsCreateModalOpen(false);
      setForm(emptyFuelAccountForm);
      setBarcodeImageFile(null);
      setBarcodeImageInputKey((currentKey) => currentKey + 1);
      await loadAccounts();
    } catch (err) {
      setCreateError(
        err instanceof Error ? err.message : "Failed to create fuel account.",
      );
    } finally {
      setIsSavingAccount(false);
    }
  }

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-8 text-slate-950 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-6xl space-y-6">
        <header>
          <div>
            <p className="text-sm font-medium text-slate-500">Fuel Rewards</p>
            <h1 className="mt-1 text-3xl font-semibold tracking-tight">
              Fuel Accounts
            </h1>
          </div>
        </header>

        <section className="flex flex-col gap-3 rounded-lg border border-slate-200 bg-white p-4 shadow-sm sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <label className="flex items-center gap-2 text-sm font-medium text-slate-700">
              <span>Status</span>
              <select
                className="h-11 cursor-pointer rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-950 outline-none transition hover:bg-slate-50 focus:border-slate-500 focus:ring-2 focus:ring-slate-200"
                onChange={(event) =>
                  setLifecycleFilter(event.target.value as LifecycleFilter)
                }
                value={lifecycleFilter}
              >
                <option value="active">Active</option>
                <option value="sold">Sold</option>
                <option value="expired">Expired</option>
                <option value="inactive">Inactive/Closed</option>
                <option value="all">All</option>
              </select>
            </label>
            <label className="flex items-center gap-2 text-sm font-medium text-slate-700">
              <span>Sort</span>
              <select
                className="h-11 cursor-pointer rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-950 outline-none transition hover:bg-slate-50 focus:border-slate-500 focus:ring-2 focus:ring-slate-200"
                onChange={(event) =>
                  setSortOption(event.target.value as SortOption)
                }
                value={sortOption}
              >
                <option value="closest">Closest to target</option>
                <option value="expiration">Expiration soonest</option>
                <option value="balance">Highest balance</option>
              </select>
            </label>
          </div>
          <button
            className="h-11 cursor-pointer rounded-md bg-slate-950 px-4 text-sm font-semibold text-white transition hover:bg-slate-800 active:bg-slate-900"
            onClick={openCreateModal}
            type="button"
          >
            Add Fuel Account
          </button>
        </section>

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
            Loading fuel accounts...
          </div>
        ) : visibleAccounts.length === 0 ? (
          <div className="rounded-lg border border-slate-200 bg-white px-6 py-12 text-center text-sm text-slate-500 shadow-sm">
            {emptyStateLabel(lifecycleFilter)}
          </div>
        ) : (
          <>
            <div className="grid gap-4 lg:hidden">
              {visibleAccounts.map((account) => {
                const indicator = getIndicator(account);
                const progressPercent = getProgressPercent(account);
                const progressBarClass = getProgressBarClass(progressPercent);
                const canOpenBarcode = hasBarcodeData(account);

                return (
                  <article
                    className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm"
                    key={account.id}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <h2 className="text-lg font-semibold">
                          {account.retailer}
                        </h2>
                        <p className="mt-1 truncate text-sm text-slate-500">
                          {account.email || account.alt_id || "-"}
                        </p>
                      </div>
                      <span
                        className={`shrink-0 rounded-full border px-2 py-1 text-xs font-semibold ${indicator.className}`}
                      >
                        {indicator.label}
                      </span>
                    </div>

                    <div className="mt-4 grid grid-cols-3 gap-2 text-center">
                      <div className="rounded-md bg-slate-50 p-3">
                        <p className="text-xs font-semibold text-slate-500">
                          Current
                        </p>
                        <p className="mt-1 text-lg font-bold">
                          {formatNumber(account.current_points)}
                        </p>
                      </div>
                      <div className="rounded-md bg-slate-50 p-3">
                        <p className="text-xs font-semibold text-slate-500">
                          Target
                        </p>
                        <p className="mt-1 text-lg font-bold">
                          {formatNumber(account.target_points)}
                        </p>
                      </div>
                      <div className="rounded-md bg-slate-50 p-3">
                        <p className="text-xs font-semibold text-slate-500">
                          Expires
                        </p>
                        <p className="mt-1 text-sm font-bold">
                          {formatDate(account.nearest_expiration_date)}
                        </p>
                      </div>
                    </div>

                    <div className="mt-4">
                      <div className="flex justify-between text-xs font-medium text-slate-600">
                        <span>
                          {progressPercent !== null
                            ? `${progressPercent}%`
                            : "No target"}
                        </span>
                        <span>{formatCycle(account.expiration_cycle)}</span>
                      </div>
                      <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-200">
                        <div
                          className={`h-full rounded-full ${progressBarClass}`}
                          style={{ width: `${progressPercent ?? 0}%` }}
                        />
                      </div>
                    </div>

                    <div className="mt-4 grid gap-2 sm:grid-cols-2">
                      {canOpenBarcode ? (
                        <Link
                          className={`flex h-11 cursor-pointer items-center justify-center rounded-md px-4 text-sm font-semibold transition ${
                            isUsableAccount(account)
                              ? "bg-slate-900 text-white hover:bg-slate-700 active:bg-slate-800"
                              : "border border-slate-300 bg-white text-slate-600 hover:bg-slate-100 active:bg-slate-200"
                          }`}
                          href={`/fuel-accounts/${account.id}/barcode`}
                        >
                          Open Barcode
                        </Link>
                      ) : (
                        <span className="flex h-11 cursor-not-allowed items-center justify-center rounded-md border border-slate-200 bg-slate-100 px-4 text-sm font-semibold text-slate-400">
                          Barcode unavailable
                        </span>
                      )}
                      <Link
                        className="flex h-11 cursor-pointer items-center justify-center rounded-md border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-700 transition hover:bg-slate-100 active:bg-slate-200"
                        href={`/fuel-accounts/${account.id}`}
                      >
                        Details
                      </Link>
                    </div>
                  </article>
                );
              })}
            </div>

            <div className="hidden overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm lg:block">
              <table className="min-w-full divide-y divide-slate-200 text-sm">
                <thead className="bg-slate-100 text-left text-xs font-semibold uppercase tracking-wide text-slate-600">
                  <tr>
                    <th className="px-5 py-3">Retailer</th>
                    <th className="px-5 py-3">Current</th>
                    <th className="px-5 py-3">Progress</th>
                    <th className="px-5 py-3">Target</th>
                    <th className="px-5 py-3">Expiration</th>
                    <th className="px-5 py-3">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 bg-white">
                  {visibleAccounts.map((account) => {
                    const indicator = getIndicator(account);
                    const progressPercent = getProgressPercent(account);
                    const progressBarClass = getProgressBarClass(progressPercent);
                    const canOpenBarcode = hasBarcodeData(account);
                    const isReadyToSell =
                      isUsableAccount(account) &&
                      account.target_points !== null &&
                      account.current_points >= account.target_points;

                    return (
                      <tr key={account.id} className="hover:bg-slate-50">
                        <td className="whitespace-nowrap px-5 py-4 font-semibold">
                          <div className="flex items-center gap-2">
                            <span>{account.retailer}</span>
                            <span
                              className={`rounded-full border px-2 py-0.5 text-xs font-semibold ${indicator.className}`}
                            >
                              {indicator.label}
                            </span>
                          </div>
                          <div className="mt-1 text-xs font-normal text-slate-500">
                            {account.email || account.alt_id || "-"}
                          </div>
                        </td>
                        <td className="whitespace-nowrap px-5 py-4 font-semibold">
                          {formatNumber(account.current_points)}
                        </td>
                        <td className="min-w-44 px-5 py-4">
                          <div className="flex items-center justify-between gap-3 text-xs font-medium text-slate-600">
                            <span>
                              {progressPercent !== null
                                ? `${progressPercent}%`
                                : "No target"}
                            </span>
                            {isReadyToSell ? (
                              <span className="rounded-full bg-emerald-100 px-2 py-1 font-semibold text-emerald-800">
                                Ready to Sell
                              </span>
                            ) : null}
                          </div>
                          <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-200">
                            <div
                              className={`h-full rounded-full ${progressBarClass}`}
                              style={{ width: `${progressPercent ?? 0}%` }}
                            />
                          </div>
                        </td>
                        <td className="whitespace-nowrap px-5 py-4 text-slate-700">
                          {formatNumber(account.target_points)}
                        </td>
                        <td className="whitespace-nowrap px-5 py-4 text-slate-700">
                          <div>{formatDate(account.nearest_expiration_date)}</div>
                          <div className="mt-1 text-xs text-slate-500">
                            {formatCycle(account.expiration_cycle)}
                          </div>
                        </td>
                        <td className="whitespace-nowrap px-5 py-4">
                          <div className="flex flex-col gap-2 xl:flex-row">
                            {canOpenBarcode ? (
                              <Link
                                className={`inline-flex h-10 cursor-pointer items-center justify-center rounded-md px-4 text-sm font-semibold transition ${
                                  isUsableAccount(account)
                                    ? "bg-slate-900 text-white hover:bg-slate-700 active:bg-slate-800"
                                    : "border border-slate-300 bg-white text-slate-600 hover:bg-slate-100 active:bg-slate-200"
                                }`}
                                href={`/fuel-accounts/${account.id}/barcode`}
                              >
                                Open Barcode
                              </Link>
                            ) : (
                              <span className="inline-flex h-10 cursor-not-allowed items-center justify-center rounded-md border border-slate-200 bg-slate-100 px-4 text-sm font-semibold text-slate-400">
                                Barcode unavailable
                              </span>
                            )}
                            <Link
                              className="inline-flex h-10 cursor-pointer items-center justify-center rounded-md border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-700 transition hover:bg-slate-100 active:bg-slate-200"
                              href={`/fuel-accounts/${account.id}`}
                            >
                              Details
                            </Link>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>

      {isCreateModalOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 px-4 py-6">
          <div className="w-full max-w-2xl rounded-lg border border-slate-200 bg-white p-6 shadow-xl">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-xl font-semibold">Add Fuel Account</h2>
                <p className="mt-1 text-sm text-slate-500">
                  Create the account shell now. Points are added from purchases.
                </p>
              </div>
              <button
                className="rounded-md px-2 py-1 text-sm font-semibold text-slate-500 transition hover:bg-slate-100 hover:text-slate-800"
                onClick={closeCreateModal}
                type="button"
              >
                Close
              </button>
            </div>

            {createError ? (
              <div className="mt-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-800">
                {createError}
              </div>
            ) : null}

            <form className="mt-5 space-y-4" onSubmit={handleCreateAccount}>
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="text-sm font-medium text-slate-700">
                  Retailer
                  <select
                    className="mt-1 h-11 w-full cursor-pointer rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-950 outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-200"
                    disabled={retailerOptions.length === 0}
                    onChange={(event) =>
                      updateFormField("retailer", event.target.value)
                    }
                    required
                    value={form.retailer}
                  >
                    <option value="">
                      {retailerOptions.length === 0
                        ? "No retailers available"
                        : "Select retailer"}
                    </option>
                    {retailerOptions.map((retailer) => (
                      <option key={retailer} value={retailer}>
                        {retailer}
                      </option>
                    ))}
                  </select>
                  {fuelEligibleRetailerOptions.length === 0 ? (
                    <span className="mt-1 block text-xs text-slate-500">
                      Configure a fuel-earning store first in Settings &gt;
                      Stores.
                    </span>
                  ) : null}
                </label>

                <label className="text-sm font-medium text-slate-700">
                  Status
                  <select
                    className="mt-1 h-11 w-full cursor-pointer rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-950 outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-200"
                    onChange={(event) =>
                      updateFormField("status", event.target.value)
                    }
                    value={form.status}
                  >
                    <option value="ACTIVE">Active</option>
                    <option value="INACTIVE">Inactive</option>
                  </select>
                </label>

                <label className="text-sm font-medium text-slate-700">
                  Rewards account identifier/email
                  <input
                    className="mt-1 h-11 w-full rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-950 outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-200"
                    onChange={(event) =>
                      updateFormField("email", event.target.value)
                    }
                    value={form.email}
                  />
                </label>

                <label className="text-sm font-medium text-slate-700">
                  Password / PIN
                  <input
                    className="mt-1 h-11 w-full rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-950 outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-200"
                    onChange={(event) =>
                      updateFormField("login_password", event.target.value)
                    }
                    type="password"
                    value={form.login_password}
                  />
                </label>

                <label className="text-sm font-medium text-slate-700">
                  Alternate ID / phone / loyalty number
                  <input
                    className="mt-1 h-11 w-full rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-950 outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-200"
                    onChange={(event) =>
                      updateFormField("alt_id", event.target.value)
                    }
                    value={form.alt_id}
                  />
                </label>

                <label className="text-sm font-medium text-slate-700">
                  Barcode value
                  <input
                    className="mt-1 h-11 w-full rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-950 outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-200"
                    onChange={(event) =>
                      updateFormField("barcode_value", event.target.value)
                    }
                    value={form.barcode_value}
                  />
                </label>

                <label className="text-sm font-medium text-slate-700">
                  Target points
                  <input
                    className="mt-1 h-11 w-full rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-950 outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-200"
                    min="0"
                    onChange={(event) =>
                      updateFormField("target_points", event.target.value)
                    }
                    type="number"
                    value={form.target_points}
                  />
                </label>
              </div>

              <label className="block text-sm font-medium text-slate-700">
                Barcode image
                <input
                  accept="image/jpeg,image/png,image/webp,image/heic,.jpg,.jpeg,.png,.webp,.heic"
                  className="mt-1 block w-full cursor-pointer rounded-md border border-dashed border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 file:mr-3 file:cursor-pointer file:rounded-md file:border-0 file:bg-slate-900 file:px-3 file:py-2 file:text-sm file:font-semibold file:text-white hover:bg-slate-50"
                  disabled={isSavingAccount}
                  key={barcodeImageInputKey}
                  onChange={handleBarcodeImageChange}
                  type="file"
                />
                {barcodeImageFile ? (
                  <span className="mt-1 block text-xs text-slate-500">
                    Selected: {barcodeImageFile.name}
                  </span>
                ) : null}
              </label>

              <label className="block text-sm font-medium text-slate-700">
                Notes
                <textarea
                  className="mt-1 min-h-24 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-950 outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-200"
                  onChange={(event) =>
                    updateFormField("notes", event.target.value)
                  }
                  value={form.notes}
                />
              </label>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  className="h-10 rounded-md border border-slate-300 px-4 text-sm font-semibold text-slate-700 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60"
                  disabled={isSavingAccount}
                  onClick={closeCreateModal}
                  type="button"
                >
                  Cancel
                </button>
                <button
                  className="h-10 rounded-md bg-slate-900 px-4 text-sm font-semibold text-white transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-60"
                  disabled={isSavingAccount}
                  type="submit"
                >
                  {isSavingAccount ? "Saving..." : "Create Account"}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </main>
  );
}
