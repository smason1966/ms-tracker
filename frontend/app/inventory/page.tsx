"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";

import { API_BASE_URL } from "@/lib/api";

type GiftCard = {
  id: number;
  purchase_batch_id: number;
  brand: string;
  face_value: string | number;
  status: string;
  card_number_encrypted: string | null;
  notes: string | null;
};

type StatusFilter = {
  label: string;
  value: string;
};

const statusFilters: StatusFilter[] = [
  { label: "All", value: "ALL" },
  { label: "Pending Verification", value: "Pending Verification" },
  { label: "Available", value: "Available" },
  { label: "Sold", value: "SOLD" },
  { label: "Used", value: "Used" },
  { label: "Void", value: "VOID" },
];

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
  const [activeStatus, setActiveStatus] = useState("ALL");
  const [searchQuery, setSearchQuery] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;

    async function loadGiftCards() {
      setIsLoading(true);
      setError(null);

      try {
        const response = await fetch(`${API_BASE_URL}/gift-cards/`);

        if (!response.ok) {
          throw new Error(`Failed to load gift cards (${response.status})`);
        }

        const data = (await response.json()) as GiftCard[];

        if (isMounted) {
          setGiftCards(data);
        }
      } catch (err) {
        if (isMounted) {
          setError(
            err instanceof Error ? err.message : "Failed to load gift cards.",
          );
        }
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    }

    loadGiftCards();

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
                  ? "border-slate-950 bg-slate-950 text-white"
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

        {error ? (
          <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-800">
            {error}
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
                    <th className="px-6 py-3">Brand</th>
                    <th className="px-6 py-3">Face Value</th>
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
                      <td className="whitespace-nowrap px-6 py-4 font-medium">
                        {giftCard.brand}
                      </td>
                      <td className="whitespace-nowrap px-6 py-4 text-slate-700">
                        {formatAmount(giftCard.face_value)}
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
                        <Link
                          className={`inline-flex h-9 items-center rounded-md px-4 text-xs font-semibold text-white transition ${
                            giftCard.status === "VERIFIED_AVAILABLE"
                              ? "bg-emerald-700 hover:bg-emerald-800"
                              : "bg-red-700 hover:bg-red-800"
                          }`}
                          href={`/gift-cards/${giftCard.id}/verify`}
                        >
                          {giftCard.status === "VERIFIED_AVAILABLE"
                            ? "Verified"
                            : "Verify"}
                        </Link>
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
    </main>
  );
}
