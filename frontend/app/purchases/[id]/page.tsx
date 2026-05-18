"use client";

import { ChangeEvent, FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useParams } from "next/navigation";

import { API_BASE_URL } from "@/lib/api";

type PurchaseBatch = {
  id: number;
  store_name: string;
  purchase_date: string;
  total_amount: string | number;
  notes: string | null;
};

type Receipt = {
  id: number;
  purchase_batch_id: number;
  image_url: string;
  original_filename: string | null;
  notes: string | null;
  created_at: string;
};

type GiftCard = {
  id: number;
  brand: string;
  face_value: string | number;
  status: string;
  card_number_encrypted: string | null;
  notes: string | null;
};

type CardBrand = {
  id: number;
  name: string;
  active: boolean;
};

type GiftCardForm = {
  brand: string;
  face_value: string;
  notes: string;
};

const emptyGiftCardForm: GiftCardForm = {
  brand: "",
  face_value: "",
  notes: "",
};

export default function PurchaseDetailPage() {
  const params = useParams<{ id: string | string[] }>();
  const purchaseId = useMemo(() => {
    const rawId = params.id;
    return Array.isArray(rawId) ? rawId[0] : rawId;
  }, [params.id]);

  const [purchase, setPurchase] = useState<PurchaseBatch | null>(null);
  const [receipts, setReceipts] = useState<Receipt[]>([]);
  const [giftCards, setGiftCards] = useState<GiftCard[]>([]);
  const [cardBrands, setCardBrands] = useState<CardBrand[]>([]);
  const [revealedCardNumbers, setRevealedCardNumbers] = useState<
    Record<number, boolean>
  >({});
  const [form, setForm] = useState<GiftCardForm>(emptyGiftCardForm);
  const [isLoadingPurchase, setIsLoadingPurchase] = useState(true);
  const [isLoadingReceipts, setIsLoadingReceipts] = useState(true);
  const [isUploadingReceipt, setIsUploadingReceipt] = useState(false);
  const [isLoadingGiftCards, setIsLoadingGiftCards] = useState(true);
  const [isLoadingCardBrands, setIsLoadingCardBrands] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [receiptsError, setReceiptsError] = useState<string | null>(null);
  const [receiptUploadError, setReceiptUploadError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [cardBrandsError, setCardBrandsError] = useState<string | null>(null);

  const purchaseUrl = `${API_BASE_URL}/purchase-batches/${purchaseId}`;
  const receiptsUrl = `${API_BASE_URL}/receipts/purchase/${purchaseId}`;
  const giftCardsUrl = `${API_BASE_URL}/gift-cards/purchase/${purchaseId}`;
  const cardBrandsUrl = `${API_BASE_URL}/card-brands/`;

  const loadGiftCards = useCallback(
    async (options: { showLoading?: boolean } = {}) => {
      if (!purchaseId) {
        return;
      }

      if (options.showLoading ?? true) {
        setIsLoadingGiftCards(true);
      }

      setError(null);

      try {
        const response = await fetch(giftCardsUrl);

        if (!response.ok) {
          throw new Error(`Failed to load gift cards (${response.status})`);
        }

        const data = (await response.json()) as GiftCard[];
        setGiftCards(data);
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Failed to load gift cards.",
        );
      } finally {
        setIsLoadingGiftCards(false);
      }
    },
    [giftCardsUrl, purchaseId],
  );

  const loadReceipts = useCallback(
    async (options: { showLoading?: boolean } = {}) => {
      if (!purchaseId) {
        return;
      }

      if (options.showLoading ?? true) {
        setIsLoadingReceipts(true);
      }

      setReceiptsError(null);

      try {
        const response = await fetch(receiptsUrl);

        if (!response.ok) {
          throw new Error(`Failed to load receipts (${response.status})`);
        }

        const data = (await response.json()) as Receipt[];
        setReceipts(data);
      } catch (err) {
        setReceiptsError(
          err instanceof Error ? err.message : "Failed to load receipts.",
        );
      } finally {
        setIsLoadingReceipts(false);
      }
    },
    [purchaseId, receiptsUrl],
  );

  useEffect(() => {
    let isMounted = true;

    async function loadPurchase() {
      if (!purchaseId) {
        return;
      }

      setIsLoadingPurchase(true);
      setError(null);

      try {
        const response = await fetch(purchaseUrl);

        if (!response.ok) {
          throw new Error(`Failed to load purchase (${response.status})`);
        }

        const data = (await response.json()) as PurchaseBatch;

        if (isMounted) {
          setPurchase(data);
        }
      } catch (err) {
        if (isMounted) {
          setError(
            err instanceof Error ? err.message : "Failed to load purchase.",
          );
        }
      } finally {
        if (isMounted) {
          setIsLoadingPurchase(false);
        }
      }
    }

    loadPurchase();

    return () => {
      isMounted = false;
    };
  }, [purchaseId, purchaseUrl]);

  useEffect(() => {
    let isMounted = true;

    async function loadCardBrands() {
      setIsLoadingCardBrands(true);
      setCardBrandsError(null);

      try {
        const response = await fetch(cardBrandsUrl);

        if (!response.ok) {
          throw new Error(`Failed to load card brands (${response.status})`);
        }

        const data = (await response.json()) as CardBrand[];

        if (isMounted) {
          setCardBrands(data);
        }
      } catch (err) {
        if (isMounted) {
          setCardBrandsError(
            err instanceof Error ? err.message : "Failed to load card brands.",
          );
        }
      } finally {
        if (isMounted) {
          setIsLoadingCardBrands(false);
        }
      }
    }

    loadCardBrands();

    return () => {
      isMounted = false;
    };
  }, [cardBrandsUrl]);

  useEffect(() => {
    let isMounted = true;

    async function loadInitialReceipts() {
      if (!purchaseId) {
        return;
      }

      setIsLoadingReceipts(true);
      setReceiptsError(null);

      try {
        const response = await fetch(receiptsUrl);

        if (!response.ok) {
          throw new Error(`Failed to load receipts (${response.status})`);
        }

        const data = (await response.json()) as Receipt[];

        if (isMounted) {
          setReceipts(data);
        }
      } catch (err) {
        if (isMounted) {
          setReceiptsError(
            err instanceof Error ? err.message : "Failed to load receipts.",
          );
        }
      } finally {
        if (isMounted) {
          setIsLoadingReceipts(false);
        }
      }
    }

    loadInitialReceipts();

    return () => {
      isMounted = false;
    };
  }, [purchaseId, receiptsUrl]);

  useEffect(() => {
    let isMounted = true;

    async function loadInitialGiftCards() {
      if (!purchaseId) {
        return;
      }

      setIsLoadingGiftCards(true);
      setError(null);

      try {
        const response = await fetch(giftCardsUrl);

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
          setIsLoadingGiftCards(false);
        }
      }
    }

    loadInitialGiftCards();

    return () => {
      isMounted = false;
    };
  }, [giftCardsUrl, purchaseId]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);
    setIsSubmitting(true);

    try {
      const response = await fetch(`${API_BASE_URL}/gift-cards/`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          brand: form.brand.trim(),
          face_value: form.face_value,
          notes: form.notes.trim() || null,
          purchase_batch_id: Number(purchaseId),
        }),
      });

      if (!response.ok) {
        throw new Error(`Failed to create gift card (${response.status})`);
      }

      setForm((currentForm) => ({
        ...currentForm,
        notes: "",
      }));
      await loadGiftCards({ showLoading: false });
    } catch (err) {
      setFormError(
        err instanceof Error ? err.message : "Failed to create gift card.",
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleReceiptUpload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];

    if (!file || !purchaseId) {
      return;
    }

    setIsUploadingReceipt(true);
    setReceiptUploadError(null);

    try {
      const formData = new FormData();
      formData.append("purchase_batch_id", purchaseId);
      formData.append("file", file);

      const response = await fetch(`${API_BASE_URL}/receipts/upload`, {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        throw new Error(`Failed to upload receipt (${response.status})`);
      }

      await loadReceipts({ showLoading: false });
    } catch (err) {
      setReceiptUploadError(
        err instanceof Error ? err.message : "Failed to upload receipt.",
      );
    } finally {
      event.target.value = "";
      setIsUploadingReceipt(false);
    }
  }

  function updateFormField(field: keyof GiftCardForm, value: string) {
    setForm((currentForm) => ({
      ...currentForm,
      [field]: value,
    }));
  }

  function formatDate(value: string) {
    const date = new Date(value);

    if (Number.isNaN(date.getTime())) {
      return value;
    }

    return new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    }).format(date);
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

  function getReceiptImageUrl(receipt: Receipt) {
    if (
      receipt.image_url.startsWith("http://") ||
      receipt.image_url.startsWith("https://")
    ) {
      return receipt.image_url;
    }

    return `${API_BASE_URL}/${receipt.image_url.replace(/^\/+/, "")}`;
  }

  function renderReceipts() {
    if (isLoadingReceipts) {
      return <p className="text-sm text-slate-500">Loading receipts...</p>;
    }

    if (receipts.length === 0) {
      return <p className="text-sm text-slate-500">No receipts uploaded.</p>;
    }

    return (
      <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {receipts.map((receipt) => (
          <figure
            className="overflow-hidden rounded-md border border-slate-200 bg-slate-50"
            key={receipt.id}
          >
            <Image
              className="h-48 w-full object-cover"
              src={getReceiptImageUrl(receipt)}
              alt={receipt.original_filename || "Uploaded receipt"}
              width={360}
              height={192}
              unoptimized
            />
            <figcaption className="space-y-1 px-3 py-2 text-xs text-slate-600">
              <p className="truncate font-medium text-slate-700">
                {receipt.original_filename || "Receipt image"}
              </p>
              <p>{formatDate(receipt.created_at)}</p>
            </figcaption>
          </figure>
        ))}
      </div>
    );
  }

  function getBrandTone(brand: string) {
    const tones = [
      "border-slate-300 bg-slate-100 text-slate-800",
      "border-emerald-300 bg-emerald-50 text-emerald-900",
      "border-sky-300 bg-sky-50 text-sky-900",
      "border-amber-300 bg-amber-50 text-amber-900",
      "border-rose-300 bg-rose-50 text-rose-900",
    ];
    const index = brand
      .split("")
      .reduce((total, character) => total + character.charCodeAt(0), 0);

    return tones[index % tones.length];
  }

  function getCardNumberDisplay(giftCard: GiftCard) {
    const cardNumber = giftCard.card_number_encrypted;

    if (!cardNumber) {
      return "Not verified";
    }

    if (revealedCardNumbers[giftCard.id]) {
      return cardNumber;
    }

    const normalizedCardNumber = cardNumber.replace(/\s/g, "");
    const lastFour = normalizedCardNumber.slice(-4);

    return lastFour ? `Card ending ${lastFour}` : "Card number saved";
  }

  function toggleCardNumber(giftCardId: number) {
    setRevealedCardNumbers((currentRevealedCardNumbers) => ({
      ...currentRevealedCardNumbers,
      [giftCardId]: !currentRevealedCardNumbers[giftCardId],
    }));
  }

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-8 text-slate-950 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-6xl space-y-8">
        <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-sm font-medium text-slate-500">
              Purchase Batch #{purchaseId}
            </p>
            <h1 className="mt-1 text-3xl font-semibold tracking-tight">
              Purchase Detail
            </h1>
          </div>

          <button
            className="h-10 rounded-md border border-slate-300 px-4 text-sm font-medium text-slate-700 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:text-slate-400"
            type="button"
            onClick={() => loadGiftCards()}
            disabled={isLoadingGiftCards}
          >
            {isLoadingGiftCards ? "Loading..." : "Refresh Gift Cards"}
          </button>
        </header>

        {error ? (
          <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-800">
            {error}
          </div>
        ) : null}

        <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-lg font-semibold">Purchase</h2>

          {isLoadingPurchase ? (
            <div className="mt-6 text-sm text-slate-500">
              Loading purchase details...
            </div>
          ) : purchase ? (
            <dl className="mt-5 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
              <div>
                <dt className="text-sm font-medium text-slate-500">Store</dt>
                <dd className="mt-1 text-base font-semibold">
                  {purchase.store_name}
                </dd>
              </div>

              <div>
                <dt className="text-sm font-medium text-slate-500">
                  Purchase Date
                </dt>
                <dd className="mt-1 text-base font-semibold">
                  {formatDate(purchase.purchase_date)}
                </dd>
              </div>

              <div>
                <dt className="text-sm font-medium text-slate-500">
                  Total Amount
                </dt>
                <dd className="mt-1 text-base font-semibold">
                  {formatAmount(purchase.total_amount)}
                </dd>
              </div>

              <div>
                <dt className="text-sm font-medium text-slate-500">Notes</dt>
                <dd className="mt-1 text-base text-slate-800">
                  {purchase.notes || "-"}
                </dd>
              </div>
            </dl>
          ) : (
            <div className="mt-6 text-sm text-slate-500">
              No purchase details found.
            </div>
          )}

          <div className="mt-6 border-t border-slate-200 pt-5">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h3 className="text-base font-semibold">Receipts</h3>
                <p className="mt-1 text-sm text-slate-500">
                  {receipts.length}{" "}
                  {receipts.length === 1 ? "receipt" : "receipts"}
                </p>
              </div>

              <label
                className={`inline-flex h-10 cursor-pointer items-center rounded-md border border-slate-300 px-4 text-sm font-medium transition ${
                  isUploadingReceipt
                    ? "cursor-not-allowed bg-slate-100 text-slate-400"
                    : "text-slate-700 hover:bg-slate-100"
                }`}
              >
                <span>
                  {isUploadingReceipt ? "Uploading..." : "Upload Receipt"}
                </span>
                <input
                  className="sr-only"
                  type="file"
                  accept="image/*"
                  disabled={isUploadingReceipt}
                  onChange={handleReceiptUpload}
                />
              </label>
            </div>

            {receiptsError ? (
              <p className="mt-3 text-sm font-medium text-red-700">
                {receiptsError}
              </p>
            ) : null}
            {receiptUploadError ? (
              <p className="mt-3 text-sm font-medium text-red-700">
                {receiptUploadError}
              </p>
            ) : null}

            <div className="mt-4">{renderReceipts()}</div>
          </div>
        </section>

        <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-lg font-semibold">Add Gift Card</h2>

          {formError ? (
            <div className="mt-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-800">
              {formError}
            </div>
          ) : null}

          <form
            className="mt-5 grid gap-5 md:grid-cols-3"
            onSubmit={handleSubmit}
          >
            <label className="space-y-2 text-sm font-medium text-slate-700">
              <span>Brand</span>
              <select
                className="h-11 w-full rounded-md border border-slate-300 px-3 text-slate-950 outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-200"
                value={form.brand}
                onChange={(event) =>
                  updateFormField("brand", event.target.value)
                }
                disabled={isLoadingCardBrands || Boolean(cardBrandsError)}
                required
              >
                <option value="">
                  {isLoadingCardBrands
                    ? "Loading brands..."
                    : cardBrands.length === 0
                      ? "No brands available"
                      : "Select a brand"}
                </option>
                {cardBrands.map((brand) => (
                  <option key={brand.id} value={brand.name}>
                    {brand.name}
                    {brand.active ? "" : " (Inactive)"}
                  </option>
                ))}
              </select>
              {cardBrandsError ? (
                <p className="text-xs font-medium text-red-700">
                  {cardBrandsError}
                </p>
              ) : null}
            </label>

            <label className="space-y-2 text-sm font-medium text-slate-700">
              <span>Face Value</span>
              <input
                className="h-11 w-full rounded-md border border-slate-300 px-3 text-slate-950 outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-200"
                type="number"
                min="0"
                step="0.01"
                value={form.face_value}
                onChange={(event) =>
                  updateFormField("face_value", event.target.value)
                }
                placeholder="25.00"
                required
              />
            </label>

            <label className="space-y-2 text-sm font-medium text-slate-700 md:row-span-2">
              <span>Notes</span>
              <textarea
                className="min-h-28 w-full rounded-md border border-slate-300 px-3 py-2 text-slate-950 outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-200"
                value={form.notes}
                onChange={(event) =>
                  updateFormField("notes", event.target.value)
                }
                placeholder="Optional notes"
              />
            </label>

            <div className="flex items-end">
              <button
                className="h-11 rounded-md bg-slate-900 px-5 text-sm font-semibold text-white transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:bg-slate-400"
                type="submit"
                disabled={
                  isSubmitting ||
                  isLoadingCardBrands ||
                  Boolean(cardBrandsError) ||
                  cardBrands.length === 0
                }
              >
                {isSubmitting ? "Adding..." : "Add Gift Card"}
              </button>
            </div>
          </form>
        </section>

        <section className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-200 px-6 py-4">
            <h2 className="text-lg font-semibold">Gift Cards</h2>
            <p className="mt-1 text-sm text-slate-500">
              {giftCards.length} {giftCards.length === 1 ? "card" : "cards"}
            </p>
          </div>

          {isLoadingGiftCards ? (
            <div className="px-6 py-12 text-center text-sm text-slate-500">
              Loading gift cards...
            </div>
          ) : giftCards.length === 0 ? (
            <div className="px-6 py-12 text-center text-sm text-slate-500">
              No gift cards found for this purchase.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-slate-200 text-sm">
                <thead className="bg-slate-100 text-left text-xs font-semibold uppercase tracking-wide text-slate-600">
                  <tr>
                    <th className="px-6 py-3">Brand</th>
                    <th className="px-6 py-3">Face Value</th>
                    <th className="px-6 py-3">Card Number</th>
                    <th className="px-6 py-3">Action</th>
                    <th className="px-6 py-3">Notes</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 bg-white">
                  {giftCards.map((giftCard) => (
                    <tr key={giftCard.id} className="hover:bg-slate-50">
                      <td className="px-6 py-4">
                        <div
                          className={`flex h-16 w-28 items-center justify-center rounded-md border px-3 text-center text-sm font-semibold ${getBrandTone(
                            giftCard.brand,
                          )}`}
                        >
                          {giftCard.brand}
                        </div>
                      </td>
                      <td className="whitespace-nowrap px-6 py-4 text-slate-700">
                        {formatAmount(giftCard.face_value)}
                      </td>
                      <td className="whitespace-nowrap px-6 py-4 text-slate-700">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-xs">
                            {getCardNumberDisplay(giftCard)}
                          </span>
                          {giftCard.card_number_encrypted ? (
                            <button
                              aria-label={
                                revealedCardNumbers[giftCard.id]
                                  ? "Hide card number"
                                  : "Show card number"
                              }
                              className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-slate-300 text-slate-600 transition hover:bg-slate-100 hover:text-slate-950"
                              onClick={() => toggleCardNumber(giftCard.id)}
                              type="button"
                            >
                              <EyeIcon hidden={revealedCardNumbers[giftCard.id]} />
                            </button>
                          ) : null}
                        </div>
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

function EyeIcon({ hidden }: { hidden?: boolean }) {
  return (
    <svg
      aria-hidden="true"
      className="h-4 w-4"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2"
      viewBox="0 0 24 24"
    >
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" />
      <circle cx="12" cy="12" r="3" />
      {hidden ? <path d="m4 4 16 16" /> : null}
    </svg>
  );
}
