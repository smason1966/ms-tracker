"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  FormEvent,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";

import { API_BASE_URL } from "@/lib/api";

type Buyer = {
  id: number;
  name: string;
  active: boolean;
  default_payment_account_id: number | null;
  default_payment_account: PaymentAccount | null;
  payment_timing_notes: string | null;
  payment_reference_format: string | null;
  payment_instructions: string | null;
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

type SaleCard = {
  id: number;
  brand: string;
  face_value: string | number;
  card_number_ending: string | null;
  purchase_batch_id: number;
  expected_payout: string | number | null;
  payout_received: string | number | null;
  settlement_received_at: string | null;
  settlement_status: string;
};

type SaleFuelAccount = {
  id: number;
  retailer: string;
  points_sold: number | null;
  expected_value: string | number | null;
  payout_received: string | number | null;
  settlement_received_at: string | null;
  email: string | null;
  alt_id: string | null;
};

type Sale = {
  id: number;
  buyer_id: number;
  buyer_name: string | null;
  sold_at: string;
  expected_payment_date: string | null;
  expected_payout: string | number;
  payout_received: string | number | null;
  payment_account_id: number | null;
  payment_account: PaymentAccount | null;
  status: string;
  notes: string | null;
  gift_cards: SaleCard[];
  fuel_accounts: SaleFuelAccount[];
};

type LegacyCard = {
  id: number;
  buyer_id: number | null;
  buyer_name: string | null;
  brand: string;
  face_value: string | number;
  expected_payout: string | number | null;
  card_number_encrypted: string | null;
  purchase_batch_id: number;
  status: string;
  expected_payment_date: string | null;
  sold_at: string | null;
  sale_history?: unknown[];
};

type PayableAsset =
  | {
      kind: "sale-card";
      id: string;
      saleId: number;
      giftCardId: number;
      expected: number;
      label: string;
      detail: string;
    }
  | {
      kind: "sale-fuel";
      id: string;
      saleId: number;
      fuelAccountId: number;
      expected: number;
      label: string;
      detail: string;
    }
  | {
      kind: "legacy-card";
      id: string;
      legacyCardId: number;
      expected: number;
      label: string;
      detail: string;
    };

const receiveQueueFilters = [
  { value: "awaiting", label: "Awaiting Payment" },
  { value: "overdue", label: "Overdue" },
  { value: "partial", label: "Partially Paid" },
  { value: "legacy", label: "Legacy Unlinked Cards" },
  { value: "all", label: "All Payable" },
] as const;

type ReceiveQueueFilter = (typeof receiveQueueFilters)[number]["value"];

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

function formatSignedCurrency(value: number) {
  const formatted = formatCurrency(Math.abs(value));

  if (Math.round(value * 100) === 0) {
    return "$0.00";
  }

  return `${value > 0 ? "+" : "-"}${formatted}`;
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

function dayDifference(value: string | null) {
  if (!value) {
    return null;
  }

  const due = value.includes("T")
    ? new Date(value)
    : new Date(`${value}T00:00:00`);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  due.setHours(0, 0, 0, 0);

  if (Number.isNaN(due.getTime())) {
    return null;
  }

  return Math.round((due.getTime() - today.getTime()) / 86_400_000);
}

function paymentAccountLabel(account: PaymentAccount | null | undefined) {
  if (!account) {
    return "No payment account selected";
  }

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

function cardEnding(value: string | null) {
  return value ? value.replace(/\s/g, "").slice(-4) : "";
}

function saleCardAssetId(saleId: number, cardId: number) {
  return `sale-${saleId}-card-${cardId}`;
}

function saleFuelAssetId(saleId: number, accountId: number) {
  return `sale-${saleId}-fuel-${accountId}`;
}

function legacyCardAssetId(cardId: number) {
  return `legacy-card-${cardId}`;
}

function isSaleCardUnpaid(card: SaleCard) {
  return !card.settlement_received_at;
}

function isSaleFuelUnpaid(account: SaleFuelAccount) {
  return !account.settlement_received_at;
}

function salePaymentStatus(sale: Sale) {
  const cardAssets = sale.gift_cards;
  const fuelAssets = sale.fuel_accounts;
  const totalAssets = cardAssets.length + fuelAssets.length;
  const unpaidAssets = [
    ...cardAssets.filter(isSaleCardUnpaid),
    ...fuelAssets.filter(isSaleFuelUnpaid),
  ].length;
  const expectedDate = sale.expected_payment_date
    ? new Date(`${sale.expected_payment_date}T00:00:00`)
    : null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  if (
    unpaidAssets > 0 &&
    expectedDate &&
    !Number.isNaN(expectedDate.getTime()) &&
    expectedDate < today
  ) {
    return {
      label: "Overdue",
      className: "border-red-300/40 bg-red-500/10 text-red-100",
    };
  }

  if (unpaidAssets === 0) {
    return {
      label: "Paid / Settled",
      className: "border-emerald-300/40 bg-emerald-400/10 text-emerald-100",
    };
  }

  if (unpaidAssets < totalAssets) {
    return {
      label: "Partially Paid",
      className: "border-blue-300/40 bg-blue-500/10 text-blue-100",
    };
  }

  return {
    label: "Awaiting Payment",
    className: "border-amber-300/40 bg-amber-400/10 text-amber-100",
  };
}

function saleMatchesReceiveFilter(sale: Sale, filter: ReceiveQueueFilter) {
  const dueDiff = dayDifference(sale.expected_payment_date);

  if (filter === "overdue") {
    return dueDiff !== null && dueDiff < 0;
  }
  if (filter === "partial") {
    return sale.status === "PARTIALLY_SETTLED";
  }
  if (filter === "legacy") {
    return false;
  }
  if (filter === "all") {
    return true;
  }
  return true;
}

function assetExpected(asset: PayableAsset) {
  return asset.expected;
}

async function fetchJson<T>(endpoint: string, label: string): Promise<T> {
  let response: Response;

  try {
    response = await fetch(endpoint);
  } catch (err) {
    console.error("Receive Payment fetch network error", {
      endpoint,
      label,
      error: err,
    });
    throw new Error(
      `Failed to reach ${label} at ${endpoint}: ${
        err instanceof Error ? err.message : "network request failed"
      }`,
    );
  }

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    console.error("Receive Payment fetch failed", {
      endpoint,
      label,
      status: response.status,
      statusText: response.statusText,
      body,
    });
    throw new Error(
      `Failed to load ${label} from ${endpoint} (${response.status})${
        body ? `: ${body}` : ""
      }`,
    );
  }

  return (await response.json()) as T;
}

function allocateAmount(
  assets: PayableAsset[],
  receivedTotal: number,
): Map<string, number> {
  const allocations = new Map<string, number>();
  const expectedTotal = assets.reduce(
    (total, asset) => total + assetExpected(asset),
    0,
  );
  let allocatedTotal = 0;

  assets.forEach((asset, index) => {
    const amount =
      expectedTotal <= 0
        ? index === assets.length - 1
          ? Number((receivedTotal - allocatedTotal).toFixed(2))
          : Number((receivedTotal / assets.length).toFixed(2))
        : index === assets.length - 1
          ? Number((receivedTotal - allocatedTotal).toFixed(2))
          : Number(
              (receivedTotal * (assetExpected(asset) / expectedTotal)).toFixed(
                2,
              ),
            );

    allocatedTotal += amount;
    allocations.set(asset.id, amount);
  });

  return allocations;
}

function saleAssets(sale: Sale): PayableAsset[] {
  return [
    ...sale.gift_cards.filter(isSaleCardUnpaid).map((card) => ({
      kind: "sale-card" as const,
      id: saleCardAssetId(sale.id, card.id),
      saleId: sale.id,
      giftCardId: card.id,
      expected: Number(card.expected_payout ?? 0) || 0,
      label: `${card.brand} ${formatCurrency(card.face_value)}`,
      detail: [
        card.card_number_ending ? `ending ${card.card_number_ending}` : null,
        `purchase #${card.purchase_batch_id}`,
      ]
        .filter(Boolean)
        .join(" · "),
    })),
    ...sale.fuel_accounts.filter(isSaleFuelUnpaid).map((account) => ({
      kind: "sale-fuel" as const,
      id: saleFuelAssetId(sale.id, account.id),
      saleId: sale.id,
      fuelAccountId: account.id,
      expected: Number(account.expected_value ?? 0) || 0,
      label: account.retailer,
      detail: [
        `${account.points_sold?.toLocaleString() ?? 0} points`,
        account.alt_id ? `alt ${account.alt_id}` : null,
        account.email,
      ]
        .filter(Boolean)
        .join(" · "),
    })),
  ];
}

function compactGiftCardLabel(card: SaleCard) {
  return [
    card.brand,
    formatCurrency(card.face_value),
    card.card_number_ending,
  ]
    .filter(Boolean)
    .join(" • ");
}

function compactFuelLabel(account: SaleFuelAccount) {
  return [
    "Fuel",
    account.retailer,
    `${account.points_sold?.toLocaleString() ?? 0} pts`,
  ].join(" • ");
}

function defaultPaymentAccountIdForBuyer(
  nextBuyerId: string,
  buyers: Buyer[],
  sales: Sale[],
) {
  if (!nextBuyerId) {
    return "";
  }

  const selectedBuyerId = Number(nextBuyerId);
  const saleAccountId = sales
    .filter(
      (sale) =>
        sale.buyer_id === selectedBuyerId &&
        ["ACTIVE", "SOLD_PENDING_PAYMENT", "PARTIALLY_SETTLED"].includes(sale.status) &&
        saleAssets(sale).length > 0,
    )
    .sort((saleA, saleB) => {
      const dateA = saleA.expected_payment_date ?? "9999-12-31";
      const dateB = saleB.expected_payment_date ?? "9999-12-31";

      if (dateA !== dateB) {
        return dateA.localeCompare(dateB);
      }

      return saleA.id - saleB.id;
    })
    .find((sale) => sale.payment_account_id !== null)?.payment_account_id;

  if (saleAccountId !== undefined && saleAccountId !== null) {
    return String(saleAccountId);
  }

  const buyer =
    buyers.find((candidate) => String(candidate.id) === nextBuyerId) ?? null;

  return buyer?.default_payment_account_id === null ||
    buyer?.default_payment_account_id === undefined
    ? ""
    : String(buyer.default_payment_account_id);
}

export default function ReceivePaymentPage() {
  return (
    <Suspense
      fallback={
        <main className="min-h-screen bg-[#020617] px-4 py-8 text-slate-100">
          <div className="mx-auto max-w-7xl rounded-lg border border-white/10 bg-[#0f172a] p-8 text-sm text-slate-400">
            Loading payment workflow...
          </div>
        </main>
      }
    >
      <ReceivePaymentContent />
    </Suspense>
  );
}

function ReceivePaymentContent() {
  const searchParams = useSearchParams();
  const [buyers, setBuyers] = useState<Buyer[]>([]);
  const [paymentAccounts, setPaymentAccounts] = useState<PaymentAccount[]>([]);
  const [sales, setSales] = useState<Sale[]>([]);
  const [legacyCards, setLegacyCards] = useState<LegacyCard[]>([]);
  const [buyerId, setBuyerId] = useState(searchParams.get("buyer_id") ?? "");
  const [receivedAmount, setReceivedAmount] = useState("");
  const [paymentAccountId, setPaymentAccountId] = useState("");
  const [receivedDate, setReceivedDate] = useState(todayString());
  const [settlementNotes, setSettlementNotes] = useState(
    "Bulk deposit reconciliation",
  );
  const [queueFilter, setQueueFilter] =
    useState<ReceiveQueueFilter>("awaiting");
  const [acceptDifference, setAcceptDifference] = useState(false);
  const [adjustmentReason, setAdjustmentReason] = useState("");
  const [selectedAssetIds, setSelectedAssetIds] = useState<string[]>([]);
  const [expandedSaleIds, setExpandedSaleIds] = useState<number[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const [buyerData, accountData, saleData, cardData] = await Promise.all([
        fetchJson<Buyer[]>(`${API_BASE_URL}/buyers/`, "buyers"),
        fetchJson<PaymentAccount[]>(
          `${API_BASE_URL}/payment-accounts/?active_only=true`,
          "payment accounts",
        ),
        fetchJson<Sale[]>(`${API_BASE_URL}/sales/`, "sales"),
        fetchJson<LegacyCard[]>(`${API_BASE_URL}/gift-cards/`, "gift cards"),
      ]);

      setBuyers(buyerData);
      setPaymentAccounts(accountData);
      setSales(saleData);
      setLegacyCards(cardData);
      if (buyerId) {
        setPaymentAccountId(
          defaultPaymentAccountIdForBuyer(buyerId, buyerData, saleData),
        );
      }
    } catch (err) {
      console.error("Receive Payment load failed", err);
      setError(err instanceof Error ? err.message : "Failed to load payments.");
    } finally {
      setIsLoading(false);
    }
  }, [buyerId]);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      void loadData();
    }, 0);

    return () => window.clearTimeout(timeoutId);
  }, [loadData]);

  const selectedBuyer = useMemo(
    () => buyers.find((buyer) => String(buyer.id) === buyerId) ?? null,
    [buyerId, buyers],
  );
  function selectBuyer(nextBuyerId: string) {
    setBuyerId(nextBuyerId);
    setSelectedAssetIds([]);
    setPaymentAccountId(
      defaultPaymentAccountIdForBuyer(nextBuyerId, buyers, sales),
    );
  }

  const payableSales = useMemo(() => {
    if (!buyerId) {
      return [];
    }

    const selectedBuyerId = Number(buyerId);
    return sales
      .filter(
        (sale) =>
          sale.buyer_id === selectedBuyerId &&
          ["ACTIVE", "SOLD_PENDING_PAYMENT", "PARTIALLY_SETTLED"].includes(sale.status) &&
          saleAssets(sale).length > 0,
      )
      .sort((saleA, saleB) => {
        const dateA = saleA.expected_payment_date ?? "9999-12-31";
        const dateB = saleB.expected_payment_date ?? "9999-12-31";

        if (dateA !== dateB) {
          return dateA.localeCompare(dateB);
        }

        return saleA.id - saleB.id;
      });
  }, [buyerId, sales]);

  const legacyPayables = useMemo(() => {
    if (!buyerId) {
      return [];
    }

    const selectedBuyerId = Number(buyerId);
    return legacyCards
      .filter(
        (card) =>
          card.buyer_id === selectedBuyerId &&
          ["SOLD_PENDING_PAYMENT", "SOLD"].includes(card.status) &&
          (!card.sale_history || card.sale_history.length === 0),
      )
      .map((card) => ({
        kind: "legacy-card" as const,
        id: legacyCardAssetId(card.id),
        legacyCardId: card.id,
        expected: Number(card.expected_payout ?? 0) || 0,
        label: `${card.brand} ${formatCurrency(card.face_value)}`,
        detail: [
          `card ending ${cardEnding(card.card_number_encrypted) || "-"}`,
          `purchase #${card.purchase_batch_id}`,
        ].join(" · "),
      }));
  }, [buyerId, legacyCards]);

  const visiblePayableSales = useMemo(
    () =>
      payableSales.filter((sale) =>
        saleMatchesReceiveFilter(sale, queueFilter),
      ),
    [payableSales, queueFilter],
  );

  const visibleLegacyPayables = useMemo(
    () =>
      queueFilter === "legacy" || queueFilter === "all" ? legacyPayables : [],
    [legacyPayables, queueFilter],
  );

  const allAssets = useMemo(
    () => [...visiblePayableSales.flatMap(saleAssets), ...visibleLegacyPayables],
    [visibleLegacyPayables, visiblePayableSales],
  );
  const totalPayableItemCount =
    payableSales.reduce((total, sale) => total + saleAssets(sale).length, 0) +
    legacyPayables.length;
  const visiblePayableItemCount =
    visiblePayableSales.reduce(
      (total, sale) => total + saleAssets(sale).length,
      0,
    ) + visibleLegacyPayables.length;
  const selectedAssets = allAssets.filter((asset) =>
    selectedAssetIds.includes(asset.id),
  );
  const selectedExpectedTotal = selectedAssets.reduce(
    (total, asset) => total + assetExpected(asset),
    0,
  );
  const receivedTotal = Number(receivedAmount || 0);
  const difference = receivedTotal - selectedExpectedTotal;
  const hasDifference = Math.round(difference * 100) !== 0;
  const canSubmit =
    selectedAssets.length > 0 &&
    Boolean(receivedAmount) &&
    Boolean(buyerId) &&
    (!hasDifference || acceptDifference);

  function toggleAsset(assetId: string) {
    setSelectedAssetIds((currentIds) =>
      currentIds.includes(assetId)
        ? currentIds.filter((id) => id !== assetId)
        : [...currentIds, assetId],
    );
  }

  function toggleSale(sale: Sale) {
    const ids = saleAssets(sale).map((asset) => asset.id);
    const allSelected = ids.every((id) => selectedAssetIds.includes(id));

    setSelectedAssetIds((currentIds) =>
      allSelected
        ? currentIds.filter((id) => !ids.includes(id))
        : Array.from(new Set([...currentIds, ...ids])),
    );
  }

  function toggleExpandedSale(saleId: number) {
    setExpandedSaleIds((currentIds) =>
      currentIds.includes(saleId)
        ? currentIds.filter((id) => id !== saleId)
        : [...currentIds, saleId],
    );
  }

  async function submitPayment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!canSubmit) {
      return;
    }

    setIsSaving(true);
    setError(null);
    setMessage(null);

    try {
      const allocations = allocateAmount(selectedAssets, receivedTotal);
      const assetsBySale = new Map<number, PayableAsset[]>();

      selectedAssets.forEach((asset) => {
        if (asset.kind === "legacy-card") {
          return;
        }

        assetsBySale.set(asset.saleId, [
          ...(assetsBySale.get(asset.saleId) ?? []),
          asset,
        ]);
      });

      for (const [saleId, assets] of assetsBySale.entries()) {
        const response = await fetch(
          `${API_BASE_URL}/sales/${saleId}/settle-assets`,
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              gift_card_ids: assets
                .filter((asset) => asset.kind === "sale-card")
                .map((asset) => asset.giftCardId),
              fuel_account_ids: assets
                .filter((asset) => asset.kind === "sale-fuel")
                .map((asset) => asset.fuelAccountId),
              payout_received: String(
                assets.reduce(
                  (total, asset) => total + (allocations.get(asset.id) ?? 0),
                  0,
                ),
              ),
              payment_account_id:
                paymentAccountId === "" ? null : Number(paymentAccountId),
              settlement_received_at: `${receivedDate}T00:00:00`,
              adjustment_amount: hasDifference ? String(difference) : null,
              adjustment_reason: hasDifference ? adjustmentReason : null,
              notes: settlementNotes.trim() || null,
            }),
          },
        );

        if (!response.ok) {
          throw new Error(`Failed to settle sale #${saleId} (${response.status})`);
        }
      }

      for (const asset of selectedAssets) {
        if (asset.kind !== "legacy-card") {
          continue;
        }

        const response = await fetch(
          `${API_BASE_URL}/gift-cards/${asset.legacyCardId}/settle`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              payout_received: String(allocations.get(asset.id) ?? 0),
              payment_account_id:
                paymentAccountId === "" ? null : Number(paymentAccountId),
              settlement_received_date: receivedDate,
              internal_notes: [
                settlementNotes.trim(),
                hasDifference ? `Adjustment: ${adjustmentReason}` : null,
              ]
                .filter(Boolean)
                .join("\n"),
            }),
          },
        );

        if (!response.ok) {
          throw new Error(
            `Failed to settle sold card not linked to sale #${asset.legacyCardId} (${response.status})`,
          );
        }
      }

      setMessage("Payment received and selected assets settled.");
      setSelectedAssetIds([]);
      setReceivedAmount("");
      setAcceptDifference(false);
      setAdjustmentReason("");
      await loadData();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to receive payment.",
      );
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <main className="min-h-screen bg-[#020617] px-4 py-8 text-slate-100 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-7xl space-y-6">
        <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-sm font-medium uppercase tracking-wide text-slate-500">
              Payments
            </p>
            <h1 className="mt-1 text-3xl font-semibold tracking-tight">
              Receive Payment
            </h1>
            <p className="mt-2 text-sm text-slate-400">
              Start with the buyer deposit, pick the matching sale assets, and
              explicitly record short pays, overpays, or partial settlements.
            </p>
          </div>
          <Link
            className="inline-flex h-11 cursor-pointer items-center rounded-md border border-white/10 px-4 text-sm font-semibold text-slate-100 hover:bg-white/10 active:bg-white/15"
            href="/sales"
          >
            Sales History
          </Link>
        </header>

        {error ? (
          <div className="rounded-md border border-red-300/30 bg-red-500/10 px-4 py-3 text-sm font-medium text-red-100">
            {error}
          </div>
        ) : null}
        {message ? (
          <div className="rounded-md border border-emerald-300/30 bg-emerald-400/10 px-4 py-3 text-sm font-medium text-emerald-100">
            {message}
          </div>
        ) : null}

        <form className="space-y-6" onSubmit={submitPayment}>
          <section className="rounded-lg border border-white/10 bg-[#0f172a] p-5 shadow-2xl shadow-black/20">
            <h2 className="text-lg font-semibold">Deposit Details</h2>
            <div className="mt-4 grid gap-4 md:grid-cols-5">
              <label className="space-y-2 text-sm font-medium text-slate-300">
                <span>Buyer</span>
                <select
                  className="h-11 w-full rounded-md border border-white/10 bg-[#020617] px-3 text-slate-100"
                  onChange={(event) => selectBuyer(event.target.value)}
                  required
                  value={buyerId}
                >
                  <option value="">
                    {isLoading ? "Loading buyers..." : "Select buyer"}
                  </option>
                  {buyers
                    .filter((buyer) => buyer.active)
                    .map((buyer) => (
                      <option key={buyer.id} value={buyer.id}>
                        {buyer.name}
                      </option>
                  ))}
                </select>
              </label>
              <label className="space-y-2 text-sm font-medium text-slate-300">
                <span>Deposit Account</span>
                <select
                  className="h-11 w-full rounded-md border border-white/10 bg-[#020617] px-3 text-slate-100"
                  onChange={(event) => setPaymentAccountId(event.target.value)}
                  value={paymentAccountId}
                >
                  <option value="">No account selected</option>
                  {paymentAccounts.map((account) => (
                    <option key={account.id} value={account.id}>
                      {paymentAccountLabel(account)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="space-y-2 text-sm font-medium text-slate-300">
                <span>Received Amount</span>
                <input
                  className="h-11 w-full rounded-md border border-white/10 bg-[#020617] px-3 text-slate-100"
                  min="0"
                  onChange={(event) => setReceivedAmount(event.target.value)}
                  required
                  step="0.01"
                  type="number"
                  value={receivedAmount}
                />
              </label>
              <label className="space-y-2 text-sm font-medium text-slate-300">
                <span>Received Date</span>
                <input
                  className="h-11 w-full rounded-md border border-white/10 bg-[#020617] px-3 text-slate-100"
                  onChange={(event) => setReceivedDate(event.target.value)}
                  required
                  type="date"
                  value={receivedDate}
                />
              </label>
              <label className="space-y-2 text-sm font-medium text-slate-300">
                <span>Settlement Notes / Reference</span>
                <input
                  className="h-11 w-full rounded-md border border-white/10 bg-[#020617] px-3 text-slate-100"
                  onChange={(event) => setSettlementNotes(event.target.value)}
                  type="text"
                  value={settlementNotes}
                />
              </label>
            </div>
          </section>

          <section className="sticky top-3 z-20 rounded-lg border border-white/10 bg-[#0f172a]/95 p-5 shadow-2xl shadow-black/25 backdrop-blur">
            <div className="grid gap-3 sm:grid-cols-4">
              <Metric label="Selected" value={String(selectedAssets.length)} />
              <Metric
                label="Expected"
                value={formatCurrency(selectedExpectedTotal)}
              />
              <Metric label="Received" value={formatCurrency(receivedTotal)} />
              <Metric
                label="Difference"
                tone={hasDifference ? "red" : "green"}
                value={formatSignedCurrency(difference)}
              />
            </div>

            {hasDifference && receivedAmount ? (
              <div className="mt-4 rounded-md border border-amber-300/30 bg-amber-400/10 p-4">
                <p className="text-sm font-semibold text-amber-100">
                  Received amount differs from expected by{" "}
                  {formatSignedCurrency(difference)}.
                </p>
                <label className="mt-3 flex items-center gap-2 text-sm font-medium text-amber-50">
                  <input
                    checked={acceptDifference}
                    className="h-4 w-4 cursor-pointer"
                    onChange={(event) => setAcceptDifference(event.target.checked)}
                    type="checkbox"
                  />
                  Accept difference / record adjustment
                </label>
                {acceptDifference ? (
                  <div className="mt-3 grid gap-3 md:grid-cols-2">
                    <label className="space-y-2 text-sm font-medium text-amber-50">
                      <span>Adjustment Amount</span>
                      <input
                        className="h-11 w-full rounded-md border border-amber-300/40 bg-[#020617]/60 px-3 text-amber-50"
                        readOnly
                        value={formatSignedCurrency(difference)}
                      />
                    </label>
                    <label className="space-y-2 text-sm font-medium text-amber-50">
                      <span>Adjustment Reason</span>
                      <input
                        className="h-11 w-full rounded-md border border-amber-300/40 bg-[#020617]/60 px-3 text-amber-50"
                        onChange={(event) =>
                          setAdjustmentReason(event.target.value)
                        }
                        placeholder="Short pay, fee, delayed asset, buyer issue..."
                        value={adjustmentReason}
                      />
                    </label>
                  </div>
                ) : null}
              </div>
            ) : null}

            <div className="mt-4 flex justify-end">
              <button
                className="h-11 cursor-pointer rounded-md bg-emerald-700 px-4 text-sm font-semibold text-white hover:bg-emerald-800 active:bg-emerald-900 disabled:cursor-not-allowed disabled:opacity-60"
                disabled={isSaving || !canSubmit}
                type="submit"
              >
                {isSaving ? "Saving..." : "Confirm Settlement"}
              </button>
            </div>
          </section>

          <section className="rounded-lg border border-white/10 bg-[#0f172a] shadow-2xl shadow-black/20">
            <div className="border-b border-white/10 px-5 py-4">
              <h2 className="text-lg font-semibold">
                Payment Reconciliation Queue
              </h2>
              <p className="mt-1 text-sm text-slate-400">
                {buyerId
                  ? `Showing payable items for ${
                      selectedBuyer?.name ?? "selected buyer"
                    }.`
                  : "Select a buyer above to load payable items."}
              </p>
            </div>

            {buyerId ? (
              <div className="border-b border-white/10 bg-white/[0.025] px-5 py-3">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                  <label className="space-y-2 text-sm font-medium text-slate-300">
                    <span>Status for selected buyer</span>
                    <select
                      className="h-10 min-w-56 rounded-md border border-white/10 bg-[#020617] px-3 text-sm text-slate-100"
                      onChange={(event) =>
                        setQueueFilter(event.target.value as ReceiveQueueFilter)
                      }
                      value={queueFilter}
                    >
                      {receiveQueueFilters.map((filter) => (
                        <option key={filter.value} value={filter.value}>
                          {filter.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <p className="pb-2 text-sm font-medium text-slate-400">
                    {visiblePayableItemCount} of {totalPayableItemCount} items
                  </p>
                </div>
              </div>
            ) : null}

            {!buyerId ? (
              <p className="px-5 py-8 text-sm text-slate-400">
                Select a buyer above to load payable items.
              </p>
            ) : totalPayableItemCount === 0 ? (
              <p className="px-5 py-8 text-sm text-slate-400">
                No payment reconciliation items found.
              </p>
            ) : visiblePayableItemCount === 0 ? (
              <p className="px-5 py-8 text-sm text-slate-400">
                No payable items match this status filter.
              </p>
            ) : (
              <div className="divide-y divide-white/10">
                {visiblePayableSales.map((sale) => {
                  const assets = saleAssets(sale);
                  const assetIds = assets.map((asset) => asset.id);
                  const allSelected = assetIds.every((id) =>
                    selectedAssetIds.includes(id),
                  );
                  const someSelected = assetIds.some((id) =>
                    selectedAssetIds.includes(id),
                  );
                  const expanded = expandedSaleIds.includes(sale.id);
                  const unpaidExpected = assets.reduce(
                    (total, asset) => total + asset.expected,
                    0,
                  );
                  const paymentStatus = salePaymentStatus(sale);

                  return (
                    <div className="px-5 py-3" key={sale.id}>
                      <div className="flex items-start gap-3">
                        <input
                          checked={allSelected}
                          className="mt-1 h-5 w-5 shrink-0 cursor-pointer"
                          onChange={() => toggleSale(sale)}
                          ref={(input) => {
                            if (input) {
                              input.indeterminate =
                                someSelected && !allSelected;
                            }
                          }}
                          type="checkbox"
                        />
                        <div className="grid min-w-0 flex-1 gap-3 lg:grid-cols-[minmax(0,1.35fr)_minmax(16rem,1fr)_minmax(11rem,0.7fr)] lg:items-center">
                          <div className="min-w-0">
                            <button
                              className="cursor-pointer text-left text-base font-semibold text-slate-100 hover:text-cyan-200"
                              onClick={() => toggleExpandedSale(sale.id)}
                              type="button"
                            >
                              <span className="mr-2 text-slate-500">
                                {expanded ? "▾" : "▸"}
                              </span>
                              {sale.buyer_name ?? selectedBuyer?.name ?? "Buyer"} · Sale #
                              {sale.id}
                            </button>
                            <p className="mt-1 text-sm text-slate-400">
                              Sold {formatDate(sale.sold_at)}
                            </p>
                            <div className="mt-2 flex flex-wrap gap-1.5">
                              {sale.gift_cards.slice(0, 3).map((card) => (
                                <AssetTag
                                  isSettled={!isSaleCardUnpaid(card)}
                                  key={card.id}
                                  label={compactGiftCardLabel(card)}
                                  type="card"
                                />
                              ))}
                              {sale.fuel_accounts.slice(0, 3).map((account) => (
                                <AssetTag
                                  isSettled={!isSaleFuelUnpaid(account)}
                                  key={account.id}
                                  label={compactFuelLabel(account)}
                                  type="fuel"
                                />
                              ))}
                              {sale.gift_cards.length + sale.fuel_accounts.length >
                              6 ? (
                                <span className="rounded-md border border-white/10 bg-white/[0.04] px-2 py-1 text-xs font-medium text-slate-400">
                                  +
                                  {sale.gift_cards.length +
                                    sale.fuel_accounts.length -
                                    6}{" "}
                                  more
                                </span>
                              ) : null}
                            </div>
                          </div>
                          <div className="grid gap-2 text-sm sm:grid-cols-3 lg:grid-cols-1">
                            <div>
                              <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
                                Expected payout
                              </p>
                              <p className="font-semibold text-slate-100">
                                {formatCurrency(sale.expected_payout)}
                              </p>
                              <p className="mt-0.5 text-xs text-slate-400">
                                Remaining: {formatCurrency(unpaidExpected)}
                              </p>
                            </div>
                            <div>
                              <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
                                Expected account
                              </p>
                              <p className="text-slate-300">
                                {paymentAccountLabel(sale.payment_account)}
                              </p>
                            </div>
                            <div>
                              <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
                                Expected date
                              </p>
                              <p className="text-slate-300">
                                {formatDate(sale.expected_payment_date)}
                              </p>
                            </div>
                          </div>

                          <div className="flex flex-wrap items-center justify-between gap-3 lg:justify-end">
                            <div className="space-y-1 lg:text-right">
                              <span
                                className={`inline-flex rounded-md border px-2 py-1 text-xs font-semibold ${paymentStatus.className}`}
                              >
                                {paymentStatus.label}
                              </span>
                              <p className="text-sm font-semibold text-slate-200">
                                Outstanding: {formatCurrency(unpaidExpected)}
                              </p>
                            </div>
                          </div>
                        </div>
                      </div>

                      {expanded ? (
                        <div className="mt-3 space-y-2 pl-0 sm:pl-8">
                          {assets.map((asset) => (
                            <AssetCheckbox
                              asset={asset}
                              checked={selectedAssetIds.includes(asset.id)}
                              key={asset.id}
                              onChange={() => toggleAsset(asset.id)}
                            />
                          ))}
                        </div>
                      ) : (
                        null
                      )}
                    </div>
                  );
                })}

                {visibleLegacyPayables.map((asset) => (
                  <div className="px-5 py-4" key={asset.id}>
                    <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                      Sold card not linked to sale
                    </p>
                    <AssetCheckbox
                      asset={asset}
                      checked={selectedAssetIds.includes(asset.id)}
                      onChange={() => toggleAsset(asset.id)}
                    />
                  </div>
                ))}
              </div>
            )}
          </section>

        </form>
      </div>
    </main>
  );
}

function AssetCheckbox({
  asset,
  checked,
  onChange,
}: {
  asset: PayableAsset;
  checked: boolean;
  onChange: () => void;
}) {
  const isFuel = asset.kind === "sale-fuel";

  return (
    <label
      className={`flex cursor-pointer items-start justify-between gap-3 rounded-md border px-3 py-3 transition hover:bg-white/[0.06] ${
        isFuel
          ? "border-cyan-300/40 bg-cyan-400/10"
          : "border-white/10 bg-white/[0.03]"
      }`}
    >
      <span className="flex min-w-0 items-start gap-3">
        <input
          checked={checked}
          className="mt-1 h-5 w-5 cursor-pointer"
          onChange={onChange}
          type="checkbox"
        />
        <span className="min-w-0">
          <span className="block font-medium text-slate-100">
            {isFuel ? "Fuel • " : ""}
            {asset.label}
          </span>
          <span className="mt-1 block text-sm text-slate-400">
            {asset.detail}
          </span>
        </span>
      </span>
      <span className="shrink-0 text-sm font-semibold text-slate-100">
        {asset.expected > 0 ? formatCurrency(asset.expected) : "Included"}
      </span>
    </label>
  );
}

function AssetTag({
  label,
  type,
  isSettled,
}: {
  label: string;
  type: "card" | "fuel";
  isSettled: boolean;
}) {
  const className =
    type === "fuel"
      ? "border-cyan-300/40 bg-cyan-400/10 text-cyan-100"
      : "border-white/10 bg-white/[0.04] text-slate-300";

  return (
    <span
      className={`rounded-md border px-2 py-1 text-xs font-medium ${className} ${
        isSettled ? "opacity-60" : ""
      }`}
    >
      {label}
      {isSettled ? " • settled" : ""}
    </span>
  );
}

function Metric({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: string;
  tone?: "default" | "green" | "yellow" | "red" | "blue";
}) {
  const toneClass =
    tone === "green"
      ? "border-emerald-300/30 bg-emerald-400/10 text-emerald-100"
      : tone === "yellow"
        ? "border-amber-300/30 bg-amber-400/10 text-amber-100"
        : tone === "red"
          ? "border-red-300/30 bg-red-500/10 text-red-100"
          : tone === "blue"
            ? "border-blue-300/30 bg-blue-500/10 text-blue-100"
            : "border-white/10 bg-white/[0.04] text-slate-100";

  return (
    <div className={`rounded-md border p-3 ${toneClass}`}>
      <p className="text-xs font-medium uppercase tracking-wide text-slate-400">
        {label}
      </p>
      <p className="mt-1 text-lg font-semibold tabular-nums">{value}</p>
    </div>
  );
}
