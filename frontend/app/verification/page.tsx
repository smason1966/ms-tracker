"use client";

import Image from "next/image";
import Link from "next/link";
import { ChangeEvent, useCallback, useEffect, useMemo, useState } from "react";

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

type CardImage = {
  id: number;
  gift_card_id: number;
  image_type: string;
  original_image_url: string;
  processed_image_url: string | null;
};

function formatAmount(value: string | number) {
  const amount = Number(value);

  if (Number.isNaN(amount)) {
    return String(value);
  }

  return amount.toLocaleString(undefined, {
    style: "currency",
    currency: "USD",
  });
}

function getCardNumberStatus(cardNumber: string | null) {
  const normalizedCardNumber = cardNumber?.trim();

  if (!normalizedCardNumber) {
    return "Card number missing";
  }

  return `Card ending ${normalizedCardNumber.slice(-4)}`;
}

function buildUploadUrl(path: string | null | undefined) {
  if (!path) {
    return "";
  }

  if (path.startsWith("http://") || path.startsWith("https://")) {
    return path;
  }

  return `${API_BASE_URL}/${path.replace(/^\/+/, "")}`;
}

async function fetchGiftCardImages(giftCardId: number) {
  const response = await fetch(`${API_BASE_URL}/card-images/gift-card/${giftCardId}`);

  if (!response.ok) {
    throw new Error(`Failed to load images for card ${giftCardId}`);
  }

  return (await response.json()) as CardImage[];
}

export default function VerificationQueuePage() {
  const [giftCards, setGiftCards] = useState<GiftCard[]>([]);
  const [cardImagesById, setCardImagesById] = useState<
    Record<number, CardImage | null>
  >({});
  const [brandFilter, setBrandFilter] = useState("");
  const [purchaseFilter, setPurchaseFilter] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const brands = useMemo(
    () => Array.from(new Set(giftCards.map((card) => card.brand))).sort(),
    [giftCards],
  );

  const purchaseBatchIds = useMemo(
    () =>
      Array.from(new Set(giftCards.map((card) => card.purchase_batch_id))).sort(
        (first, second) => first - second,
      ),
    [giftCards],
  );

  const filteredGiftCards = useMemo(() => {
    return giftCards.filter((card) => {
      const matchesBrand = !brandFilter || card.brand === brandFilter;
      const matchesPurchase =
        !purchaseFilter || String(card.purchase_batch_id) === purchaseFilter;

      return matchesBrand && matchesPurchase;
    });
  }, [brandFilter, giftCards, purchaseFilter]);

  const loadQueue = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch(`${API_BASE_URL}/gift-cards/verification-queue`);

      if (!response.ok) {
        throw new Error(`Failed to load verification queue (${response.status})`);
      }

      const data = (await response.json()) as GiftCard[];
      setGiftCards(data);

      const imageEntries = await Promise.all(
        data.map(async (card) => {
          try {
            const images = await fetchGiftCardImages(card.id);
            const primaryImage =
              images.find((image) => image.image_type === "primary") ??
              images[0] ??
              null;

            return [card.id, primaryImage] as const;
          } catch {
            return [card.id, null] as const;
          }
        }),
      );

      setCardImagesById(Object.fromEntries(imageEntries));
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to load verification queue.",
      );
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    queueMicrotask(() => {
      void loadQueue();
    });
  }, [loadQueue]);

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-6 text-slate-950 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-6xl space-y-6">
        <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-sm font-medium uppercase tracking-wide text-slate-500">
              Operations
            </p>
            <h1 className="text-3xl font-semibold tracking-tight">
              Confirm Card Details
            </h1>
            <p className="mt-1 text-sm text-slate-600">
              Cards leave this queue once card number, optional PIN, and card
              details are confirmed.
            </p>
          </div>
          <Link
            className="inline-flex h-11 cursor-pointer items-center justify-center rounded-md border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-700 transition hover:bg-slate-100 active:bg-slate-200"
            href="/inventory"
          >
            Inventory
          </Link>
        </header>

        <section className="grid gap-3 rounded-lg border border-slate-200 bg-white p-4 shadow-sm sm:grid-cols-2">
          <label className="space-y-2 text-sm font-medium text-slate-700">
            <span>Brand</span>
            <select
              className="h-11 w-full rounded-md border border-slate-300 px-3 text-base outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-200"
              onChange={(event: ChangeEvent<HTMLSelectElement>) =>
                setBrandFilter(event.target.value)
              }
              value={brandFilter}
            >
              <option value="">All brands</option>
              {brands.map((brand) => (
                <option key={brand} value={brand}>
                  {brand}
                </option>
              ))}
            </select>
          </label>

          <label className="space-y-2 text-sm font-medium text-slate-700">
            <span>Purchase Batch</span>
            <select
              className="h-11 w-full rounded-md border border-slate-300 px-3 text-base outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-200"
              onChange={(event: ChangeEvent<HTMLSelectElement>) =>
                setPurchaseFilter(event.target.value)
              }
              value={purchaseFilter}
            >
              <option value="">All purchases</option>
              {purchaseBatchIds.map((purchaseBatchId) => (
                <option key={purchaseBatchId} value={purchaseBatchId}>
                  Purchase #{purchaseBatchId}
                </option>
              ))}
            </select>
          </label>
        </section>

        {error ? (
          <p className="rounded-md border border-red-200 bg-red-50 p-3 text-sm font-medium text-red-700">
            {error}
          </p>
        ) : null}

        <section className="space-y-3">
          {isLoading ? (
            <div className="rounded-lg border border-slate-200 bg-white p-6 text-slate-600 shadow-sm">
              Loading cards...
            </div>
          ) : filteredGiftCards.length === 0 ? (
            <div className="rounded-lg border border-slate-200 bg-white p-6 text-slate-600 shadow-sm">
              No cards need confirmation.
            </div>
          ) : (
            filteredGiftCards.map((giftCard) => {
              const image = cardImagesById[giftCard.id];
              const imageUrl = buildUploadUrl(
                image?.processed_image_url ?? image?.original_image_url,
              );

              return (
                <article
                  className="grid gap-4 rounded-lg border border-slate-200 bg-white p-4 shadow-sm md:grid-cols-[9rem_1fr_auto]"
                  key={giftCard.id}
                >
                  <div className="flex h-36 items-center justify-center rounded-md bg-slate-100">
                    {imageUrl ? (
                      <Image
                        alt={`${giftCard.brand} card`}
                        className="h-full w-full rounded-md object-cover"
                        height={180}
                        src={imageUrl}
                        unoptimized
                        width={240}
                      />
                    ) : (
                      <span className="px-3 text-center text-sm text-slate-500">
                        No image
                      </span>
                    )}
                  </div>

                  <div className="min-w-0 space-y-2">
                    <div>
                      <h2 className="text-xl font-semibold">{giftCard.brand}</h2>
                      <p className="text-sm text-slate-500">
                        Purchase #{giftCard.purchase_batch_id} ·{" "}
                        {formatAmount(giftCard.face_value)}
                      </p>
                    </div>
                    <p
                      className={
                        giftCard.card_number_encrypted?.trim()
                          ? "text-sm font-medium text-slate-700"
                          : "text-sm font-medium text-red-700"
                      }
                    >
                      {getCardNumberStatus(giftCard.card_number_encrypted)}
                    </p>
                    {giftCard.notes ? (
                      <p className="text-sm text-slate-500">{giftCard.notes}</p>
                    ) : null}
                  </div>

                  <div className="flex items-center">
                    <Link
                      className="inline-flex h-11 cursor-pointer items-center justify-center rounded-md bg-slate-950 px-4 text-sm font-semibold text-white transition hover:bg-slate-800 active:bg-slate-900"
                      href={`/gift-cards/${giftCard.id}/verify?returnTo=/verification`}
                    >
                      Confirm Card Details
                    </Link>
                  </div>
                </article>
              );
            })
          )}
        </section>
      </div>
    </main>
  );
}
