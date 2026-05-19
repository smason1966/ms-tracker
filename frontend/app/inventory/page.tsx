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
  status: string;
  card_number_encrypted: string | null;
  notes: string | null;
};

type Buyer = {
  id: number;
  name: string;
  buyer_type: string | null;
  active: boolean;
  notes: string | null;
};

type StatusFilter = {
  label: string;
  value: string;
};

type SaleForm = {
  sold_to: string;
  sold_date: string;
  sale_price: string;
  sale_notes: string;
};

type BulkSaleForm = {
  sold_to: string;
  sold_date: string;
  sale_price_total: string;
  sale_notes: string;
};

const statusFilters: StatusFilter[] = [
  { label: "All", value: "ALL" },
  { label: "Pending Verification", value: "Pending Verification" },
  { label: "Available", value: "Available" },
  { label: "Sold", value: "Sold" },
  { label: "Used", value: "Used" },
  { label: "Void", value: "Void" },
];

function getTodayDate() {
  return new Date().toISOString().slice(0, 10);
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

function formatAmount(value: string | number) {
  const amount = Number(value);

  if (Number.isNaN(amount)) {
    return String(value);
  }

  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(amount);
}

function getCardEnding(cardNumber: string | null) {
  if (!cardNumber) {
    return "";
  }

  return cardNumber.replace(/\s/g, "").slice(-4);
}

function getMaskedCardNumber(cardNumber: string | null) {
  const ending = getCardEnding(cardNumber);

  return ending ? `Card ending ${ending}` : "Not verified";
}

function matchesStatus(giftCard: GiftCard, statusFilter: string) {
  if (statusFilter === "ALL") {
    return true;
  }

  return getInventoryState(giftCard.status) === statusFilter;
}

function getInventoryState(status: string) {
  if (status === "VERIFIED_AVAILABLE") {
    return "Available";
  }

  if (status === "NEEDS_VERIFICATION") {
    return "Pending Verification";
  }

  if (status === "SOLD") {
    return "Sold";
  }

  if (status === "REDEEMED") {
    return "Used";
  }

  if (status === "VOID") {
    return "Void";
  }

  return status;
}

export default function InventoryPage() {
  const [giftCards, setGiftCards] = useState<GiftCard[]>([]);
  const [buyers, setBuyers] = useState<Buyer[]>([]);
  const [selectedGiftCardIds, setSelectedGiftCardIds] = useState<number[]>([]);
  const [activeStatus, setActiveStatus] = useState("ALL");
  const [searchQuery, setSearchQuery] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingBuyers, setIsLoadingBuyers] = useState(true);
  const [isSelling, setIsSelling] = useState(false);
  const [isBulkSellOpen, setIsBulkSellOpen] = useState(false);
  const [isBulkSelling, setIsBulkSelling] = useState(false);
  const [isRedeemingByCardId, setIsRedeemingByCardId] = useState<
    Record<number, boolean>
  >({});
  const [error, setError] = useState<string | null>(null);
  const [buyersError, setBuyersError] = useState<string | null>(null);
  const [saleError, setSaleError] = useState<string | null>(null);
  const [bulkSaleError, setBulkSaleError] = useState<string | null>(null);
  const [redeemError, setRedeemError] = useState<string | null>(null);
  const [sellingGiftCard, setSellingGiftCard] = useState<GiftCard | null>(null);
  const [saleForm, setSaleForm] = useState<SaleForm>({
    sold_to: "",
    sold_date: getTodayDate(),
    sale_price: "",
    sale_notes: "",
  });
  const [bulkSaleForm, setBulkSaleForm] = useState<BulkSaleForm>({
    sold_to: "",
    sold_date: getTodayDate(),
    sale_price_total: "",
    sale_notes: "",
  });

  useEffect(() => {
    let isMounted = true;

    async function loadInventoryData() {
      setIsLoading(true);
      setIsLoadingBuyers(true);
      setError(null);
      setBuyersError(null);

      const [giftCardsResult, buyersResult] = await Promise.allSettled([
        fetchGiftCards(),
        fetchBuyers(),
      ]);

      if (!isMounted) {
        return;
      }

      if (giftCardsResult.status === "fulfilled") {
        setGiftCards(giftCardsResult.value);
      } else {
        setError(
          giftCardsResult.reason instanceof Error
            ? giftCardsResult.reason.message
            : "Failed to load gift cards.",
        );
      }

      if (buyersResult.status === "fulfilled") {
        setBuyers(buyersResult.value);
      } else {
        setBuyersError(
          buyersResult.reason instanceof Error
            ? buyersResult.reason.message
            : "Failed to load buyers.",
        );
      }

      setIsLoading(false);
      setIsLoadingBuyers(false);
    }

    loadInventoryData();

    return () => {
      isMounted = false;
    };
  }, []);

  const filteredGiftCards = useMemo(() => {
    const normalizedSearch = searchQuery.trim().toLowerCase();

    return giftCards.filter((giftCard) => {
      if (!matchesStatus(giftCard, activeStatus)) {
        return false;
      }

      if (!normalizedSearch) {
        return true;
      }

      const cardEnding = getCardEnding(giftCard.card_number_encrypted);

      return (
        giftCard.brand.toLowerCase().includes(normalizedSearch) ||
        cardEnding.includes(normalizedSearch)
      );
    });
  }, [activeStatus, giftCards, searchQuery]);

  const canSaveSale =
    saleForm.sold_to.trim().length > 0 &&
    saleForm.sold_date.length > 0 &&
    saleForm.sale_price.length > 0;

  const selectedAvailableGiftCards = useMemo(
    () =>
      giftCards.filter(
        (giftCard) =>
          selectedGiftCardIds.includes(giftCard.id) &&
          giftCard.status === "VERIFIED_AVAILABLE",
      ),
    [giftCards, selectedGiftCardIds],
  );

  const selectedFaceValue = selectedAvailableGiftCards.reduce(
    (total, giftCard) => total + (Number(giftCard.face_value) || 0),
    0,
  );

  const canSaveBulkSale =
    selectedAvailableGiftCards.length > 0 &&
    bulkSaleForm.sold_to.trim().length > 0 &&
    bulkSaleForm.sold_date.length > 0 &&
    bulkSaleForm.sale_price_total.length > 0;

  function openSellModal(giftCard: GiftCard) {
    setSellingGiftCard(giftCard);
    setSaleError(null);
    setSaleForm({
      sold_to: "",
      sold_date: getTodayDate(),
      sale_price: "",
      sale_notes: "",
    });
  }

  function closeSellModal() {
    if (isSelling) {
      return;
    }

    setSellingGiftCard(null);
    setSaleError(null);
  }

  function openBulkSellModal() {
    if (selectedAvailableGiftCards.length === 0) {
      return;
    }

    setBulkSaleError(null);
    setBulkSaleForm({
      sold_to: "",
      sold_date: getTodayDate(),
      sale_price_total: "",
      sale_notes: "",
    });
    setIsBulkSellOpen(true);
  }

  function closeBulkSellModal() {
    if (isBulkSelling) {
      return;
    }

    setIsBulkSellOpen(false);
    setBulkSaleError(null);
  }

  function toggleGiftCardSelection(giftCard: GiftCard) {
    if (giftCard.status !== "VERIFIED_AVAILABLE") {
      return;
    }

    setSelectedGiftCardIds((currentSelectedIds) =>
      currentSelectedIds.includes(giftCard.id)
        ? currentSelectedIds.filter((giftCardId) => giftCardId !== giftCard.id)
        : [...currentSelectedIds, giftCard.id],
    );
  }

  async function refreshGiftCards() {
    const data = await fetchGiftCards();
    setGiftCards(data);
    setSelectedGiftCardIds((currentSelectedIds) =>
      currentSelectedIds.filter((giftCardId) =>
        data.some(
          (giftCard) =>
            giftCard.id === giftCardId &&
            giftCard.status === "VERIFIED_AVAILABLE",
        ),
      ),
    );
  }

  async function handleSaleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!sellingGiftCard || !canSaveSale) {
      return;
    }

    setIsSelling(true);
    setSaleError(null);

    try {
      const response = await fetch(
        `${API_BASE_URL}/gift-cards/${sellingGiftCard.id}/sell`,
        {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            sold_to: saleForm.sold_to.trim(),
            sold_date: saleForm.sold_date,
            sale_price: saleForm.sale_price,
            sale_notes: saleForm.sale_notes.trim() || null,
          }),
        },
      );

      if (!response.ok) {
        throw new Error(`Failed to mark card sold (${response.status})`);
      }

      await refreshGiftCards();
      setSellingGiftCard(null);
    } catch (err) {
      setSaleError(
        err instanceof Error ? err.message : "Failed to mark card sold.",
      );
    } finally {
      setIsSelling(false);
    }
  }

  async function handleMarkUsed(giftCard: GiftCard) {
    const confirmed = window.confirm(
      `Mark ${giftCard.brand} ${formatAmount(giftCard.face_value)} as used?`,
    );

    if (!confirmed) {
      return;
    }

    setRedeemError(null);
    setIsRedeemingByCardId((currentRedeeming) => ({
      ...currentRedeeming,
      [giftCard.id]: true,
    }));

    try {
      const response = await fetch(
        `${API_BASE_URL}/gift-cards/${giftCard.id}/redeem`,
        {
          method: "PATCH",
        },
      );

      if (!response.ok) {
        throw new Error(`Failed to mark card used (${response.status})`);
      }

      await refreshGiftCards();
    } catch (err) {
      setRedeemError(
        err instanceof Error ? err.message : "Failed to mark card used.",
      );
    } finally {
      setIsRedeemingByCardId((currentRedeeming) => ({
        ...currentRedeeming,
        [giftCard.id]: false,
      }));
    }
  }

  async function handleBulkSaleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!canSaveBulkSale) {
      return;
    }

    setIsBulkSelling(true);
    setBulkSaleError(null);

    try {
      const response = await fetch(`${API_BASE_URL}/gift-cards/bulk-sell`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          gift_card_ids: selectedAvailableGiftCards.map(
            (giftCard) => giftCard.id,
          ),
          sold_to: bulkSaleForm.sold_to.trim(),
          sold_date: bulkSaleForm.sold_date,
          sale_price_total: bulkSaleForm.sale_price_total,
          sale_notes: bulkSaleForm.sale_notes.trim() || null,
        }),
      });

      if (!response.ok) {
        throw new Error(`Failed to bulk sell cards (${response.status})`);
      }

      await refreshGiftCards();
      setSelectedGiftCardIds([]);
      setIsBulkSellOpen(false);
    } catch (err) {
      setBulkSaleError(
        err instanceof Error ? err.message : "Failed to bulk sell cards.",
      );
    } finally {
      setIsBulkSelling(false);
    }
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
            <p className="mt-2 text-sm text-slate-600">
              {filteredGiftCards.length} of {giftCards.length} cards shown
            </p>
          </div>

          <label className="block w-full max-w-md space-y-2 text-sm font-medium text-slate-700">
            <span>Search brand or card ending</span>
            <input
              className="h-11 w-full rounded-md border border-slate-300 px-3 text-base text-slate-950 outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-200"
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="Best Buy or 3723"
              type="search"
              value={searchQuery}
            />
          </label>
        </header>

        <section className="flex flex-wrap gap-2">
          {statusFilters.map((filter) => (
            <button
              className={`h-10 rounded-md border px-4 text-sm font-medium transition ${
                activeStatus === filter.value
                  ? "border-slate-950 bg-slate-950 text-white hover:bg-slate-800"
                  : "border-slate-300 bg-white text-slate-700 hover:bg-slate-100"
              }`}
              key={filter.value}
              onClick={() => setActiveStatus(filter.value)}
              type="button"
            >
              {filter.label}
            </button>
          ))}
        </section>

        {selectedAvailableGiftCards.length > 0 ? (
          <section className="flex flex-col gap-3 rounded-lg border border-slate-200 bg-white p-4 shadow-sm sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-sm font-semibold text-slate-900">
                {selectedAvailableGiftCards.length}{" "}
                {selectedAvailableGiftCards.length === 1 ? "card" : "cards"}{" "}
                selected
              </p>
              <p className="mt-1 text-sm text-slate-500">
                Face value {formatAmount(selectedFaceValue)}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                className="h-10 rounded-md border border-slate-300 px-4 text-sm font-medium text-slate-700 transition hover:bg-slate-100"
                onClick={() => setSelectedGiftCardIds([])}
                type="button"
              >
                Clear
              </button>
              <button
                className="h-10 rounded-md bg-slate-900 px-4 text-sm font-semibold text-white transition hover:bg-slate-700"
                onClick={openBulkSellModal}
                type="button"
              >
                Bulk Sell
              </button>
            </div>
          </section>
        ) : null}

        {error ? (
          <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-800">
            {error}
          </div>
        ) : null}
        {buyersError ? (
          <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-800">
            {buyersError}
          </div>
        ) : null}
        {redeemError ? (
          <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-800">
            {redeemError}
          </div>
        ) : null}

        <section className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
          {isLoading ? (
            <div className="px-6 py-12 text-center text-sm text-slate-500">
              Loading inventory...
            </div>
          ) : filteredGiftCards.length === 0 ? (
            <div className="px-6 py-12 text-center text-sm text-slate-500">
              No gift cards match the current filters.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-slate-200 text-sm">
                <thead className="bg-slate-100 text-left text-xs font-semibold uppercase tracking-wide text-slate-600">
                  <tr>
                    <th className="px-6 py-3">Select</th>
                    <th className="px-6 py-3">Brand</th>
                    <th className="px-6 py-3">Face Value</th>
                    <th className="px-6 py-3">Cost</th>
                    <th className="px-6 py-3">Card Number</th>
                    <th className="px-6 py-3">Inventory State</th>
                    <th className="px-6 py-3">Purchase</th>
                    <th className="px-6 py-3">Action</th>
                    <th className="px-6 py-3">Notes</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 bg-white">
                  {filteredGiftCards.map((giftCard) => (
                    <tr key={giftCard.id} className="hover:bg-slate-50">
                      <td className="whitespace-nowrap px-6 py-4">
                        {giftCard.status === "VERIFIED_AVAILABLE" ? (
                          <input
                            aria-label={`Select ${giftCard.brand} ${formatAmount(
                              giftCard.face_value,
                            )}`}
                            checked={selectedGiftCardIds.includes(giftCard.id)}
                            className="h-4 w-4 rounded border-slate-300 text-slate-900 focus:ring-slate-500"
                            onChange={() => toggleGiftCardSelection(giftCard)}
                            type="checkbox"
                          />
                        ) : null}
                      </td>
                      <td className="whitespace-nowrap px-6 py-4 font-medium">
                        {giftCard.brand}
                      </td>
                      <td className="whitespace-nowrap px-6 py-4 text-slate-700">
                        {formatAmount(giftCard.face_value)}
                      </td>
                      <td className="whitespace-nowrap px-6 py-4 text-slate-700">
                        {giftCard.acquisition_cost === null
                          ? ""
                          : formatAmount(giftCard.acquisition_cost)}
                      </td>
                      <td className="whitespace-nowrap px-6 py-4 font-mono text-xs text-slate-700">
                        {getMaskedCardNumber(giftCard.card_number_encrypted)}
                      </td>
                      <td className="whitespace-nowrap px-6 py-4 text-slate-700">
                        {getInventoryState(giftCard.status)}
                      </td>
                      <td className="whitespace-nowrap px-6 py-4 text-slate-700">
                        #{giftCard.purchase_batch_id}
                      </td>
                      <td className="whitespace-nowrap px-6 py-4">
                        <div className="flex flex-wrap gap-2">
                          <Link
                            className={`inline-flex h-9 items-center rounded-md px-4 text-xs font-semibold text-white transition ${
                              giftCard.status === "VERIFIED_AVAILABLE"
                                ? "bg-emerald-700 hover:bg-emerald-800"
                                : giftCard.status === "SOLD"
                                  ? "bg-slate-600 hover:bg-slate-700"
                                : "bg-red-700 hover:bg-red-800"
                            }`}
                            href={`/gift-cards/${giftCard.id}/verify?returnTo=/inventory`}
                          >
                            {giftCard.status === "VERIFIED_AVAILABLE"
                              ? "Verified"
                              : giftCard.status === "SOLD"
                                ? "Details"
                                : "Verify"}
                          </Link>
                          {giftCard.status === "VERIFIED_AVAILABLE" ? (
                            <button
                              className="inline-flex h-9 items-center rounded-md bg-slate-900 px-4 text-xs font-semibold text-white transition hover:bg-slate-700"
                              onClick={() => openSellModal(giftCard)}
                              type="button"
                            >
                              Sell
                            </button>
                          ) : null}
                          {giftCard.status === "SOLD" ? (
                            <button
                              className="inline-flex h-9 items-center rounded-md bg-slate-900 px-4 text-xs font-semibold text-white transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:bg-slate-400"
                              disabled={Boolean(
                                isRedeemingByCardId[giftCard.id],
                              )}
                              onClick={() => handleMarkUsed(giftCard)}
                              type="button"
                            >
                              {isRedeemingByCardId[giftCard.id]
                                ? "Saving..."
                                : "Mark Used"}
                            </button>
                          ) : null}
                        </div>
                      </td>
                      <td className="max-w-md px-6 py-4 text-xs text-slate-500">
                        {giftCard.notes || ""}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>

      {sellingGiftCard ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 px-4 py-6">
          <form
            className="w-full max-w-lg space-y-4 rounded-lg bg-white p-5 shadow-xl"
            onSubmit={handleSaleSubmit}
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-lg font-semibold">Mark Sold</h2>
                <p className="mt-1 text-sm text-slate-500">
                  {sellingGiftCard.brand} {formatAmount(sellingGiftCard.face_value)}
                </p>
              </div>
              <button
                className="h-9 rounded-md border border-slate-300 px-3 text-sm font-medium text-slate-700 hover:bg-slate-100"
                onClick={closeSellModal}
                type="button"
              >
                Close
              </button>
            </div>

            <label className="block space-y-2 text-sm font-medium text-slate-700">
              <span>Sold To</span>
              <select
                className="h-11 w-full rounded-md border border-slate-300 px-3 text-slate-950 outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-200"
                disabled={isLoadingBuyers || Boolean(buyersError)}
                onChange={(event) =>
                  setSaleForm((currentForm) => ({
                    ...currentForm,
                    sold_to: event.target.value,
                  }))
                }
                required
                value={saleForm.sold_to}
              >
                <option value="">
                  {isLoadingBuyers
                    ? "Loading buyers..."
                    : buyers.length === 0
                      ? "No buyers available"
                      : "Select buyer"}
                </option>
                {buyers.map((buyer) => (
                  <option key={buyer.id} value={buyer.name}>
                    {buyer.name}
                    {buyer.active ? "" : " (Inactive)"}
                  </option>
                ))}
              </select>
            </label>

            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block space-y-2 text-sm font-medium text-slate-700">
                <span>Sold Date</span>
                <input
                  className="h-11 w-full rounded-md border border-slate-300 px-3 text-slate-950 outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-200"
                  onChange={(event) =>
                    setSaleForm((currentForm) => ({
                      ...currentForm,
                      sold_date: event.target.value,
                    }))
                  }
                  required
                  type="date"
                  value={saleForm.sold_date}
                />
              </label>

              <label className="block space-y-2 text-sm font-medium text-slate-700">
                <span>Sale Price</span>
                <input
                  className="h-11 w-full rounded-md border border-slate-300 px-3 text-slate-950 outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-200"
                  min="0"
                  onChange={(event) =>
                    setSaleForm((currentForm) => ({
                      ...currentForm,
                      sale_price: event.target.value,
                    }))
                  }
                  required
                  step="0.01"
                  type="number"
                  value={saleForm.sale_price}
                />
              </label>
            </div>

            <label className="block space-y-2 text-sm font-medium text-slate-700">
              <span>Sale Notes</span>
              <textarea
                className="min-h-24 w-full rounded-md border border-slate-300 px-3 py-2 text-slate-950 outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-200"
                onChange={(event) =>
                  setSaleForm((currentForm) => ({
                    ...currentForm,
                    sale_notes: event.target.value,
                  }))
                }
                value={saleForm.sale_notes}
              />
            </label>

            {saleError ? (
              <p className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                {saleError}
              </p>
            ) : null}

            <div className="flex justify-end gap-2">
              <button
                className="h-10 rounded-md border border-slate-300 px-4 text-sm font-medium text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:text-slate-400"
                disabled={isSelling}
                onClick={closeSellModal}
                type="button"
              >
                Cancel
              </button>
              <button
                className="h-10 rounded-md bg-slate-900 px-4 text-sm font-semibold text-white hover:bg-slate-700 disabled:cursor-not-allowed disabled:bg-slate-400"
                disabled={isSelling || !canSaveSale}
                type="submit"
              >
                {isSelling ? "Saving..." : "Save Sale"}
              </button>
            </div>
          </form>
        </div>
      ) : null}

      {isBulkSellOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 px-4 py-6">
          <form
            className="w-full max-w-lg space-y-4 rounded-lg bg-white p-5 shadow-xl"
            onSubmit={handleBulkSaleSubmit}
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-lg font-semibold">Bulk Sell</h2>
                <p className="mt-1 text-sm text-slate-500">
                  {selectedAvailableGiftCards.length}{" "}
                  {selectedAvailableGiftCards.length === 1 ? "card" : "cards"}{" "}
                  selected · Face value {formatAmount(selectedFaceValue)}
                </p>
              </div>
              <button
                className="h-9 rounded-md border border-slate-300 px-3 text-sm font-medium text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:text-slate-400"
                disabled={isBulkSelling}
                onClick={closeBulkSellModal}
                type="button"
              >
                Close
              </button>
            </div>

            <label className="block space-y-2 text-sm font-medium text-slate-700">
              <span>Sold To</span>
              <select
                className="h-11 w-full rounded-md border border-slate-300 px-3 text-slate-950 outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-200"
                disabled={isLoadingBuyers || Boolean(buyersError)}
                onChange={(event) =>
                  setBulkSaleForm((currentForm) => ({
                    ...currentForm,
                    sold_to: event.target.value,
                  }))
                }
                required
                value={bulkSaleForm.sold_to}
              >
                <option value="">
                  {isLoadingBuyers
                    ? "Loading buyers..."
                    : buyers.length === 0
                      ? "No buyers available"
                      : "Select buyer"}
                </option>
                {buyers.map((buyer) => (
                  <option key={buyer.id} value={buyer.name}>
                    {buyer.name}
                    {buyer.active ? "" : " (Inactive)"}
                  </option>
                ))}
              </select>
            </label>

            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block space-y-2 text-sm font-medium text-slate-700">
                <span>Sold Date</span>
                <input
                  className="h-11 w-full rounded-md border border-slate-300 px-3 text-slate-950 outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-200"
                  onChange={(event) =>
                    setBulkSaleForm((currentForm) => ({
                      ...currentForm,
                      sold_date: event.target.value,
                    }))
                  }
                  required
                  type="date"
                  value={bulkSaleForm.sold_date}
                />
              </label>

              <label className="block space-y-2 text-sm font-medium text-slate-700">
                <span>Total Sale Price</span>
                <input
                  className="h-11 w-full rounded-md border border-slate-300 px-3 text-slate-950 outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-200"
                  min="0"
                  onChange={(event) =>
                    setBulkSaleForm((currentForm) => ({
                      ...currentForm,
                      sale_price_total: event.target.value,
                    }))
                  }
                  required
                  step="0.01"
                  type="number"
                  value={bulkSaleForm.sale_price_total}
                />
              </label>
            </div>

            <label className="block space-y-2 text-sm font-medium text-slate-700">
              <span>Sale Notes</span>
              <textarea
                className="min-h-24 w-full rounded-md border border-slate-300 px-3 py-2 text-slate-950 outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-200"
                onChange={(event) =>
                  setBulkSaleForm((currentForm) => ({
                    ...currentForm,
                    sale_notes: event.target.value,
                  }))
                }
                value={bulkSaleForm.sale_notes}
              />
            </label>

            {bulkSaleError ? (
              <p className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                {bulkSaleError}
              </p>
            ) : null}

            <div className="flex justify-end gap-2">
              <button
                className="h-10 rounded-md border border-slate-300 px-4 text-sm font-medium text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:text-slate-400"
                disabled={isBulkSelling}
                onClick={closeBulkSellModal}
                type="button"
              >
                Cancel
              </button>
              <button
                className="h-10 rounded-md bg-slate-900 px-4 text-sm font-semibold text-white hover:bg-slate-700 disabled:cursor-not-allowed disabled:bg-slate-400"
                disabled={isBulkSelling || !canSaveBulkSale}
                type="submit"
              >
                {isBulkSelling ? "Saving..." : "Save Bulk Sale"}
              </button>
            </div>
          </form>
        </div>
      ) : null}
    </main>
  );
}
