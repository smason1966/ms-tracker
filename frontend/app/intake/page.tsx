"use client";

import { ChangeEvent, FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { API_BASE_URL } from "@/lib/api";

type Store = {
  id: number;
  name: string;
  store_type: string | null;
  active: boolean;
  earns_fuel_points: boolean;
  default_fuel_multiplier: number | null;
};

type FuelAccount = {
  id: number;
  retailer: string;
  email: string | null;
  alt_id: string | null;
  status: string;
  target_points: number | null;
  current_points: number;
  expiration_cycle: string | null;
  barcode_image_url: string | null;
  barcode_value: string | null;
};

type CreditCard = {
  id: number;
  nickname: string;
  issuer: string;
  last_four: string | null;
  is_active: boolean;
};

type PurchaseBatch = {
  id: number;
  store_name: string;
  purchase_date: string;
  total_amount: string | number;
  purchase_total_paid: string | number | null;
  fuel_points_quantity: number | null;
  fuel_points_unit: number | null;
  fuel_points_notes: string | null;
  financial_notes: string | null;
  notes: string | null;
};

type IntakeForm = {
  store_name: string;
  purchase_date: string;
  total_amount: string;
  purchase_total_paid: string;
  fuel_reward_account_id: string;
  fuel_multiplier_mode: string;
  custom_fuel_multiplier: string;
  should_override_fuel_points: boolean;
  fuel_points_earned: string;
  credit_card_id: string;
  fuel_notes: string;
  financial_notes: string;
  notes: string;
};

type PaymentRow = {
  payment_type: string;
  credit_card_id: string;
  amount: string;
  notes: string;
};

function getTodayDateString() {
  const today = new Date();
  const year = today.getFullYear();
  const month = String(today.getMonth() + 1).padStart(2, "0");
  const day = String(today.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

function createInitialForm(): IntakeForm {
  return {
    store_name: "",
    purchase_date: getTodayDateString(),
    total_amount: "",
    purchase_total_paid: "",
    fuel_reward_account_id: "",
    fuel_multiplier_mode: "4",
    custom_fuel_multiplier: "",
    should_override_fuel_points: false,
    fuel_points_earned: "",
    credit_card_id: "",
    fuel_notes: "",
    financial_notes: "",
    notes: "",
  };
}

function createEmptyPaymentRow(): PaymentRow {
  return {
    payment_type: "CREDIT_CARD",
    credit_card_id: "",
    amount: "",
    notes: "",
  };
}

function getFuelMultiplier(form: IntakeForm) {
  if (form.fuel_multiplier_mode === "custom") {
    const customMultiplier = Number(form.custom_fuel_multiplier);

    return Number.isNaN(customMultiplier) ? null : customMultiplier;
  }

  const multiplier = Number(form.fuel_multiplier_mode);

  return Number.isNaN(multiplier) ? null : multiplier;
}

function calculateFuelPointsEarned(form: IntakeForm) {
  const amount = Number(form.purchase_total_paid);
  const multiplier = getFuelMultiplier(form);

  if (
    !form.purchase_total_paid ||
    Number.isNaN(amount) ||
    multiplier === null
  ) {
    return null;
  }

  return Math.max(0, Math.round(amount * multiplier));
}

function getFuelPointBasisAmount(form: IntakeForm) {
  return form.purchase_total_paid || null;
}

function getFuelEntryExpirationDate(purchaseDate: string) {
  if (!purchaseDate) {
    return null;
  }

  const [yearText, monthText] = purchaseDate.split("-");
  const year = Number(yearText);
  const month = Number(monthText);

  if (Number.isNaN(year) || Number.isNaN(month)) {
    return null;
  }

  return new Date(year, month + 1, 0);
}

function formatDate(value: string | Date | null) {
  if (!value) {
    return "";
  }

  const date = value instanceof Date ? value : new Date(`${value}T00:00:00`);

  if (Number.isNaN(date.getTime())) {
    return String(value);
  }

  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(date);
}

function formatShortDate(value: string | Date | null) {
  if (!value) {
    return "";
  }

  const date = value instanceof Date ? value : new Date(`${value}T00:00:00`);

  if (Number.isNaN(date.getTime())) {
    return String(value);
  }

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date);
}

function hasDifferentExpirationCycle(
  accountExpirationCycle: string | null | undefined,
  entryExpirationDate: Date | null,
) {
  if (!accountExpirationCycle || !entryExpirationDate) {
    return false;
  }

  const accountCycleDate = new Date(`${accountExpirationCycle}T00:00:00`);

  if (Number.isNaN(accountCycleDate.getTime())) {
    return false;
  }

  return (
    accountCycleDate.getFullYear() !== entryExpirationDate.getFullYear() ||
    accountCycleDate.getMonth() !== entryExpirationDate.getMonth()
  );
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

export default function PurchaseIntakePage() {
  const router = useRouter();
  const [stores, setStores] = useState<Store[]>([]);
  const [fuelAccounts, setFuelAccounts] = useState<FuelAccount[]>([]);
  const [creditCards, setCreditCards] = useState<CreditCard[]>([]);
  const [form, setForm] = useState<IntakeForm>(() => createInitialForm());
  const [isSplitTenderEnabled, setIsSplitTenderEnabled] = useState(false);
  const [paymentRows, setPaymentRows] = useState<PaymentRow[]>([]);
  const [receiptFile, setReceiptFile] = useState<File | null>(null);
  const [isLoadingStores, setIsLoadingStores] = useState(true);
  const [isLoadingFuelAccounts, setIsLoadingFuelAccounts] = useState(true);
  const [isLoadingCreditCards, setIsLoadingCreditCards] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [storesError, setStoresError] = useState<string | null>(null);
  const [fuelAccountsError, setFuelAccountsError] = useState<string | null>(null);
  const [creditCardsError, setCreditCardsError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [fuelTargetNotice, setFuelTargetNotice] = useState<string | null>(null);
  const [isBarcodeVisible, setIsBarcodeVisible] = useState(false);
  const selectedStore = stores.find((store) => store.name === form.store_name);
  const showFuelPoints = Boolean(selectedStore?.earns_fuel_points);
  const calculatedFuelPoints = calculateFuelPointsEarned(form);
  const fuelPointsEarned =
    form.should_override_fuel_points && form.fuel_points_earned.trim() !== ""
      ? Number(form.fuel_points_earned)
      : calculatedFuelPoints;
  const selectedFuelAccount = fuelAccounts.find(
    (account) => String(account.id) === form.fuel_reward_account_id,
  );
  const selectedBarcodeImageUrl = selectedFuelAccount
    ? getUploadUrl(selectedFuelAccount.barcode_image_url)
    : null;
  const fuelEntryExpirationDate = getFuelEntryExpirationDate(form.purchase_date);
  const hasFuelCycleMismatch = hasDifferentExpirationCycle(
    selectedFuelAccount?.expiration_cycle,
    fuelEntryExpirationDate,
  );
  const activePaymentRows = paymentRows.filter(
    (row) =>
      row.amount.trim() !== "" ||
      row.credit_card_id.trim() !== "" ||
      row.notes.trim() !== "" ||
      row.payment_type !== "CREDIT_CARD",
  );
  const paymentRowsTotal = activePaymentRows.reduce((total, row) => {
    const amount = Number(row.amount);

    return total + (Number.isNaN(amount) ? 0 : amount);
  }, 0);
  const totalPaid = Number(form.purchase_total_paid);
  const paymentDifference = Number.isNaN(totalPaid)
    ? 0
    : totalPaid - paymentRowsTotal;
  const hasPaymentMismatch =
    isSplitTenderEnabled &&
    form.purchase_total_paid.trim() !== "" &&
    Math.round(paymentRowsTotal * 100) !== Math.round(totalPaid * 100);
  const hasMissingCreditCardPayment =
    isSplitTenderEnabled &&
    activePaymentRows.some(
      (row) => row.payment_type === "CREDIT_CARD" && !row.credit_card_id,
    );
  const hasBlankPaymentRows =
    isSplitTenderEnabled &&
    activePaymentRows.some(
      (row) => !row.payment_type || !row.amount || Number(row.amount) <= 0,
    );
  const canAddPaymentRow =
    !isSplitTenderEnabled ||
    form.purchase_total_paid.trim() === "" ||
    Math.round(paymentDifference * 100) !== 0;

  useEffect(() => {
    let isMounted = true;

    async function loadLookups() {
      setIsLoadingStores(true);
      setIsLoadingFuelAccounts(true);
      setIsLoadingCreditCards(true);
      setStoresError(null);
      setFuelAccountsError(null);
      setCreditCardsError(null);

      const [storesResult, accountsResult, cardsResult] = await Promise.allSettled([
        fetch(`${API_BASE_URL}/stores/`),
        fetch(`${API_BASE_URL}/fuel-accounts/intake-eligible`),
        fetch(`${API_BASE_URL}/credit-cards`),
      ]);

      if (!isMounted) {
        return;
      }

      if (storesResult.status === "fulfilled" && storesResult.value.ok) {
        const data = (await storesResult.value.json()) as Store[];
        setStores(data);
      } else {
        setStoresError("Failed to load stores.");
      }

      if (accountsResult.status === "fulfilled" && accountsResult.value.ok) {
        const data = (await accountsResult.value.json()) as FuelAccount[];
        setFuelAccounts(data);
        setForm((currentForm) =>
          data.some(
            (account) => String(account.id) === currentForm.fuel_reward_account_id,
          )
            ? currentForm
            : {
                ...currentForm,
                fuel_reward_account_id: data[0] ? String(data[0].id) : "",
              },
        );
      } else {
        setFuelAccountsError("Failed to load fuel accounts.");
      }

      if (cardsResult.status === "fulfilled" && cardsResult.value.ok) {
        const data = (await cardsResult.value.json()) as CreditCard[];
        setCreditCards(data.filter((card) => card.is_active));
      } else {
        setCreditCardsError("Failed to load funding cards.");
      }

      setIsLoadingStores(false);
      setIsLoadingFuelAccounts(false);
      setIsLoadingCreditCards(false);
    }

    loadLookups();

    return () => {
      isMounted = false;
    };
  }, []);

  function updateFormField(field: keyof IntakeForm, value: string | boolean) {
    setForm((currentForm) => ({
      ...currentForm,
      [field]: value,
    }));
  }

  function handleFuelAccountChange(accountId: string) {
    updateFormField("fuel_reward_account_id", accountId);
    setIsBarcodeVisible(false);
  }

  function handleStoreChange(storeName: string) {
    const store = stores.find((currentStore) => currentStore.name === storeName);
    const defaultMultiplier = store?.earns_fuel_points
      ? String(store.default_fuel_multiplier ?? 4)
      : "4";

    setIsBarcodeVisible(false);

    setForm((currentForm) => ({
      ...currentForm,
      store_name: storeName,
      fuel_reward_account_id: store?.earns_fuel_points
        ? currentForm.fuel_reward_account_id ||
          (fuelAccounts[0] ? String(fuelAccounts[0].id) : "")
        : "",
      fuel_multiplier_mode: ["2", "4", "6"].includes(defaultMultiplier)
        ? defaultMultiplier
        : "custom",
      custom_fuel_multiplier: ["2", "4", "6"].includes(defaultMultiplier)
        ? ""
        : defaultMultiplier,
      should_override_fuel_points: store?.earns_fuel_points
        ? currentForm.should_override_fuel_points
        : false,
      fuel_points_earned: store?.earns_fuel_points
        ? currentForm.fuel_points_earned
        : "",
      fuel_notes: store?.earns_fuel_points ? currentForm.fuel_notes : "",
    }));
  }

  function handleReceiptChange(event: ChangeEvent<HTMLInputElement>) {
    setReceiptFile(event.target.files?.[0] ?? null);
  }

  function handleSplitTenderChange(isEnabled: boolean) {
    setIsSplitTenderEnabled(isEnabled);

    if (isEnabled) {
      updateFormField("credit_card_id", "");
    } else {
      setPaymentRows([]);
    }
  }

  function updatePaymentRow(
    index: number,
    field: keyof PaymentRow,
    value: string,
  ) {
    setPaymentRows((currentRows) =>
      currentRows.map((row, rowIndex) => {
        if (rowIndex !== index) {
          return row;
        }

        const nextRow = {
          ...row,
          [field]: value,
        };

        if (field === "payment_type" && value !== "CREDIT_CARD") {
          nextRow.credit_card_id = "";
        }

        return nextRow;
      }),
    );
  }

  function addPaymentRow() {
    setPaymentRows((currentRows) => [...currentRows, createEmptyPaymentRow()]);
  }

  function removePaymentRow(index: number) {
    setPaymentRows((currentRows) =>
      currentRows.filter((_, rowIndex) => rowIndex !== index),
    );
  }

  async function uploadReceipt(purchaseId: number) {
    if (!receiptFile) {
      return;
    }

    const receiptFormData = new FormData();
    receiptFormData.append("purchase_batch_id", String(purchaseId));
    receiptFormData.append("file", receiptFile);

    const response = await fetch(`${API_BASE_URL}/receipts/upload`, {
      method: "POST",
      body: receiptFormData,
    });

    if (!response.ok) {
      throw new Error(
        `Purchase created, but receipt upload failed (${response.status})`,
      );
    }
  }

  async function createFuelPointEntry(purchaseId: number) {
    if (
      !showFuelPoints ||
      !form.fuel_reward_account_id ||
      hasFuelCycleMismatch ||
      fuelPointsEarned === null ||
      Number.isNaN(fuelPointsEarned) ||
      fuelPointsEarned <= 0
    ) {
      return false;
    }

    const response = await fetch(`${API_BASE_URL}/fuel-point-entries/`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        fuel_reward_account_id: Number(form.fuel_reward_account_id),
        purchase_batch_id: purchaseId,
        earned_date: form.purchase_date,
        multiplier: getFuelMultiplier(form),
        qualifying_spend: getFuelPointBasisAmount(form),
        points_earned: fuelPointsEarned,
        notes: form.fuel_notes.trim() || null,
      }),
    });

    if (!response.ok) {
      const errorData = (await response.json().catch(() => null)) as {
        detail?: string;
      } | null;

      throw new Error(
        errorData?.detail ||
          `Purchase created, but fuel points failed (${response.status})`,
      );
    }

    const data = (await response.json()) as {
      account_current_points: number;
      target_points: number | null;
      target_met: boolean;
    };

    if (data.target_met && selectedFuelAccount) {
      setFuelTargetNotice(
        `${selectedFuelAccount.retailer} has ${data.account_current_points.toLocaleString()} points, meeting the ${data.target_points?.toLocaleString()} point target.`,
      );
      return true;
    }

    return false;
  }

  async function createPurchasePayments(purchaseId: number) {
    if (!isSplitTenderEnabled) {
      return;
    }

    for (const row of activePaymentRows) {
      const response = await fetch(
        `${API_BASE_URL}/purchase-batches/${purchaseId}/payments`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            payment_type: row.payment_type,
            credit_card_id:
              row.payment_type === "CREDIT_CARD"
                ? Number(row.credit_card_id)
                : null,
            amount: row.amount,
            notes: row.notes.trim() || null,
          }),
        },
      );

      if (!response.ok) {
        throw new Error(`Purchase created, but payment failed (${response.status})`);
      }
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitError(null);
    setFuelTargetNotice(null);
    setIsSubmitting(true);

    try {
      if (hasPaymentMismatch) {
        throw new Error("Split tender payments must equal Total Paid.");
      }

      if (hasMissingCreditCardPayment) {
        throw new Error("Credit card payments require a selected card.");
      }

      if (hasBlankPaymentRows) {
        throw new Error("Split tender payment rows need type and amount.");
      }

      const response = await fetch(`${API_BASE_URL}/purchase-batches/`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          store_name: form.store_name.trim(),
          purchase_date: new Date(form.purchase_date).toISOString(),
          total_amount: form.total_amount || "0",
          purchase_total_paid: form.purchase_total_paid || null,
          credit_card_id: !isSplitTenderEnabled && form.credit_card_id
            ? Number(form.credit_card_id)
            : null,
          financial_notes: form.financial_notes.trim() || null,
          notes: form.notes.trim() || null,
        }),
      });

      if (!response.ok) {
        throw new Error(`Failed to create purchase (${response.status})`);
      }

      const purchase = (await response.json()) as PurchaseBatch;
      await createPurchasePayments(purchase.id);
      const shouldPauseForFuelNotice = await createFuelPointEntry(purchase.id);
      await uploadReceipt(purchase.id);

      if (shouldPauseForFuelNotice) {
        await new Promise((resolve) => setTimeout(resolve, 1200));
      }

      router.push(`/intake/${purchase.id}`);
    } catch (err) {
      setSubmitError(
        err instanceof Error ? err.message : "Failed to create purchase.",
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  const isSubmitDisabled =
    isSubmitting ||
    isLoadingStores ||
    Boolean(storesError) ||
    stores.length === 0 ||
    hasFuelCycleMismatch ||
    hasPaymentMismatch ||
    hasMissingCreditCardPayment ||
    hasBlankPaymentRows;

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-6 text-slate-950">
      <div className="mx-auto flex min-h-[calc(100vh-3rem)] max-w-md flex-col sm:max-w-2xl">
        <header className="pb-5">
          <p className="text-sm font-medium text-slate-500">Purchase Intake</p>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight">
            New Purchase
          </h1>
        </header>

        <form className="flex flex-1 flex-col" onSubmit={handleSubmit}>
          <section className="space-y-5 rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
            <label className="block space-y-2 text-sm font-medium text-slate-700">
              <span>Store</span>
              <select
                className="h-12 w-full rounded-md border border-slate-300 px-3 text-base text-slate-950 outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-200"
                value={form.store_name}
                onChange={(event) => handleStoreChange(event.target.value)}
                disabled={isLoadingStores || Boolean(storesError)}
                required
              >
                <option value="">
                  {isLoadingStores
                    ? "Loading stores..."
                    : stores.length === 0
                      ? "No stores available"
                      : "Select a store"}
                </option>
                {stores.map((store) => (
                  <option key={store.id} value={store.name}>
                    {store.name}
                    {store.active ? "" : " (Inactive)"}
                  </option>
                ))}
              </select>
              {storesError ? (
                <p className="text-sm font-medium text-red-700">
                  {storesError}
                </p>
              ) : null}
            </label>

            <label className="block space-y-2 text-sm font-medium text-slate-700">
              <span>Purchase Date</span>
              <input
                className="h-12 w-full rounded-md border border-slate-300 px-3 text-base text-slate-950 outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-200"
                type="date"
                value={form.purchase_date}
                onChange={(event) =>
                  updateFormField("purchase_date", event.target.value)
                }
                required
              />
            </label>

            <label className="block space-y-2 text-sm font-medium text-slate-700">
              <span>Total Paid</span>
              <input
                className="h-12 w-full rounded-md border border-slate-300 px-3 text-base text-slate-950 outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-200"
                type="number"
                min="0"
                step="0.01"
                value={form.purchase_total_paid}
                onChange={(event) =>
                  updateFormField("purchase_total_paid", event.target.value)
                }
              />
              <p className="text-sm text-slate-500">
                Optional receipt/payment context. Gift card cost is entered on
                the next screen.
              </p>
            </label>

            <label className="block space-y-2 text-sm font-medium text-slate-700">
              <span>Face Value</span>
              <input
                className="h-12 w-full rounded-md border border-slate-300 px-3 text-base text-slate-950 outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-200"
                type="number"
                min="0"
                step="0.01"
                value={form.total_amount}
                onChange={(event) =>
                  updateFormField("total_amount", event.target.value)
                }
                placeholder="Optional"
              />
              <p className="text-sm text-slate-500">
                Optional total value of cards expected in the batch.
              </p>
            </label>

            <section className="space-y-3 rounded-md border border-slate-200 bg-slate-50 p-4">
              <div
                className={
                  isSplitTenderEnabled
                    ? "flex items-center justify-between gap-3"
                    : "grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end"
                }
              >
                {!isSplitTenderEnabled ? (
                  <label className="block space-y-2 text-sm font-medium text-slate-700">
                    <span>Funding Card</span>
                    <select
                      className="h-12 w-full rounded-md border border-slate-300 px-3 text-base text-slate-950 outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-200"
                      disabled={
                        isLoadingCreditCards || Boolean(creditCardsError)
                      }
                      onChange={(event) =>
                        updateFormField("credit_card_id", event.target.value)
                      }
                      value={form.credit_card_id}
                    >
                      <option value="">
                        {isLoadingCreditCards
                          ? "Loading cards..."
                          : "No funding card"}
                      </option>
                      {creditCards.map((card) => (
                        <option key={card.id} value={card.id}>
                          {card.nickname}
                          {card.last_four ? ` - ${card.last_four}` : ""}
                        </option>
                      ))}
                    </select>
                    {creditCardsError ? (
                      <p className="text-sm font-medium text-red-700">
                        {creditCardsError}
                      </p>
                    ) : null}
                  </label>
                ) : null}

                <label className="flex h-12 items-center justify-between gap-3 text-sm font-medium text-slate-700 sm:justify-end">
                  <span>Split Tender</span>
                  <input
                    checked={isSplitTenderEnabled}
                    className="h-5 w-5"
                    onChange={(event) =>
                      handleSplitTenderChange(event.target.checked)
                    }
                    type="checkbox"
                  />
                </label>
              </div>

              {isSplitTenderEnabled ? (
                <div className="space-y-2">
                  {paymentRows.map((row, index) => (
                    <div
                      className="rounded-md border border-slate-200 bg-white p-2.5"
                      key={index}
                    >
                      <div
                        className={`grid gap-2 sm:items-end ${
                          row.payment_type === "CREDIT_CARD"
                            ? "sm:grid-cols-[7rem_minmax(12rem,1fr)_7rem_auto]"
                            : "sm:grid-cols-[8rem_7rem_auto]"
                        }`}
                      >
                        <label className="block space-y-1 text-xs font-medium text-slate-600">
                          <span>Type</span>
                          <select
                            className="h-10 w-full rounded-md border border-slate-300 px-2 text-sm text-slate-950 outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-200"
                            onChange={(event) =>
                              updatePaymentRow(
                                index,
                                "payment_type",
                                event.target.value,
                              )
                            }
                            value={row.payment_type}
                          >
                            <option value="CREDIT_CARD">Credit Card</option>
                            <option value="CASH">Cash</option>
                            <option value="OTHER">Other</option>
                          </select>
                        </label>

                        {row.payment_type === "CREDIT_CARD" ? (
                          <label className="block space-y-1 text-xs font-medium text-slate-600">
                            <span>Card</span>
                            <select
                              className="h-10 w-full rounded-md border border-slate-300 px-2 text-sm text-slate-950 outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-200"
                              onChange={(event) =>
                                updatePaymentRow(
                                  index,
                                  "credit_card_id",
                                  event.target.value,
                                )
                              }
                              required
                              value={row.credit_card_id}
                            >
                              <option value="">Select card</option>
                              {creditCards.map((card) => (
                                <option key={card.id} value={card.id}>
                                  {card.nickname}
                                  {card.last_four ? ` - ${card.last_four}` : ""}
                                </option>
                              ))}
                            </select>
                          </label>
                        ) : null}

                        <label className="block space-y-1 text-xs font-medium text-slate-600">
                          <span>Amount</span>
                          <input
                            className="h-10 w-full rounded-md border border-slate-300 px-2 text-sm text-slate-950 outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-200"
                            min="0"
                            onChange={(event) =>
                              updatePaymentRow(
                                index,
                                "amount",
                                event.target.value,
                              )
                            }
                            required
                            step="0.01"
                            type="number"
                            value={row.amount}
                          />
                        </label>

                        <button
                          className="h-10 cursor-pointer rounded-md border border-slate-300 px-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60"
                          onClick={() => removePaymentRow(index)}
                          type="button"
                        >
                          Remove
                        </button>
                      </div>

                      <details className="mt-2 text-sm">
                        <summary className="cursor-pointer text-xs font-medium text-slate-500 hover:text-slate-800">
                          Notes
                        </summary>
                        <input
                          className="mt-2 h-10 w-full rounded-md border border-slate-300 px-2 text-sm text-slate-950 outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-200"
                          onChange={(event) =>
                            updatePaymentRow(index, "notes", event.target.value)
                          }
                          placeholder="Optional"
                          type="text"
                          value={row.notes}
                        />
                      </details>
                    </div>
                  ))}

                  <div className="rounded-md border border-slate-200 bg-white p-3 text-sm">
                    <dl className="grid grid-cols-3 gap-2 text-center">
                      <div>
                        <dt className="text-xs font-medium text-slate-500">
                          Payments
                        </dt>
                        <dd className="font-semibold">
                          ${paymentRowsTotal.toFixed(2)}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-xs font-medium text-slate-500">
                          Total Paid
                        </dt>
                        <dd className="font-semibold">
                          $
                          {Number.isNaN(totalPaid)
                            ? "0.00"
                            : totalPaid.toFixed(2)}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-xs font-medium text-slate-500">
                          Remaining
                        </dt>
                        <dd
                          className={
                            Math.round(paymentDifference * 100) === 0
                              ? "font-semibold text-emerald-700"
                              : "font-semibold text-red-700"
                          }
                        >
                          ${paymentDifference.toFixed(2)}
                        </dd>
                      </div>
                    </dl>
                    {hasPaymentMismatch ? (
                      <p className="mt-2 text-sm font-medium text-red-700">
                        Payment rows must equal Total Paid.
                      </p>
                    ) : null}
                    {hasMissingCreditCardPayment ? (
                      <p className="mt-2 text-sm font-medium text-red-700">
                        Credit card payment rows require a card.
                      </p>
                    ) : null}
                    {hasBlankPaymentRows ? (
                      <p className="mt-2 text-sm font-medium text-red-700">
                        Payment rows must have an amount greater than $0.
                      </p>
                    ) : null}
                  </div>

                  {canAddPaymentRow ? (
                    <div className="flex justify-end">
                      <button
                        className="h-10 cursor-pointer rounded-md border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-100"
                        onClick={addPaymentRow}
                        type="button"
                      >
                        Add Payment
                      </button>
                    </div>
                  ) : null}
                </div>
              ) : null}
            </section>

            {showFuelPoints ? (
              <section className="space-y-4 rounded-md border border-slate-200 bg-slate-50 p-4">
                <div>
                  <h2 className="text-base font-semibold">Fuel Points</h2>
                  <p className="mt-1 text-sm text-slate-500">
                    Track points earned for this purchase.
                  </p>
                </div>

                <label className="block space-y-2 text-sm font-medium text-slate-700">
                  <span>Fuel Account</span>
                  <select
                    className="h-12 w-full rounded-md border border-slate-300 bg-white px-3 text-base text-slate-950 outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-200"
                    disabled={
                      isLoadingFuelAccounts || Boolean(fuelAccountsError)
                    }
                    onChange={(event) =>
                      handleFuelAccountChange(event.target.value)
                    }
                    value={form.fuel_reward_account_id}
                  >
                    <option value="">
                      {isLoadingFuelAccounts
                        ? "Loading accounts..."
                        : fuelAccounts.length === 0
                          ? "No eligible fuel accounts available."
                          : "Select account"}
                    </option>
                    {fuelAccounts.map((account) => (
                      <option key={account.id} value={account.id}>
                        {account.retailer}
                        {account.email ? ` - ${account.email}` : ""}
                        {account.expiration_cycle
                          ? ` - expires ${formatShortDate(account.expiration_cycle)}`
                          : ""}
                        {account.target_points
                          ? ` - ${account.current_points.toLocaleString()}/${account.target_points.toLocaleString()} pts`
                          : ""}
                      </option>
                    ))}
                  </select>
                  {fuelAccountsError ? (
                    <p className="text-sm font-medium text-red-700">
                      {fuelAccountsError}
                    </p>
                  ) : null}
                  {!isLoadingFuelAccounts &&
                  !fuelAccountsError &&
                  fuelAccounts.length === 0 ? (
                    <p className="text-sm font-medium text-amber-700">
                      No eligible fuel accounts available.
                    </p>
                  ) : null}
                  <p className="text-sm text-slate-500">
                    Fuel accounts should only contain points with the same
                    expiration month. Accounts at or above target are hidden
                    from intake and available for sale only.
                  </p>
                  <p className="text-sm text-slate-500">
                    Expiration is based on the purchase date.
                  </p>
                  {selectedFuelAccount?.expiration_cycle ? (
                    <p className="text-sm text-slate-500">
                      Account cycle:{" "}
                      {formatDate(selectedFuelAccount.expiration_cycle)}
                    </p>
                  ) : selectedFuelAccount && fuelEntryExpirationDate ? (
                    <p className="text-sm font-medium text-slate-700">
                      First entry will lock this account to{" "}
                      {formatDate(fuelEntryExpirationDate)}.
                    </p>
                  ) : null}
                  {fuelEntryExpirationDate ? (
                    <p className="text-sm font-medium text-slate-700">
                      New entry expiration cycle:{" "}
                      {formatDate(fuelEntryExpirationDate)}
                    </p>
                  ) : null}
                  {hasFuelCycleMismatch && selectedFuelAccount ? (
                    <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-800">
                      This account is locked to points expiring{" "}
                      {formatShortDate(selectedFuelAccount.expiration_cycle)}.
                      Use a new account for this expiration cycle.
                    </p>
                  ) : null}
                  {selectedFuelAccount && selectedBarcodeImageUrl ? (
                    <div className="rounded-md border border-slate-200 bg-white p-3">
                      <button
                        className="h-11 w-full cursor-pointer rounded-md border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-700 transition hover:bg-slate-100 active:bg-slate-200"
                        onClick={() =>
                          setIsBarcodeVisible((currentValue) => !currentValue)
                        }
                        type="button"
                      >
                        {isBarcodeVisible ? "Hide Barcode" : "Show Barcode"}
                      </button>
                      {isBarcodeVisible ? (
                        <div className="mt-3 rounded-md border border-slate-200 bg-white p-3">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            alt={`${selectedFuelAccount.retailer} barcode`}
                            className="mx-auto max-h-72 w-full object-contain"
                            src={selectedBarcodeImageUrl}
                          />
                          {selectedFuelAccount.barcode_value ? (
                            <p className="mt-3 break-all text-center text-sm font-medium text-slate-700">
                              {selectedFuelAccount.barcode_value}
                            </p>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                  ) : selectedFuelAccount ? (
                    <p className="text-sm text-slate-500">
                      No barcode image uploaded for this account.
                    </p>
                  ) : null}
                </label>

                <div className="grid gap-4 sm:grid-cols-2">
                  <label className="block space-y-2 text-sm font-medium text-slate-700">
                    <span>Multiplier</span>
                    <select
                      className="h-12 w-full rounded-md border border-slate-300 bg-white px-3 text-base text-slate-950 outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-200"
                      onChange={(event) =>
                        updateFormField(
                          "fuel_multiplier_mode",
                          event.target.value,
                        )
                      }
                      value={form.fuel_multiplier_mode}
                    >
                      <option value="2">2x</option>
                      <option value="4">4x</option>
                      <option value="6">6x</option>
                      <option value="custom">Custom</option>
                    </select>
                  </label>

                  {form.fuel_multiplier_mode === "custom" ? (
                    <label className="block space-y-2 text-sm font-medium text-slate-700">
                      <span>Custom Multiplier</span>
                      <input
                        className="h-12 w-full rounded-md border border-slate-300 bg-white px-3 text-base text-slate-950 outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-200"
                        min="0"
                        onChange={(event) =>
                          updateFormField(
                            "custom_fuel_multiplier",
                            event.target.value,
                          )
                        }
                        step="1"
                        type="number"
                        value={form.custom_fuel_multiplier}
                      />
                    </label>
                  ) : null}
                </div>

                <div className="rounded-md border border-slate-200 bg-white p-3">
                  <p className="text-sm font-medium text-slate-700">
                    Calculated Points Earned
                  </p>
                  <p className="mt-1 text-2xl font-semibold text-slate-950">
                    {calculatedFuelPoints !== null
                      ? calculatedFuelPoints.toLocaleString()
                      : ""}
                  </p>
                  <p className="mt-1 text-sm text-slate-500">
                    {form.purchase_total_paid
                      ? "Based on Total Paid × multiplier."
                      : "Enter Total Paid to calculate fuel points."}
                  </p>
                </div>

                <label className="flex min-h-12 cursor-pointer items-center gap-3 rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50 active:bg-slate-100">
                  <input
                    checked={form.should_override_fuel_points}
                    className="h-5 w-5 cursor-pointer rounded border-slate-300"
                    onChange={(event) =>
                      updateFormField(
                        "should_override_fuel_points",
                        event.target.checked,
                      )
                    }
                    type="checkbox"
                  />
                  <span>Override points earned</span>
                </label>

                <label className="block space-y-2 text-sm font-medium text-slate-700">
                  <span>Points Earned</span>
                  <input
                    className="h-12 w-full rounded-md border border-slate-300 bg-white px-3 text-base text-slate-950 outline-none transition read-only:bg-slate-100 read-only:text-slate-600 focus:border-slate-500 focus:ring-2 focus:ring-slate-200"
                    min="0"
                    onChange={(event) =>
                      updateFormField("fuel_points_earned", event.target.value)
                    }
                    readOnly={!form.should_override_fuel_points}
                    step="1"
                    type="number"
                    value={
                      form.should_override_fuel_points
                        ? form.fuel_points_earned
                        : calculatedFuelPoints !== null
                          ? String(calculatedFuelPoints)
                          : ""
                    }
                  />
                </label>

                <label className="block space-y-2 text-sm font-medium text-slate-700">
                  <span>Fuel Point Notes</span>
                  <textarea
                    className="min-h-20 w-full rounded-md border border-slate-300 bg-white px-3 py-3 text-base text-slate-950 outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-200"
                    onChange={(event) =>
                      updateFormField("fuel_notes", event.target.value)
                    }
                    placeholder="Optional"
                    value={form.fuel_notes}
                  />
                </label>
              </section>
            ) : null}

            <label className="block space-y-2 text-sm font-medium text-slate-700">
              <span>Financial Notes</span>
              <textarea
                className="min-h-24 w-full rounded-md border border-slate-300 px-3 py-3 text-base text-slate-950 outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-200"
                value={form.financial_notes}
                onChange={(event) =>
                  updateFormField("financial_notes", event.target.value)
                }
                placeholder="Optional"
              />
            </label>

            <label className="block space-y-2 text-sm font-medium text-slate-700">
              <span>Notes</span>
              <textarea
                className="min-h-28 w-full rounded-md border border-slate-300 px-3 py-3 text-base text-slate-950 outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-200"
                value={form.notes}
                onChange={(event) =>
                  updateFormField("notes", event.target.value)
                }
                placeholder="Optional"
              />
            </label>

            <label className="block space-y-2 text-sm font-medium text-slate-700">
              <span>Receipt Image</span>
              <input
                className="block w-full cursor-pointer rounded-md border border-slate-300 bg-white text-sm text-slate-700 file:mr-4 file:h-12 file:cursor-pointer file:border-0 file:bg-slate-900 file:px-4 file:text-sm file:font-semibold file:text-white file:transition file:hover:bg-slate-700"
                type="file"
                accept="image/*"
                onChange={handleReceiptChange}
              />
              {receiptFile ? (
                <p className="text-sm text-slate-500">{receiptFile.name}</p>
              ) : null}
            </label>
          </section>

          {submitError ? (
            <div className="mt-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-800">
              {submitError}
            </div>
          ) : null}

          {fuelTargetNotice ? (
            <div className="mt-4 rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-800">
              {fuelTargetNotice}
            </div>
          ) : null}

          <div className="sticky bottom-0 mt-auto bg-slate-50 py-4">
            <button
              className="h-12 w-full rounded-md bg-slate-900 px-5 text-base font-semibold text-white shadow-sm transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:bg-slate-400"
              type="submit"
              disabled={isSubmitDisabled}
            >
              {isSubmitting ? "Saving..." : "Continue to Card Intake"}
            </button>
          </div>
        </form>
      </div>
    </main>
  );
}
