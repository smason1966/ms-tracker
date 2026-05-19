"use client";

import { ChangeEvent, FormEvent, useEffect, useMemo, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { API_BASE_URL } from "@/lib/api";

type GiftCard = {
  id: number;
  purchase_batch_id: number;
  brand: string;
  face_value: string | number;
  status: string;
  card_number_encrypted: string | null;
  pin_encrypted: string | null;
  notes: string | null;
  sold_to: string | null;
  sold_date: string | null;
  sale_price: string | number | null;
  sale_notes: string | null;
};

type CardImage = {
  id: number;
  gift_card_id: number;
  image_type: string;
  original_image_url: string;
  processed_image_url: string | null;
  created_at?: string;
};

type ExtractionAttempt = {
  id: number;
  gift_card_id: number;
  method: string;
  extracted_card_number: string | null;
  extracted_pin: string | null;
  confidence_score: number | null;
  created_at: string;
};

type ExtractionCandidate = {
  id: number;
  gift_card_id: number;
  candidate_type: string;
  source: string;
  value: string;
  confidence_score: number | null;
  notes: string | null;
  created_at: string;
};

type VerificationForm = {
  card_number: string;
  pin: string;
};

type VerificationDetails = {
  giftCard: GiftCard;
  cardImages: CardImage[];
  extractionAttempts: ExtractionAttempt[];
  extractionCandidates: ExtractionCandidate[];
};

const cardImageAccept = "image/jpeg,image/png,image/webp,image/heic,.jpg,.jpeg,.png,.webp,.heic";

function buildUploadUrl(path: string | null | undefined) {
  if (!path) {
    return "";
  }

  if (path.startsWith("http://") || path.startsWith("https://")) {
    return path;
  }

  return `${API_BASE_URL}/${path.replace(/^\/+/, "")}`;
}

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

function formatDate(value: string | null | undefined) {
  if (!value) {
    return "Unknown";
  }

  return new Date(value).toLocaleString();
}

function formatSaleDate(value: string | null | undefined) {
  if (!value) {
    return "Unknown";
  }

  const [year, month, day] = value.split("T")[0].split("-").map(Number);
  const date =
    year && month && day ? new Date(year, month - 1, day) : new Date(value);

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date);
}

function formatConfidence(value: number | null) {
  if (value === null || value === undefined) {
    return "Unknown confidence";
  }

  return `${Math.round(value * 100)}% confidence`;
}

function candidateSourceRank(candidate: ExtractionCandidate) {
  return candidate.source.toLowerCase() === "barcode" ? 1 : 0;
}

function getBestCandidate(
  candidates: ExtractionCandidate[],
  candidateType: string,
) {
  const matchingCandidates = candidates.filter(
    (candidate) =>
      candidate.candidate_type === candidateType &&
      ((candidate.confidence_score ?? 0) >= 0.35 ||
        candidate.source.toLowerCase() === "barcode"),
  );

  return matchingCandidates.sort((candidateA, candidateB) => {
    const confidenceA = candidateA.confidence_score ?? 0;
    const confidenceB = candidateB.confidence_score ?? 0;
    const confidenceGap = Math.abs(confidenceA - confidenceB);

    if (confidenceGap <= 0.05) {
      return candidateSourceRank(candidateB) - candidateSourceRank(candidateA);
    }

    return confidenceB - confidenceA;
  })[0];
}

function getUsefulCandidates(
  candidates: ExtractionCandidate[],
  candidateType: string,
  bestCandidateId?: number,
) {
  return candidates
    .filter(
      (candidate) =>
        candidate.candidate_type === candidateType &&
        candidate.id !== bestCandidateId &&
        (candidate.confidence_score ?? 0) >= 0.35,
    )
    .sort((candidateA, candidateB) => {
      const confidenceA = candidateA.confidence_score ?? 0;
      const confidenceB = candidateB.confidence_score ?? 0;

      return confidenceB - confidenceA;
    });
}

async function loadGiftCardVerificationDetails(
  giftCardId: string,
): Promise<VerificationDetails> {
  const [
    giftCardResponse,
    imagesResponse,
    attemptsResponse,
    candidatesResponse,
  ] = await Promise.all([
    fetch(`${API_BASE_URL}/gift-cards/${giftCardId}`),
    fetch(`${API_BASE_URL}/card-images/gift-card/${giftCardId}`),
    fetch(`${API_BASE_URL}/extraction-attempts/gift-card/${giftCardId}`),
    fetch(`${API_BASE_URL}/extraction-candidates/gift-card/${giftCardId}`),
  ]);

  if (!giftCardResponse.ok) {
    throw new Error(`Failed to load gift card (${giftCardResponse.status})`);
  }

  if (!imagesResponse.ok) {
    throw new Error(`Failed to load card images (${imagesResponse.status})`);
  }

  if (!attemptsResponse.ok) {
    throw new Error(
      `Failed to load extraction attempts (${attemptsResponse.status})`,
    );
  }

  if (!candidatesResponse.ok) {
    throw new Error(
      `Failed to load extraction candidates (${candidatesResponse.status})`,
    );
  }

  return {
    giftCard: (await giftCardResponse.json()) as GiftCard,
    cardImages: (await imagesResponse.json()) as CardImage[],
    extractionAttempts: (await attemptsResponse.json()) as ExtractionAttempt[],
    extractionCandidates:
      (await candidatesResponse.json()) as ExtractionCandidate[],
  };
}

function getInitialVerificationForm(details: VerificationDetails) {
  const bestLoadedCardNumberCandidate = getBestCandidate(
    details.extractionCandidates,
    "card_number",
  );
  const bestLoadedPinCandidate = getBestCandidate(
    details.extractionCandidates,
    "pin",
  );

  return {
    // TODO: Mask and encrypt these values before production.
    card_number:
      details.giftCard.card_number_encrypted ??
      bestLoadedCardNumberCandidate?.value ??
      "",
    pin: details.giftCard.pin_encrypted ?? bestLoadedPinCandidate?.value ?? "",
  };
}

export default function GiftCardVerificationPage() {
  const params = useParams<{ id: string | string[] }>();
  const router = useRouter();
  const giftCardId = Array.isArray(params.id) ? params.id[0] : params.id;

  const [giftCard, setGiftCard] = useState<GiftCard | null>(null);
  const [cardImages, setCardImages] = useState<CardImage[]>([]);
  const [extractionAttempts, setExtractionAttempts] = useState<
    ExtractionAttempt[]
  >([]);
  const [extractionCandidates, setExtractionCandidates] = useState<
    ExtractionCandidate[]
  >([]);
  const [form, setForm] = useState<VerificationForm>({
    card_number: "",
    pin: "",
  });
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [imageRotation, setImageRotation] = useState(0);
  const [isUploadingImage, setIsUploadingImage] = useState(false);
  const [imageUploadError, setImageUploadError] = useState<string | null>(null);
  const [imageUploadMessage, setImageUploadMessage] = useState<string | null>(
    null,
  );

  const primaryImage = useMemo(() => {
    return (
      cardImages.find((image) => image.image_type === "primary") ??
      cardImages[0] ??
      null
    );
  }, [cardImages]);

  const bestCardNumberCandidate = useMemo(
    () => getBestCandidate(extractionCandidates, "card_number"),
    [extractionCandidates],
  );

  const bestPinCandidate = useMemo(
    () => getBestCandidate(extractionCandidates, "pin"),
    [extractionCandidates],
  );

  const otherCardNumberCandidates = useMemo(
    () =>
      getUsefulCandidates(
        extractionCandidates,
        "card_number",
        bestCardNumberCandidate?.id,
      ),
    [bestCardNumberCandidate?.id, extractionCandidates],
  );

  const otherPinCandidates = useMemo(
    () => getUsefulCandidates(extractionCandidates, "pin", bestPinCandidate?.id),
    [bestPinCandidate?.id, extractionCandidates],
  );

  const latestExtractionAttempt = extractionAttempts[0] ?? null;
  const purchaseHref = giftCard
    ? `/purchases/${giftCard.purchase_batch_id}`
    : "/";

  useEffect(() => {
    let isMounted = true;

    async function loadVerificationDetails() {
      setIsLoading(true);
      setError(null);
      setSuccessMessage(null);

      try {
        const details = await loadGiftCardVerificationDetails(giftCardId);

        if (isMounted) {
          setGiftCard(details.giftCard);
          setCardImages(details.cardImages);
          setExtractionAttempts(details.extractionAttempts);
          setExtractionCandidates(details.extractionCandidates);
          setForm(getInitialVerificationForm(details));
        }
      } catch (err) {
        if (isMounted) {
          setError(
            err instanceof Error
              ? err.message
              : "Failed to load verification details.",
          );
        }
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    }

    if (giftCardId) {
      void loadVerificationDetails();
    }

    return () => {
      isMounted = false;
    };
  }, [giftCardId]);

  async function handleImageUpload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];

    if (!file) {
      return;
    }

    setIsUploadingImage(true);
    setImageUploadError(null);
    setImageUploadMessage(null);

    try {
      const formData = new FormData();
      formData.append("gift_card_id", giftCardId);
      formData.append("file", file);

      const response = await fetch(`${API_BASE_URL}/card-images/upload`, {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        throw new Error(`Failed to upload image (${response.status})`);
      }

      const details = await loadGiftCardVerificationDetails(giftCardId);
      setGiftCard(details.giftCard);
      setCardImages(details.cardImages);
      setExtractionAttempts(details.extractionAttempts);
      setExtractionCandidates(details.extractionCandidates);
      setForm(getInitialVerificationForm(details));
      setImageRotation(0);
      setImageUploadMessage("Image uploaded.");
    } catch (err) {
      setImageUploadError(
        err instanceof Error ? err.message : "Failed to upload image.",
      );
    } finally {
      event.target.value = "";
      setIsUploadingImage(false);
    }
  }

  async function handleVerify(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (giftCard?.status === "SOLD") {
      setSubmitError("Sold cards cannot be re-verified from this page.");
      return;
    }

    setIsSubmitting(true);
    setSubmitError(null);
    setSuccessMessage(null);

    try {
      const response = await fetch(`${API_BASE_URL}/gift-cards/${giftCardId}/verify`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(form),
      });

      if (!response.ok) {
        throw new Error(`Failed to verify gift card (${response.status})`);
      }

      const updatedGiftCard = (await response.json()) as GiftCard;
      setGiftCard(updatedGiftCard);
      router.push(`/purchases/${updatedGiftCard.purchase_batch_id}`);
    } catch (err) {
      setSubmitError(
        err instanceof Error ? err.message : "Failed to verify gift card.",
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  if (isLoading) {
    return (
      <main className="min-h-screen bg-slate-50 px-4 py-8 text-slate-950">
        <div className="mx-auto max-w-3xl rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
          Loading verification details...
        </div>
      </main>
    );
  }

  if (error || !giftCard) {
    return (
      <main className="min-h-screen bg-slate-50 px-4 py-8 text-slate-950">
        <div className="mx-auto max-w-3xl space-y-4 rounded-lg border border-red-200 bg-red-50 p-6 text-red-700">
          <p>{error ?? "Gift card not found."}</p>
          <Link
            className="text-sm font-semibold underline underline-offset-4 hover:text-red-900"
            href="/"
          >
            Back to purchases
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-5 text-slate-950 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-7xl space-y-6">
        <header className="space-y-3">
          <Link
            className="inline-flex min-h-11 items-center text-sm font-medium text-slate-600 underline-offset-4 hover:text-slate-950 hover:underline"
            href={purchaseHref}
          >
            Back to purchase
          </Link>
          <div className="space-y-1">
            <p className="text-sm font-medium uppercase tracking-wide text-slate-500">
              Verify Gift Card
            </p>
            <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
              {giftCard.brand} {formatAmount(giftCard.face_value)}
            </h1>
            <p className="text-sm text-slate-600">Status: {giftCard.status}</p>
          </div>
        </header>

        {successMessage && (
          <div className="flex flex-col gap-3 rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800 sm:flex-row sm:items-center sm:justify-between">
            <span>{successMessage}</span>
            <Link
              className="inline-flex h-11 items-center justify-center rounded-md bg-emerald-700 px-4 font-semibold text-white transition hover:bg-emerald-800"
              href={purchaseHref}
            >
              Back to Purchase
            </Link>
          </div>
        )}

        <section className="grid gap-6 xl:grid-cols-[minmax(0,1.3fr)_minmax(380px,0.7fr)]">
          <div className="space-y-4">
            <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
              <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <h2 className="text-lg font-semibold">Uploaded Card Image</h2>
                <div className="flex flex-wrap gap-2">
                  <label
                    className={`inline-flex h-11 cursor-pointer items-center rounded-md border border-slate-300 px-4 text-sm font-medium transition ${
                      isUploadingImage
                        ? "cursor-not-allowed bg-slate-100 text-slate-400"
                        : "text-slate-700 hover:bg-slate-100"
                    }`}
                  >
                    <span>
                      {isUploadingImage
                        ? "Uploading..."
                        : primaryImage
                          ? "Replace Image"
                          : "Upload Image"}
                    </span>
                    <input
                      accept={cardImageAccept}
                      className="sr-only"
                      disabled={isUploadingImage}
                      onChange={handleImageUpload}
                      type="file"
                    />
                  </label>
                  {primaryImage && (
                    <>
                      <button
                        className="h-11 rounded-md border border-slate-300 px-4 text-sm font-medium text-slate-700 transition hover:bg-slate-100"
                        onClick={() =>
                          setImageRotation(
                            (currentRotation) => currentRotation - 90,
                          )
                        }
                        type="button"
                      >
                        Rotate Left
                      </button>
                      <button
                        className="h-11 rounded-md border border-slate-300 px-4 text-sm font-medium text-slate-700 transition hover:bg-slate-100"
                        onClick={() =>
                          setImageRotation(
                            (currentRotation) => currentRotation + 90,
                          )
                        }
                        type="button"
                      >
                        Rotate Right
                      </button>
                      <button
                        className="h-11 rounded-md border border-slate-300 px-4 text-sm font-medium text-slate-700 transition hover:bg-slate-100"
                        onClick={() => setImageRotation(0)}
                        type="button"
                      >
                        Reset
                      </button>
                    </>
                  )}
                </div>
              </div>
              {imageUploadMessage ? (
                <p className="mb-3 text-sm font-medium text-emerald-700">
                  {imageUploadMessage}
                </p>
              ) : null}
              {imageUploadError ? (
                <p className="mb-3 text-sm font-medium text-red-700">
                  {imageUploadError}
                </p>
              ) : null}
              {primaryImage ? (
                <div className="flex min-h-[28rem] items-center justify-center overflow-hidden rounded-lg border border-slate-200 bg-slate-100 p-3 sm:min-h-[34rem] md:min-h-[40rem] lg:min-h-[44rem]">
                  <Image
                    alt={`${giftCard.brand} card`}
                    className="h-auto max-h-[78vh] w-full max-w-full object-contain transition-transform duration-200"
                    height={720}
                    src={buildUploadUrl(
                      primaryImage.processed_image_url ??
                        primaryImage.original_image_url,
                    )}
                    style={{
                      transform: `rotate(${imageRotation}deg)`,
                    }}
                    unoptimized
                    width={960}
                  />
                </div>
              ) : (
                <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-8 text-center text-sm text-slate-500">
                  No image uploaded. Upload an image to review and verify this
                  card.
                </div>
              )}
            </div>

            <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
              <h2 className="text-lg font-semibold">Extraction Summary</h2>
              {latestExtractionAttempt ? (
                <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2">
                  <div>
                    <dt className="font-medium text-slate-500">Method</dt>
                    <dd>{latestExtractionAttempt.method}</dd>
                  </div>
                  <div>
                    <dt className="font-medium text-slate-500">Confidence</dt>
                    <dd>
                      {formatConfidence(latestExtractionAttempt.confidence_score)}
                    </dd>
                  </div>
                  <div>
                    <dt className="font-medium text-slate-500">Card Number</dt>
                    <dd>{latestExtractionAttempt.extracted_card_number ?? "None"}</dd>
                  </div>
                  <div>
                    <dt className="font-medium text-slate-500">PIN</dt>
                    <dd>{latestExtractionAttempt.extracted_pin ?? "None"}</dd>
                  </div>
                  <div className="sm:col-span-2">
                    <dt className="font-medium text-slate-500">Created</dt>
                    <dd>{formatDate(latestExtractionAttempt.created_at)}</dd>
                  </div>
                </dl>
              ) : (
                <p className="mt-3 text-sm text-slate-500">No extraction yet.</p>
              )}
            </div>
          </div>

          <form
            className="space-y-4 rounded-lg border border-slate-200 bg-white p-4 shadow-sm xl:sticky xl:top-6 xl:self-start"
            onSubmit={handleVerify}
          >
            <div>
              <h2 className="text-lg font-semibold">Confirm Values</h2>
              <p className="mt-1 text-sm text-slate-500">
                Review the suggestions, then save the confirmed card details.
              </p>
            </div>

            {giftCard.status === "SOLD" ? (
              <section className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                <h3 className="text-sm font-semibold text-slate-900">
                  Sale Details
                </h3>
                <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2 xl:grid-cols-1">
                  <div>
                    <dt className="font-medium text-slate-500">Sold To</dt>
                    <dd>{giftCard.sold_to ?? "Unknown"}</dd>
                  </div>
                  <div>
                    <dt className="font-medium text-slate-500">Sold Date</dt>
                    <dd>{formatSaleDate(giftCard.sold_date)}</dd>
                  </div>
                  <div>
                    <dt className="font-medium text-slate-500">Sale Price</dt>
                    <dd>
                      {giftCard.sale_price === null
                        ? "Unknown"
                        : formatAmount(giftCard.sale_price)}
                    </dd>
                  </div>
                  {giftCard.sale_notes ? (
                    <div className="sm:col-span-2 xl:col-span-1">
                      <dt className="font-medium text-slate-500">Sale Notes</dt>
                      <dd className="whitespace-pre-wrap text-slate-700">
                        {giftCard.sale_notes}
                      </dd>
                    </div>
                  ) : null}
                </dl>
              </section>
            ) : null}

            <section className="rounded-lg border border-slate-200 bg-slate-50 p-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Suggested Card Number
                  </p>
                  {bestCardNumberCandidate ? (
                    <>
                      <p className="mt-1 break-all font-mono text-base">
                        {bestCardNumberCandidate.value}
                      </p>
                      <p className="mt-1 text-xs text-slate-500">
                        {bestCardNumberCandidate.source} ·{" "}
                        {formatConfidence(
                          bestCardNumberCandidate.confidence_score,
                        )}
                      </p>
                    </>
                  ) : (
                    <p className="mt-1 text-sm text-slate-500">
                      No useful card number candidate.
                    </p>
                  )}
                </div>
                {bestCardNumberCandidate && (
                  <button
                    className="h-11 rounded-md border border-slate-300 bg-white px-4 text-sm font-medium hover:bg-slate-100"
                    onClick={() =>
                      setForm((currentForm) => ({
                        ...currentForm,
                        card_number: bestCardNumberCandidate.value,
                      }))
                    }
                    type="button"
                  >
                    Use
                  </button>
                )}
              </div>

              {otherCardNumberCandidates.length > 0 && (
                <details className="mt-3 text-sm">
                  <summary className="cursor-pointer font-medium text-slate-600 hover:text-slate-950">
                    Show other card number candidates
                  </summary>
                  <div className="mt-2 space-y-2">
                    {otherCardNumberCandidates.map((candidate) => (
                      <CandidateRow
                        candidate={candidate}
                        key={candidate.id}
                        onUse={() =>
                          setForm((currentForm) => ({
                            ...currentForm,
                            card_number: candidate.value,
                          }))
                        }
                      />
                    ))}
                  </div>
                </details>
              )}
            </section>

            {bestPinCandidate && (
              <section className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                      Suggested PIN
                    </p>
                    <p className="mt-1 break-all font-mono text-base">
                      {bestPinCandidate.value}
                    </p>
                    <p className="mt-1 text-xs text-slate-500">
                      {bestPinCandidate.source} ·{" "}
                      {formatConfidence(bestPinCandidate.confidence_score)}
                    </p>
                  </div>
                  <button
                    className="h-11 rounded-md border border-slate-300 bg-white px-4 text-sm font-medium hover:bg-slate-100"
                    onClick={() =>
                      setForm((currentForm) => ({
                        ...currentForm,
                        pin: bestPinCandidate.value,
                      }))
                    }
                    type="button"
                  >
                    Use
                  </button>
                </div>

                {otherPinCandidates.length > 0 && (
                  <details className="mt-3 text-sm">
                    <summary className="cursor-pointer font-medium text-slate-600 hover:text-slate-950">
                      Show other PIN candidates
                    </summary>
                    <div className="mt-2 space-y-2">
                      {otherPinCandidates.map((candidate) => (
                        <CandidateRow
                          candidate={candidate}
                          key={candidate.id}
                          onUse={() =>
                            setForm((currentForm) => ({
                              ...currentForm,
                              pin: candidate.value,
                            }))
                          }
                        />
                      ))}
                    </div>
                  </details>
                )}
              </section>
            )}

            <label className="block space-y-2 text-sm font-medium text-slate-700">
              <span>Confirmed Card Number</span>
              <input
                className="h-12 w-full rounded-md border border-slate-300 px-3 text-base text-slate-950 outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-200"
                onChange={(event) =>
                  setForm((currentForm) => ({
                    ...currentForm,
                    card_number: event.target.value,
                  }))
                }
                required
                type="text"
                value={form.card_number}
              />
            </label>

            <label className="block space-y-2 text-sm font-medium text-slate-700">
              <span>Confirmed PIN</span>
              <input
                className="h-12 w-full rounded-md border border-slate-300 px-3 text-base text-slate-950 outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-200"
                onChange={(event) =>
                  setForm((currentForm) => ({
                    ...currentForm,
                    pin: event.target.value,
                  }))
                }
                required
                type="text"
                value={form.pin}
              />
            </label>

            {submitError && (
              <p className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                {submitError}
              </p>
            )}

            <button
              className="h-12 w-full rounded-md bg-slate-950 px-4 font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-400"
              disabled={isSubmitting || giftCard.status === "SOLD"}
              type="submit"
            >
              {giftCard.status === "SOLD"
                ? "Sold Card"
                : isSubmitting
                  ? "Verifying..."
                  : "Verify Card"}
            </button>
          </form>
        </section>
      </div>
    </main>
  );
}

function CandidateRow({
  candidate,
  onUse,
}: {
  candidate: ExtractionCandidate;
  onUse: () => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-md border border-slate-200 bg-white p-3">
      <div className="min-w-0">
        <p className="break-all font-mono text-sm">{candidate.value}</p>
        <p className="text-xs text-slate-500">
          {candidate.source} · {formatConfidence(candidate.confidence_score)}
        </p>
      </div>
      <button
        className="h-11 rounded-md border border-slate-300 px-4 text-sm font-medium hover:bg-slate-100"
        onClick={onUse}
        type="button"
      >
        Use
      </button>
    </div>
  );
}
