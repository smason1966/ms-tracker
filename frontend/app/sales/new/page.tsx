"use client";

import Link from "next/link";
import { FormEvent, useEffect, useMemo, useState } from "react";

import { API_BASE_URL } from "@/lib/api";

type Buyer = {
  id: number;
  name: string;
  active: boolean;
  default_payout_rate: string | number | null;
  default_payment_account_id: number | null;
  card_export_format: string | null;
  fuel_export_format: string | null;
  group_card_exports_by_brand: boolean;
  preserve_blank_export_columns: boolean;
};

type PaymentAccount = {
  id: number;
  name: string;
  account_type: string;
  institution: string | null;
  last_four: string | null;
  account_identifier: string | null;
  payment_identifier: string | null;
  is_business_account: boolean;
  bank_account_type: string | null;
  active: boolean;
};

type GiftCard = {
  id: number;
  brand: string;
  face_value: string | number;
  status: string;
  card_number_encrypted: string | null;
  pin_encrypted: string | null;
};

type FuelAccount = {
  id: number;
  retailer: string;
  email: string | null;
  alt_id: string | null;
  status: string;
  current_points: number;
  target_points: number | null;
  login_password: string | null;
};

type FuelSelection = {
  fuel_reward_account_id: number;
  points_sold: string;
  fuel_overage_override: boolean;
};

type CreatedSale = {
  id: number;
  buyer_name: string | null;
  expected_payout: string | number;
  gift_cards: GiftCard[];
  fuel_accounts: FuelAccount[];
};

function todayString() {
  return new Date().toISOString().slice(0, 10);
}

function formatCurrency(value: string | number | null) {
  const amount = Number(value ?? 0);

  if (Number.isNaN(amount)) {
    return String(value);
  }

  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(amount);
}

function roundDownToThousand(points: string | number) {
  const parsedPoints = Math.max(0, Math.floor(Number(points) || 0));
  return Math.floor(parsedPoints / 1000) * 1000;
}

function normalizePayoutRateInput(value: string) {
  const parsedValue = Number(value);

  if (!Number.isFinite(parsedValue)) {
    return 0;
  }

  return parsedValue / 100;
}

function formatRateForInput(value: string | number | null | undefined) {
  const rate = Number(value ?? 1);

  if (!Number.isFinite(rate)) {
    return "100";
  }

  return String(Number((rate * 100).toFixed(4)));
}

function formatRateLabel(rate: number) {
  return `${(rate * 100).toFixed(2).replace(/\.?0+$/, "")}%`;
}

function fuelTargetLabel(account: FuelAccount) {
  return `${account.current_points.toLocaleString()} / ${
    account.target_points?.toLocaleString() ?? "-"
  } pts`;
}

function isFuelBelowTarget(account: FuelAccount) {
  return account.target_points !== null && account.current_points < account.target_points;
}

function fuelOveragePoints(account: FuelAccount) {
  return account.target_points === null
    ? 0
    : Math.max(account.current_points - account.target_points, 0);
}

function fuelRequiresOverageOverride(account: FuelAccount) {
  return fuelOveragePoints(account) > 1000;
}

function isDecimalStylePayoutRate(value: string) {
  const parsedValue = Number(value);
  return value.trim() !== "" && parsedValue > 0 && parsedValue < 1;
}

async function errorMessageFromResponse(response: Response, endpoint: string) {
  const bodyText = await response.text();
  const body = bodyText
    ? (() => {
        try {
          return JSON.parse(bodyText) as { detail?: unknown };
        } catch {
          return null;
        }
      })()
    : null;
  const detail = body?.detail ?? body;

  if (
    detail &&
    typeof detail === "object" &&
    "message" in detail &&
    typeof detail.message === "string"
  ) {
    return `Request failed: ${endpoint} (${response.status}). ${detail.message}. Response body: ${bodyText}`;
  }

  return `Request failed: ${endpoint} (${response.status}). Response body: ${
    bodyText || response.statusText
  }`;
}

const DEFAULT_CARD_EXPORT_FORMAT = "brand,face_value,card_number,pin";
const DEFAULT_FUEL_EXPORT_FORMAT = "retailer,points_sold,email_login,password,alt_id";

function templateFields(template: string, preserveBlankColumns = true) {
  const fields = template.split(",").map((field) =>
    field.trim().replace(/^\{/, "").replace(/\}$/, "").trim(),
  );

  return preserveBlankColumns ? fields : fields.filter(Boolean);
}

function renderAssetExport({
  includeHeader,
  preserveBlankColumns,
  rows,
  template,
}: {
  includeHeader: boolean;
  preserveBlankColumns: boolean;
  rows: Record<string, string>[];
  template: string;
}) {
  const fields = templateFields(template, preserveBlankColumns);
  const outputRows: string[] = [];

  if (includeHeader) {
    outputRows.push(fields.join(","));
  }

  for (const row of rows) {
    outputRows.push(fields.map((field) => row[field] ?? "").join(","));
  }

  return outputRows.join("\n");
}

function cardExportValues(card: GiftCard) {
  const cardNumber = card.card_number_encrypted ?? "";
  const pin = card.pin_encrypted ?? "";

  return {
    brand: card.brand,
    face_value: String(card.face_value),
    card_number: cardNumber,
    pin,
    card_id: String(card.id),
    gift_card_id: String(card.id),
    card_number_last4: cardNumber.slice(-4),
    pin_last4: pin.slice(-4),
  };
}

function cardExportShouldGroupByBrand(
  template: string,
  preserveBlankColumns: boolean,
) {
  return !templateFields(template, preserveBlankColumns)
    .map((field) => field.toLowerCase())
    .includes("brand");
}

function cardSortKey(card: GiftCard) {
  return [
    (card.brand || "Unknown Brand").toLowerCase(),
    String(999999999 - Number(card.face_value || 0)).padStart(12, "0"),
    card.card_number_encrypted ?? "",
  ].join("|");
}

function groupedCardExportPreview(
  cards: GiftCard[],
  template: string,
  preserveBlankColumns: boolean,
) {
  const groupedCards = new Map<string, GiftCard[]>();

  for (const card of [...cards].sort((left, right) =>
    cardSortKey(left).localeCompare(cardSortKey(right)),
  )) {
    const brand = card.brand || "Unknown Brand";
    groupedCards.set(brand, [...(groupedCards.get(brand) ?? []), card]);
  }

  return [...groupedCards.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([brand, brandCards]) => {
      const rows = renderAssetExport({
        includeHeader: false,
        preserveBlankColumns,
        rows: brandCards.map(cardExportValues),
        template,
      });
      return rows ? `${brand}\n${rows}` : brand;
    })
    .join("\n\n");
}

function cardExportPreview(cards: GiftCard[], buyer: Buyer | null) {
  const template = buyer?.card_export_format?.trim() || DEFAULT_CARD_EXPORT_FORMAT;
  const preserveBlankColumns = buyer?.preserve_blank_export_columns ?? true;
  const includeHeader = !buyer?.card_export_format;

  if (cards.length === 0) {
    return buyer?.group_card_exports_by_brand &&
      cardExportShouldGroupByBrand(template, preserveBlankColumns)
      ? "No gift cards selected."
      : renderAssetExport({
          includeHeader: true,
          preserveBlankColumns,
          rows: [],
          template,
        });
  }

  if (
    buyer?.group_card_exports_by_brand &&
    cardExportShouldGroupByBrand(template, preserveBlankColumns)
  ) {
    return groupedCardExportPreview(cards, template, preserveBlankColumns);
  }

  return renderAssetExport({
    includeHeader,
    preserveBlankColumns,
    rows: cards.map(cardExportValues),
    template,
  });
}

function fuelExportValues(
  account: FuelAccount,
  fuelSelections: FuelSelection[],
) {
  const selection = fuelSelections.find(
    (item) => item.fuel_reward_account_id === account.id,
  );

  return {
    retailer: account.retailer,
    points_sold: String(selection?.points_sold ?? ""),
    email_login: account.email ?? "",
    email: account.email ?? "",
    login: account.email ?? "",
    password: account.login_password ?? "",
    login_password: account.login_password ?? "",
    alt_id: account.alt_id ?? "",
    fuel_account_id: String(account.id),
    account_id: String(account.id),
    expected_value: "",
    barcode_value: "",
  };
}

function fuelExportPreview(
  selectedFuelAccounts: FuelAccount[],
  fuelSelections: FuelSelection[],
  buyer: Buyer | null,
) {
  const template = buyer?.fuel_export_format?.trim() || DEFAULT_FUEL_EXPORT_FORMAT;
  const preserveBlankColumns = buyer?.preserve_blank_export_columns ?? true;
  const includeHeader = !buyer?.fuel_export_format;

  if (selectedFuelAccounts.length === 0) {
    return renderAssetExport({
      includeHeader: true,
      preserveBlankColumns,
      rows: [],
      template,
    });
  }

  return renderAssetExport({
    includeHeader,
    preserveBlankColumns,
    rows: selectedFuelAccounts.map((account) =>
      fuelExportValues(account, fuelSelections),
    ),
    template,
  });
}

function exportFormatLabel(buyer: Buyer | null) {
  if (!buyer || (!buyer.card_export_format && !buyer.fuel_export_format)) {
    return "Using default export format";
  }

  return `Using buyer format: ${buyer.name}`;
}

function cardEnding(card: GiftCard) {
  const value = card.card_number_encrypted?.replace(/\s/g, "");
  return value ? `ending ${value.slice(-4)}` : "ending unavailable";
}

export default function NewSalePage() {
  const [buyers, setBuyers] = useState<Buyer[]>([]);
  const [paymentAccounts, setPaymentAccounts] = useState<PaymentAccount[]>([]);
  const [giftCards, setGiftCards] = useState<GiftCard[]>([]);
  const [fuelAccounts, setFuelAccounts] = useState<FuelAccount[]>([]);
  const [buyerId, setBuyerId] = useState("");
  const [paymentAccountId, setPaymentAccountId] = useState("");
  const [soldDate, setSoldDate] = useState(todayString());
  const [cardPayoutRate, setCardPayoutRate] = useState("100");
  const [fuelRatePer1000, setFuelRatePer1000] = useState("");
  const [notes, setNotes] = useState("");
  const [selectedCardIds, setSelectedCardIds] = useState<number[]>([]);
  const [fuelSelections, setFuelSelections] = useState<FuelSelection[]>([]);
  const [createdSale, setCreatedSale] = useState<CreatedSale | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      async function loadData() {
        setIsLoading(true);
        setError(null);

        try {
          const [buyersResponse, accountsResponse, cardsResponse, fuelResponse] =
            await Promise.all([
              fetch(`${API_BASE_URL}/buyers/`),
              fetch(`${API_BASE_URL}/payment-accounts/?active_only=true`),
              fetch(`${API_BASE_URL}/gift-cards/`),
              fetch(`${API_BASE_URL}/fuel-accounts/dashboard`),
            ]);

          if (
            !buyersResponse.ok ||
            !accountsResponse.ok ||
            !cardsResponse.ok ||
            !fuelResponse.ok
          ) {
            const failures = await Promise.all(
              [
                [`${API_BASE_URL}/buyers/`, buyersResponse],
                [`${API_BASE_URL}/payment-accounts/?active_only=true`, accountsResponse],
                [`${API_BASE_URL}/gift-cards/`, cardsResponse],
                [`${API_BASE_URL}/fuel-accounts/dashboard`, fuelResponse],
              ]
                .filter(([, response]) => !(response as Response).ok)
                .map(([endpoint, response]) =>
                  errorMessageFromResponse(response as Response, endpoint as string),
                ),
            );
            throw new Error(failures.join(" | "));
          }

          const buyerData = (await buyersResponse.json()) as Buyer[];
          const accountData =
            (await accountsResponse.json()) as PaymentAccount[];
          const cardData = (await cardsResponse.json()) as GiftCard[];
          const fuelData = (await fuelResponse.json()) as FuelAccount[];

          setBuyers(buyerData.filter((buyer) => buyer.active));
          setPaymentAccounts(accountData.filter((account) => account.active));
          setGiftCards(
            cardData.filter((card) => card.status === "VERIFIED_AVAILABLE"),
          );
          setFuelAccounts(
            fuelData.filter((account) => account.status === "ACTIVE"),
          );
        } catch (err) {
          setError(
            err instanceof Error ? err.message : "Failed to load sale setup.",
          );
        } finally {
          setIsLoading(false);
        }
      }

      void loadData();
    }, 0);

    return () => window.clearTimeout(timeoutId);
  }, []);

  const selectedCards = useMemo(
    () => giftCards.filter((card) => selectedCardIds.includes(card.id)),
    [giftCards, selectedCardIds],
  );
  const selectedFuelAccounts = useMemo(
    () =>
      fuelAccounts.filter((account) =>
        fuelSelections.some(
          (selection) => selection.fuel_reward_account_id === account.id,
        ),
      ),
    [fuelAccounts, fuelSelections],
  );
  const selectedFaceValue = selectedCards.reduce(
    (total, card) => total + Number(card.face_value || 0),
    0,
  );
  const selectedSellableFuelPoints = fuelSelections.reduce(
    (total, selection) => total + roundDownToThousand(selection.points_sold),
    0,
  );
  const hasSelectedCards = selectedCards.length > 0;
  const hasStandaloneFuel = !hasSelectedCards && fuelSelections.length > 0;
  const hasInvalidCardPayoutRate = isDecimalStylePayoutRate(cardPayoutRate);
  const normalizedCardPayoutRate = normalizePayoutRateInput(cardPayoutRate);
  const cardPayout = selectedFaceValue * normalizedCardPayoutRate;
  const standaloneFuelPayout = hasStandaloneFuel
    ? (selectedSellableFuelPoints / 1000) * Number(fuelRatePer1000 || 0)
    : 0;
  const totalExpectedPayout = cardPayout + standaloneFuelPayout;
  const selectedBuyer =
    buyers.find((buyer) => buyer.id === Number(buyerId)) ?? null;
  const selectedDefaultPaymentAccount =
    paymentAccounts.find(
      (account) => account.id === selectedBuyer?.default_payment_account_id,
    ) ?? null;
  const paymentAccountOptions = selectedDefaultPaymentAccount
    ? [
        selectedDefaultPaymentAccount,
        ...paymentAccounts.filter(
          (account) => account.id !== selectedDefaultPaymentAccount.id,
        ),
      ]
    : paymentAccounts;
  function paymentAccountLabel(account: PaymentAccount) {
    const type = account.account_type.toLowerCase();
    const identifier = account.payment_identifier ?? account.account_identifier;

    if (type === "paypal" || type === "venmo" || type === "zelle") {
      return [account.account_type, identifier].filter(Boolean).join(" · ");
    }

    return [
      account.name,
      account.institution,
      account.bank_account_type,
      account.last_four ? `****${account.last_four}` : null,
      account.is_business_account ? "Business" : null,
    ]
      .filter(Boolean)
      .join(" · ");
  }

  function selectBuyer(nextBuyerId: string) {
    const nextBuyer =
      buyers.find((buyer) => String(buyer.id) === nextBuyerId) ?? null;

    setBuyerId(nextBuyerId);
    setCardPayoutRate(
      formatRateForInput(nextBuyer?.default_payout_rate ?? 1),
    );
    setPaymentAccountId(
      nextBuyer?.default_payment_account_id === null ||
        nextBuyer?.default_payment_account_id === undefined
        ? ""
        : String(nextBuyer.default_payment_account_id),
    );
  }

  function toggleCard(cardId: number) {
    setSelectedCardIds((currentIds) =>
      currentIds.includes(cardId)
        ? currentIds.filter((id) => id !== cardId)
        : [...currentIds, cardId],
    );
  }

  function toggleFuelAccount(account: FuelAccount) {
    setFuelSelections((currentSelections) => {
      const exists = currentSelections.some(
        (selection) => selection.fuel_reward_account_id === account.id,
      );

      if (exists) {
        return currentSelections.filter(
          (selection) => selection.fuel_reward_account_id !== account.id,
        );
      }

      return [
        ...currentSelections,
        {
          fuel_reward_account_id: account.id,
          points_sold: String(account.current_points),
          fuel_overage_override: false,
        },
      ];
    });
  }

  function setFuelOverageOverride(accountId: number, value: boolean) {
    setFuelSelections((currentSelections) =>
      currentSelections.map((selection) =>
        selection.fuel_reward_account_id === accountId
          ? { ...selection, fuel_overage_override: value }
          : selection,
      ),
    );
  }

  async function updateFuelTargetToCurrent(account: FuelAccount) {
    setError(null);

    try {
      const response = await fetch(`${API_BASE_URL}/fuel-accounts/${account.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ target_points: account.current_points }),
      });

      if (!response.ok) {
        throw new Error(`Failed to update fuel target (${response.status})`);
      }

      const updatedAccount = (await response.json()) as FuelAccount;
      setFuelAccounts((currentAccounts) =>
        currentAccounts.map((currentAccount) =>
          currentAccount.id === account.id ? updatedAccount : currentAccount,
        ),
      );
      setFuelOverageOverride(account.id, false);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to update fuel target.",
      );
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    setIsSaving(true);
    setError(null);
    setCreatedSale(null);

    try {
      const endpoint = `${API_BASE_URL}/sales/`;
      const payload = {
        buyer_id: Number(buyerId),
        sold_date: soldDate,
        payment_account_id:
          paymentAccountId === "" ? null : Number(paymentAccountId),
        card_payout_rate: cardPayoutRate,
        fuel_rate_per_1000: hasSelectedCards
          ? null
          : fuelRatePer1000.trim() === ""
            ? null
            : fuelRatePer1000,
        expected_payout: totalExpectedPayout.toFixed(2),
        notes: notes.trim() || null,
        gift_card_ids: selectedCardIds,
        fuel_accounts: fuelSelections.map((selection) => ({
          fuel_reward_account_id: selection.fuel_reward_account_id,
          points_sold: roundDownToThousand(selection.points_sold),
          expected_value: null,
          is_full_account_sale: true,
          fuel_overage_override: selection.fuel_overage_override,
        })),
      };
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        console.error("Create sale failed", {
          endpoint,
          status: response.status,
          payload,
        });
        throw new Error(
          `${await errorMessageFromResponse(response, endpoint)} Payload: ${JSON.stringify(payload)}`,
        );
      }

      setCreatedSale((await response.json()) as CreatedSale);
      setSelectedCardIds([]);
      setFuelSelections([]);
      setPaymentAccountId("");
      setNotes("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create sale.");
    } finally {
      setIsSaving(false);
    }
  }

  const canSubmit =
    buyerId !== "" &&
    (selectedCardIds.length > 0 || fuelSelections.length > 0) &&
    normalizedCardPayoutRate >= 0 &&
    !hasInvalidCardPayoutRate &&
    (!hasStandaloneFuel ||
      (fuelRatePer1000.trim() !== "" && Number(fuelRatePer1000) >= 0)) &&
    totalExpectedPayout >= 0 &&
    fuelSelections.every((selection) => {
      const account = fuelAccounts.find(
        (fuelAccount) => fuelAccount.id === selection.fuel_reward_account_id,
      );

      return (
        account !== undefined &&
        roundDownToThousand(selection.points_sold) > 0 &&
        !isFuelBelowTarget(account) &&
        (!fuelRequiresOverageOverride(account) || selection.fuel_overage_override)
      );
    });

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-8 text-slate-950 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-7xl space-y-6">
        <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-sm font-medium uppercase tracking-wide text-slate-500">
              Sales
            </p>
            <h1 className="mt-1 text-3xl font-semibold tracking-tight">
              Create Sale
            </h1>
            <p className="mt-2 text-sm text-slate-600">
              Bundle gift cards and fuel accounts into one buyer sale.
            </p>
          </div>
          <Link
            className="inline-flex h-11 items-center justify-center rounded-md border border-slate-300 px-4 text-sm font-semibold hover:bg-slate-100"
            href="/sales"
          >
            Sales History
          </Link>
        </header>

        {error ? (
          <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-800">
            {error}
          </div>
        ) : null}

        {createdSale ? (
          <section className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 shadow-sm">
            <h2 className="font-semibold">Sale #{createdSale.id} finalized</h2>
            <p className="mt-1 text-sm text-emerald-900">
              {createdSale.buyer_name} ·{" "}
              {formatCurrency(createdSale.expected_payout)}
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <a
                className="inline-flex h-10 items-center rounded-md bg-slate-950 px-4 text-sm font-semibold text-white"
                href={`${API_BASE_URL}/sales/${createdSale.id}/package.zip`}
              >
                Download ZIP
              </a>
              <Link
                className="inline-flex h-10 items-center rounded-md border border-slate-300 px-4 text-sm font-semibold hover:bg-slate-100"
                href="/sales"
              >
                View Sales
              </Link>
            </div>
          </section>
        ) : null}

        {isLoading ? (
          <section className="rounded-lg border border-slate-200 bg-white p-8 text-center text-sm text-slate-500">
            Loading sale setup...
          </section>
        ) : (
          <form className="grid gap-6 lg:grid-cols-[1fr_22rem]" onSubmit={handleSubmit}>
            <div className="space-y-6">
              <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
                <div className="grid gap-4 md:grid-cols-3">
                  <label className="block space-y-2 text-sm font-medium text-slate-700">
                    <span>Buyer</span>
                    <select
                      className="h-11 w-full rounded-md border border-slate-300 px-3"
                      onChange={(event) => selectBuyer(event.target.value)}
                      required
                      value={buyerId}
                    >
                      <option value="">Select buyer</option>
                      {buyers.map((buyer) => (
                        <option key={buyer.id} value={buyer.id}>
                          {buyer.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="block space-y-2 text-sm font-medium text-slate-700">
                    <span>Sold Date</span>
                    <input
                      className="h-11 w-full rounded-md border border-slate-300 px-3"
                      onChange={(event) => setSoldDate(event.target.value)}
                      required
                      type="date"
                      value={soldDate}
                    />
                  </label>
                  <label className="block space-y-2 text-sm font-medium text-slate-700">
                    <span>Expected Payment Account</span>
                    <select
                      className="h-11 w-full rounded-md border border-slate-300 px-3"
                      onChange={(event) => setPaymentAccountId(event.target.value)}
                      value={paymentAccountId}
                    >
                      <option value="">
                        {selectedBuyer?.default_payment_account_id
                          ? "Select payment account"
                          : "No default account"}
                      </option>
                      {paymentAccountOptions.map((account) => (
                        <option key={account.id} value={account.id}>
                          {paymentAccountLabel(account)}
                          {account.id === selectedBuyer?.default_payment_account_id
                            ? " (Default)"
                            : ""}
                        </option>
                      ))}
                    </select>
                    {selectedBuyer && !selectedBuyer.default_payment_account_id ? (
                      <p className="text-xs text-slate-500">
                        No default account. Select any active payment account if
                        you know where this buyer will pay.
                      </p>
                    ) : null}
                  </label>
                  <label className="block space-y-2 text-sm font-medium text-slate-700">
                    <span>Card Payout Rate (%)</span>
                    <input
                      className="h-11 w-full rounded-md border border-slate-300 px-3"
                      min="0"
                      onChange={(event) => setCardPayoutRate(event.target.value)}
                      placeholder="92"
                      step="0.01"
                      type="number"
                      value={cardPayoutRate}
                    />
                    {hasInvalidCardPayoutRate ? (
                      <p className="text-xs font-medium text-red-700">
                        Enter payout rate as a percentage.
                      </p>
                    ) : null}
                  </label>
                  {hasStandaloneFuel ? (
                    <label className="block space-y-2 text-sm font-medium text-slate-700">
                      <span>Fuel Rate per 1,000 Points</span>
                      <input
                        className="h-11 w-full rounded-md border border-slate-300 px-3"
                        min="0"
                        onChange={(event) =>
                          setFuelRatePer1000(event.target.value)
                        }
                        required
                        step="0.01"
                        type="number"
                        value={fuelRatePer1000}
                      />
                    </label>
                  ) : null}
                  <div className="space-y-2 text-sm font-medium text-slate-700">
                    <span>Total Expected Payout</span>
                    <div className="flex h-11 items-center rounded-md border border-slate-200 bg-slate-50 px-3 font-semibold text-slate-950">
                      {formatCurrency(totalExpectedPayout)}
                    </div>
                  </div>
                </div>
                <label className="mt-4 block space-y-2 text-sm font-medium text-slate-700">
                  <span>Notes</span>
                  <textarea
                    className="min-h-20 w-full rounded-md border border-slate-300 px-3 py-2"
                    onChange={(event) => setNotes(event.target.value)}
                    value={notes}
                  />
                </label>
              </section>

              <AssetPicker
                cards={giftCards}
                fuelAccounts={fuelAccounts}
                fuelSelections={fuelSelections}
                hasSelectedCards={hasSelectedCards}
                selectedCardIds={selectedCardIds}
                setFuelOverageOverride={setFuelOverageOverride}
                toggleCard={toggleCard}
                toggleFuelAccount={toggleFuelAccount}
                updateFuelTargetToCurrent={updateFuelTargetToCurrent}
              />
            </div>

            <aside className="space-y-4">
              <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
                <h2 className="font-semibold">Sale Summary</h2>
                <dl className="mt-3 space-y-2 text-sm">
                  <SummaryRow label="Cards" value={String(selectedCards.length)} />
                  <SummaryRow label="Fuel accounts" value={String(selectedFuelAccounts.length)} />
                  <SummaryRow label="Card face value" value={formatCurrency(selectedFaceValue)} />
                  <SummaryRow label="Card payout rate" value={formatRateLabel(normalizedCardPayoutRate)} />
                  <SummaryRow label="Card payout" value={formatCurrency(cardPayout)} />
                  <SummaryRow label="Fuel points selected" value={selectedSellableFuelPoints.toLocaleString()} />
                  {hasStandaloneFuel ? (
                    <SummaryRow label="Fuel payout" value={formatCurrency(standaloneFuelPayout)} />
                  ) : selectedFuelAccounts.length > 0 ? (
                    <SummaryRow label="Fuel payout" value="Included in bundle" />
                  ) : null}
                  <SummaryRow label="Total expected payout" value={formatCurrency(totalExpectedPayout)} />
                </dl>
                <button
                  className="mt-4 h-11 w-full rounded-md bg-slate-950 px-4 text-sm font-semibold text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
                  disabled={isSaving || !canSubmit}
                  type="submit"
                >
                  {isSaving ? "Finalizing..." : "Finalize Sale"}
                </button>
              </section>

              <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
                <h2 className="font-semibold">Export Preview</h2>
                <p className="mt-1 text-xs text-slate-500">
                  {exportFormatLabel(selectedBuyer)}
                </p>
                <p className="mt-3 text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Cards
                </p>
                <pre className="mt-2 max-h-40 overflow-auto rounded-md bg-slate-50 p-3 text-xs">
                  {cardExportPreview(selectedCards, selectedBuyer)}
                </pre>
                <p className="mt-3 text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Fuel
                </p>
                <pre className="mt-2 max-h-40 overflow-auto rounded-md bg-slate-50 p-3 text-xs">
                  {fuelExportPreview(selectedFuelAccounts, fuelSelections, selectedBuyer)}
                </pre>
              </section>
            </aside>
          </form>
        )}
      </div>
    </main>
  );
}

function AssetPicker({
  cards,
  fuelAccounts,
  fuelSelections,
  hasSelectedCards,
  selectedCardIds,
  setFuelOverageOverride,
  toggleCard,
  toggleFuelAccount,
  updateFuelTargetToCurrent,
}: {
  cards: GiftCard[];
  fuelAccounts: FuelAccount[];
  fuelSelections: FuelSelection[];
  hasSelectedCards: boolean;
  selectedCardIds: number[];
  setFuelOverageOverride: (accountId: number, value: boolean) => void;
  toggleCard: (cardId: number) => void;
  toggleFuelAccount: (account: FuelAccount) => void;
  updateFuelTargetToCurrent: (account: FuelAccount) => void;
}) {
  return (
    <section className="grid gap-6 xl:grid-cols-2">
      <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="font-semibold">Gift Cards</h2>
        <div className="mt-4 max-h-[34rem] space-y-2 overflow-auto">
          {cards.map((card) => (
            <label
              className="flex cursor-pointer items-center gap-3 rounded-md border border-slate-200 px-3 py-2 text-sm hover:bg-slate-50"
              key={card.id}
            >
              <input
                checked={selectedCardIds.includes(card.id)}
                className="h-4 w-4 shrink-0 cursor-pointer"
                onChange={() => toggleCard(card.id)}
                type="checkbox"
              />
              <span className="min-w-0">
                <span className="font-medium">{card.brand}</span>
                <span className="ml-2 text-slate-500">
                  {formatCurrency(card.face_value)}
                </span>
                <span className="ml-2 text-slate-500">
                  {cardEnding(card)}
                </span>
              </span>
            </label>
          ))}
          {cards.length === 0 ? (
            <p className="text-sm text-slate-500">No available cards.</p>
          ) : null}
        </div>
      </div>

      <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="font-semibold">Fuel Accounts</h2>
        <div className="mt-4 max-h-[34rem] space-y-3 overflow-auto">
          {fuelAccounts.map((account) => {
            const selection = fuelSelections.find(
              (item) => item.fuel_reward_account_id === account.id,
            );
            const isBelowTarget = isFuelBelowTarget(account);
            const overagePoints = fuelOveragePoints(account);
            const requiresOverageOverride = fuelRequiresOverageOverride(account);

            return (
              <div
                className={`rounded-md border px-3 py-2 text-sm ${
                  isBelowTarget
                    ? "border-red-200 bg-red-50"
                    : requiresOverageOverride
                      ? "border-amber-200 bg-amber-50"
                      : "border-slate-200"
                }`}
                key={account.id}
              >
                <label className="flex cursor-pointer items-start gap-3">
                  <input
                    checked={Boolean(selection)}
                    className="mt-0.5 h-4 w-4 shrink-0 cursor-pointer disabled:cursor-not-allowed"
                    disabled={isBelowTarget}
                    onChange={() => toggleFuelAccount(account)}
                    type="checkbox"
                  />
                  <span className="min-w-0">
                    <span className="font-medium">{account.retailer}</span>
                    <span className="ml-2 text-slate-500">
                      {fuelTargetLabel(account)}
                    </span>
                    {isBelowTarget ? (
                      <span className="ml-2 rounded-md bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-700">
                        Below target
                      </span>
                    ) : null}
                    {requiresOverageOverride ? (
                      <span className="mt-1 block text-xs font-medium text-amber-700">
                        This account is more than 1,000 points over target.
                      </span>
                    ) : null}
                  </span>
                </label>
                {selection ? (
                  <div className="mt-3 space-y-2">
                    <div className="rounded-md bg-slate-50 px-3 py-2 text-xs font-medium text-slate-600">
                      Full balance selected:{" "}
                      {Number(selection.points_sold).toLocaleString()} pts ·
                      sellable{" "}
                      {roundDownToThousand(selection.points_sold).toLocaleString()}{" "}
                      pts
                      <span className="mt-1 block">
                      {hasSelectedCards
                        ? "Included in bundle"
                        : "Valued by fuel rate per 1,000 points"}
                      </span>
                    </div>
                    {requiresOverageOverride ? (
                      <div className="space-y-2 rounded-md border border-amber-200 bg-white px-3 py-2 text-xs text-amber-800">
                        <p>
                          Overage: {overagePoints.toLocaleString()} points.
                        </p>
                        <label className="flex items-center gap-2 font-semibold">
                          <input
                            checked={selection.fuel_overage_override}
                            onChange={(event) =>
                              setFuelOverageOverride(
                                account.id,
                                event.target.checked,
                              )
                            }
                            type="checkbox"
                          />
                          Sell with overage
                        </label>
                        <button
                          className="text-left font-semibold underline"
                          onClick={() => updateFuelTargetToCurrent(account)}
                          type="button"
                        >
                          Update target to current points
                        </button>
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </div>
            );
          })}
          {fuelAccounts.length === 0 ? (
            <p className="text-sm text-slate-500">No active fuel accounts.</p>
          ) : null}
        </div>
      </div>
    </section>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-slate-500">{label}</dt>
      <dd className="font-medium">{value}</dd>
    </div>
  );
}
