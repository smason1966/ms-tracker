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
  credit_card_id: number | null;
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
  card_source?: string | null;
  face_value: string | number;
  acquisition_cost: string | number | null;
  status: string;
  ocr_status?: string | null;
  notes: string | null;
};

type GiftCardForm = {
  card_source: "physical" | "digital";
  brand: string;
  face_value: string;
  acquisition_cost: string;
  card_number: string;
  pin: string;
  redemption_code: string;
  notes: string;
  digital_source_notes: string;
};

const initialForm: GiftCardForm = {
  card_source: "physical",
  brand: "",
  face_value: "",
  acquisition_cost: "",
  card_number: "",
  pin: "",
  redemption_code: "",
  notes: "",
  digital_source_notes: "",
};

type Store = {
  id: number;
  name: string;
  active: boolean;
};

type RewardRule = {
  id: number;
  store_id: number | null;
  rule_type?: string | null;
  reward_type?: string | null;
  value: string | number | null;
  priority: number | null;
  active: boolean;
  effective_start_date: string | null;
  effective_end_date: string | null;
};

type CreditCard = {
  id: number;
  nickname: string;
  last_four: string | null;
  is_active: boolean;
  reward_rules?: RewardRule[];
};

type InstantDiscountPreview = {
  percent: number;
  discountAmount: number;
  allocatedCost: number;
};

const cardImageAccept =
  "image/jpeg,image/png,image/webp,image/heic,.jpg,.jpeg,.png,.webp,.heic";
const digitalAttachmentAccept =
  "application/pdf,image/jpeg,image/png,image/webp,image/heic,.pdf,.jpg,.jpeg,.png,.webp,.heic";

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

function roundCurrency(value: number) {
  return Math.round(value * 100) / 100;
}

function formatCurrencyInput(value: number) {
  return roundCurrency(value).toFixed(2);
}

function isInstantDiscountRule(rule: RewardRule) {
  const ruleType = rule.rule_type ?? rule.reward_type;

  return (
    rule.active &&
    (ruleType === "instant_discount_percent" || ruleType === "purchase_discount")
  );
}

function isRuleEffective(rule: RewardRule, purchaseDate: string) {
  const purchaseDay = purchaseDate.slice(0, 10);

  if (
    rule.effective_start_date &&
    rule.effective_start_date.slice(0, 10) > purchaseDay
  ) {
    return false;
  }

  if (
    rule.effective_end_date &&
    rule.effective_end_date.slice(0, 10) < purchaseDay
  ) {
    return false;
  }

  return true;
}

export default function RapidCardIntakePage() {
  const params = useParams<{ id: string | string[] }>();
  const purchaseId = Array.isArray(params.id) ? params.id[0] : params.id;

  const [purchase, setPurchase] = useState<PurchaseBatch | null>(null);
  const [cardBrands, setCardBrands] = useState<CardBrand[]>([]);
  const [giftCards, setGiftCards] = useState<GiftCard[]>([]);
  const [stores, setStores] = useState<Store[]>([]);
  const [creditCards, setCreditCards] = useState<CreditCard[]>([]);
  const [form, setForm] = useState<GiftCardForm>(initialForm);
  const [cardImageFile, setCardImageFile] = useState<File | null>(null);
  const [fileInputKey, setFileInputKey] = useState(0);
  const [isCostManuallyEdited, setIsCostManuallyEdited] = useState(false);
  const [isLoadingPurchase, setIsLoadingPurchase] = useState(true);
  const [isLoadingBrands, setIsLoadingBrands] = useState(true);
  const [isLoadingGiftCards, setIsLoadingGiftCards] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [purchaseError, setPurchaseError] = useState<string | null>(null);
  const [brandsError, setBrandsError] = useState<string | null>(null);
  const [giftCardsError, setGiftCardsError] = useState<string | null>(null);
  const [lookupsError, setLookupsError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [lastSavedGiftCardId, setLastSavedGiftCardId] = useState<number | null>(null);
  const [cardUploadStatuses, setCardUploadStatuses] = useState<
    Record<number, string>
  >({});
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
      setLookupsError(null);

      const [purchaseResult, brandsResult, giftCardsResult, storesResult, cardsResult] =
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
          (async () => {
            const response = await fetch(`${API_BASE_URL}/stores/`);

            if (!response.ok) {
              throw new Error(`Failed to load stores (${response.status})`);
            }

            return (await response.json()) as Store[];
          })(),
          (async () => {
            const response = await fetch(`${API_BASE_URL}/credit-cards`);

            if (!response.ok) {
              throw new Error(`Failed to load funding cards (${response.status})`);
            }

            return (await response.json()) as CreditCard[];
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

      if (storesResult.status === "fulfilled") {
        setStores(storesResult.value);
      } else {
        setLookupsError(
          storesResult.reason instanceof Error
            ? storesResult.reason.message
            : "Failed to load store lookup data.",
        );
      }

      if (cardsResult.status === "fulfilled") {
        setCreditCards(cardsResult.value.filter((card) => card.is_active));
      } else {
        setLookupsError(
          cardsResult.reason instanceof Error
            ? cardsResult.reason.message
            : "Failed to load funding card lookup data.",
        );
      }

      setIsLoadingPurchase(false);
      setIsLoadingBrands(false);
      setIsLoadingGiftCards(false);
    }

    loadInitialData();
  }, [purchaseId]);

  function updateFormField(field: keyof GiftCardForm, value: string) {
    setLastSavedGiftCardId(null);
    setForm((currentForm) => ({
      ...currentForm,
      [field]: value,
    }));
  }

  function getInstantDiscountPreview(faceValue: string): InstantDiscountPreview | null {
    const amount = Number(faceValue);

    if (!purchase || Number.isNaN(amount) || amount <= 0) {
      return null;
    }

    const selectedStore = stores.find(
      (store) => store.name.toLowerCase() === purchase.store_name.toLowerCase(),
    );
    const selectedCard = creditCards.find(
      (card) => card.id === purchase.credit_card_id,
    );

    if (!selectedStore || !selectedCard) {
      return null;
    }

    const matchingRule = (selectedCard.reward_rules ?? [])
      .filter(
        (rule) =>
          isInstantDiscountRule(rule) &&
          rule.store_id === selectedStore.id &&
          isRuleEffective(rule, purchase.purchase_date),
      )
      .sort((left, right) => (left.priority ?? 100) - (right.priority ?? 100))[0];
    const percent = Number(matchingRule?.value);

    if (!matchingRule || Number.isNaN(percent) || percent <= 0 || percent >= 100) {
      return null;
    }

    const discountAmount = roundCurrency((amount * percent) / 100);

    return {
      percent,
      discountAmount,
      allocatedCost: roundCurrency(amount - discountAmount),
    };
  }

  function handleFaceValueChange(value: string) {
    setLastSavedGiftCardId(null);
    setForm((currentForm) => {
      const preview = getInstantDiscountPreview(value);

      if (isCostManuallyEdited) {
        return {
          ...currentForm,
          face_value: value,
        };
      }

      return {
        ...currentForm,
        face_value: value,
        acquisition_cost: preview
          ? formatCurrencyInput(preview.allocatedCost)
          : value,
      };
    });
  }

  function handleAcquisitionCostChange(value: string) {
    setIsCostManuallyEdited(true);
    updateFormField("acquisition_cost", value);
  }

  function useCalculatedCost() {
    if (!instantDiscountPreview) {
      return;
    }

    setIsCostManuallyEdited(false);
    updateFormField(
      "acquisition_cost",
      formatCurrencyInput(instantDiscountPreview.allocatedCost),
    );
  }

  function handleCardImageChange(event: ChangeEvent<HTMLInputElement>) {
    setLastSavedGiftCardId(null);
    setCardImageFile(event.target.files?.[0] ?? null);
  }

  function startNextGiftCard() {
    setForm((currentForm) => ({
      ...initialForm,
      card_source: currentForm.card_source,
      brand: currentForm.brand,
    }));
    setCardImageFile(null);
    setFileInputKey((currentKey) => currentKey + 1);
    setIsCostManuallyEdited(false);
    setSubmitError(null);
    setSuccessMessage(null);
    setLastSavedGiftCardId(null);
  }

  async function uploadCardImage(
    giftCardId: number,
    imageFile: File,
    options: {
      imageType?: string;
      attachmentType?: string;
      runOcr?: boolean;
    } = {},
  ) {
    const imageFormData = new FormData();
    imageFormData.append("gift_card_id", String(giftCardId));
    imageFormData.append("file", imageFile);
    imageFormData.append("image_type", options.imageType ?? "primary");
    imageFormData.append("attachment_type", options.attachmentType ?? "card_image");
    imageFormData.append("run_ocr", String(options.runOcr ?? true));

    const response = await fetch(`${API_BASE_URL}/card-images/upload`, {
      method: "POST",
      body: imageFormData,
    });

    if (!response.ok) {
      const responseBody = await response.text();
      throw new Error(
        `Image upload failed (${response.status}): ${responseBody}`,
      );
    }

    return (await response.json()) as { message?: string; ocr_status?: string };
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (lastSavedGiftCardId !== null) {
      return;
    }

    setSubmitError(null);
    setSuccessMessage(null);
    setIsSubmitting(true);

    try {
      const selectedImageFile = cardImageFile;
      const idempotencyKey =
        typeof crypto !== "undefined" && "randomUUID" in crypto
          ? crypto.randomUUID()
          : `${Date.now()}-${Math.random()}`;
      console.info("Saving intake gift card", {
        purchaseId,
        brand: form.brand.trim(),
        cardSource: form.card_source,
        hasImage: Boolean(selectedImageFile),
        idempotencyKey,
      });
      const response = await fetch(`${API_BASE_URL}/gift-cards/`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          purchase_batch_id: Number(purchaseId),
          brand: form.brand.trim(),
          card_source: form.card_source,
          face_value: form.face_value,
          acquisition_cost: form.acquisition_cost || form.face_value,
          confirmed_card_number:
            form.card_source === "digital" && form.redemption_code.trim() === ""
              ? form.card_number.trim() || null
              : null,
          confirmed_pin:
            form.card_source === "digital" ? form.pin.trim() || null : null,
          confirmed_redemption_code:
            form.card_source === "digital"
              ? form.redemption_code.trim() || null
              : null,
          confirmed_source:
            form.card_source === "digital" &&
            (form.card_number.trim() || form.redemption_code.trim())
              ? "manual_digital"
              : null,
          notes: form.notes.trim() || null,
          digital_source_notes:
            form.card_source === "digital"
              ? form.digital_source_notes.trim() || null
              : null,
          idempotency_key: idempotencyKey,
        }),
      });

      if (!response.ok) {
        const responseBody = await response.text();
        throw new Error(
          `Failed to create gift card (${response.status}): ${responseBody}`,
        );
      }

      const giftCard = (await response.json()) as GiftCard;
      setLastSavedGiftCardId(giftCard.id);

      setForm((currentForm) => ({
        ...currentForm,
        card_number: "",
        pin: "",
        redemption_code: "",
        notes: "",
        digital_source_notes: "",
      }));
      setCardImageFile(null);
      setFileInputKey((currentKey) => currentKey + 1);
      setSuccessMessage(
        selectedImageFile
          ? form.card_source === "digital"
            ? `Digital gift card #${giftCard.id} saved. Attachment upload started; OCR was not queued.`
            : `Gift card #${giftCard.id} saved. Image upload started — OCR will run in the background.`
          : `Gift card #${giftCard.id} saved.`,
      );
      await loadGiftCards({ showLoading: false });

      if (selectedImageFile) {
        setCardUploadStatuses((currentStatuses) => ({
          ...currentStatuses,
          [giftCard.id]: "Uploading image...",
        }));
        const isDigital = form.card_source === "digital";
        void uploadCardImage(giftCard.id, selectedImageFile, {
          imageType: isDigital ? "digital_attachment" : "primary",
          attachmentType: isDigital
            ? selectedImageFile.name.toLowerCase().endsWith(".pdf")
              ? "digital_pdf"
              : "digital_image"
            : "card_image",
          runOcr: !isDigital,
        })
          .then((result) => {
            setCardUploadStatuses((currentStatuses) => ({
              ...currentStatuses,
              [giftCard.id]:
                result?.message ??
                (isDigital
                  ? "Attachment saved. OCR was not queued."
                  : "Image saved — OCR queued."),
            }));
            void loadGiftCards({ showLoading: false });
          })
          .catch((error) => {
            console.error("Intake card image upload failed", {
              purchaseId,
              giftCardId: giftCard.id,
              error,
            });
            setCardUploadStatuses((currentStatuses) => ({
              ...currentStatuses,
              [giftCard.id]:
                error instanceof Error
                  ? error.message
                  : "Image upload failed.",
            }));
          });
      }
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
  const instantDiscountPreview = getInstantDiscountPreview(form.face_value);

  const isSubmitDisabled =
    isSubmitting ||
    lastSavedGiftCardId !== null ||
    isLoadingBrands ||
    Boolean(brandsError) ||
    cardBrands.length === 0 ||
    !form.acquisition_cost.trim();

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-6 pb-28 text-slate-950 sm:pb-6">
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
            {giftCards.length > 0 ? (
              <Link
                className="flex h-11 items-center justify-center rounded-md bg-slate-900 px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-slate-700"
                href={`/purchases/${purchaseId}`}
              >
                Finish Intake
              </Link>
            ) : null}
          </div>

        </header>

        <form className="flex flex-1 flex-col" onSubmit={handleSubmit}>
          <section className="space-y-5 rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
            <fieldset className="space-y-2 text-sm font-medium text-slate-700">
              <legend>Card Source</legend>
              <div className="grid grid-cols-2 gap-2">
                {[
                  ["physical", "Physical card"],
                  ["digital", "Digital card"],
                ].map(([value, label]) => (
                  <label
                    className={`flex min-h-11 cursor-pointer items-center justify-center rounded-md border px-3 text-center text-sm font-semibold transition ${
                      form.card_source === value
                        ? "border-slate-950 bg-slate-950 text-white"
                        : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
                    }`}
                    key={value}
                  >
                    <input
                      checked={form.card_source === value}
                      className="sr-only"
                      name="card_source"
                      onChange={() =>
                        updateFormField(
                          "card_source",
                          value as GiftCardForm["card_source"],
                        )
                      }
                      type="radio"
                    />
                    {label}
                  </label>
                ))}
              </div>
            </fieldset>

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
                onChange={(event) => handleFaceValueChange(event.target.value)}
                placeholder="25.00"
                required
              />
            </label>

            <label className="block space-y-2 text-sm font-medium text-slate-700">
              <span>Gift Card Cost / Allocated Cost</span>
              <input
                className="h-12 w-full rounded-md border border-slate-300 px-3 text-base text-slate-950 outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-200"
                type="number"
                min="0"
                step="0.01"
                value={form.acquisition_cost}
                onChange={(event) =>
                  handleAcquisitionCostChange(event.target.value)
                }
                placeholder="25.00"
                required
              />
              {isCostManuallyEdited ? (
                <span className="block rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-medium text-amber-800">
                  Manual cost override:{" "}
                  {form.acquisition_cost.trim()
                    ? formatAmount(form.acquisition_cost)
                    : ""}
                  {instantDiscountPreview ? (
                    <>
                      <br />
                      Calculated instant-discount cost would be{" "}
                      {formatAmount(instantDiscountPreview.allocatedCost)}.
                      <button
                        className="ml-2 cursor-pointer text-sm font-semibold underline"
                        onClick={useCalculatedCost}
                        type="button"
                      >
                        Use calculated cost
                      </button>
                    </>
                  ) : null}
                </span>
              ) : instantDiscountPreview ? (
                <span className="block rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-800">
                  Instant discount: {instantDiscountPreview.percent}% ={" "}
                  {formatAmount(instantDiscountPreview.discountAmount)}
                  <br />
                  Gift card cost:{" "}
                  {formatAmount(instantDiscountPreview.allocatedCost)}
                </span>
              ) : (
                <span className="block text-sm text-slate-500">
                  Defaults to face value. Edit for store sale prices, such as a
                  $100 card sold for $79.99.
                </span>
              )}
            </label>

            {form.card_source === "digital" ? (
              <section className="space-y-4 rounded-md border border-cyan-200 bg-cyan-50 p-4">
                <div>
                  <h2 className="text-base font-semibold text-slate-950">
                    Digital/manual credential entry
                  </h2>
                  <p className="mt-1 text-sm text-slate-600">
                    Paste the credentials from the PDF/email. OCR will not run unless
                    requested later from verification.
                  </p>
                </div>
                <label className="block space-y-2 text-sm font-medium text-slate-700">
                  <span>Card Number</span>
                  <input
                    className="h-12 w-full rounded-md border border-slate-300 px-3 text-base text-slate-950 outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-200"
                    onChange={(event) =>
                      updateFormField("card_number", event.target.value)
                    }
                    type="text"
                    value={form.card_number}
                  />
                </label>
                <label className="block space-y-2 text-sm font-medium text-slate-700">
                  <span>PIN</span>
                  <input
                    className="h-12 w-full rounded-md border border-slate-300 px-3 text-base text-slate-950 outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-200"
                    onChange={(event) =>
                      updateFormField("pin", event.target.value)
                    }
                    type="text"
                    value={form.pin}
                  />
                </label>
                <label className="block space-y-2 text-sm font-medium text-slate-700">
                  <span>Redemption Code</span>
                  <input
                    className="h-12 w-full rounded-md border border-slate-300 px-3 text-base text-slate-950 outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-200"
                    onChange={(event) =>
                      updateFormField("redemption_code", event.target.value)
                    }
                    type="text"
                    value={form.redemption_code}
                  />
                </label>
                <label className="block space-y-2 text-sm font-medium text-slate-700">
                  <span>Source / Email Notes</span>
                  <textarea
                    className="min-h-20 w-full rounded-md border border-slate-300 px-3 py-3 text-base text-slate-950 outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-200"
                    onChange={(event) =>
                      updateFormField("digital_source_notes", event.target.value)
                    }
                    placeholder="Email sender, order number, PDF source, etc."
                    value={form.digital_source_notes}
                  />
                </label>
              </section>
            ) : null}

            <label className="block space-y-2 text-sm font-medium text-slate-700">
              <span>
                {form.card_source === "digital"
                  ? "Digital PDF/Image Attachment Optional"
                  : "Primary Card Image Optional"}
              </span>
              <div className="flex min-h-24 cursor-pointer flex-col items-center justify-center rounded-md border border-dashed border-slate-300 bg-slate-50 px-4 py-5 text-center transition hover:bg-slate-100">
                <span className="text-base font-semibold text-slate-900">
                  {form.card_source === "digital"
                    ? "Upload PDF / Email Image"
                    : "Take Photo / Upload Card Image"}
                </span>
                <span className="mt-1 text-sm text-slate-500">
                  {form.card_source === "digital"
                    ? "Stored as supporting documentation; OCR is not queued."
                    : "Camera opens on supported mobile devices."}
                </span>
              </div>
              <input
                className="sr-only"
                key={fileInputKey}
                type="file"
                accept={
                  form.card_source === "digital"
                    ? digitalAttachmentAccept
                    : cardImageAccept
                }
                capture={
                  form.card_source === "physical" && useCameraCapture
                    ? "environment"
                    : undefined
                }
                onChange={handleCardImageChange}
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

          <section className="mt-5 rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
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
                  Purchase #{purchase.id} · Face value{" "}
                  {formatAmount(purchase.total_amount)}
                </p>
                {lookupsError ? (
                  <p className="text-sm font-medium text-amber-700">
                    {lookupsError} Instant discount matching may be unavailable.
                  </p>
                ) : null}
              </div>
            ) : (
              <p className="text-sm text-slate-500">Purchase not found.</p>
            )}
          </section>

          <section className="mt-4 rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
            <h2 className="text-base font-semibold">Session Summary</h2>
            <div className="mt-3 grid grid-cols-2 gap-3 text-sm">
              <div className="rounded-md bg-slate-50 p-3">
                <p className="text-xs font-medium text-slate-500">Cards Added</p>
                <p className="mt-1 text-xl font-semibold">{giftCards.length}</p>
              </div>
              <div className="rounded-md bg-slate-50 p-3">
                <p className="text-xs font-medium text-slate-500">
                  Face Value Added
                </p>
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

          {successMessage ? (
            <div className="mt-4 rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-800">
              <p>{successMessage}</p>
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  className="h-9 rounded-md border border-emerald-300 bg-white px-3 text-xs font-semibold text-emerald-800 transition hover:bg-emerald-100"
                  onClick={startNextGiftCard}
                  type="button"
                >
                  Add Another Card
                </button>
                <Link
                  className="flex h-9 items-center rounded-md bg-emerald-700 px-3 text-xs font-semibold text-white transition hover:bg-emerald-800"
                  href={`/purchases/${purchaseId}`}
                >
                  Finish Intake
                </Link>
              </div>
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
                      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
                        {giftCard.card_source === "digital"
                          ? "Digital"
                          : "Physical"}
                      </p>
                      {giftCard.notes ? (
                        <p className="truncate text-sm text-slate-500">
                          {giftCard.notes}
                        </p>
                      ) : null}
                      {cardUploadStatuses[giftCard.id] || giftCard.ocr_status ? (
                        <p className="mt-1 text-xs font-medium text-slate-500">
                          {cardUploadStatuses[giftCard.id] ??
                            `OCR ${giftCard.ocr_status?.replaceAll("_", " ")}`}
                        </p>
                      ) : null}
                    </div>
                    <div className="flex shrink-0 items-center gap-3">
                      <p className="text-sm font-semibold">
                        {formatAmount(giftCard.face_value)}
                      </p>
                      <Link
                        className="flex h-9 items-center rounded-md border border-slate-300 px-3 text-xs font-semibold text-slate-700 transition hover:bg-slate-100 hover:text-slate-950"
                        href={`/gift-cards/${giftCard.id}/verify?returnTo=/intake/${purchaseId}`}
                      >
                        Verify
                      </Link>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <div className="sticky bottom-0 mt-auto bg-slate-50 pb-[calc(1rem+env(safe-area-inset-bottom))] pt-4">
            <button
              className="h-12 w-full rounded-md bg-slate-900 px-5 text-base font-semibold text-white shadow-sm transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:bg-slate-400"
              type="submit"
              disabled={isSubmitDisabled}
            >
              {lastSavedGiftCardId !== null
                ? "Saved"
                : isSubmitting
                  ? "Saving..."
                  : "Save Gift Card"}
            </button>
          </div>
        </form>
      </div>
    </main>
  );
}
