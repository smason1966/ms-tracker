"use client";

import { FormEvent, Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";

import { API_BASE_URL } from "@/lib/api";

type GiftCard = {
  id: number;
  purchase_batch_id: number;
  brand: string;
  face_value: string | number;
  acquisition_cost: string | number | null;
  expected_payout: string | number | null;
  payout_received: string | number | null;
  expected_profit: string | number | null;
  realized_profit: string | number | null;
  inventory_aging_days: number;
  buyer_id: number | null;
  buyer_name: string | null;
  sold_at: string | null;
  expected_payment_date: string | null;
  settlement_received_at: string | null;
  status: string;
  card_number_encrypted: string | null;
  pin_encrypted: string | null;
  notes: string | null;
  sale_history?: Array<{
    sale_id: number;
    buyer_name: string;
    sold_at: string;
    expected_payout: string | number | null;
    payout_received: string | number | null;
    status: string;
    notes: string | null;
  }>;
};

type Buyer = {
  id: number;
  name: string;
  active: boolean;
  default_payout_days: number | null;
  default_payout_rate: string | number | null;
  requires_card_images: boolean;
  requires_receipt_images: boolean;
  preferred_export_type: string;
  card_export_format: string | null;
  fuel_export_format: string | null;
};

type FuelAccount = {
  id: number;
  retailer: string;
  email: string | null;
  alt_id: string | null;
  login_password: string | null;
  status: string;
  current_points: number;
  target_points: number | null;
  expiration_cycle: string | null;
};

type FuelSelection = {
  fuel_reward_account_id: number;
  points_sold: string;
  fuel_overage_override: boolean;
};

type CardImage = {
  id: number;
  gift_card_id: number;
  original_image_url: string;
  created_at: string;
};

type Receipt = {
  id: number;
  purchase_batch_id: number;
  image_url: string;
  original_filename: string | null;
  created_at: string;
};

type SaleFile = {
  id: string;
  group: "card" | "receipt";
  label: string;
  url: string;
  filename: string;
};

type SaleResponse = {
  id: number;
  gift_cards: GiftCard[];
  fuel_accounts: Array<FuelAccount & {
    points_sold: number | null;
    expected_value: string | number | null;
  }>;
};

type SellForm = {
  buyer_id: string;
  payout_total: string;
  liquidation_rate: string;
  sold_date: string;
  expected_payment_date: string;
  notes: string;
};

type SettleForm = {
  payout_received: string;
  settlement_received_date: string;
  notes: string;
};

const sections = [
  { title: "Needs Verification", statuses: ["NEEDS_VERIFICATION"] },
  { title: "Available", statuses: ["VERIFIED_AVAILABLE"] },
  {
    title: "Awaiting Payment",
    statuses: ["SOLD_PENDING_PAYMENT", "PARTIALLY_SETTLED"],
  },
  { title: "Settled/Sold", statuses: ["SOLD", "SETTLED"] },
];

const inventoryLifecycleFilters = [
  {
    value: "open",
    label: "Open Inventory",
    statuses: [
      "NEEDS_VERIFICATION",
      "VERIFIED_AVAILABLE",
      "SOLD_PENDING_PAYMENT",
      "PARTIALLY_SETTLED",
    ],
  },
  {
    value: "needs_verification",
    label: "Needs Verification",
    statuses: ["NEEDS_VERIFICATION"],
  },
  {
    value: "available",
    label: "Available",
    statuses: ["VERIFIED_AVAILABLE"],
  },
  {
    value: "awaiting_payment",
    label: "Awaiting Payment",
    statuses: ["SOLD_PENDING_PAYMENT", "PARTIALLY_SETTLED"],
  },
  {
    value: "sold",
    label: "Sold",
    statuses: ["SOLD"],
  },
  {
    value: "settled",
    label: "Settled",
    statuses: ["SETTLED"],
  },
  {
    value: "all",
    label: "All",
    statuses: null,
  },
] as const;

type InventoryLifecycleFilter =
  (typeof inventoryLifecycleFilters)[number]["value"];

const inventoryFilterLabels: Record<string, string> = {
  available: "Available Inventory",
  needs_verification: "Needs Verification",
  awaiting_verification: "Needs Verification",
  awaiting_payment: "Awaiting Payment",
  settled: "Settled/Sold",
  duplicate_review: "Possible Duplicate Review",
};

const inventoryMetricLabels: Record<string, string> = {
  turnover: "Inventory Turnover",
};

function lifecycleFilterForStatus(
  statusFilter: string | null,
): InventoryLifecycleFilter | null {
  if (
    statusFilter === "awaiting_verification" ||
    statusFilter === "needs_verification"
  ) {
    return "needs_verification";
  }
  if (statusFilter === "available") {
    return "available";
  }
  if (statusFilter === "awaiting_payment") {
    return "awaiting_payment";
  }
  if (statusFilter === "settled") {
    return "settled";
  }
  return null;
}

function todayString() {
  return new Date().toISOString().slice(0, 10);
}

function addDaysString(dateValue: string, days: number | null) {
  if (!dateValue || days === null) {
    return "";
  }

  const date = new Date(`${dateValue}T00:00:00`);
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

function formatAmount(value: string | number | null) {
  if (value === null || value === "") {
    return "";
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

function formatStoredRateAsPercent(value: string | number | null | undefined) {
  const rate = Number(value ?? 1);

  if (!Number.isFinite(rate)) {
    return "100";
  }

  return String(Number((rate * 100).toFixed(4)));
}

function normalizePayoutRatePercent(value: string) {
  const rate = Number(value);

  if (!Number.isFinite(rate)) {
    return 0;
  }

  return rate / 100;
}

function isDecimalStylePayoutRate(value: string) {
  const rate = Number(value);
  return value.trim() !== "" && rate > 0 && rate < 1;
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

async function saleErrorMessage(response: Response) {
  const body = await response.json().catch(() => null);
  const detail = body?.detail ?? body;

  if (detail?.message) {
    return detail.message;
  }

  return `Failed to sell selected cards (${response.status})`;
}

function daysSince(dateValue: string | null) {
  if (!dateValue) {
    return "";
  }

  const then = new Date(dateValue);
  if (Number.isNaN(then.getTime())) {
    return "";
  }

  const now = new Date();
  const diff = now.getTime() - then.getTime();
  const days = Math.max(0, Math.floor(diff / 86_400_000));

  return `${days}d`;
}

function formatDate(value: string | null) {
  if (!value) {
    return "";
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

function dueStatus(expectedPaymentDate: string | null, soldAt: string | null) {
  if (!expectedPaymentDate) {
    return {
      className: "bg-slate-100 text-slate-700",
      text: soldAt ? `${daysSince(soldAt)} since sold` : "",
    };
  }

  const dueDate = new Date(`${expectedPaymentDate}T00:00:00`);
  const today = new Date(`${todayString()}T00:00:00`);
  const diffDays = Math.round(
    (dueDate.getTime() - today.getTime()) / 86_400_000,
  );

  if (diffDays < 0) {
    return {
      className: "bg-red-100 text-red-800",
      text: `${Math.abs(diffDays)}d overdue`,
    };
  }

  if (diffDays <= 2) {
    return {
      className: "bg-yellow-100 text-yellow-800",
      text: diffDays === 0 ? "Due today" : `Due in ${diffDays}d`,
    };
  }

  return {
    className: "bg-slate-100 text-slate-700",
    text: `Due in ${diffDays}d`,
  };
}

function statusLabel(status: string) {
  if (status === "NEEDS_VERIFICATION") {
    return "Needs Verification";
  }

  if (status === "VERIFIED_AVAILABLE") {
    return "Available";
  }

  if (status === "SOLD_PENDING_PAYMENT") {
    return "Awaiting Payment";
  }

  if (status === "SOLD") {
    return "Sold";
  }

  if (status === "SETTLED") {
    return "Settled";
  }

  return status.replaceAll("_", " ");
}

function statusBadgeClass(status: string) {
  if (status === "NEEDS_VERIFICATION") {
    return "bg-red-100 text-red-800";
  }

  if (status === "VERIFIED_AVAILABLE") {
    return "bg-emerald-50 text-emerald-800";
  }

  if (status === "SOLD_PENDING_PAYMENT" || status === "PARTIALLY_SETTLED") {
    return "bg-amber-50 text-amber-800";
  }

  return "bg-slate-100 text-slate-700";
}

function cardEnding(value: string | null) {
  if (!value) {
    return "";
  }

  const normalizedValue = value.replace(/\s/g, "");
  return normalizedValue.slice(-4);
}

function cardNumberStatus(value: string | null) {
  const ending = cardEnding(value);
  return ending ? `card ending ${ending}` : "card number missing";
}

function currentSaleId(card: GiftCard) {
  return card.sale_history?.[0]?.sale_id ?? null;
}

function escapeCsvValue(value: string | number | null) {
  const stringValue = value === null ? "" : String(value);

  if (
    stringValue.includes(",") ||
    stringValue.includes("\"") ||
    stringValue.includes("\n")
  ) {
    return `"${stringValue.replaceAll("\"", "\"\"")}"`;
  }

  return stringValue;
}

const DEFAULT_CARD_EXPORT_FORMAT = "brand,face_value,card_number,pin";
const DEFAULT_FUEL_EXPORT_FORMAT = "retailer,points_sold,email_login,password,alt_id";
const EXPORT_HEADERS = ["brand", "face_value", "card_number", "pin"];

function cleanFilenamePart(value: string | number | null) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "file";
}

function getFileExtension(path: string) {
  const cleanPath = path.split("?")[0];
  const extension = cleanPath.slice(cleanPath.lastIndexOf("."));

  return extension && extension.length <= 8 ? extension : ".jpg";
}

function getUploadUrl(path: string) {
  if (path.startsWith("http://") || path.startsWith("https://")) {
    return path;
  }

  return `${API_BASE_URL}/${path.replace(/^\/+/, "")}`;
}

function applyCardExportFormat(format: string, card: GiftCard) {
  return format
    .replaceAll("{brand}", card.brand)
    .replaceAll("{face_value}", String(card.face_value))
    .replaceAll("{card_number}", card.card_number_encrypted ?? "")
    .replaceAll("{pin}", card.pin_encrypted ?? "");
}

function buildDelimitedExport(cards: GiftCard[], delimiter: "," | "\t") {
  const rows = [
    EXPORT_HEADERS,
    ...cards.map((card) => [
      card.brand,
      String(card.face_value),
      card.card_number_encrypted ?? "",
      card.pin_encrypted ?? "",
    ]),
  ];

  if (delimiter === "\t") {
    return rows.map((row) => row.join("\t")).join("\n");
  }

  return rows
    .map((row) => row.map((value) => escapeCsvValue(value)).join(","))
    .join("\n");
}

function buildSellerExport(cards: GiftCard[], buyer: Buyer | null) {
  const exportType = buyer?.preferred_export_type ?? "TXT";

  if (exportType === "GOOGLE_SHEETS_PASTE") {
    return {
      text: buildDelimitedExport(cards, "\t"),
      fileExtension: "tsv",
      label: "Google Sheets Paste",
      canDownloadCsv: false,
    };
  }

  if (exportType === "TSV") {
    return {
      text: buildDelimitedExport(cards, "\t"),
      fileExtension: "tsv",
      label: "TSV",
      canDownloadCsv: false,
    };
  }

  if (exportType === "CUSTOM") {
    const format =
      buyer?.card_export_format?.trim() || DEFAULT_CARD_EXPORT_FORMAT;

    return {
      text: cards.map((card) => applyCardExportFormat(format, card)).join("\n"),
      fileExtension: "txt",
      label: "Custom",
      canDownloadCsv: false,
    };
  }

  return {
    text: buildDelimitedExport(cards, ","),
    fileExtension: exportType === "CSV" ? "csv" : "txt",
    label: exportType === "CSV" ? "CSV" : "TXT",
    canDownloadCsv: true,
  };
}

function applyFuelExportFormat(format: string, account: SaleResponse["fuel_accounts"][number]) {
  return format
    .replaceAll("{retailer}", account.retailer)
    .replaceAll("{points_sold}", String(account.points_sold ?? account.current_points))
    .replaceAll("{email_login}", account.email ?? "")
    .replaceAll("{password}", account.login_password ?? "")
    .replaceAll("{alt_id}", account.alt_id ?? "");
}

function buildFuelSellerExport(
  fuelAccounts: SaleResponse["fuel_accounts"],
  buyer: Buyer | null,
) {
  if (fuelAccounts.length === 0) {
    return "";
  }

  const format = buyer?.fuel_export_format?.trim() || DEFAULT_FUEL_EXPORT_FORMAT;

  if (format !== DEFAULT_FUEL_EXPORT_FORMAT) {
    return fuelAccounts.map((account) => applyFuelExportFormat(format, account)).join("\n");
  }

  return [
    DEFAULT_FUEL_EXPORT_FORMAT,
    ...fuelAccounts.map((account) =>
      [
        account.retailer,
        String(account.points_sold ?? account.current_points),
        account.email ?? "",
        account.login_password ?? "",
        account.alt_id ?? "",
      ]
        .map((value) => escapeCsvValue(value))
        .join(","),
    ),
  ].join("\n");
}

async function fetchGiftCards() {
  const endpoint = `${API_BASE_URL}/gift-cards/`;
  const response = await fetch(endpoint);

  if (!response.ok) {
    console.error("Inventory fetch failed", {
      endpoint,
      status: response.status,
      statusText: response.statusText,
    });
    throw new Error(`Failed to load gift cards from ${endpoint} (${response.status})`);
  }

  return (await response.json()) as GiftCard[];
}

async function fetchBuyers() {
  const endpoint = `${API_BASE_URL}/buyers/`;
  const response = await fetch(endpoint);

  if (!response.ok) {
    console.error("Inventory fetch failed", {
      endpoint,
      status: response.status,
      statusText: response.statusText,
    });
    throw new Error(`Failed to load buyers from ${endpoint} (${response.status})`);
  }

  return (await response.json()) as Buyer[];
}

async function fetchFuelAccounts() {
  const endpoint = `${API_BASE_URL}/fuel-accounts/dashboard`;
  const response = await fetch(endpoint);

  if (!response.ok) {
    console.error("Inventory fetch failed", {
      endpoint,
      status: response.status,
      statusText: response.statusText,
    });
    throw new Error(`Failed to load fuel accounts from ${endpoint} (${response.status})`);
  }

  return (await response.json()) as FuelAccount[];
}

export default function InventoryPage() {
  return (
    <Suspense
      fallback={
        <main className="min-h-screen bg-slate-50 px-4 py-8 text-slate-950 sm:px-6 lg:px-8">
          <div className="mx-auto max-w-7xl rounded-lg border border-slate-200 bg-white p-8 text-sm text-slate-500">
            Loading inventory...
          </div>
        </main>
      }
    >
      <InventoryContent />
    </Suspense>
  );
}

function InventoryContent() {
  const searchParams = useSearchParams();
  const [giftCards, setGiftCards] = useState<GiftCard[]>([]);
  const [buyers, setBuyers] = useState<Buyer[]>([]);
  const [fuelAccounts, setFuelAccounts] = useState<FuelAccount[]>([]);
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [saleCardIds, setSaleCardIds] = useState<number[]>([]);
  const [saleFuelSelections, setSaleFuelSelections] = useState<FuelSelection[]>([]);
  const [includeFuelInSale, setIncludeFuelInSale] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [lifecycleFilter, setLifecycleFilter] =
    useState<InventoryLifecycleFilter>("open");
  const [isBulkMode, setIsBulkMode] = useState(false);
  const [isSellModalOpen, setIsSellModalOpen] = useState(false);
  const [sellerExportCards, setSellerExportCards] = useState<GiftCard[]>([]);
  const [sellerExportFuelAccounts, setSellerExportFuelAccounts] = useState<SaleResponse["fuel_accounts"]>([]);
  const [sellerExportBuyer, setSellerExportBuyer] = useState<Buyer | null>(null);
  const [sellerExportSaleId, setSellerExportSaleId] = useState<number | null>(null);
  const [settlingCard, setSettlingCard] = useState<GiftCard | null>(null);
  const [sellForm, setSellForm] = useState<SellForm>({
    buyer_id: "",
    payout_total: "",
    liquidation_rate: "",
    sold_date: todayString(),
    expected_payment_date: "",
    notes: "",
  });
  const [settleForm, setSettleForm] = useState<SettleForm>({
    payout_received: "",
    settlement_received_date: todayString(),
    notes: "",
  });
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedCards = useMemo(
    () =>
      giftCards.filter(
        (card) =>
          selectedIds.includes(card.id) && card.status === "VERIFIED_AVAILABLE",
      ),
    [giftCards, selectedIds],
  );

  const selectedFaceValue = selectedCards.reduce(
    (total, card) => total + (Number(card.face_value) || 0),
    0,
  );

  const saleCards = useMemo(
    () =>
      giftCards.filter(
        (card) =>
          saleCardIds.includes(card.id) && card.status === "VERIFIED_AVAILABLE",
      ),
    [giftCards, saleCardIds],
  );

  const saleFaceValue = saleCards.reduce(
    (total, card) => total + (Number(card.face_value) || 0),
    0,
  );

  const estimatedPayoutFromRate =
    sellForm.liquidation_rate.trim() && saleFaceValue > 0
      ? saleFaceValue * normalizePayoutRatePercent(sellForm.liquidation_rate)
      : null;

  const sellPayoutTotal =
    sellForm.payout_total.trim() !== ""
      ? Number(sellForm.payout_total)
      : estimatedPayoutFromRate;
  const selectedFuelPoints = saleFuelSelections.reduce(
    (total, selection) => total + Number(selection.points_sold || 0),
    0,
  );
  const combinedPayoutTotal = sellPayoutTotal;
  const saleCardPayoutRatePercent =
    sellForm.payout_total.trim() !== "" && saleFaceValue > 0
      ? String((Number(sellForm.payout_total) / saleFaceValue) * 100)
      : sellForm.liquidation_rate.trim() || null;

  async function loadData() {
    setIsLoading(true);
    setError(null);

    try {
      const [cards, buyerData, fuelAccountData] = await Promise.all([
        fetchGiftCards(),
        fetchBuyers(),
        fetchFuelAccounts(),
      ]);

      setGiftCards(cards);
      setBuyers(buyerData.filter((buyer) => buyer.active));
      setFuelAccounts(
        fuelAccountData.filter((account) => account.status === "ACTIVE"),
      );
      setSelectedIds((currentIds) =>
        currentIds.filter((id) =>
          cards.some(
            (card) => card.id === id && card.status === "VERIFIED_AVAILABLE",
          ),
        ),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load inventory.");
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      void loadData();
    }, 0);

    return () => window.clearTimeout(timeoutId);
  }, []);

  const filteredCards = useMemo(() => {
    const normalizedSearch = searchQuery.trim().toLowerCase();
    const statusFilter = searchParams.get("status");
    const metricFilter = searchParams.get("metric");
    const urlLifecycleFilter = lifecycleFilterForStatus(statusFilter);
    const effectiveLifecycleFilter =
      urlLifecycleFilter ??
      (statusFilter || metricFilter ? "all" : lifecycleFilter);
    const lifecycleStatuses =
      inventoryLifecycleFilters.find(
        (filter) => filter.value === effectiveLifecycleFilter,
      )?.statuses ?? null;

    const cards = giftCards.filter((card) => {
        if (
          lifecycleStatuses &&
          !lifecycleStatuses.some((status) => status === card.status)
        ) {
          return false;
        }

        if (
          (statusFilter === "awaiting_verification" ||
            statusFilter === "needs_verification") &&
          card.status !== "NEEDS_VERIFICATION"
        ) {
          return false;
        }

        if (statusFilter === "available" && card.status !== "VERIFIED_AVAILABLE") {
          return false;
        }

        if (
          statusFilter === "awaiting_payment" &&
          !["SOLD_PENDING_PAYMENT", "PARTIALLY_SETTLED"].includes(
            card.status,
          )
        ) {
          return false;
        }

        if (statusFilter === "settled" && card.status !== "SETTLED") {
          return false;
        }

        if (
          statusFilter === "duplicate_review" &&
          ![
            card.brand,
            String(card.purchase_batch_id),
            card.notes ?? "",
            card.status,
          ]
            .join(" ")
            .toLowerCase()
            .includes("duplicate")
        ) {
          return false;
        }

        if (metricFilter === "turnover" && card.sold_at === null) {
          return false;
        }

        return (
          !normalizedSearch ||
          [
            card.brand,
            String(card.purchase_batch_id),
            card.buyer_name ?? "",
            cardEnding(card.card_number_encrypted),
            String(card.face_value),
            String(currentSaleId(card) ?? ""),
            card.notes ?? "",
          ].some((value) => value.toLowerCase().includes(normalizedSearch))
        );
      });

    if (metricFilter === "turnover") {
      return cards.sort(
        (first, second) =>
          (second.inventory_aging_days ?? 0) - (first.inventory_aging_days ?? 0),
      );
    }

    return cards;
  }, [giftCards, lifecycleFilter, searchParams, searchQuery]);
  const statusFilter = searchParams.get("status");
  const metricFilter = searchParams.get("metric");
  const activeInventoryFilterLabel =
    (statusFilter ? inventoryFilterLabels[statusFilter] : null) ??
    (metricFilter ? inventoryMetricLabels[metricFilter] : null);
  const visibleSectionData = sections
    .map((section) => ({
      ...section,
      cards: filteredCards.filter((card) =>
        section.statuses.includes(card.status),
      ),
    }))
    .filter((section) => section.cards.length > 0);

  function openSellSelected() {
    setSaleCardIds(selectedIds);
    setSellForm({
      buyer_id: "",
      payout_total: "",
      liquidation_rate: "",
      sold_date: todayString(),
      expected_payment_date: "",
      notes: "",
    });
    setIncludeFuelInSale(false);
    setSaleFuelSelections([]);
    setIsSellModalOpen(true);
  }

  function openSellCard(card: GiftCard) {
    setSaleCardIds([card.id]);
    setSellForm({
      buyer_id: "",
      payout_total: String(card.face_value),
      liquidation_rate: "",
      sold_date: todayString(),
      expected_payment_date: "",
      notes: "",
    });
    setIncludeFuelInSale(false);
    setSaleFuelSelections([]);
    setIsSellModalOpen(true);
  }

  function openSettle(card: GiftCard) {
    setSettlingCard(card);
    setSettleForm({
      payout_received:
        card.expected_payout === null ? "" : String(card.expected_payout),
      settlement_received_date: todayString(),
      notes: "",
    });
  }

  async function submitSellSelected(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (saleCards.length === 0 || combinedPayoutTotal === null) {
      return;
    }

    setIsSaving(true);
    setError(null);

    try {
      const response = await fetch(`${API_BASE_URL}/sales/`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          buyer_id: Number(sellForm.buyer_id),
          sold_date: sellForm.sold_date || null,
          expected_payment_date: sellForm.expected_payment_date || null,
          expected_payout: String(combinedPayoutTotal),
          card_payout_rate: saleCardPayoutRatePercent,
          notes: sellForm.notes || null,
          gift_card_ids: saleCards.map((card) => card.id),
          fuel_accounts: includeFuelInSale
            ? saleFuelSelections.map((selection) => ({
                fuel_reward_account_id: selection.fuel_reward_account_id,
                points_sold: Number(selection.points_sold),
                expected_value: null,
                is_full_account_sale: true,
                fuel_overage_override: selection.fuel_overage_override,
              }))
            : [],
        }),
      });

      if (!response.ok) {
        throw new Error(await saleErrorMessage(response));
      }

      const sale = (await response.json()) as SaleResponse;
      const exportBuyer =
        buyers.find((buyer) => buyer.id === Number(sellForm.buyer_id)) ?? null;
      setSelectedIds([]);
      setSaleCardIds([]);
      setIsBulkMode(false);
      setIsSellModalOpen(false);
      setSellerExportCards(sale.gift_cards);
      setSellerExportFuelAccounts(sale.fuel_accounts);
      setSellerExportBuyer(exportBuyer);
      setSellerExportSaleId(sale.id);
      setSaleFuelSelections([]);
      setIncludeFuelInSale(false);
      await loadData();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to sell selected cards.",
      );
    } finally {
      setIsSaving(false);
    }
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
      setSaleFuelSelections((currentSelections) =>
        currentSelections.map((selection) =>
          selection.fuel_reward_account_id === account.id
            ? { ...selection, fuel_overage_override: false }
            : selection,
        ),
      );
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to update fuel target.",
      );
    }
  }

  async function submitSettle(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!settlingCard) {
      return;
    }

    setIsSaving(true);
    setError(null);

    try {
      const response = await fetch(
        `${API_BASE_URL}/gift-cards/${settlingCard.id}/settle`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            payout_received: settleForm.payout_received,
            settlement_received_date:
              settleForm.settlement_received_date || null,
            internal_notes: settleForm.notes || null,
          }),
        },
      );

      if (!response.ok) {
        throw new Error(`Failed to settle card (${response.status})`);
      }

      setSettlingCard(null);
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to settle card.");
    } finally {
      setIsSaving(false);
    }
  }

  function toggleSelection(card: GiftCard) {
    if (card.status !== "VERIFIED_AVAILABLE") {
      return;
    }

    setSelectedIds((currentIds) =>
      currentIds.includes(card.id)
        ? currentIds.filter((id) => id !== card.id)
        : [...currentIds, card.id],
    );
  }

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-8 text-slate-950 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-7xl space-y-6">
        <header className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-sm font-medium uppercase tracking-wide text-slate-500">
              Operations
            </p>
            <h1 className="mt-1 text-3xl font-semibold tracking-tight">
              Gift Card Inventory
            </h1>
          </div>

          <label className="block w-full max-w-md space-y-2 text-sm font-medium text-slate-700">
            <span>Search brand, purchase, or buyer</span>
            <input
              className="h-11 w-full rounded-md border border-slate-300 px-3 text-base text-slate-950 outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-200"
              onChange={(event) => setSearchQuery(event.target.value)}
              type="search"
              value={searchQuery}
            />
          </label>
        </header>

        <section className="flex flex-col gap-3 rounded-lg border border-slate-200 bg-white p-4 shadow-sm sm:flex-row sm:items-center sm:justify-between">
          <label className="flex flex-col gap-2 text-sm font-medium text-slate-700 sm:flex-row sm:items-center">
            <span>Lifecycle</span>
            <select
              className="h-10 min-w-48 rounded-md border border-slate-300 px-3 text-sm text-slate-950 outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-200"
              onChange={(event) =>
                setLifecycleFilter(event.target.value as InventoryLifecycleFilter)
              }
              value={lifecycleFilter}
            >
              {inventoryLifecycleFilters.map((filter) => (
                <option key={filter.value} value={filter.value}>
                  {filter.label}
                </option>
              ))}
            </select>
          </label>
          <p className="text-sm font-medium text-slate-500">
            {filteredCards.length} of {giftCards.length} cards
          </p>
        </section>

        {isBulkMode ? (
          <section className="sticky top-2 z-20 flex flex-col gap-3 rounded-lg border border-slate-200 bg-white p-4 shadow-sm sm:flex-row sm:items-center sm:justify-between md:static">
            <div>
              <p className="text-sm font-semibold">
                {selectedCards.length} selected · Face value{" "}
                {formatAmount(selectedFaceValue)}
              </p>
              <p className="text-xs text-slate-500">
                Sell selected cards together and allocate payout by face value.
              </p>
            </div>
            <div className="flex gap-2">
              <button
                className="h-10 cursor-pointer rounded-md border border-slate-300 px-4 text-sm font-semibold hover:bg-slate-100 active:bg-slate-200"
                onClick={() => {
                  setSelectedIds([]);
                  setIsBulkMode(false);
                }}
                type="button"
              >
                Cancel Bulk
              </button>
              <button
                className="h-10 cursor-pointer rounded-md bg-slate-900 px-4 text-sm font-semibold text-white hover:bg-slate-700 active:bg-slate-950 disabled:cursor-not-allowed disabled:opacity-60"
                disabled={selectedCards.length === 0}
                onClick={openSellSelected}
                type="button"
              >
                Sell Selected
              </button>
            </div>
          </section>
        ) : null}

        {activeInventoryFilterLabel ? (
          <div className="flex flex-col gap-3 rounded-md border border-cyan-200 bg-cyan-50 px-4 py-3 text-sm text-cyan-950 sm:flex-row sm:items-center sm:justify-between">
            <p className="font-semibold">
              Showing: {activeInventoryFilterLabel}
            </p>
            <Link className="font-semibold hover:underline" href="/inventory">
              Clear filter
            </Link>
          </div>
        ) : null}

        {error ? (
          <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-800">
            {error}
          </div>
        ) : null}

        {isLoading ? (
          <div className="rounded-lg border border-slate-200 bg-white p-8 text-center text-sm text-slate-500">
            Loading inventory...
          </div>
        ) : filteredCards.length === 0 ? (
          <div className="rounded-lg border border-dashed border-slate-300 bg-white p-8 text-center shadow-sm">
            <h2 className="text-lg font-semibold">No cards found</h2>
            <p className="mt-2 text-sm text-slate-500">
              No inventory matches the current lifecycle, search, or dashboard
              filter.
            </p>
          </div>
        ) : (
          <div className="space-y-6">
            {visibleSectionData.map((section) => {
              return (
                <InventorySection
                  cards={section.cards}
                  isSaving={isSaving}
                  isBulkMode={isBulkMode}
                  key={section.title}
                  onStartBulk={() => setIsBulkMode(true)}
                  onSelect={toggleSelection}
                  onSell={openSellCard}
                  onSettle={openSettle}
                  selectedIds={selectedIds}
                  title={section.title}
                />
              );
            })}
          </div>
        )}
      </div>

      {isSellModalOpen ? (
        <SaleModal
          buyers={buyers}
          combinedPayoutTotal={combinedPayoutTotal}
          estimatedPayout={sellPayoutTotal}
          faceValue={saleFaceValue}
          fuelAccounts={fuelAccounts}
          fuelSelections={saleFuelSelections}
          form={sellForm}
          includeFuel={includeFuelInSale}
          isSaving={isSaving}
          onClose={() => {
            setSaleCardIds([]);
            setSaleFuelSelections([]);
            setIncludeFuelInSale(false);
            setIsSellModalOpen(false);
          }}
          onSubmit={submitSellSelected}
          selectedCount={saleCards.length}
          selectedFuelPoints={selectedFuelPoints}
          setFuelSelections={setSaleFuelSelections}
          setForm={setSellForm}
          setIncludeFuel={setIncludeFuelInSale}
          updateFuelTargetToCurrent={updateFuelTargetToCurrent}
        />
      ) : null}

      {settlingCard ? (
        <SettleModal
          card={settlingCard}
          form={settleForm}
          isSaving={isSaving}
          onClose={() => setSettlingCard(null)}
          onSubmit={submitSettle}
          setForm={setSettleForm}
        />
      ) : null}

      {sellerExportCards.length > 0 ? (
        <SellerExportModal
          cards={sellerExportCards}
          buyer={sellerExportBuyer}
          fuelAccounts={sellerExportFuelAccounts}
          saleId={sellerExportSaleId}
          onClose={() => {
            setSellerExportCards([]);
            setSellerExportFuelAccounts([]);
            setSellerExportSaleId(null);
          }}
        />
      ) : null}

    </main>
  );
}

function InventorySection({
  title,
  cards,
  selectedIds,
  isSaving,
  isBulkMode,
  onStartBulk,
  onSelect,
  onSell,
  onSettle,
}: {
  title: string;
  cards: GiftCard[];
  selectedIds: number[];
  isSaving: boolean;
  isBulkMode: boolean;
  onStartBulk: () => void;
  onSelect: (card: GiftCard) => void;
  onSell: (card: GiftCard) => void;
  onSettle: (card: GiftCard) => void;
}) {
  const isAvailableSection = title === "Available";
  const isAwaitingPaymentSection = title === "Awaiting Payment";

  return (
    <section className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
      <div className="flex flex-col gap-3 border-b border-slate-200 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <h2 className="text-lg font-semibold">
          {title} <span className="text-sm text-slate-500">({cards.length})</span>
        </h2>
        {isAvailableSection && !isBulkMode ? (
          <button
            className="h-10 cursor-pointer rounded-md border border-slate-300 px-4 text-sm font-semibold hover:bg-slate-100 active:bg-slate-200"
            onClick={onStartBulk}
            type="button"
          >
            Bulk Sell
          </button>
        ) : null}
      </div>
      {cards.length === 0 ? (
        <p className="px-4 py-6 text-sm text-slate-500">No cards.</p>
      ) : (
        <>
        <div className="divide-y divide-slate-200 md:hidden">
          {cards.map((card) => (
            <InventoryMobileCard
              card={card}
              isAvailableSection={isAvailableSection}
              isAwaitingPaymentSection={isAwaitingPaymentSection}
              isBulkMode={isBulkMode}
              isSaving={isSaving}
              isSelected={selectedIds.includes(card.id)}
              key={card.id}
              onSelect={onSelect}
              onSell={onSell}
              onSettle={onSettle}
            />
          ))}
        </div>

        <div className="hidden overflow-x-auto md:block">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-100 text-left text-xs font-semibold uppercase tracking-wide text-slate-600">
              <tr>
                {isAvailableSection && isBulkMode ? (
                  <th className="w-10 px-3 py-2">Select</th>
                ) : null}
                <th className="px-3 py-2">Card</th>
                <th className="px-3 py-2">Workflow</th>
                <th className="px-3 py-2 text-right">Actions</th>
                <th className="px-3 py-2">Notes</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 bg-white">
              {cards.map((card) => {
                const due = dueStatus(card.expected_payment_date, card.sold_at);
                const profit = card.realized_profit ?? card.expected_profit;

                return (
                  <tr key={card.id} className="hover:bg-slate-50">
                    {isAvailableSection && isBulkMode ? (
                      <td className="px-3 py-2 align-middle">
                        {card.status === "VERIFIED_AVAILABLE" ? (
                          <input
                            checked={selectedIds.includes(card.id)}
                            className="h-4 w-4 cursor-pointer"
                            onChange={() => onSelect(card)}
                            type="checkbox"
                          />
                        ) : null}
                      </td>
                    ) : null}
                    <td className="min-w-[28rem] px-3 py-2 align-middle">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 leading-tight">
                        <span className="font-semibold text-slate-950">
                          {card.brand}
                        </span>
                        <span className="text-slate-300">•</span>
                        <span>{formatAmount(card.face_value)} face</span>
                        {card.status === "NEEDS_VERIFICATION" ? (
                          <>
                            <span className="text-slate-300">•</span>
                            <span className="text-slate-600">
                              purchase #{card.purchase_batch_id}
                            </span>
                          </>
                        ) : null}
                        <span className="text-slate-300">•</span>
                        <span className="text-slate-600">
                          cost {formatAmount(card.acquisition_cost)}
                        </span>
                        {card.card_number_encrypted ? (
                          <>
                            <span className="text-slate-300">•</span>
                            <span className="text-slate-600">
                              {cardNumberStatus(card.card_number_encrypted)}
                            </span>
                          </>
                        ) : card.status === "NEEDS_VERIFICATION" ? (
                          <>
                            <span className="text-slate-300">•</span>
                            <span className="font-medium text-red-700">
                              {cardNumberStatus(card.card_number_encrypted)}
                            </span>
                          </>
                        ) : null}
                        {currentSaleId(card) ? (
                          <>
                            <span className="text-slate-300">•</span>
                            <span className="text-slate-600">
                              sale #{currentSaleId(card)}
                            </span>
                          </>
                        ) : null}
                        {card.expected_payout !== null ? (
                          <>
                            <span className="text-slate-300">•</span>
                            <span className="text-slate-600">
                              payout {formatAmount(card.expected_payout)}
                            </span>
                          </>
                        ) : null}
                        {profit !== null ? (
                          <>
                            <span className="text-slate-300">•</span>
                            <span
                              className={
                                Number(profit) >= 0
                                  ? "font-medium text-emerald-700"
                                  : "font-medium text-red-700"
                              }
                            >
                              profit {formatAmount(profit)}
                            </span>
                          </>
                        ) : null}
                      </div>
                    </td>
                    <td className="min-w-64 px-3 py-2 align-middle">
                      <div className="flex flex-wrap items-center gap-1.5">
                        {card.buyer_name ? (
                          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-700">
                            {card.buyer_name}
                          </span>
                        ) : null}
                        <span
                          className={`rounded-full px-2 py-0.5 text-xs font-semibold ${statusBadgeClass(card.status)}`}
                        >
                          {statusLabel(card.status)}
                        </span>
                        {isAwaitingPaymentSection && due.text ? (
                          <span
                            className={`rounded-full px-2 py-0.5 text-xs font-semibold ${due.className}`}
                          >
                            {due.text}
                          </span>
                        ) : (
                          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-700">
                            {card.inventory_aging_days}d age
                          </span>
                        )}
                        {isAwaitingPaymentSection &&
                        card.expected_payment_date ? (
                          <span className="text-xs text-slate-500">
                            {formatDate(card.expected_payment_date)}
                          </span>
                        ) : null}
                      </div>
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 align-middle">
                      <div className="flex justify-end gap-2">
                        <Link
                          className={
                            card.status === "NEEDS_VERIFICATION"
                              ? "inline-flex h-8 cursor-pointer items-center rounded-md bg-red-700 px-3 text-xs font-semibold text-white hover:bg-red-800 active:bg-red-900"
                              : "inline-flex h-8 cursor-pointer items-center rounded-md border border-slate-300 px-3 text-xs font-semibold hover:bg-slate-100 active:bg-slate-200"
                          }
                          href={`/gift-cards/${card.id}/verify?returnTo=/inventory`}
                        >
                          {card.status === "NEEDS_VERIFICATION"
                            ? "Verify"
                            : "Details"}
                        </Link>
                        {card.status === "VERIFIED_AVAILABLE" ? (
                          <button
                            className="h-8 cursor-pointer rounded-md bg-cyan-600 px-3 text-xs font-semibold text-white hover:bg-cyan-700 active:bg-cyan-800 disabled:cursor-not-allowed disabled:opacity-60"
                            disabled={isSaving}
                            onClick={() => onSell(card)}
                            type="button"
                          >
                            Sell
                          </button>
                        ) : null}
                        {["SOLD_PENDING_PAYMENT", "SOLD"].includes(
                          card.status,
                        ) ? (
                          <button
                            className="h-8 cursor-pointer rounded-md bg-emerald-700 px-3 text-xs font-semibold text-white hover:bg-emerald-800 active:bg-emerald-900 disabled:cursor-not-allowed disabled:opacity-60"
                            disabled={isSaving}
                            onClick={() => onSettle(card)}
                            type="button"
                          >
                            Mark Settled
                          </button>
                        ) : null}
                      </div>
                    </td>
                    <td className="max-w-56 px-3 py-2 align-middle text-xs text-slate-500">
                      <span className="line-clamp-1">{card.notes ?? ""}</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        </>
      )}
    </section>
  );
}

function SellerExportModal({
  cards,
  buyer,
  fuelAccounts,
  saleId,
  onClose,
}: {
  cards: GiftCard[];
  buyer: Buyer | null;
  fuelAccounts: SaleResponse["fuel_accounts"];
  saleId: number | null;
  onClose: () => void;
}) {
  const sellerExport = buildSellerExport(cards, buyer);
  const fuelExport = buildFuelSellerExport(fuelAccounts, buyer);
  const [saleFiles, setSaleFiles] = useState<SaleFile[]>([]);
  const [isLoadingFiles, setIsLoadingFiles] = useState(false);
  const [filesError, setFilesError] = useState<string | null>(null);
  const [showSaleFiles, setShowSaleFiles] = useState(false);
  const requiresSaleFiles =
    Boolean(buyer?.requires_card_images) ||
    Boolean(buyer?.requires_receipt_images);

  useEffect(() => {
    if (!requiresSaleFiles) {
      return;
    }

    async function loadSaleFiles() {
      setIsLoadingFiles(true);
      setFilesError(null);

      try {
        const buyerName = cleanFilenamePart(buyer?.name ?? "buyer");
        const saleDate = cleanFilenamePart(
          cards[0]?.sold_at?.slice(0, 10) ??
            cards[0]?.expected_payment_date ??
            todayString(),
        );
        const files: SaleFile[] = [];

        if (buyer?.requires_card_images) {
          const cardImageResults = await Promise.all(
            cards.map(async (card) => {
              const response = await fetch(
                `${API_BASE_URL}/card-images/gift-card/${card.id}`,
              );

              if (!response.ok) {
                throw new Error(
                  `Failed to load card images for card ${card.id}`,
                );
              }

              return {
                card,
                images: (await response.json()) as CardImage[],
              };
            }),
          );

          cardImageResults.forEach(({ card, images }) => {
            images.forEach((image) => {
              files.push({
                id: `card-${image.id}`,
                group: "card",
                label: `${card.brand} card #${card.id}`,
                url: getUploadUrl(image.original_image_url),
                filename: `${buyerName}_${saleDate}_card-${card.id}_${cleanFilenamePart(
                  card.brand,
                )}_${cleanFilenamePart(card.face_value)}${getFileExtension(
                  image.original_image_url,
                )}`,
              });
            });
          });
        }

        if (buyer?.requires_receipt_images) {
          const purchaseIds = Array.from(
            new Set(cards.map((card) => card.purchase_batch_id)),
          );
          const receiptResults = await Promise.all(
            purchaseIds.map(async (purchaseId) => {
              const response = await fetch(
                `${API_BASE_URL}/receipts/purchase/${purchaseId}`,
              );

              if (!response.ok) {
                throw new Error(
                  `Failed to load receipts for purchase ${purchaseId}`,
                );
              }

              return {
                purchaseId,
                receipts: (await response.json()) as Receipt[],
              };
            }),
          );

          receiptResults.forEach(({ purchaseId, receipts }) => {
            receipts.forEach((receipt) => {
              files.push({
                id: `receipt-${receipt.id}`,
                group: "receipt",
                label: `Receipt purchase #${purchaseId}`,
                url: getUploadUrl(receipt.image_url),
                filename: `${buyerName}_${saleDate}_receipt_purchase-${purchaseId}${getFileExtension(
                  receipt.image_url,
                )}`,
              });
            });
          });
        }

        setSaleFiles(files);
      } catch (err) {
        setFilesError(
          err instanceof Error ? err.message : "Failed to load sale files.",
        );
      } finally {
        setIsLoadingFiles(false);
      }
    }

    void loadSaleFiles();
  }, [buyer, cards, requiresSaleFiles]);

  async function copyExport() {
    await navigator.clipboard.writeText(sellerExport.text);
  }

  async function copyFuelExport() {
    await navigator.clipboard.writeText(fuelExport);
  }

  function downloadExport() {
    const blob = new Blob([sellerExport.text], {
      type:
        sellerExport.fileExtension === "csv"
          ? "text/csv;charset=utf-8"
          : "text/plain;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `seller-export-${todayString()}.${sellerExport.fileExtension}`;
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center modal-backdrop p-4">
      <div className="w-full max-w-3xl space-y-4 rounded-lg bg-white p-5 shadow-xl">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-xl font-semibold">Seller Export</h2>
            <p className="mt-1 text-sm text-slate-500">
              {sellerExport.label} output. Full card numbers are intentionally
              shown only here after sale.
            </p>
          </div>
          <button
            className="h-10 cursor-pointer rounded-md border border-slate-300 px-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-100"
            onClick={onClose}
            type="button"
          >
            Close
          </button>
        </div>

        <textarea
          className="h-40 w-full rounded-md border border-slate-300 bg-slate-50 p-3 font-mono text-xs text-slate-950"
          readOnly
          value={sellerExport.text}
        />

        {fuelExport ? (
          <section className="space-y-2">
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-sm font-semibold">Fuel Account Export</h3>
              <button
                className="h-9 cursor-pointer rounded-md border border-slate-300 px-3 text-xs font-semibold text-slate-700 hover:bg-slate-100"
                onClick={copyFuelExport}
                type="button"
              >
                Copy Fuel Export
              </button>
            </div>
            <textarea
              className="h-28 w-full rounded-md border border-slate-300 bg-slate-50 p-3 font-mono text-xs text-slate-950"
              readOnly
              value={fuelExport}
            />
          </section>
        ) : null}

        {requiresSaleFiles ? (
          <section className="rounded-md border border-slate-200 bg-slate-50 p-3">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h3 className="text-sm font-semibold">Sale Files</h3>
                <p className="text-xs text-slate-500">
                  Buyer requires{" "}
                  {[
                    buyer?.requires_card_images ? "card images" : null,
                    buyer?.requires_receipt_images ? "receipt images" : null,
                  ]
                    .filter(Boolean)
                    .join(" and ")}
                  .
                </p>
              </div>
              <button
                className="h-10 cursor-pointer rounded-md border border-slate-300 px-3 text-sm font-semibold text-slate-700 hover:bg-slate-100"
                onClick={() => setShowSaleFiles((value) => !value)}
                type="button"
              >
                Download Sale Files
              </button>
            </div>

            {showSaleFiles ? (
              <div className="mt-3 space-y-2">
                {isLoadingFiles ? (
                  <p className="text-sm text-slate-500">Loading sale files...</p>
                ) : null}
                {filesError ? (
                  <p className="text-sm font-medium text-red-800">
                    {filesError}
                  </p>
                ) : null}
                {!isLoadingFiles && saleFiles.length === 0 && !filesError ? (
                  <p className="text-sm text-slate-500">
                    No matching uploaded files found for this sale.
                  </p>
                ) : null}
                {saleFiles.map((file) => (
                  <a
                    className="flex items-center justify-between gap-3 rounded-md border border-slate-200 bg-white px-3 py-2 text-sm hover:bg-slate-50"
                    download={file.filename}
                    href={file.url}
                    key={file.id}
                  >
                    <span>
                      <span className="font-medium">{file.label}</span>
                      <span className="ml-2 text-xs uppercase text-slate-500">
                        {file.group}
                      </span>
                    </span>
                    <span className="text-xs text-slate-500">
                      {file.filename}
                    </span>
                  </a>
                ))}
              </div>
            ) : null}
          </section>
        ) : null}

        <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
          <button
            className="h-11 cursor-pointer rounded-md border border-slate-300 px-4 text-sm font-semibold text-slate-700 transition hover:bg-slate-100 active:bg-slate-200"
            onClick={copyExport}
            type="button"
          >
            Copy Export
          </button>
          {sellerExport.canDownloadCsv ? (
            <button
              className="h-11 cursor-pointer rounded-md bg-slate-900 px-4 text-sm font-semibold text-white transition hover:bg-slate-700 active:bg-slate-950"
              onClick={downloadExport}
              type="button"
            >
              Download {sellerExport.fileExtension.toUpperCase()}
            </button>
          ) : null}
          {saleId ? (
            <a
              className="inline-flex h-11 cursor-pointer items-center rounded-md bg-cyan-300 px-4 text-sm font-semibold text-slate-950 transition hover:bg-cyan-200 active:bg-cyan-400"
              href={`${API_BASE_URL}/sales/${saleId}/package.zip`}
            >
              Download ZIP
            </a>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function InventoryMobileCard({
  card,
  isAvailableSection,
  isAwaitingPaymentSection,
  isBulkMode,
  isSaving,
  isSelected,
  onSelect,
  onSell,
  onSettle,
}: {
  card: GiftCard;
  isAvailableSection: boolean;
  isAwaitingPaymentSection: boolean;
  isBulkMode: boolean;
  isSaving: boolean;
  isSelected: boolean;
  onSelect: (card: GiftCard) => void;
  onSell: (card: GiftCard) => void;
  onSettle: (card: GiftCard) => void;
}) {
  const due = dueStatus(card.expected_payment_date, card.sold_at);
  const profit = card.realized_profit ?? card.expected_profit;

  return (
    <article className="space-y-3 px-4 py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            {isAvailableSection &&
            isBulkMode &&
            card.status === "VERIFIED_AVAILABLE" ? (
              <input
                checked={isSelected}
                className="mt-0.5 h-5 w-5 cursor-pointer"
                onChange={() => onSelect(card)}
                type="checkbox"
              />
            ) : null}
            <h3 className="text-base font-semibold leading-tight text-slate-950">
              {card.brand}
            </h3>
          </div>
          <div className="mt-1 flex flex-wrap gap-x-2 gap-y-1 text-sm text-slate-600">
            <span>{formatAmount(card.face_value)} face</span>
            {card.status === "NEEDS_VERIFICATION" ? (
              <span>purchase #{card.purchase_batch_id}</span>
            ) : null}
            <span>cost {formatAmount(card.acquisition_cost)}</span>
            {card.expected_payout !== null ? (
              <span>payout {formatAmount(card.expected_payout)}</span>
            ) : null}
            <span
              className={
                !card.card_number_encrypted &&
                card.status === "NEEDS_VERIFICATION"
                  ? "font-medium text-red-700"
                  : ""
              }
            >
              {cardNumberStatus(card.card_number_encrypted)}
            </span>
            {currentSaleId(card) ? <span>sale #{currentSaleId(card)}</span> : null}
            {profit !== null ? (
              <span
                className={
                  Number(profit) >= 0
                    ? "font-medium text-emerald-700"
                    : "font-medium text-red-700"
                }
              >
                profit {formatAmount(profit)}
              </span>
            ) : null}
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        <span
          className={`rounded-full px-2 py-1 text-xs font-semibold ${statusBadgeClass(card.status)}`}
        >
          {statusLabel(card.status)}
        </span>
        {card.buyer_name ? (
          <span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-700">
            {card.buyer_name}
          </span>
        ) : null}
        {isAwaitingPaymentSection && due.text ? (
          <span
            className={`rounded-full px-2 py-1 text-xs font-semibold ${due.className}`}
          >
            {due.text}
          </span>
        ) : (
          <span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-700">
            {card.inventory_aging_days}d age
          </span>
        )}
        {isAwaitingPaymentSection && card.expected_payment_date ? (
          <span className="text-xs text-slate-500">
            {formatDate(card.expected_payment_date)}
          </span>
        ) : null}
      </div>

      {card.notes ? (
        <p className="text-sm text-slate-500">{card.notes}</p>
      ) : null}

      <div className="grid grid-cols-2 gap-2">
        <Link
          className={
            card.status === "NEEDS_VERIFICATION"
              ? "inline-flex h-10 cursor-pointer items-center justify-center rounded-md bg-red-700 px-3 text-sm font-semibold text-white hover:bg-red-800 active:bg-red-900"
              : "inline-flex h-10 cursor-pointer items-center justify-center rounded-md border border-slate-300 px-3 text-sm font-semibold hover:bg-slate-100 active:bg-slate-200"
          }
          href={`/gift-cards/${card.id}/verify?returnTo=/inventory`}
        >
          {card.status === "NEEDS_VERIFICATION" ? "Verify" : "Details"}
        </Link>
        {card.status === "VERIFIED_AVAILABLE" ? (
          <button
            className="h-10 cursor-pointer rounded-md bg-cyan-600 px-3 text-sm font-semibold text-white hover:bg-cyan-700 active:bg-cyan-800 disabled:cursor-not-allowed disabled:opacity-60"
            disabled={isSaving}
            onClick={() => onSell(card)}
            type="button"
          >
            Sell
          </button>
        ) : null}
        {["SOLD_PENDING_PAYMENT", "SOLD"].includes(card.status) ? (
          <button
            className="h-10 cursor-pointer rounded-md bg-emerald-700 px-3 text-sm font-semibold text-white hover:bg-emerald-800 active:bg-emerald-900 disabled:cursor-not-allowed disabled:opacity-60"
            disabled={isSaving}
            onClick={() => onSettle(card)}
            type="button"
          >
            Mark Settled
          </button>
        ) : null}
      </div>
    </article>
  );
}

function SaleModal({
  buyers,
  combinedPayoutTotal,
  faceValue,
  estimatedPayout,
  fuelAccounts,
  fuelSelections,
  form,
  includeFuel,
  isSaving,
  selectedCount,
  selectedFuelPoints,
  setFuelSelections,
  setForm,
  setIncludeFuel,
  updateFuelTargetToCurrent,
  onClose,
  onSubmit,
}: {
  buyers: Buyer[];
  combinedPayoutTotal: number | null;
  faceValue: number;
  estimatedPayout: number | null;
  fuelAccounts: FuelAccount[];
  fuelSelections: FuelSelection[];
  form: SellForm;
  includeFuel: boolean;
  isSaving: boolean;
  selectedCount: number;
  selectedFuelPoints: number;
  setFuelSelections: (selections: FuelSelection[]) => void;
  setForm: (form: SellForm) => void;
  setIncludeFuel: (includeFuel: boolean) => void;
  updateFuelTargetToCurrent: (account: FuelAccount) => void;
  onClose: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  const selectedFuelAccounts = fuelSelections.map((selection) => ({
    selection,
    account: fuelAccounts.find(
      (fuelAccount) => fuelAccount.id === selection.fuel_reward_account_id,
    ),
  }));
  const hasInvalidPayoutRate = isDecimalStylePayoutRate(form.liquidation_rate);
  const canSubmit =
    selectedCount > 0 &&
    form.buyer_id !== "" &&
    (form.payout_total.trim() !== "" || form.liquidation_rate.trim() !== "") &&
    !hasInvalidPayoutRate &&
    (!includeFuel ||
      selectedFuelAccounts.every(({ account, selection }) =>
        account !== undefined &&
        Number(selection.points_sold) > 0 &&
        !isFuelBelowTarget(account) &&
        (!fuelRequiresOverageOverride(account) ||
          selection.fuel_overage_override),
      ));
  const selectedBuyer =
    buyers.find((buyer) => buyer.id === Number(form.buyer_id)) ?? null;

  function updateBuyer(value: string) {
    const buyer = buyers.find((item) => item.id === Number(value)) ?? null;

    setForm({
      ...form,
      buyer_id: value,
      expected_payment_date: buyer
        ? addDaysString(form.sold_date, buyer.default_payout_days)
        : "",
      liquidation_rate:
        buyer?.default_payout_rate === null || buyer?.default_payout_rate === undefined
          ? form.liquidation_rate
          : formatStoredRateAsPercent(buyer.default_payout_rate),
      payout_total:
        buyer?.default_payout_rate === null || buyer?.default_payout_rate === undefined
          ? form.payout_total
          : "",
    });
  }

  function updateSoldDate(value: string) {
    setForm({
      ...form,
      sold_date: value,
      expected_payment_date: selectedBuyer
        ? addDaysString(value, selectedBuyer.default_payout_days)
        : form.expected_payment_date,
    });
  }

  function toggleFuelAccount(account: FuelAccount) {
    const existingSelection = fuelSelections.find(
      (selection) => selection.fuel_reward_account_id === account.id,
    );

    if (existingSelection) {
      setFuelSelections(
        fuelSelections.filter(
          (selection) => selection.fuel_reward_account_id !== account.id,
        ),
      );
      return;
    }

    setFuelSelections([
      ...fuelSelections,
      {
        fuel_reward_account_id: account.id,
        points_sold: String(account.current_points),
        fuel_overage_override: false,
      },
    ]);
  }

  function setFuelOverageOverride(accountId: number, value: boolean) {
    setFuelSelections(
      fuelSelections.map((selection) =>
        selection.fuel_reward_account_id === accountId
          ? { ...selection, fuel_overage_override: value }
          : selection,
      ),
    );
  }

  function toggleIncludeFuel(value: boolean) {
    setIncludeFuel(value);

    if (!value) {
      setFuelSelections([]);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center modal-backdrop px-4 py-6">
      <form
        className="max-h-[90vh] w-full max-w-2xl space-y-4 overflow-y-auto rounded-lg bg-white p-5 shadow-xl"
        onSubmit={onSubmit}
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold">Sell Selected</h2>
            <p className="mt-1 text-sm text-slate-500">
              {selectedCount} cards · Face value {formatAmount(faceValue)}
            </p>
          </div>
          <button
            className="h-9 cursor-pointer rounded-md border border-slate-300 px-3 text-sm font-medium hover:bg-slate-100 active:bg-slate-200"
            onClick={onClose}
            type="button"
          >
            Close
          </button>
        </div>

        <label className="block space-y-2 text-sm font-medium text-slate-700">
          <span>Buyer</span>
          <select
            className="h-11 w-full rounded-md border border-slate-300 px-3"
            onChange={(event) => updateBuyer(event.target.value)}
            required
            value={form.buyer_id}
          >
            <option value="">Select buyer</option>
            {buyers.map((buyer) => (
              <option key={buyer.id} value={buyer.id}>
                {buyer.name}
              </option>
            ))}
          </select>
        </label>

        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block space-y-2 text-sm font-medium text-slate-700">
            <span>Card Payout Rate (%)</span>
            <input
              className="h-11 w-full rounded-md border border-slate-300 px-3"
              min="0"
              onChange={(event) =>
                setForm({
                  ...form,
                  liquidation_rate: event.target.value,
                  payout_total: "",
                })
              }
              placeholder="92"
              step="0.01"
              type="number"
              value={form.liquidation_rate}
            />
            <p
              className={`text-xs ${
                hasInvalidPayoutRate
                  ? "font-medium text-red-700"
                  : "text-slate-500"
              }`}
            >
              {hasInvalidPayoutRate
                ? "Enter payout rate as a percentage."
                : "Enter percent, e.g. 92 for 92%."}
            </p>
          </label>

          <label className="block space-y-2 text-sm font-medium text-slate-700">
            <span>Total Payout</span>
            <input
              className="h-11 w-full rounded-md border border-slate-300 px-3"
              min="0"
              onChange={(event) =>
                setForm({
                  ...form,
                  payout_total: event.target.value,
                  liquidation_rate: "",
                })
              }
              placeholder="Optional override"
              step="0.01"
              type="number"
              value={form.payout_total}
            />
          </label>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block space-y-2 text-sm font-medium text-slate-700">
            <span>Sold Date</span>
            <input
              className="h-11 w-full rounded-md border border-slate-300 px-3"
              onChange={(event) => updateSoldDate(event.target.value)}
              type="date"
              value={form.sold_date}
            />
          </label>

          <label className="block space-y-2 text-sm font-medium text-slate-700">
            <span>Expected Payment Date</span>
            <input
              className="h-11 w-full rounded-md border border-slate-300 px-3"
              onChange={(event) =>
                setForm({
                  ...form,
                  expected_payment_date: event.target.value,
                })
              }
              type="date"
              value={form.expected_payment_date}
            />
          </label>
        </div>

        <section className="rounded-md border border-slate-200 bg-slate-50 p-3">
          <label className="flex items-center gap-2 text-sm font-semibold text-slate-700">
            <input
              checked={includeFuel}
              onChange={(event) => toggleIncludeFuel(event.target.checked)}
              type="checkbox"
            />
            Include Fuel Points
          </label>

          {includeFuel ? (
            <div className="mt-3 max-h-56 space-y-2 overflow-auto">
              {fuelAccounts.map((account) => {
                const selection = fuelSelections.find(
                  (item) => item.fuel_reward_account_id === account.id,
                );
                const isBelowTarget = isFuelBelowTarget(account);
                const overagePoints = fuelOveragePoints(account);
                const requiresOverageOverride =
                  fuelRequiresOverageOverride(account);

                return (
                  <div
                    className={`rounded-md border px-3 py-2 ${
                      isBelowTarget
                        ? "border-red-200 bg-red-50"
                        : requiresOverageOverride
                          ? "border-amber-200 bg-amber-50"
                          : "border-slate-200 bg-white"
                    }`}
                    key={account.id}
                  >
                    <label className="flex items-start justify-between gap-3 text-sm">
                      <span>
                        <span className="font-semibold">{account.retailer}</span>
                        <span className="ml-2 text-slate-500">
                          {fuelTargetLabel(account)}
                        </span>
                        {isBelowTarget ? (
                          <span className="ml-2 rounded-md bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-700">
                            Below target
                          </span>
                        ) : null}
                        <span className="mt-1 block text-xs text-slate-500">
                          Cycle {formatDate(account.expiration_cycle)} · Target{" "}
                          {account.target_points?.toLocaleString() ?? "-"} · Alt{" "}
                          {account.alt_id ?? "-"}
                        </span>
                        {requiresOverageOverride ? (
                          <span className="mt-1 block text-xs font-medium text-amber-700">
                            This account is more than 1,000 points over target.
                          </span>
                        ) : null}
                      </span>
                      <input
                        checked={Boolean(selection)}
                        disabled={isBelowTarget}
                        onChange={() => toggleFuelAccount(account)}
                        type="checkbox"
                      />
                    </label>

                    {selection ? (
                      <div className="mt-2 space-y-2 text-xs font-medium text-slate-500">
                        <p>
                          Full balance selected:{" "}
                          {Number(selection.points_sold).toLocaleString()} points
                        </p>
                        {requiresOverageOverride ? (
                          <div className="space-y-2 rounded-md border border-amber-200 bg-white px-3 py-2 text-amber-800">
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
                <p className="text-sm text-slate-500">
                  No active fuel accounts available.
                </p>
              ) : null}
            </div>
          ) : null}
        </section>

        <div className="rounded-md bg-slate-50 px-3 py-2 text-sm text-slate-600">
          <div className="flex justify-between gap-3">
            <span>Selected card face value</span>
            <span className="font-semibold text-slate-950">
              {formatAmount(faceValue)}
            </span>
          </div>
          <div className="mt-1 flex justify-between gap-3">
            <span>Selected fuel points</span>
            <span className="font-semibold text-slate-950">
              {selectedFuelPoints.toLocaleString()}
            </span>
          </div>
          <div className="mt-2 flex justify-between gap-3 border-t border-slate-200 pt-2">
            <span>Total payout for bundle</span>
            <span className="font-semibold text-slate-950">
              {formatAmount(combinedPayoutTotal)}
            </span>
          </div>
          {form.liquidation_rate ? (
            <span className="mt-1 block text-xs">
              Card payout {formatAmount(estimatedPayout)} at{" "}
              {form.liquidation_rate}%
            </span>
          ) : null}
        </div>

        <label className="block space-y-2 text-sm font-medium text-slate-700">
          <span>Notes</span>
          <textarea
            className="min-h-20 w-full rounded-md border border-slate-300 px-3 py-2"
            onChange={(event) => setForm({ ...form, notes: event.target.value })}
            value={form.notes}
          />
        </label>

        <div className="flex justify-end gap-2">
          <button
            className="h-10 cursor-pointer rounded-md border border-slate-300 px-4 text-sm font-medium hover:bg-slate-100 active:bg-slate-200 disabled:cursor-not-allowed disabled:opacity-60"
            disabled={isSaving}
            onClick={onClose}
            type="button"
          >
            Cancel
          </button>
          <button
            className="h-10 cursor-pointer rounded-md bg-slate-900 px-4 text-sm font-semibold text-white hover:bg-slate-700 active:bg-slate-950 disabled:cursor-not-allowed disabled:bg-slate-400"
            disabled={isSaving || !canSubmit}
            type="submit"
          >
            {isSaving ? "Saving..." : "Sell Selected"}
          </button>
        </div>
      </form>
    </div>
  );
}

function SettleModal({
  card,
  form,
  isSaving,
  setForm,
  onClose,
  onSubmit,
}: {
  card: GiftCard;
  form: SettleForm;
  isSaving: boolean;
  setForm: (form: SettleForm) => void;
  onClose: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center modal-backdrop px-4 py-6">
      <form
        className="w-full max-w-lg space-y-4 rounded-lg bg-white p-5 shadow-xl"
        onSubmit={onSubmit}
      >
        <h2 className="text-lg font-semibold">Mark Settled</h2>
        <p className="text-sm text-slate-500">
          {card.brand} expected {formatAmount(card.expected_payout)}
        </p>
        <label className="block space-y-2 text-sm font-medium text-slate-700">
          <span>Payout Received</span>
          <input
            className="h-11 w-full rounded-md border border-slate-300 px-3"
            min="0"
            onChange={(event) =>
              setForm({ ...form, payout_received: event.target.value })
            }
            required
            step="0.01"
            type="number"
            value={form.payout_received}
          />
        </label>
        <label className="block space-y-2 text-sm font-medium text-slate-700">
          <span>Settlement Date</span>
          <input
            className="h-11 w-full rounded-md border border-slate-300 px-3"
            onChange={(event) =>
              setForm({
                ...form,
                settlement_received_date: event.target.value,
              })
            }
            type="date"
            value={form.settlement_received_date}
          />
        </label>
        <label className="block space-y-2 text-sm font-medium text-slate-700">
          <span>Settlement Notes</span>
          <textarea
            className="min-h-20 w-full rounded-md border border-slate-300 px-3 py-2"
            onChange={(event) => setForm({ ...form, notes: event.target.value })}
            value={form.notes}
          />
        </label>
        <div className="flex justify-end gap-2">
          <button
            className="h-10 cursor-pointer rounded-md border border-slate-300 px-4 text-sm font-medium hover:bg-slate-100 active:bg-slate-200 disabled:cursor-not-allowed disabled:opacity-60"
            disabled={isSaving}
            onClick={onClose}
            type="button"
          >
            Cancel
          </button>
          <button
            className="h-10 cursor-pointer rounded-md bg-emerald-700 px-4 text-sm font-semibold text-white hover:bg-emerald-800 active:bg-emerald-900 disabled:cursor-not-allowed disabled:bg-slate-400"
            disabled={isSaving}
            type="submit"
          >
            {isSaving ? "Saving..." : "Mark Settled"}
          </button>
        </div>
      </form>
    </div>
  );
}
