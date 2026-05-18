"use client";

import {
  ChangeEvent,
  FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import Image from "next/image";
import { useParams } from "next/navigation";

type PurchaseBatch = {
  id: number;
  store_name: string;
  purchase_date: string;
  total_amount: string | number;
  notes: string | null;
  created_at?: string;
  updated_at?: string;
};

type GiftCard = {
  id: number;
  brand: string;
  face_value: string | number;
  status: string;
  notes: string | null;
  purchase_batch_id?: number;
  created_at?: string;
  updated_at?: string;
};

type GiftCardForm = {
  brand: string;
  face_value: string;
  notes: string;
};

type CardBrand = {
  id: number;
  name: string;
  active: boolean;
};

type CardImage = {
  id: number;
  gift_card_id: number;
  image_type: string;
  original_image_url: string;
  processed_image_url: string | null;
  created_at?: string;
};

const emptyGiftCardForm: GiftCardForm = {
  brand: "",
  face_value: "",
  notes: "",
};

const API_BASE_URL = "http://localhost:8000";

export default function PurchaseDetailPage() {
  const params = useParams<{ id: string | string[] }>();
  const purchaseId = useMemo(() => {
    const rawId = params.id;
    return Array.isArray(rawId) ? rawId[0] : rawId;
  }, [params.id]);

  const [purchase, setPurchase] = useState<PurchaseBatch | null>(null);
  const [giftCards, setGiftCards] = useState<GiftCard[]>([]);
  const [cardBrands, setCardBrands] = useState<CardBrand[]>([]);
  const [primaryImagesByCardId, setPrimaryImagesByCardId] = useState<
    Record<number, CardImage | null>
  >({});
  const [imageLoadErrorsByCardId, setImageLoadErrorsByCardId] = useState<
    Record<number, boolean>
  >({});
  const [isUploadingImageByCardId, setIsUploadingImageByCardId] = useState<
    Record<number, boolean>
  >({});
  const [uploadErrorsByCardId, setUploadErrorsByCardId] = useState<
    Record<number, string | null>
  >({});
  const [form, setForm] = useState<GiftCardForm>(emptyGiftCardForm);
  const [isLoadingPurchase, setIsLoadingPurchase] = useState(true);
  const [isLoadingGiftCards, setIsLoadingGiftCards] = useState(true);
  const [isLoadingCardBrands, setIsLoadingCardBrands] = useState(true);
  const [isLoadingCardImages, setIsLoadingCardImages] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [cardBrandsError, setCardBrandsError] = useState<string | null>(null);
  const [cardImagesError, setCardImagesError] = useState<string | null>(null);

  const purchaseUrl = `${API_BASE_URL}/purchase-batches/${purchaseId}`;
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

  const fetchPrimaryImageForCard = useCallback(async (giftCardId: number) => {
    try {
      const response = await fetch(
        `${API_BASE_URL}/card-images/gift-card/${giftCardId}`,
      );

      if (!response.ok) {
        throw new Error(`Failed to load card images (${response.status})`);
      }

      const images = (await response.json()) as CardImage[];
      const primaryImage =
        images.find((image) => image.image_type === "primary") ?? null;

      return { image: primaryImage, failed: false };
    } catch {
      return { image: null, failed: true };
    }
  }, []);

  const loadPrimaryImageForCard = useCallback(
    async (giftCardId: number) => {
      const result = await fetchPrimaryImageForCard(giftCardId);

      setPrimaryImagesByCardId((currentImages) => ({
        ...currentImages,
        [giftCardId]: result.image,
      }));

      if (!result.failed) {
        setImageLoadErrorsByCardId((currentErrors) => ({
          ...currentErrors,
          [giftCardId]: false,
        }));
      }

      return result.failed;
    },
    [fetchPrimaryImageForCard],
  );

  useEffect(() => {
    let isMounted = true;

    async function loadPrimaryImages() {
      if (giftCards.length === 0) {
        setPrimaryImagesByCardId({});
        setImageLoadErrorsByCardId({});
        setCardImagesError(null);
        setIsLoadingCardImages(false);
        return;
      }

      setIsLoadingCardImages(true);
      setCardImagesError(null);
      setImageLoadErrorsByCardId({});

      try {
        const imageResults = await Promise.all(
          giftCards.map(async (giftCard) => {
            const result = await fetchPrimaryImageForCard(giftCard.id);
            return [giftCard.id, result.image, result.failed] as const;
          }),
        );

        if (isMounted) {
          setPrimaryImagesByCardId(
            Object.fromEntries(
              imageResults.map(([giftCardId, image]) => [giftCardId, image]),
            ),
          );
          setCardImagesError(
            imageResults.some(([, , failed]) => failed)
              ? "Some card images could not be loaded."
              : null,
          );
        }
      } catch (err) {
        if (isMounted) {
          setCardImagesError(
            err instanceof Error
              ? err.message
              : "Failed to load card images.",
          );
          setPrimaryImagesByCardId({});
        }
      } finally {
        if (isMounted) {
          setIsLoadingCardImages(false);
        }
      }
    }

    loadPrimaryImages();

    return () => {
      isMounted = false;
    };
  }, [fetchPrimaryImageForCard, giftCards]);

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

  async function handleImageUpload(
    giftCardId: number,
    event: ChangeEvent<HTMLInputElement>,
  ) {
    const file = event.target.files?.[0];

    if (!file) {
      return;
    }

    setIsUploadingImageByCardId((currentUploads) => ({
      ...currentUploads,
      [giftCardId]: true,
    }));
    setUploadErrorsByCardId((currentErrors) => ({
      ...currentErrors,
      [giftCardId]: null,
    }));

    try {
      const formData = new FormData();
      formData.append("gift_card_id", String(giftCardId));
      formData.append("file", file);

      const response = await fetch(`${API_BASE_URL}/card-images/upload`, {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        throw new Error(`Failed to upload image (${response.status})`);
      }

      const imageFailed = await loadPrimaryImageForCard(giftCardId);

      if (imageFailed) {
        throw new Error("Image uploaded, but the thumbnail could not be loaded.");
      }
    } catch (err) {
      setUploadErrorsByCardId((currentErrors) => ({
        ...currentErrors,
        [giftCardId]:
          err instanceof Error ? err.message : "Failed to upload image.",
      }));
    } finally {
      event.target.value = "";
      setIsUploadingImageByCardId((currentUploads) => ({
        ...currentUploads,
        [giftCardId]: false,
      }));
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

  function getImageUrl(image: CardImage) {
    const rawUrl = image.processed_image_url ?? image.original_image_url;

    if (rawUrl.startsWith("http://") || rawUrl.startsWith("https://")) {
      return rawUrl;
    }

    return `${API_BASE_URL}/${rawUrl.replace(/^\/+/, "")}`;
  }

  function renderGiftCardImage(giftCard: GiftCard) {
    const primaryImage = primaryImagesByCardId[giftCard.id];
    const isUploadingImage = Boolean(isUploadingImageByCardId[giftCard.id]);
    const uploadError = uploadErrorsByCardId[giftCard.id];

    return (
      <div className="space-y-2">
        <div className="flex h-16 w-24 items-center justify-center rounded-md border border-slate-200 bg-slate-100 text-center">
          {isLoadingCardImages && primaryImage === undefined ? (
            <span className="px-2 text-xs text-slate-500">Loading image...</span>
          ) : primaryImage === null ||
            primaryImage === undefined ||
            imageLoadErrorsByCardId[giftCard.id] ? (
            <span className="px-2 text-xs text-slate-500">
              No image uploaded
            </span>
          ) : (
            <Image
              className="h-16 w-24 rounded-md object-cover"
              src={getImageUrl(primaryImage)}
              alt={`${giftCard.brand} gift card`}
              width={96}
              height={64}
              unoptimized
              onError={() => {
                setImageLoadErrorsByCardId((currentErrors) => ({
                  ...currentErrors,
                  [giftCard.id]: true,
                }));
              }}
            />
          )}
        </div>

        <label
          className={`inline-flex h-8 cursor-pointer items-center rounded-md border border-slate-300 px-3 text-xs font-medium transition ${
            isUploadingImage
              ? "cursor-not-allowed bg-slate-100 text-slate-400"
              : "text-slate-700 hover:bg-slate-100"
          }`}
        >
          <span>{isUploadingImage ? "Uploading..." : "Upload Image"}</span>
          <input
            className="sr-only"
            type="file"
            accept="image/*"
            disabled={isUploadingImage}
            onChange={(event) => handleImageUpload(giftCard.id, event)}
          />
        </label>

        {uploadError ? (
          <p className="max-w-32 text-xs font-medium text-red-700">
            {uploadError}
          </p>
        ) : null}
      </div>
    );
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
            {cardImagesError ? (
              <p className="mt-1 text-sm text-amber-700">{cardImagesError}</p>
            ) : null}
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
                    <th className="px-6 py-3">Image</th>
                    <th className="px-6 py-3">Brand</th>
                    <th className="px-6 py-3">Face Value</th>
                    <th className="px-6 py-3">Status</th>
                    <th className="px-6 py-3">Notes</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 bg-white">
                  {giftCards.map((giftCard) => (
                    <tr key={giftCard.id} className="hover:bg-slate-50">
                      <td className="w-32 px-6 py-4">
                        {renderGiftCardImage(giftCard)}
                      </td>
                      <td className="whitespace-nowrap px-6 py-4 font-medium">
                        {giftCard.brand}
                      </td>
                      <td className="whitespace-nowrap px-6 py-4 text-slate-700">
                        {formatAmount(giftCard.face_value)}
                      </td>
                      <td className="whitespace-nowrap px-6 py-4 text-slate-700">
                        {giftCard.status}
                      </td>
                      <td className="max-w-md px-6 py-4 text-slate-700">
                        {giftCard.notes || "-"}
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
