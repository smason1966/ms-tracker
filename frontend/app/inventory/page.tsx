"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import Link from "next/link";

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
  notes: string | null;
};

type Buyer = {
  id: number;
  name: string;
  active: boolean;
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
  { title: "Available Inventory", statuses: ["VERIFIED_AVAILABLE"] },
  { title: "Awaiting Payment", statuses: ["SOLD_PENDING_PAYMENT", "SOLD"] },
  { title: "Settled", statuses: ["SETTLED"] },
];

function todayString() {
  return new Date().toISOString().slice(0, 10);
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

function formatRate(value: string | number | null) {
  if (value === null || value === "") {
    return "";
  }

  const rate = Number(value);

  if (Number.isNaN(rate)) {
    return String(value);
  }

  return `${(rate * 100).toFixed(1)}%`;
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
  if (status === "VERIFIED_AVAILABLE") {
    return "Available";
  }

  if (status === "SOLD_PENDING_PAYMENT" || status === "SOLD") {
    return "Awaiting Payment";
  }

  if (status === "SETTLED") {
    return "Settled";
  }

  return status.replaceAll("_", " ");
}

async function fetchGiftCards() {
  const response = await fetch(`${API_BASE_URL}/gift-cards/`);

  if (!response.ok) {
    throw new Error(`Failed to load gift cards (${response.status})`);
  }

  return (await response.json()) as GiftCard[];
}

async function fetchBuyers() {
  const response = await fetch(`${API_BASE_URL}/buyers/`);

  if (!response.ok) {
    throw new Error(`Failed to load buyers (${response.status})`);
  }

  return (await response.json()) as Buyer[];
}

export default function InventoryPage() {
  const [giftCards, setGiftCards] = useState<GiftCard[]>([]);
  const [buyers, setBuyers] = useState<Buyer[]>([]);
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [saleCardIds, setSaleCardIds] = useState<number[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [isBulkMode, setIsBulkMode] = useState(false);
  const [isSellModalOpen, setIsSellModalOpen] = useState(false);
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
      ? saleFaceValue * Number(sellForm.liquidation_rate)
      : null;

  const sellPayoutTotal =
    sellForm.payout_total.trim() !== ""
      ? Number(sellForm.payout_total)
      : estimatedPayoutFromRate;

  async function loadData() {
    setIsLoading(true);
    setError(null);

    try {
      const [cards, buyerData] = await Promise.all([
        fetchGiftCards(),
        fetchBuyers(),
      ]);

      setGiftCards(cards);
      setBuyers(buyerData.filter((buyer) => buyer.active));
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

    if (!normalizedSearch) {
      return giftCards;
    }

    return giftCards.filter(
      (card) =>
        card.brand.toLowerCase().includes(normalizedSearch) ||
        String(card.purchase_batch_id).includes(normalizedSearch) ||
        (card.buyer_name ?? "").toLowerCase().includes(normalizedSearch),
    );
  }, [giftCards, searchQuery]);

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

    if (saleCards.length === 0 || sellPayoutTotal === null) {
      return;
    }

    setIsSaving(true);
    setError(null);

    try {
      const response = await fetch(`${API_BASE_URL}/gift-cards/bulk-sell`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          gift_card_ids: saleCards.map((card) => card.id),
          buyer_id: Number(sellForm.buyer_id),
          payout_total:
            sellForm.payout_total.trim() === "" ? null : sellForm.payout_total,
          liquidation_rate:
            sellForm.payout_total.trim() === "" && sellForm.liquidation_rate
              ? sellForm.liquidation_rate
              : null,
          sold_date: sellForm.sold_date || null,
          expected_payment_date: sellForm.expected_payment_date || null,
          sale_notes: sellForm.notes || null,
          internal_notes: sellForm.notes || null,
        }),
      });

      if (!response.ok) {
        throw new Error(`Failed to sell selected cards (${response.status})`);
      }

      setSelectedIds([]);
      setSaleCardIds([]);
      setIsBulkMode(false);
      setIsSellModalOpen(false);
      await loadData();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to sell selected cards.",
      );
    } finally {
      setIsSaving(false);
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

        {error ? (
          <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-800">
            {error}
          </div>
        ) : null}

        {isLoading ? (
          <div className="rounded-lg border border-slate-200 bg-white p-8 text-center text-sm text-slate-500">
            Loading inventory...
          </div>
        ) : (
          <div className="space-y-6">
            {sections.map((section) => {
              const cards = filteredCards.filter((card) =>
                section.statuses.includes(card.status),
              );

              return (
                <InventorySection
                  cards={cards}
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
          estimatedPayout={sellPayoutTotal}
          faceValue={saleFaceValue}
          form={sellForm}
          isSaving={isSaving}
          onClose={() => {
            setSaleCardIds([]);
            setIsSellModalOpen(false);
          }}
          onSubmit={submitSellSelected}
          selectedCount={saleCards.length}
          setForm={setSellForm}
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
  const isAvailableSection = title === "Available Inventory";
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
                        <input
                          checked={selectedIds.includes(card.id)}
                          className="h-4 w-4 cursor-pointer"
                          onChange={() => onSelect(card)}
                          type="checkbox"
                        />
                      </td>
                    ) : null}
                    <td className="min-w-[28rem] px-3 py-2 align-middle">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 leading-tight">
                        <span className="font-semibold text-slate-950">
                          {card.brand}
                        </span>
                        <span className="text-slate-300">•</span>
                        <span>{formatAmount(card.face_value)} face</span>
                        <span className="text-slate-300">•</span>
                        <span className="text-slate-600">
                          cost {formatAmount(card.acquisition_cost)}
                        </span>
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
                        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-700">
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
                          className="inline-flex h-8 cursor-pointer items-center rounded-md border border-slate-300 px-3 text-xs font-semibold hover:bg-slate-100 active:bg-slate-200"
                          href={`/gift-cards/${card.id}/verify?returnTo=/inventory`}
                        >
                          Details
                        </Link>
                        {card.status === "VERIFIED_AVAILABLE" ? (
                          <button
                            className="h-8 cursor-pointer rounded-md bg-slate-900 px-3 text-xs font-semibold text-white hover:bg-slate-700 active:bg-slate-950 disabled:cursor-not-allowed disabled:opacity-60"
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
            {isAvailableSection && isBulkMode ? (
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
            <span>cost {formatAmount(card.acquisition_cost)}</span>
            {card.expected_payout !== null ? (
              <span>payout {formatAmount(card.expected_payout)}</span>
            ) : null}
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
        <span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-700">
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
          className="inline-flex h-10 cursor-pointer items-center justify-center rounded-md border border-slate-300 px-3 text-sm font-semibold hover:bg-slate-100 active:bg-slate-200"
          href={`/gift-cards/${card.id}/verify?returnTo=/inventory`}
        >
          Details
        </Link>
        {card.status === "VERIFIED_AVAILABLE" ? (
          <button
            className="h-10 cursor-pointer rounded-md bg-slate-900 px-3 text-sm font-semibold text-white hover:bg-slate-700 active:bg-slate-950 disabled:cursor-not-allowed disabled:opacity-60"
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
  faceValue,
  estimatedPayout,
  form,
  isSaving,
  selectedCount,
  setForm,
  onClose,
  onSubmit,
}: {
  buyers: Buyer[];
  faceValue: number;
  estimatedPayout: number | null;
  form: SellForm;
  isSaving: boolean;
  selectedCount: number;
  setForm: (form: SellForm) => void;
  onClose: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  const canSubmit =
    selectedCount > 0 &&
    form.buyer_id !== "" &&
    (form.payout_total.trim() !== "" || form.liquidation_rate.trim() !== "");

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 px-4 py-6">
      <form
        className="w-full max-w-lg space-y-4 rounded-lg bg-white p-5 shadow-xl"
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
            onChange={(event) =>
              setForm({ ...form, buyer_id: event.target.value })
            }
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
            <span>Liquidation Rate</span>
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
              placeholder="0.92"
              step="0.0001"
              type="number"
              value={form.liquidation_rate}
            />
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

        <label className="block space-y-2 text-sm font-medium text-slate-700">
          <span>Sold Date</span>
          <input
            className="h-11 w-full rounded-md border border-slate-300 px-3"
            onChange={(event) =>
              setForm({ ...form, sold_date: event.target.value })
            }
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

        <label className="block space-y-2 text-sm font-medium text-slate-700">
          <span>Notes</span>
          <textarea
            className="min-h-20 w-full rounded-md border border-slate-300 px-3 py-2"
            onChange={(event) => setForm({ ...form, notes: event.target.value })}
            value={form.notes}
          />
        </label>

        <div className="rounded-md bg-slate-50 px-3 py-2 text-sm text-slate-600">
          Expected payout:{" "}
          <span className="font-semibold text-slate-950">
            {formatAmount(estimatedPayout)}
          </span>
          {form.liquidation_rate ? (
            <span className="ml-2">at {formatRate(form.liquidation_rate)}</span>
          ) : null}
        </div>

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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 px-4 py-6">
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
