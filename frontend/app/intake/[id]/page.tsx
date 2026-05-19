"use client";

import { ChangeEvent, FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";

import { API_BASE_URL } from "@/lib/api";

type PurchaseBatch = {
  id: number;
  store_name: string;
  purchase_date: string;
  total_amount: string | number;
  purchase_total_paid: string | number | null;
  notes: string | null;
};

type CardBrand = {
  id: number;
  name: string;
  active: boolean;
};

type GiftCard = {
  id: number;
  brand: string;
  face_value: string | number;
  acquisition_cost: string | number | null;
  status: string;
  notes: string | null;
};

type GiftCardForm = {
  brand: string;
  face_value: string;
  notes: string;
};

const initialForm: GiftCardForm = {
  brand: "",
  face_value: "",
  notes: "",
};

const cardImageAccept = "image/jpeg,image/png,.jpg,.jpeg,.png";

function shouldUseEnvironmentCapture() {
  if (typeof window === "undefined") {
    return false;
  }

  const userAgent = window.navigator.userAgent;

  return (
    /Android|iPhone|iPad|iPod/i.test(userAgent) ||
    (userAgent.includes("Macintosh") && window.navigator.maxTouchPoints > 1)
  );
}

export default function RapidCardIntakePage() {
  const params = useParams<{ id: string | string[] }>();
  const purchaseId = Array.isArray(params.id) ? params.id[0] : params.id;

  const [purchase, setPurchase] = useState<PurchaseBatch | null>(null);
  const [cardBrands, setCardBrands] = useState<CardBrand[]>([]);
  const [giftCards, setGiftCards] = useState<GiftCard[]>([]);
  const [form, setForm] = useState<GiftCardForm>(initialForm);
  const [cardImageFile, setCardImageFile] = useState<File | null>(null);
  const [fileInputKey, setFileInputKey] = useState(0);
  const [isLoadingPurchase, setIsLoadingPurchase] = useState(true);
  const [isLoadingBrands, setIsLoadingBrands] = useState(true);
  const [isLoadingGiftCards, setIsLoadingGiftCards] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [purchaseError, setPurchaseError] = useState<string | null>(null);
  const [brandsError, setBrandsError] = useState<string | null>(null);
  const [giftCardsError, setGiftCardsError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const useCameraCapture = shouldUseEnvironmentCapture();

  async function loadGiftCards(options: { showLoading?: boolean } = {}) {
    if (!purchaseId) {
      return;
    }

    if (options.showLoading ?? true) {
      setIsLoadingGiftCards(true);
    }

    setGiftCardsError(null);

    try {
      const response = await fetch(
        `${API_BASE_URL}/gift-cards/purchase/${purchaseId}`,
      );

      if (!response.ok) {
        throw new Error(`Failed to load gift cards (${response.status})`);
      }

      const data = (await response.json()) as GiftCard[];
      setGiftCards(data);
    } catch (err) {
      setGiftCardsError(
        err instanceof Error ? err.message : "Failed to load gift cards.",
      );
    } finally {
      setIsLoadingGiftCards(false);
    }
  }

  useEffect(() => {
    async function loadInitialData() {
      if (!purchaseId) {
        return;
      }

      setIsLoadingPurchase(true);
      setIsLoadingBrands(true);
      setIsLoadingGiftCards(true);
      setPurchaseError(null);
      setBrandsError(null);
      setGiftCardsError(null);

      const [purchaseResult, brandsResult, giftCardsResult] =
        await Promise.allSettled([
          (async () => {
            const response = await fetch(
              `${API_BASE_URL}/purchase-batches/${purchaseId}`,
            );

            if (!response.ok) {
              throw new Error(`Failed to load purchase (${response.status})`);
            }

            return (await response.json()) as PurchaseBatch;
          })(),
          (async () => {
            const response = await fetch(`${API_BASE_URL}/card-brands/`);

            if (!response.ok) {
              throw new Error(
                `Failed to load card brands (${response.status})`,
              );
            }

            return (await response.json()) as CardBrand[];
          })(),
          (async () => {
            const response = await fetch(
              `${API_BASE_URL}/gift-cards/purchase/${purchaseId}`,
            );

            if (!response.ok) {
              throw new Error(`Failed to load gift cards (${response.status})`);
            }

            return (await response.json()) as GiftCard[];
          })(),
        ]);

      if (purchaseResult.status === "fulfilled") {
        setPurchase(purchaseResult.value);
      } else {
        setPurchaseError(
          purchaseResult.reason instanceof Error
            ? purchaseResult.reason.message
            : "Failed to load purchase.",
        );
      }

      if (brandsResult.status === "fulfilled") {
        setCardBrands(brandsResult.value);
      } else {
        setBrandsError(
          brandsResult.reason instanceof Error
            ? brandsResult.reason.message
            : "Failed to load card brands.",
        );
      }

      if (giftCardsResult.status === "fulfilled") {
        setGiftCards(giftCardsResult.value);
      } else {
        setGiftCardsError(
          giftCardsResult.reason instanceof Error
            ? giftCardsResult.reason.message
            : "Failed to load gift cards.",
        );
      }

      setIsLoadingPurchase(false);
      setIsLoadingBrands(false);
      setIsLoadingGiftCards(false);
    }

    loadInitialData();
  }, [purchaseId]);

  function updateFormField(field: keyof GiftCardForm, value: string) {
    setForm((currentForm) => ({
      ...currentForm,
      [field]: value,
    }));
  }

  function handleCardImageChange(event: ChangeEvent<HTMLInputElement>) {
    setCardImageFile(event.target.files?.[0] ?? null);
  }

  async function uploadCardImage(giftCardId: number) {
    if (!cardImageFile) {
      throw new Error("Primary card image is required.");
    }

    const imageFormData = new FormData();
    imageFormData.append("gift_card_id", String(giftCardId));
    imageFormData.append("file", cardImageFile);

    const response = await fetch(`${API_BASE_URL}/card-images/upload`, {
      method: "POST",
      body: imageFormData,
    });

    if (!response.ok) {
      throw new Error(
        `Gift card created, but image upload failed (${response.status})`,
      );
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitError(null);
    setSuccessMessage(null);
    setIsSubmitting(true);

    try {
      if (!cardImageFile) {
        throw new Error("Primary card image is required.");
      }

      const response = await fetch(`${API_BASE_URL}/gift-cards/`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          purchase_batch_id: Number(purchaseId),
          brand: form.brand.trim(),
          face_value: form.face_value,
          acquisition_cost: form.face_value,
          notes: form.notes.trim() || null,
        }),
      });

      if (!response.ok) {
        throw new Error(`Failed to create gift card (${response.status})`);
      }

      const giftCard = (await response.json()) as GiftCard;
      await uploadCardImage(giftCard.id);

      setForm((currentForm) => ({
        ...currentForm,
        notes: "",
      }));
      setCardImageFile(null);
      setFileInputKey((currentKey) => currentKey + 1);
      setSuccessMessage("Gift card saved.");
      await loadGiftCards({ showLoading: false });
    } catch (err) {
      setSubmitError(
        err instanceof Error ? err.message : "Failed to save gift card.",
      );
    } finally {
      setIsSubmitting(false);
    }
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

  const totalFaceValueAdded = giftCards.reduce(
    (total, giftCard) => total + (Number(giftCard.face_value) || 0),
    0,
  );
  const totalAcquisitionCost = giftCards.reduce(
    (total, giftCard) => total + (Number(giftCard.acquisition_cost) || 0),
    0,
  );

  const isSubmitDisabled =
    isSubmitting ||
    isLoadingBrands ||
    Boolean(brandsError) ||
    cardBrands.length === 0;

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-6 text-slate-950">
      <div className="mx-auto flex min-h-[calc(100vh-3rem)] max-w-md flex-col">
        <header className="pb-5">
          <p className="text-sm font-medium text-slate-500">Card Intake</p>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight">
            Add Gift Cards
          </h1>

          <div className="mt-4 grid grid-cols-2 gap-2">
            <Link
              className="flex h-11 items-center justify-center rounded-md border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-700 shadow-sm transition hover:bg-slate-100 hover:text-slate-950"
              href={`/purchases/${purchaseId}`}
            >
              Back to Purchase
            </Link>
            <Link
              className="flex h-11 items-center justify-center rounded-md bg-slate-900 px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-slate-700"
              href={`/purchases/${purchaseId}`}
            >
              Finish Intake
            </Link>
          </div>

          <div className="mt-4 rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
            {isLoadingPurchase ? (
              <p className="text-sm text-slate-500">Loading purchase...</p>
            ) : purchaseError ? (
              <p className="text-sm font-medium text-red-700">
                {purchaseError}
              </p>
            ) : purchase ? (
              <div className="space-y-1 text-sm">
                <p className="font-semibold">{purchase.store_name}</p>
                <p className="text-slate-600">
                  Purchase #{purchase.id} ·{" "}
                  {formatAmount(purchase.total_amount)}
                </p>
              </div>
            ) : (
              <p className="text-sm text-slate-500">Purchase not found.</p>
            )}
          </div>

          <section className="mt-4 rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
            <h2 className="text-base font-semibold">Session Summary</h2>
            <div className="mt-3 grid grid-cols-2 gap-3 text-sm">
              <div className="rounded-md bg-slate-50 p-3">
                <p className="text-xs font-medium text-slate-500">Cards Added</p>
                <p className="mt-1 text-xl font-semibold">{giftCards.length}</p>
              </div>
              <div className="rounded-md bg-slate-50 p-3">
                <p className="text-xs font-medium text-slate-500">Face Value</p>
                <p className="mt-1 text-xl font-semibold">
                  {formatAmount(totalFaceValueAdded)}
                </p>
              </div>
              <div className="rounded-md bg-slate-50 p-3">
                <p className="text-xs font-medium text-slate-500">Total Paid</p>
                <p className="mt-1 text-xl font-semibold">
                  {purchase?.purchase_total_paid
                    ? formatAmount(purchase.purchase_total_paid)
                    : ""}
                </p>
              </div>
              <div className="rounded-md bg-slate-50 p-3">
                <p className="text-xs font-medium text-slate-500">Card Cost</p>
                <p className="mt-1 text-xl font-semibold">
                  {totalAcquisitionCost > 0
                    ? formatAmount(totalAcquisitionCost)
                    : ""}
                </p>
              </div>
            </div>
          </section>
        </header>

        <form className="flex flex-1 flex-col" onSubmit={handleSubmit}>
          <section className="space-y-5 rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
            <label className="block space-y-2 text-sm font-medium text-slate-700">
              <span>Card Brand</span>
              <select
                className="h-12 w-full rounded-md border border-slate-300 px-3 text-base text-slate-950 outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-200"
                value={form.brand}
                onChange={(event) =>
                  updateFormField("brand", event.target.value)
                }
                disabled={Boolean(brandsError)}
                required
              >
                <option value="">
                  {isLoadingBrands
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
              {brandsError ? (
                <p className="text-sm font-medium text-red-700">
                  {brandsError}
                </p>
              ) : null}
            </label>

            <label className="block space-y-2 text-sm font-medium text-slate-700">
              <span>Face Value</span>
              <input
                className="h-12 w-full rounded-md border border-slate-300 px-3 text-base text-slate-950 outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-200"
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

            <label className="block space-y-2 text-sm font-medium text-slate-700">
              <span>Primary Card Image</span>
              <div className="flex min-h-24 cursor-pointer flex-col items-center justify-center rounded-md border border-dashed border-slate-300 bg-slate-50 px-4 py-5 text-center transition hover:bg-slate-100">
                <span className="text-base font-semibold text-slate-900">
                  Take Photo / Upload Card Image
                </span>
                <span className="mt-1 text-sm text-slate-500">
                  Camera opens on supported mobile devices.
                </span>
              </div>
              <input
                className="sr-only"
                key={fileInputKey}
                type="file"
                accept={cardImageAccept}
                capture={useCameraCapture ? "environment" : undefined}
                onChange={handleCardImageChange}
                required
              />
              {cardImageFile ? (
                <p className="text-sm font-medium text-slate-600">
                  Selected: {cardImageFile.name}
                </p>
              ) : null}
            </label>

            <label className="block space-y-2 text-sm font-medium text-slate-700">
              <span>Notes</span>
              <textarea
                className="min-h-24 w-full rounded-md border border-slate-300 px-3 py-3 text-base text-slate-950 outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-200"
                value={form.notes}
                onChange={(event) =>
                  updateFormField("notes", event.target.value)
                }
                placeholder="Optional"
              />
            </label>
          </section>

          {successMessage ? (
            <div className="mt-4 rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-800">
              {successMessage}
            </div>
          ) : null}

          {submitError ? (
            <div className="mt-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-800">
              {submitError}
            </div>
          ) : null}

          <section className="mt-5 rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="text-lg font-semibold">Added Cards</h2>
            <p className="mt-1 text-sm text-slate-500">
              {giftCards.length} {giftCards.length === 1 ? "card" : "cards"}
            </p>

            {giftCardsError ? (
              <p className="mt-3 text-sm font-medium text-red-700">
                {giftCardsError}
              </p>
            ) : null}

            {isLoadingGiftCards ? (
              <p className="mt-4 text-sm text-slate-500">Loading cards...</p>
            ) : giftCards.length === 0 ? (
              <p className="mt-4 text-sm text-slate-500">
                No gift cards added yet.
              </p>
            ) : (
              <ul className="mt-4 divide-y divide-slate-200">
                {giftCards.map((giftCard) => (
                  <li
                    className="flex items-center justify-between gap-4 py-3"
                    key={giftCard.id}
                  >
                    <div className="min-w-0">
                      <p className="font-medium">{giftCard.brand}</p>
                      {giftCard.notes ? (
                        <p className="truncate text-sm text-slate-500">
                          {giftCard.notes}
                        </p>
                      ) : null}
                    </div>
                    <div className="flex shrink-0 items-center gap-3">
                      <p className="text-sm font-semibold">
                        {formatAmount(giftCard.face_value)}
                      </p>
                      <Link
                        className="flex h-9 items-center rounded-md border border-slate-300 px-3 text-xs font-semibold text-slate-700 transition hover:bg-slate-100 hover:text-slate-950"
                        href={`/gift-cards/${giftCard.id}/verify`}
                      >
                        Verify
                      </Link>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <div className="sticky bottom-0 mt-auto bg-slate-50 py-4">
            <button
              className="h-12 w-full rounded-md bg-slate-900 px-5 text-base font-semibold text-white shadow-sm transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:bg-slate-400"
              type="submit"
              disabled={isSubmitDisabled}
            >
              {isSubmitting ? "Saving..." : "Save Gift Card"}
            </button>
          </div>
        </form>
      </div>
    </main>
  );
}
