"use client";

import {
  ChangeEvent,
  Dispatch,
  FormEvent,
  PointerEvent,
  SetStateAction,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import Image from "next/image";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { API_BASE_URL } from "@/lib/api";

type GiftCard = {
  id: number;
  purchase_batch_id: number;
  brand: string;
  card_source?: string | null;
  face_value: string | number;
  status: string;
  ocr_status?: string;
  card_number_encrypted: string | null;
  pin_encrypted: string | null;
  confirmed_card_number: string | null;
  confirmed_pin: string | null;
  confirmed_redemption_code: string | null;
  confirmed_at: string | null;
  confirmed_source: string | null;
  export_value_source: string | null;
  notes: string | null;
  digital_source_notes?: string | null;
  void_reason: string | null;
  sold_to: string | null;
  sold_date: string | null;
  sale_price: string | number | null;
  sale_notes: string | null;
  sale_history?: SaleHistory[];
  updated_at?: string | null;
};

type SaleHistory = {
  sale_id: number;
  buyer_id: number;
  buyer_name: string;
  sold_at: string;
  expected_payout: string | number | null;
  payout_received: string | number | null;
  status: string;
  notes: string | null;
};

type CardImage = {
  id: number;
  gift_card_id: number;
  image_type: string;
  original_image_url: string;
  original_filename?: string | null;
  processed_image_url: string | null;
  canonical_rotation_degrees: number | null;
  orientation_source: string | null;
  canonical_transform_metadata: string | null;
  attachment_type?: string | null;
  retention_status?: string | null;
  retention_until?: string | null;
  retain_attachment?: boolean;
  purged_at?: string | null;
  created_at?: string;
};

type CardImageOcrStatus = {
  card_image_id: number;
  gift_card_id: number;
  ocr_status?: string | null;
  processed_image_url?: string | null;
  canonical_rotation_degrees?: number | null;
  orientation_source?: string | null;
  canonical_transform_metadata?: string | null;
  latest_attempt_id?: number | null;
  latest_attempt_created_at?: string | null;
  candidate_count?: number;
};

type Receipt = {
  id: number;
  purchase_batch_id: number;
  image_url: string;
  original_filename: string | null;
  attachment_type?: string | null;
  retention_status?: string | null;
  purged_at?: string | null;
  notes: string | null;
  created_at: string;
};

type ExtractionAttempt = {
  id: number;
  gift_card_id: number;
  method: string;
  extracted_card_number: string | null;
  extracted_pin: string | null;
  confidence_score: number | null;
  raw_text: string | null;
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
  face_value: string;
  notes: string;
  confirmed_source: string;
};

type OCRZone = {
  zone_name: string;
  zone_type: string;
  x_pct: number;
  y_pct: number;
  width_pct: number;
  height_pct: number;
  priority: number;
  expected_pattern?: string;
  expected_length?: number;
  notes?: string;
};

type OCRLayout = {
  layout_name: string;
  label: string;
  zones: OCRZone[];
  active: boolean;
  active_managed?: boolean;
  coordinate_space?: string;
};

type OCRCandidatePayload = {
  candidate_type: string;
  source: string;
  value: string;
  confidence_score: number | null;
  notes: string | null;
};

type OCRZoneTestResult = {
  image_source: string;
  rotation_degrees: number;
  coordinate_mode?: string;
  card_boundary?: Partial<OCRZone> | null;
  image_space_zone?: Partial<OCRZone> | null;
  transform_chain: string;
  source_image_dimensions: {
    width: number;
    height: number;
  };
  selected_crop: {
    x_pct: number;
    y_pct: number;
    width_pct: number;
    height_pct: number;
    image_x_pct?: number;
    image_y_pct?: number;
    image_width_pct?: number;
    image_height_pct?: number;
    x_px: number;
    y_px: number;
    width_px: number;
    height_px: number;
  };
  crop: {
    x_pct: number;
    y_pct: number;
    width_pct: number;
    height_pct: number;
    image_x_pct?: number;
    image_y_pct?: number;
    image_width_pct?: number;
    image_height_pct?: number;
    x_px: number;
    y_px: number;
    width_px: number;
    height_px: number;
  };
  selected_crop_image_data_url: string;
  crop_image_data_url: string;
  debug_image_paths: string[];
  barcode_attempts: Array<{
    source: string;
    zone_name?: string;
    crop?: string;
    rotation: number;
    decoded_value: string;
    barcode_type: string;
    normalized_candidate?: string;
    accepted: boolean;
    rejected_reason: string;
  }>;
  timed_out: boolean;
  timing_ms: number;
  stage_timings: Array<Record<string, string | number | boolean>>;
  ocr_passes: Array<{
    pass_name: string;
    text: string;
    score: number;
    engine_called: boolean;
    error: string | null;
    timed_out: boolean;
    duration_ms: number;
    language: string;
    config: string;
    psm: string;
    oem: string;
    image_mode: string;
    image_width: number;
    image_height: number;
    debug_image_path: string;
    raw_tokens: Array<{
      text: string;
      conf: string | number;
      left: number;
      top: number;
      width: number;
      height: number;
    }>;
    best_candidate: OCRCandidatePayload | null;
    candidates: OCRCandidatePayload[];
  }>;
  raw_text: string;
  confidence: number;
  best_candidate: OCRCandidatePayload | null;
  candidates: OCRCandidatePayload[];
  promoted_candidates: OCRCandidatePayload[];
};

type DuplicateCardWarning = {
  message: string;
  existing_card: {
    id: number;
    purchase_batch_id: number;
    brand: string;
    face_value: string | number;
    status: string;
    card_ending: string | null;
  };
};

type CleanupReport = {
  gift_card_id: number;
  brand: string;
  status: string;
  lifecycle_state: string;
  can_hard_delete: boolean;
  can_void: boolean;
  blocking_dependencies: Array<{
    type: string;
    sale_id?: number;
    message: string;
  }>;
  warnings: string[];
  linked_purchase: {
    purchase_id: number;
    store_name: string;
    purchase_date: string;
    total_paid: string;
  } | null;
  linked_sales: Array<{
    sale_id: number;
    status: string;
    expected_payout: string | null;
    payout_received: string | null;
    settlement_received_at: string | null;
    exported: boolean;
    blocking: boolean;
  }>;
  ocr_assets: {
    extraction_attempts: number;
    extraction_candidates: number;
    extraction_profile_metrics?: number;
  };
  image_references: {
    card_images: number;
  };
};

type VerificationDetails = {
  giftCard: GiftCard;
  cardImages: CardImage[];
  receipts: Receipt[];
  extractionAttempts: ExtractionAttempt[];
  extractionCandidates: ExtractionCandidate[];
};

const cardImageAccept = "image/jpeg,image/png,image/webp,image/heic,.jpg,.jpeg,.png,.webp,.heic";
const digitalAttachmentAccept =
  "application/pdf,image/jpeg,image/png,image/webp,image/heic,.pdf,.jpg,.jpeg,.png,.webp,.heic";

function buildUploadUrl(path: string | null | undefined) {
  if (!path) {
    return "";
  }

  if (path.startsWith("http://") || path.startsWith("https://")) {
    return path;
  }

  return `${API_BASE_URL}/${path.replace(/^\/+/, "")}`;
}

function buildUploadUrlWithVersion(
  path: string | null | undefined,
  version: string | number | null | undefined,
) {
  const url = buildUploadUrl(path);
  if (!url || !version) {
    return url;
  }
  return `${url}${url.includes("?") ? "&" : "?"}v=${encodeURIComponent(String(version))}`;
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

function maskSensitiveValue(value: string | null | undefined) {
  if (!value) {
    return "Not recorded";
  }

  const normalizedValue = value.replace(/\s/g, "");

  if (normalizedValue.length <= 4) {
    return "•".repeat(normalizedValue.length);
  }

  const prefix = normalizedValue.slice(0, 4);
  const suffix = normalizedValue.slice(-4);
  const maskedLength = Math.max(4, normalizedValue.length - 8);

  return `${prefix}${"*".repeat(maskedLength)}${suffix}`;
}

function credentialValue(card: GiftCard | null | undefined) {
  if (!card) {
    return null;
  }

  return (
    card.confirmed_redemption_code ||
    card.confirmed_card_number ||
    card.card_number_encrypted
  );
}

function credentialPin(card: GiftCard | null | undefined) {
  return card?.confirmed_pin || card?.pin_encrypted || null;
}

function cleanCredential(value: string | null | undefined) {
  const cleaned = value?.trim() ?? "";
  return cleaned || null;
}

function credentialsDiffer(
  confirmedValue: string | null | undefined,
  suggestedValue: string | null | undefined,
) {
  const confirmed = cleanCredential(confirmedValue);
  const suggested = cleanCredential(suggestedValue);

  return Boolean(confirmed && suggested && confirmed !== suggested);
}

function sourceLabel(source: string | null | undefined) {
  if (!source) {
    return "Not recorded";
  }
  if (source === "manual_digital") {
    return "manual digital";
  }

  return source.replaceAll("_", " ");
}

function archiveReasonText(card: GiftCard) {
  const duplicateMatch = card.notes?.match(
    /duplicate of card #(\d+).*purchase #(\d+)/i,
  );

  if (duplicateMatch) {
    return `Duplicate of card #${duplicateMatch[1]} from purchase #${duplicateMatch[2]}`;
  }

  if (card.void_reason) {
    return card.void_reason.replaceAll("_", " ");
  }

  return "Inactive archived record";
}

function ArchiveDetailRow({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
      <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">
        {label}
      </dt>
      <dd className="mt-1 whitespace-pre-wrap break-words text-sm font-medium text-slate-800">
        {value || "Not recorded"}
      </dd>
    </div>
  );
}

function saleStatusLabel(status: string) {
  if (status === "SOLD_PENDING_PAYMENT") {
    return "Awaiting Payment";
  }

  return status.replaceAll("_", " ");
}

function canCleanupGiftCard(card: GiftCard) {
  return !["SOLD", "SOLD_PENDING_PAYMENT", "SETTLED", "REDEEMED"].includes(
    card.status,
  );
}

function isDuplicateCardWarning(value: unknown): value is DuplicateCardWarning {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as {
    code?: unknown;
    existing_card?: unknown;
    message?: unknown;
  };

  if (
    candidate.code !== "DUPLICATE_CARD_NUMBER" ||
    !candidate.existing_card ||
    typeof candidate.existing_card !== "object"
  ) {
    return false;
  }

  const existingCard = candidate.existing_card as { id?: unknown };
  return typeof existingCard.id === "number";
}

function normalizeDuplicateCardWarning(value: unknown): DuplicateCardWarning | null {
  if (isDuplicateCardWarning(value)) {
    return value;
  }

  if (!value || typeof value !== "object") {
    return null;
  }

  const candidate = value as {
    error?: unknown;
    message?: unknown;
    existing_card_id?: unknown;
    existing_purchase_id?: unknown;
    existing_status?: unknown;
    existing_brand?: unknown;
    existing_face_value?: unknown;
    existing_card_ending?: unknown;
  };

  if (
    candidate.error !== "duplicate_card_number" ||
    typeof candidate.existing_card_id !== "number" ||
    typeof candidate.existing_purchase_id !== "number"
  ) {
    return null;
  }

  return {
    message:
      typeof candidate.message === "string"
        ? candidate.message
        : "Duplicate card number found.",
    existing_card: {
      id: candidate.existing_card_id,
      purchase_batch_id: candidate.existing_purchase_id,
      brand:
        typeof candidate.existing_brand === "string"
          ? candidate.existing_brand
          : "Unknown",
      face_value:
        typeof candidate.existing_face_value === "string" ||
        typeof candidate.existing_face_value === "number"
          ? candidate.existing_face_value
          : "",
      status:
        typeof candidate.existing_status === "string"
          ? candidate.existing_status
          : "Unknown",
      card_ending:
        typeof candidate.existing_card_ending === "string"
          ? candidate.existing_card_ending
          : null,
    },
  };
}

async function readResponseBody(response: Response) {
  const text = await response.text().catch(() => "");

  if (!text) {
    return null;
  }

  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

function backendErrorMessage(body: unknown, fallback: string) {
  if (!body) {
    return fallback;
  }

  if (typeof body === "string") {
    return body;
  }

  if (typeof body !== "object") {
    return fallback;
  }

  const candidate = body as {
    message?: unknown;
    detail?: unknown;
    error?: unknown;
  };

  if (typeof candidate.message === "string") {
    return candidate.message;
  }

  if (typeof candidate.detail === "string") {
    return candidate.detail;
  }

  if (
    candidate.detail &&
    typeof candidate.detail === "object" &&
    "message" in candidate.detail &&
    typeof (candidate.detail as { message?: unknown }).message === "string"
  ) {
    return (candidate.detail as { message: string }).message;
  }

  if (typeof candidate.error === "string") {
    return candidate.error;
  }

  return fallback;
}

function cleanupReportFromBody(body: unknown): CleanupReport | null {
  if (!body || typeof body !== "object") {
    return null;
  }

  const candidate = body as {
    cleanup_report?: unknown;
    detail?: unknown;
  };

  if (candidate.cleanup_report && typeof candidate.cleanup_report === "object") {
    return normalizeCleanupReport(candidate.cleanup_report);
  }

  if (
    candidate.detail &&
    typeof candidate.detail === "object" &&
    "cleanup_report" in candidate.detail &&
    typeof (candidate.detail as { cleanup_report?: unknown }).cleanup_report ===
      "object"
  ) {
    return normalizeCleanupReport(
      (candidate.detail as { cleanup_report: unknown }).cleanup_report,
    );
  }

  return null;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {};
}

function asString(value: unknown, fallback = "") {
  return typeof value === "string" ? value : fallback;
}

function asNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function normalizeCleanupReport(
  value: unknown,
  fallbackCard?: Pick<GiftCard, "id" | "brand" | "status"> | null,
): CleanupReport | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const report = asRecord(value);
  const blockingDependencies = Array.isArray(report.blocking_dependencies)
    ? report.blocking_dependencies.map((dependency) => {
        const blocker = asRecord(dependency);

        return {
          type: asString(blocker.type, "dependency"),
          sale_id:
            typeof blocker.sale_id === "number" ? blocker.sale_id : undefined,
          message: asString(blocker.message, "Deletion is blocked."),
        };
      })
    : [];
  const linkedSales = Array.isArray(report.linked_sales)
    ? report.linked_sales.map((linkedSale) => {
        const sale = asRecord(linkedSale);

        return {
          sale_id: asNumber(sale.sale_id),
          status: asString(sale.status, "UNKNOWN"),
          expected_payout:
            typeof sale.expected_payout === "string"
              ? sale.expected_payout
              : null,
          payout_received:
            typeof sale.payout_received === "string"
              ? sale.payout_received
              : null,
          settlement_received_at:
            typeof sale.settlement_received_at === "string"
              ? sale.settlement_received_at
              : null,
          exported: Boolean(sale.exported),
          blocking: Boolean(sale.blocking),
        };
      })
    : [];
  const linkedPurchaseSource =
    report.linked_purchase && typeof report.linked_purchase === "object"
      ? asRecord(report.linked_purchase)
      : null;
  const ocrAssets = asRecord(report.ocr_assets);
  const imageReferences = asRecord(report.image_references);
  const status = asString(report.status, fallbackCard?.status ?? "UNKNOWN");
  const canHardDelete =
    typeof report.can_hard_delete === "boolean"
      ? report.can_hard_delete
      : blockingDependencies.length === 0;

  return {
    gift_card_id:
      typeof report.gift_card_id === "number"
        ? report.gift_card_id
        : fallbackCard?.id ?? 0,
    brand: asString(report.brand, fallbackCard?.brand ?? "Gift card"),
    status,
    lifecycle_state: asString(
      report.lifecycle_state,
      status.toLowerCase() || "unknown",
    ),
    can_hard_delete: canHardDelete,
    can_void:
      typeof report.can_void === "boolean"
        ? report.can_void
        : !["SOLD", "SOLD_PENDING_PAYMENT", "SETTLED", "REDEEMED"].includes(
            status,
          ),
    blocking_dependencies: blockingDependencies,
    warnings: Array.isArray(report.warnings)
      ? report.warnings.filter(
          (warning): warning is string => typeof warning === "string",
        )
      : [],
    linked_purchase: linkedPurchaseSource
      ? {
          purchase_id: asNumber(linkedPurchaseSource.purchase_id),
          store_name: asString(linkedPurchaseSource.store_name, "Unknown store"),
          purchase_date: asString(linkedPurchaseSource.purchase_date),
          total_paid:
            typeof linkedPurchaseSource.total_paid === "string"
              ? linkedPurchaseSource.total_paid
              : String(linkedPurchaseSource.total_paid ?? ""),
        }
      : null,
    linked_sales: linkedSales,
    ocr_assets: {
      extraction_attempts: asNumber(ocrAssets.extraction_attempts),
      extraction_candidates: asNumber(ocrAssets.extraction_candidates),
      extraction_profile_metrics: asNumber(
        ocrAssets.extraction_profile_metrics,
      ),
    },
    image_references: {
      card_images: asNumber(imageReferences.card_images),
    },
  };
}

function candidateSourceRank(candidate: ExtractionCandidate) {
  return candidate.source.toLowerCase() === "barcode" ? 1 : 0;
}

function normalizedCandidateValue(value: string) {
  return value.replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
}

function isCandidateValidForBrand(
  candidate: Pick<ExtractionCandidate, "candidate_type" | "value">,
  brand: string | null | undefined,
) {
  const normalizedBrand = normalizedBrandName(brand);
  const normalizedValue = normalizedCandidateValue(candidate.value);
  const candidateType = candidate.candidate_type.toLowerCase();

  if (normalizedBrand.includes("best buy")) {
    if (candidateType === "card_number") {
      return /^\d{16}$/.test(normalizedValue);
    }
    if (candidateType === "pin") {
      return /^\d{4}$/.test(normalizedValue);
    }
  }

  if (normalizedBrand.includes("nike")) {
    if (candidateType === "card_number") {
      return (
        /^606010\d+$/.test(normalizedValue) &&
        (normalizedValue.length === 16 || normalizedValue.length === 19)
      );
    }
    if (candidateType === "pin") {
      return /^\d{6}$/.test(normalizedValue);
    }
  }

  if (isRedemptionCodeOnlyBrand(brand) && candidateType === "pin") {
    return false;
  }

  return normalizedValue.length > 0;
}

function getBestCandidate(
  candidates: ExtractionCandidate[],
  candidateType: string,
  brand?: string | null,
) {
  const matchingCandidates = candidates.filter(
    (candidate) =>
      candidate.candidate_type === candidateType &&
      isCandidateValidForBrand(candidate, brand) &&
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
  brand?: string | null,
) {
  return candidates
    .filter(
      (candidate) =>
        candidate.candidate_type === candidateType &&
        isCandidateValidForBrand(candidate, brand) &&
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
  ] = await Promise.all([
    fetch(`${API_BASE_URL}/gift-cards/${giftCardId}`),
    fetch(`${API_BASE_URL}/card-images/gift-card/${giftCardId}`),
  ]);

  if (!giftCardResponse.ok) {
    throw new Error(`Failed to load gift card (${giftCardResponse.status})`);
  }

  if (!imagesResponse.ok) {
    throw new Error(`Failed to load card images (${imagesResponse.status})`);
  }

  const giftCard = (await giftCardResponse.json()) as GiftCard;
  const cardImages = (await imagesResponse.json()) as CardImage[];
  const shouldLoadOcrResults = !isOcrPendingStatus(giftCard.ocr_status);
  const [
    receiptsResponse,
    attemptsResponse,
    candidatesResponse,
  ] = await Promise.all([
    fetch(`${API_BASE_URL}/receipts/purchase/${giftCard.purchase_batch_id}`),
    shouldLoadOcrResults
      ? fetch(`${API_BASE_URL}/extraction-attempts/gift-card/${giftCardId}`)
      : Promise.resolve(null),
    shouldLoadOcrResults
      ? fetch(`${API_BASE_URL}/extraction-candidates/gift-card/${giftCardId}`)
      : Promise.resolve(null),
  ]);

  if (!receiptsResponse.ok) {
    throw new Error(`Failed to load receipts (${receiptsResponse.status})`);
  }

  if (attemptsResponse && !attemptsResponse.ok) {
    throw new Error(
      `Failed to load extraction attempts (${attemptsResponse.status})`,
    );
  }

  if (candidatesResponse && !candidatesResponse.ok) {
    throw new Error(
      `Failed to load extraction candidates (${candidatesResponse.status})`,
    );
  }

  return {
    giftCard,
    cardImages,
    receipts: (await receiptsResponse.json()) as Receipt[],
    extractionAttempts: attemptsResponse
      ? ((await attemptsResponse.json()) as ExtractionAttempt[])
      : [],
    extractionCandidates: candidatesResponse
      ? ((await candidatesResponse.json()) as ExtractionCandidate[])
      : [],
  };
}

function getInitialVerificationForm(details: VerificationDetails) {
  const isRedemptionCodeOnly = isRedemptionCodeOnlyBrand(details.giftCard.brand);

  return {
    // TODO: Mask and encrypt these values before production.
    card_number: credentialValue(details.giftCard) ?? "",
    pin: isRedemptionCodeOnly ? "" : credentialPin(details.giftCard) ?? "",
    face_value: String(details.giftCard.face_value),
    notes: details.giftCard.notes ?? "",
    confirmed_source: details.giftCard.confirmed_source ?? "manual",
  };
}

function normalizedBrandName(brand: string | null | undefined) {
  return (brand ?? "").trim().toLowerCase();
}

function isRedemptionCodeOnlyBrand(brand: string | null | undefined) {
  const normalizedBrand = normalizedBrandName(brand);
  return normalizedBrand.includes("uber") || normalizedBrand.includes("doordash");
}

function isOcrReadyStatus(status: string | null | undefined) {
  return status === "ocr_ready" || status === "completed";
}

function isCanonicalReadyStatus(status: string | null | undefined) {
  return (
    isOcrReadyStatus(status) ||
    status === "canonical_ready" ||
    status === "zones_ready"
  );
}

function isOcrPendingStatus(status: string | null | undefined) {
  return [
    "pending",
    "uploading",
    "queued",
    "processing",
    "preprocessing",
    "canonical_ready",
    "zones_ready",
  ].includes(status ?? "");
}

function ocrDebugValue(rawText: string | null | undefined, label: string) {
  if (!rawText) {
    return null;
  }

  const match = rawText.match(new RegExp(`^${label}:\\s*(.+)$`, "m"));
  return match?.[1]?.trim() ?? null;
}

function ocrDebugBlock(
  rawText: string | null | undefined,
  label: string,
  nextLabel: string,
) {
  if (!rawText) {
    return null;
  }

  const pattern = new RegExp(`${label}:\\n([\\s\\S]*?)\\n${nextLabel}:`, "m");
  return rawText.match(pattern)?.[1]?.trim() ?? null;
}

const BEST_BUY_LAYOUT_OPTIONS = [
  ["auto", "Auto"],
  ["best_buy_barcode_above_number", "Best Buy barcode-above-number"],
  ["best_buy_barcode_below_number", "Best Buy barcode-below-number"],
  ["best_buy_number_between_bars", "Best Buy number-between-bars"],
  ["best_buy_legacy_small_pin", "Best Buy legacy/small-PIN"],
  ["best_buy_unknown_manual", "Best Buy unknown/manual"],
] as const;
const DEFAULT_ACTIVE_BEST_BUY_LAYOUT_NAMES = new Set([
  "best_buy_barcode_above_number",
  "best_buy_number_between_bars",
]);
const LEGACY_BEST_BUY_LAYOUT_NAMES = new Set([
  "best_buy_horizontal_barcode",
  "best_buy_vertical_barcode",
  "best_buy_back_v1",
  "best_buy_back_v2",
]);

function bestBuyLayoutLabel(layoutName: string) {
  const legacyLabels: Record<string, string> = {
    best_buy_horizontal_barcode: "Best Buy barcode-below-number",
    best_buy_vertical_barcode: "Best Buy number-between-bars",
    best_buy_back_v1: "Best Buy barcode-above-number",
    best_buy_back_v2: "Best Buy legacy/small-PIN",
  };
  return (
    BEST_BUY_LAYOUT_OPTIONS.find(([value]) => value === layoutName)?.[1] ??
    legacyLabels[layoutName] ??
    layoutName.replaceAll("_", " ")
  );
}

function defaultBestBuyLayout(layoutName: string): OCRLayout {
  return {
    layout_name: layoutName,
    label: bestBuyLayoutLabel(layoutName),
    active: DEFAULT_ACTIVE_BEST_BUY_LAYOUT_NAMES.has(layoutName),
    active_managed: false,
    coordinate_space: "card_boundary_relative",
    zones: bestBuyLayoutZones(layoutName),
  };
}

function normalizeBestBuyLayouts(layouts: OCRLayout[]) {
  const standardLayouts = BEST_BUY_LAYOUT_OPTIONS.filter(
    ([layoutName]) => layoutName !== "auto",
  ).map(([layoutName]) => layoutName);
  const layoutMap = new Map<string, OCRLayout>();

  for (const layoutName of standardLayouts) {
    layoutMap.set(layoutName, defaultBestBuyLayout(layoutName));
  }

  for (const layout of layouts) {
    if (LEGACY_BEST_BUY_LAYOUT_NAMES.has(layout.layout_name)) {
      continue;
    }

    const standardLayout = standardLayouts.includes(
      layout.layout_name as (typeof standardLayouts)[number],
    );
    const existing = layoutMap.get(layout.layout_name);
    const active =
      standardLayout && !layout.active_managed
        ? DEFAULT_ACTIVE_BEST_BUY_LAYOUT_NAMES.has(layout.layout_name)
        : layout.active;
    layoutMap.set(layout.layout_name, {
      ...(existing ?? defaultBestBuyLayout(layout.layout_name)),
      ...layout,
      label: layout.label || bestBuyLayoutLabel(layout.layout_name),
      active,
      active_managed: layout.active_managed ?? standardLayout,
      coordinate_space: layout.coordinate_space ?? "card_boundary_relative",
      zones: layout.zones.length
        ? layout.zones
        : existing?.zones ?? bestBuyLayoutZones(layout.layout_name),
    });
  }

  return Array.from(layoutMap.values());
}

function bestBuyLayoutZones(layoutName: string): OCRZone[] {
  const commonBoundary: OCRZone = {
    zone_name: "card_boundary",
    zone_type: "card_boundary",
    x_pct: 2,
    y_pct: 2,
    width_pct: 96,
    height_pct: 96,
    priority: 1,
    notes: "Full saved review/OCR image.",
  };

  const layouts: Record<string, OCRZone[]> = {
    best_buy_barcode_above_number: [
      commonBoundary,
      {
        zone_name: "best_buy_card_number",
        zone_type: "card_number",
        x_pct: 12,
        y_pct: 54,
        width_pct: 54,
        height_pct: 16,
        priority: 1,
        expected_length: 16,
        notes: "Printed card number below the redeemable barcode.",
      },
      {
        zone_name: "best_buy_pin",
        zone_type: "pin",
        x_pct: 58,
        y_pct: 54,
        width_pct: 25,
        height_pct: 18,
        priority: 2,
        expected_length: 4,
        notes: "PIN near/right of card number.",
      },
      {
        zone_name: "best_buy_barcode",
        zone_type: "barcode",
        x_pct: 12,
        y_pct: 34,
        width_pct: 62,
        height_pct: 20,
        priority: 3,
        expected_length: 16,
        notes: "Redeemable barcode above card number.",
      },
    ],
    best_buy_barcode_below_number: [
      commonBoundary,
      {
        zone_name: "best_buy_card_number",
        zone_type: "card_number",
        x_pct: 12,
        y_pct: 38,
        width_pct: 54,
        height_pct: 16,
        priority: 1,
        expected_length: 16,
        notes: "Printed card number above redeemable barcode.",
      },
      {
        zone_name: "best_buy_pin",
        zone_type: "pin",
        x_pct: 58,
        y_pct: 40,
        width_pct: 25,
        height_pct: 18,
        priority: 2,
        expected_length: 4,
        notes: "PIN near/right of card number.",
      },
      {
        zone_name: "best_buy_barcode",
        zone_type: "barcode",
        x_pct: 12,
        y_pct: 54,
        width_pct: 62,
        height_pct: 20,
        priority: 3,
        expected_length: 16,
        notes: "Redeemable barcode below card number.",
      },
    ],
    best_buy_number_between_bars: [
      commonBoundary,
      {
        zone_name: "best_buy_card_number",
        zone_type: "card_number",
        x_pct: 24,
        y_pct: 42,
        width_pct: 46,
        height_pct: 16,
        priority: 1,
        expected_length: 16,
        notes: "Printed number between barcode/stripe regions.",
      },
      {
        zone_name: "best_buy_pin",
        zone_type: "pin",
        x_pct: 66,
        y_pct: 40,
        width_pct: 22,
        height_pct: 18,
        priority: 2,
        expected_length: 4,
        notes: "PIN near the number block.",
      },
      {
        zone_name: "best_buy_barcode",
        zone_type: "barcode",
        x_pct: 12,
        y_pct: 60,
        width_pct: 68,
        height_pct: 18,
        priority: 3,
        expected_length: 16,
        notes: "Primary redeemable barcode/stripe region.",
      },
    ],
    best_buy_legacy_small_pin: [
      commonBoundary,
      {
        zone_name: "best_buy_card_number",
        zone_type: "card_number",
        x_pct: 18,
        y_pct: 34,
        width_pct: 54,
        height_pct: 16,
        priority: 1,
        expected_length: 16,
        notes: "Legacy printed card number.",
      },
      {
        zone_name: "best_buy_pin",
        zone_type: "pin",
        x_pct: 62,
        y_pct: 34,
        width_pct: 24,
        height_pct: 18,
        priority: 2,
        expected_length: 4,
        notes: "Small legacy PIN area.",
      },
      {
        zone_name: "best_buy_barcode",
        zone_type: "barcode",
        x_pct: 18,
        y_pct: 52,
        width_pct: 62,
        height_pct: 20,
        priority: 3,
        expected_length: 16,
        notes: "Legacy barcode.",
      },
    ],
  };
  layouts.best_buy_unknown_manual = [
    commonBoundary,
    {
      zone_name: "best_buy_card_number",
      zone_type: "card_number",
      x_pct: 10,
      y_pct: 40,
      width_pct: 55,
      height_pct: 18,
      priority: 1,
      expected_length: 16,
      notes: "Manual Best Buy card number zone.",
    },
    {
      zone_name: "best_buy_pin",
      zone_type: "pin",
      x_pct: 60,
      y_pct: 40,
      width_pct: 25,
      height_pct: 18,
      priority: 2,
      expected_length: 4,
      notes: "Manual Best Buy PIN zone.",
    },
    {
      zone_name: "best_buy_barcode",
      zone_type: "barcode",
      x_pct: 10,
      y_pct: 58,
      width_pct: 70,
      height_pct: 22,
      priority: 3,
      expected_length: 16,
      notes: "Manual Best Buy redeemable barcode zone.",
    },
  ];

  return layouts[layoutName] ?? layouts.best_buy_barcode_above_number;
}

function parseOcrLayouts(value: string | null | undefined): OCRLayout[] {
  if (!value) {
    return [];
  }

  try {
    const parsed = JSON.parse(value) as unknown;
    const rawLayouts =
      parsed &&
      typeof parsed === "object" &&
      "layouts" in parsed &&
      Array.isArray((parsed as { layouts?: unknown }).layouts)
        ? (parsed as { layouts: unknown[] }).layouts
        : parsed &&
              typeof parsed === "object" &&
              "layout_variants" in parsed &&
              Array.isArray((parsed as { layout_variants?: unknown }).layout_variants)
          ? (parsed as { layout_variants: unknown[] }).layout_variants
          : [];

    return rawLayouts
      .filter((layout): layout is { layout_name?: string; name?: string; zones?: unknown; active?: boolean; active_managed?: boolean } => {
        return Boolean(
          layout &&
            typeof layout === "object" &&
            Array.isArray((layout as { zones?: unknown }).zones),
        );
      })
      .map((layout, index) => {
        const layoutName =
          layout.layout_name || layout.name || `layout_${index + 1}`;
        return {
          layout_name: layoutName,
          label: bestBuyLayoutLabel(layoutName),
          active: layout.active !== false,
          active_managed: layout.active_managed === true,
          coordinate_space:
            (layout as { coordinate_space?: string }).coordinate_space ??
            "card_boundary_relative",
          zones: parseOcrZones(JSON.stringify({ zones: layout.zones })),
        };
      });
  } catch {
    return [];
  }
}

function parseOcrZones(value: string | null | undefined): OCRZone[] {
  if (!value) {
    return [];
  }

  try {
    const parsed = JSON.parse(value) as unknown;
    const zones = Array.isArray(parsed)
      ? parsed
      : parsed &&
          typeof parsed === "object" &&
          "zones" in parsed &&
          Array.isArray((parsed as { zones?: unknown }).zones)
        ? (parsed as { zones: unknown[] }).zones
        : parsed &&
              typeof parsed === "object" &&
              "layouts" in parsed &&
              Array.isArray((parsed as { layouts?: unknown }).layouts)
          ? (((parsed as { layouts: Array<{ zones?: unknown }> }).layouts.find(
              (layout) => Array.isArray(layout.zones),
            )?.zones ?? []) as unknown[])
          : [];

    return zones
      .filter((zone): zone is OCRZone => {
        if (!zone || typeof zone !== "object") {
          return false;
        }

        const candidate = zone as Partial<OCRZone>;
        return (
          typeof candidate.zone_name === "string" &&
          typeof candidate.zone_type === "string" &&
          typeof candidate.x_pct === "number" &&
          typeof candidate.y_pct === "number" &&
          typeof candidate.width_pct === "number" &&
          typeof candidate.height_pct === "number"
        );
      })
      .map((zone, index) => ({
        ...zone,
        priority: zone.priority || index + 1,
      }));
  } catch {
    return [];
  }
}

function zonePresetFor(brand: string | null | undefined, preset: string): OCRZone {
  const normalizedBrand = normalizedBrandName(brand);

  if (preset === "best_buy_pin") {
    return {
      zone_name: "best_buy_pin",
      zone_type: "pin",
      x_pct: 58,
      y_pct: 42,
      width_pct: 24,
      height_pct: 16,
      priority: 1,
      expected_length: 4,
      notes: "Best Buy PIN region near/right of card number.",
    };
  }

  if (preset === "best_buy_card_number") {
    return {
      zone_name: "best_buy_card_number",
      zone_type: "card_number",
      x_pct: 14,
      y_pct: 40,
      width_pct: 50,
      height_pct: 16,
      priority: 1,
      expected_length: 16,
      notes: "Best Buy printed card number region.",
    };
  }

  if (preset === "best_buy_barcode") {
    return {
      zone_name: "best_buy_barcode",
      zone_type: "barcode",
      x_pct: 15,
      y_pct: 38,
      width_pct: 52,
      height_pct: 18,
      priority: 1,
      expected_length: 16,
      notes: "Best Buy card number/barcode region.",
    };
  }

  if (preset === "doordash_redemption") {
    return {
      zone_name: "doordash_redemption_strip",
      zone_type: "redemption_code",
      x_pct: 8,
      y_pct: 55,
      width_pct: 84,
      height_pct: 28,
      priority: 1,
      expected_length: 16,
      notes: "DoorDash lower scratch-off redemption strip.",
    };
  }

  if (preset === "uber_gift_code") {
    return {
      zone_name: "uber_gift_code_strip",
      zone_type: "redemption_code",
      x_pct: 8,
      y_pct: 55,
      width_pct: 84,
      height_pct: 28,
      priority: 1,
      expected_length: 16,
      notes: "Uber gift code strip.",
    };
  }

  if (preset === "nike_activation_barcode") {
    return {
      zone_name: "nike_activation_barcode",
      zone_type: "barcode",
      x_pct: 8,
      y_pct: 36,
      width_pct: 84,
      height_pct: 24,
      priority: 3,
      notes: "Nike large center retail/activation barcode; auxiliary POS data only.",
    };
  }

  if (preset === "nike_redeem_barcode") {
    return {
      zone_name: "nike_redeem_barcode",
      zone_type: "barcode",
      x_pct: 8,
      y_pct: 70,
      width_pct: 84,
      height_pct: 20,
      priority: 1,
      expected_length: 19,
      notes: "Nike lower redeemable card-number barcode.",
    };
  }

  if (preset === "nike_card_number") {
    return {
      zone_name: "nike_card_number",
      zone_type: "card_number",
      x_pct: 10,
      y_pct: 34,
      width_pct: 80,
      height_pct: 18,
      priority: 1,
      expected_length: 19,
      notes: "Nike printed card number region.",
    };
  }

  if (preset === "nike_pin") {
    return {
      zone_name: "nike_pin",
      zone_type: "pin",
      x_pct: 58,
      y_pct: 28,
      width_pct: 30,
      height_pct: 20,
      priority: 1,
      expected_length: 6,
      notes: "Nike optional PIN/security code region.",
    };
  }

  return {
    zone_name: normalizedBrand.includes("best buy")
      ? "credential_zone"
      : "redemption_strip",
    zone_type: normalizedBrand.includes("best buy") ? "card_number" : "redemption_code",
    x_pct: 10,
    y_pct: 55,
    width_pct: 80,
    height_pct: 25,
    priority: 1,
    expected_length: normalizedBrand.includes("best buy") ? undefined : 16,
    notes: "General credential zone.",
  };
}

function zonePresetsForBrand(brand: string | null | undefined) {
  const normalizedBrand = normalizedBrandName(brand);

  if (normalizedBrand.includes("best buy")) {
    return [
      ["best_buy_card_number", "Card number zone"],
      ["best_buy_pin", "PIN zone"],
      ["best_buy_barcode", "Barcode zone"],
    ];
  }

  if (normalizedBrand.includes("doordash")) {
    return [["doordash_redemption", "DoorDash redemption strip"]];
  }

  if (normalizedBrand.includes("uber")) {
    return [["uber_gift_code", "Uber gift code strip"]];
  }

  if (normalizedBrand.includes("nike")) {
    return [
      ["nike_activation_barcode", "Nike activation barcode"],
      ["nike_redeem_barcode", "Nike redeem barcode"],
      ["nike_card_number", "Nike card number"],
      ["nike_pin", "Nike PIN"],
    ];
  }

  return [["general", "General credential zone"]];
}

function zonesForBrand(brand: string | null | undefined, zones: OCRZone[]) {
  const normalizedBrand = normalizedBrandName(brand);

  if (normalizedBrand.includes("doordash")) {
    return zones.filter(
      (zone) =>
        zone.zone_name === "card_boundary" ||
        zone.zone_type === "redemption_code" ||
        zone.zone_name === "doordash_redemption_strip",
    );
  }

  return zones;
}

function formatManualCredential(value: string) {
  const normalized = value.replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
  if (normalized.length === 16) {
    return normalized.match(/.{1,4}/g)?.join(" ") ?? normalized;
  }
  return value.trim();
}

function isValidManualCredentialForBrand(
  value: string,
  brand: string | null | undefined,
) {
  const normalized = value.replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
  const normalizedBrand = normalizedBrandName(brand);

  if (normalizedBrand.includes("doordash")) {
    return /^NAAW[A-Z0-9]{12}$/.test(normalized);
  }

  if (normalizedBrand.includes("uber")) {
    return /^NAAD[A-Z0-9]{12}$/.test(normalized);
  }

  return normalized.length > 0;
}

function applyCredentialCandidate(
  candidate: OCRCandidatePayload,
  {
    brand,
    isRedemptionCodeOnly,
    setForm,
  }: {
    brand?: string | null;
    isRedemptionCodeOnly: boolean;
    setForm: Dispatch<SetStateAction<VerificationForm>>;
  },
) {
  const normalizedCandidateType = candidate.candidate_type.toLowerCase();

  if (!isCandidateValidForBrand(candidate, brand)) {
    return;
  }

  setForm((currentForm) => ({
    ...currentForm,
    card_number:
      normalizedCandidateType === "pin" ? currentForm.card_number : candidate.value,
    pin:
      isRedemptionCodeOnly
        ? ""
        : normalizedCandidateType === "pin"
          ? candidate.value
          : currentForm.pin,
    confirmed_source: candidate.source || "OCR",
  }));
}

function candidateTargetLabel(
  candidate: Pick<OCRCandidatePayload, "candidate_type">,
  isRedemptionCodeOnly: boolean,
) {
  const normalizedCandidateType = candidate.candidate_type.toLowerCase();
  if (normalizedCandidateType === "pin") {
    return "PIN";
  }
  if (normalizedCandidateType === "redemption_code" || isRedemptionCodeOnly) {
    return "Redemption Code";
  }
  return "Card Number";
}

function candidateTypeForZone(zoneType: string, isRedemptionCodeOnly: boolean) {
  if (zoneType === "pin") {
    return "pin";
  }
  if (zoneType === "redemption_code" || isRedemptionCodeOnly) {
    return "redemption_code";
  }
  return "card_number";
}

function clampPercent(value: number) {
  return Math.max(0, Math.min(100, value));
}

function isDefaultishBestBuyBoundary(boundary: OCRZone | undefined) {
  if (!boundary) {
    return true;
  }

  return (
    boundary.x_pct <= 3 &&
    boundary.y_pct <= 3 &&
    boundary.width_pct >= 94 &&
    boundary.height_pct >= 94
  );
}

function zoneImageBox(zone: OCRZone, boundary: OCRZone | undefined) {
  if (!boundary || zone.zone_name === "card_boundary") {
    return {
      x_pct: clampPercent(zone.x_pct),
      y_pct: clampPercent(zone.y_pct),
      width_pct: Math.max(0, Math.min(100 - zone.x_pct, zone.width_pct)),
      height_pct: Math.max(0, Math.min(100 - zone.y_pct, zone.height_pct)),
    };
  }

  const x = boundary.x_pct + (zone.x_pct / 100) * boundary.width_pct;
  const y = boundary.y_pct + (zone.y_pct / 100) * boundary.height_pct;
  const width = (zone.width_pct / 100) * boundary.width_pct;
  const height = (zone.height_pct / 100) * boundary.height_pct;

  return {
    x_pct: clampPercent(x),
    y_pct: clampPercent(y),
    width_pct: Math.max(0, Math.min(100 - x, width)),
    height_pct: Math.max(0, Math.min(100 - y, height)),
  };
}

export default function GiftCardVerificationPage() {
  const params = useParams<{ id: string | string[] }>();
  const router = useRouter();
  const searchParams = useSearchParams();
  const giftCardId = Array.isArray(params.id) ? params.id[0] : params.id;

  const [giftCard, setGiftCard] = useState<GiftCard | null>(null);
  const [cardImages, setCardImages] = useState<CardImage[]>([]);
  const [receipts, setReceipts] = useState<Receipt[]>([]);
  const [extractionAttempts, setExtractionAttempts] = useState<
    ExtractionAttempt[]
  >([]);
  const [extractionCandidates, setExtractionCandidates] = useState<
    ExtractionCandidate[]
  >([]);
  const [form, setForm] = useState<VerificationForm>({
    card_number: "",
    pin: "",
    face_value: "",
    notes: "",
    confirmed_source: "manual",
  });
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [imageRotation, setImageRotation] = useState(0);
  const [isUploadingImage, setIsUploadingImage] = useState(false);
  const [isRescanningImage, setIsRescanningImage] = useState(false);
  const [isSavingOcrOrientation, setIsSavingOcrOrientation] = useState(false);
  const [imageUploadError, setImageUploadError] = useState<string | null>(null);
  const [imageUploadMessage, setImageUploadMessage] = useState<string | null>(
    null,
  );
  const [cleanupAction, setCleanupAction] = useState<"delete" | "void" | null>(
    null,
  );
  const [cleanupError, setCleanupError] = useState<string | null>(null);
  const [cleanupMessage, setCleanupMessage] = useState<string | null>(null);
  const [cleanupReport, setCleanupReport] = useState<CleanupReport | null>(
    null,
  );
  const [cleanupReportRequestKey, setCleanupReportRequestKey] = useState(0);
  const [isLoadingCleanupReport, setIsLoadingCleanupReport] = useState(false);
  const [isCleaningUpCard, setIsCleaningUpCard] = useState(false);
  const [duplicateWarning, setDuplicateWarning] =
    useState<DuplicateCardWarning | null>(null);
  const [showLockedCredentials, setShowLockedCredentials] = useState(false);
  const [allowLockedCredentialUpdate, setAllowLockedCredentialUpdate] =
    useState(false);
  const [zoneTemplateMessage, setZoneTemplateMessage] = useState<string | null>(null);
  const [zoneTemplateError, setZoneTemplateError] = useState<string | null>(null);
  const [isTestingZone, setIsTestingZone] = useState(false);
  const [zoneTestResult, setZoneTestResult] = useState<OCRZoneTestResult | null>(
    null,
  );
  const [zoneTestStage, setZoneTestStage] = useState<string | null>(null);
  const [savedOcrZones, setSavedOcrZones] = useState<OCRZone[]>([]);
  const cleanupGiftCardId = giftCard?.id ?? null;
  const cleanupGiftCardFallback = useMemo(
    () =>
      cleanupGiftCardId
        ? {
            id: cleanupGiftCardId,
            brand: giftCard?.brand ?? "Gift card",
            status: giftCard?.status ?? "UNKNOWN",
          }
        : null,
    [cleanupGiftCardId, giftCard?.brand, giftCard?.status],
  );
  const [ocrLayouts, setOcrLayouts] = useState<OCRLayout[]>([]);
  const [selectedBestBuyLayout, setSelectedBestBuyLayout] = useState("auto");
  const [zoneTrainingMode, setZoneTrainingMode] = useState<
    "idle" | "boundary" | "new_zone" | "edit_zone"
  >("idle");
  const [selectedZoneName, setSelectedZoneName] = useState<string | null>(null);
  const [canonicalImageSize, setCanonicalImageSize] = useState<{
    width: number;
    height: number;
  } | null>(null);
  const [canonicalDisplaySize, setCanonicalDisplaySize] = useState<{
    width: number;
    height: number;
  } | null>(null);
  const [canonicalRenderedSize, setCanonicalRenderedSize] = useState<{
    width: number;
    height: number;
  } | null>(null);
  const [zoneTemplateSaved, setZoneTemplateSaved] = useState(false);
  const [manualZoneCredential, setManualZoneCredential] = useState("");
  const zoneCanvasRef = useRef<HTMLDivElement | null>(null);
  const savedReviewImageRef = useRef<HTMLImageElement | null>(null);
  const dragStartRef = useRef<{ x: number; y: number } | null>(null);
  const [zoneForm, setZoneForm] = useState({
    zone_name: "credential_zone",
    zone_type: "redemption_code",
    x_pct: "10",
    y_pct: "60",
    width_pct: "80",
    height_pct: "25",
    priority: "1",
  });

  const primaryImage = useMemo(() => {
    return (
      cardImages.find(
        (image) =>
          image.image_type === "primary" &&
          (image.retention_status ?? "active") !== "purged",
      ) ??
      null
    );
  }, [cardImages]);
  const supportingAttachments = useMemo(
    () =>
      cardImages.filter(
        (image) =>
          image.image_type !== "primary" ||
          (image.retention_status ?? "active") === "purged",
      ),
    [cardImages],
  );
  const isDigitalCard = giftCard?.card_source === "digital";
  const ocrReady = isOcrReadyStatus(giftCard?.ocr_status);
  const canonicalReady = Boolean(
    primaryImage?.processed_image_url &&
      isCanonicalReadyStatus(giftCard?.ocr_status),
  );
  const currentExtractionCandidates = ocrReady ? extractionCandidates : [];

  const bestCardNumberCandidate = useMemo(
    () => getBestCandidate(currentExtractionCandidates, "card_number", giftCard?.brand),
    [currentExtractionCandidates, giftCard?.brand],
  );

  const bestPinCandidate = useMemo(
    () => getBestCandidate(currentExtractionCandidates, "pin", giftCard?.brand),
    [currentExtractionCandidates, giftCard?.brand],
  );

  const otherCardNumberCandidates = useMemo(
    () =>
      getUsefulCandidates(
        currentExtractionCandidates,
        "card_number",
        bestCardNumberCandidate?.id,
        giftCard?.brand,
      ),
    [bestCardNumberCandidate?.id, currentExtractionCandidates, giftCard?.brand],
  );

  const otherPinCandidates = useMemo(
    () =>
      getUsefulCandidates(
        currentExtractionCandidates,
        "pin",
        bestPinCandidate?.id,
        giftCard?.brand,
      ),
    [bestPinCandidate?.id, currentExtractionCandidates, giftCard?.brand],
  );

  const latestExtractionAttempt = ocrReady ? extractionAttempts[0] ?? null : null;
  const rejectedCandidates = useMemo(
    () =>
      currentExtractionCandidates.filter(
        (candidate) => candidate.candidate_type === "rejected",
      ),
    [currentExtractionCandidates],
  );
  const usefulExtractionCandidateCount = useMemo(
    () =>
      currentExtractionCandidates.filter(
        (candidate) => candidate.candidate_type !== "rejected",
      ).length,
    [currentExtractionCandidates],
  );
  const selectedOcrRotation = ocrDebugValue(
    latestExtractionAttempt?.raw_text,
    "OCR_SELECTED_ROTATION_DEGREES",
  );
  const selectedOcrImageSource = ocrDebugValue(
    latestExtractionAttempt?.raw_text,
    "OCR_SELECTED_IMAGE_SOURCE",
  );
  const appliedTemplateRotation = ocrDebugValue(
    latestExtractionAttempt?.raw_text,
    "OCR_APPLIED_TEMPLATE_ROTATION",
  );
  const persistedCanonicalRotation = ocrDebugValue(
    latestExtractionAttempt?.raw_text,
    "OCR_CANONICAL_PERSISTED_ROTATION",
  );
  const canonicalRotation = ocrDebugValue(
    latestExtractionAttempt?.raw_text,
    "OCR_CANONICAL_ROTATION_DEGREES",
  );
  const canonicalOrientationSource = ocrDebugValue(
    latestExtractionAttempt?.raw_text,
    "OCR_CANONICAL_ORIENTATION_SOURCE",
  );
  const canonicalOrientationScore = ocrDebugValue(
    latestExtractionAttempt?.raw_text,
    "OCR_CANONICAL_ORIENTATION_SCORE",
  );
  const canonicalCoordinateSpace = ocrDebugValue(
    latestExtractionAttempt?.raw_text,
    "OCR_CANONICAL_COORDINATE_SPACE",
  );
  const canonicalOrientationTrials = ocrDebugValue(
    latestExtractionAttempt?.raw_text,
    "OCR_CANONICAL_ORIENTATION_TRIALS",
  );
  const canonicalReasonSelected = ocrDebugValue(
    latestExtractionAttempt?.raw_text,
    "OCR_CANONICAL_REASON_SELECTED",
  );
  const selectedTemplateLayout = ocrDebugValue(
    latestExtractionAttempt?.raw_text,
    "OCR_SELECTED_TEMPLATE_LAYOUT",
  );
  const selectedTemplateConfidence = ocrDebugValue(
    latestExtractionAttempt?.raw_text,
    "OCR_SELECTED_TEMPLATE_CONFIDENCE",
  );
  const templateMismatch = ocrDebugValue(
    latestExtractionAttempt?.raw_text,
    "OCR_TEMPLATE_MISMATCH",
  );
  const detectedOcrProfile = ocrDebugValue(
    latestExtractionAttempt?.raw_text,
    "OCR_BRAND_PROFILE",
  );
  const detectedCredentialType = ocrDebugValue(
    latestExtractionAttempt?.raw_text,
    "OCR_DETECTED_CREDENTIAL_TYPE",
  );
  const preprocessingMethod = ocrDebugValue(
    latestExtractionAttempt?.raw_text,
    "OCR_PREPROCESSING",
  );
  const debugDisplayImageUsed = ocrDebugValue(
    latestExtractionAttempt?.raw_text,
    "OCR_DISPLAY_IMAGE_USED",
  );
  const debugOcrImageUsed = ocrDebugValue(
    latestExtractionAttempt?.raw_text,
    "OCR_IMAGE_USED",
  );
  const debugBarcodeImageUsed = ocrDebugValue(
    latestExtractionAttempt?.raw_text,
    "OCR_BARCODE_IMAGE_USED",
  );
  const debugSavedReviewImageDimensions = ocrDebugValue(
    latestExtractionAttempt?.raw_text,
    "OCR_SAVED_REVIEW_IMAGE_DIMENSIONS",
  );
  const debugTemplateCoordinateSource = ocrDebugValue(
    latestExtractionAttempt?.raw_text,
    "OCR_TEMPLATE_COORDINATE_SOURCE",
  );
  const debugOcrZoneImageNaturalSize = ocrDebugValue(
    latestExtractionAttempt?.raw_text,
    "OCR_ZONE_IMAGE_NATURAL_SIZE",
  );
  const debugOcrCardBoundary = ocrDebugValue(
    latestExtractionAttempt?.raw_text,
    "OCR_CARD_BOUNDARY",
  );
  const ocrModeResults = ocrDebugBlock(
    latestExtractionAttempt?.raw_text,
    "OCR_MODE_RESULTS",
    "OCR_SELECTION_NOTES",
  );
  const isSaleLocked = ["SOLD", "SOLD_PENDING_PAYMENT", "SETTLED"].includes(
    giftCard?.status ?? "",
  );
  const isInactiveCard = ["VOID", "VOIDED", "ARCHIVED"].includes(
    giftCard?.status ?? "",
  );
  const isBestBuyCard = normalizedBrandName(giftCard?.brand).includes("best buy");
  const activeBestBuyLayoutOptions = ocrLayouts
    .filter((layout) => layout.active && !LEGACY_BEST_BUY_LAYOUT_NAMES.has(layout.layout_name))
    .map((layout) => [layout.layout_name, layout.label] as const);
  const bestBuyLayoutOptions = [
    ["auto", "Auto"] as const,
    ...activeBestBuyLayoutOptions.filter(
      ([value], index, options) =>
        options.findIndex(([candidate]) => candidate === value) === index,
    ),
  ];
  const isRedemptionCodeOnly = isRedemptionCodeOnlyBrand(giftCard?.brand);
  const primaryCredentialLabel = isRedemptionCodeOnly
    ? "Confirmed Redemption Code"
    : "Confirmed Card Number";
  const lockedPrimaryValue = credentialValue(giftCard);
  const lockedPinValue = credentialPin(giftCard);
  const cardSuggestionMismatch = credentialsDiffer(
    lockedPrimaryValue,
    bestCardNumberCandidate?.value,
  );
  const pinSuggestionMismatch =
    !isRedemptionCodeOnly &&
    credentialsDiffer(lockedPinValue, bestPinCandidate?.value);
  const reviewImagePath =
    primaryImage?.processed_image_url ?? primaryImage?.original_image_url ?? null;
  const savedReviewOcrImageUrl = buildUploadUrlWithVersion(
    primaryImage?.processed_image_url,
    primaryImage?.canonical_transform_metadata ?? primaryImage?.canonical_rotation_degrees,
  );
  const originalUploadPreviewUrl = buildUploadUrl(primaryImage?.original_image_url);
  const reviewImageUrl = primaryImage?.processed_image_url
    ? savedReviewOcrImageUrl
    : originalUploadPreviewUrl;
  const savedRotationLabel =
    canonicalRotation ??
    (primaryImage?.canonical_rotation_degrees !== null &&
    primaryImage?.canonical_rotation_degrees !== undefined
      ? String(primaryImage.canonical_rotation_degrees)
      : null);
  const savedOrientationSource =
    canonicalOrientationSource ?? primaryImage?.orientation_source ?? null;
  const orientationStatusLabel = savedRotationLabel
    ? savedOrientationSource === "manual"
      ? `Manual orientation saved: ${savedRotationLabel}°`
      : savedOrientationSource === "auto"
        ? `Auto orientation selected: ${savedRotationLabel}°`
        : `OCR orientation saved: ${savedRotationLabel}°`
    : null;
  const currentZone: OCRZone = {
    zone_name: zoneForm.zone_name.trim() || "credential_zone",
    zone_type: zoneForm.zone_type,
    x_pct: Number(zoneForm.x_pct) || 0,
    y_pct: Number(zoneForm.y_pct) || 0,
    width_pct: Number(zoneForm.width_pct) || 0,
    height_pct: Number(zoneForm.height_pct) || 0,
    priority: Number(zoneForm.priority) || 1,
    expected_length: isRedemptionCodeOnly ? 16 : undefined,
    notes: "Saved from visual OCR zone trainer.",
  };
  const boundaryZone = savedOcrZones.find(
    (zone) => zone.zone_name === "card_boundary",
  );
  const credentialZones = savedOcrZones.filter(
    (zone) => zone.zone_name !== "card_boundary",
  );
  const hasBoundary = Boolean(boundaryZone);
  const bestBuyBoundaryNeedsAdjustment =
    isBestBuyCard && isDefaultishBestBuyBoundary(boundaryZone);
  const hasCredentialZone = credentialZones.length > 0;
  const coordinateMode = hasBoundary
    ? "card-boundary-relative"
    : "full-image-relative";
  const currentZoneImageBox = zoneImageBox(currentZone, boundaryZone);
  const selectedZonePixelBox = canonicalImageSize
    ? {
        x: Math.round((currentZoneImageBox.x_pct / 100) * canonicalImageSize.width),
        y: Math.round((currentZoneImageBox.y_pct / 100) * canonicalImageSize.height),
        width: Math.round((currentZoneImageBox.width_pct / 100) * canonicalImageSize.width),
        height: Math.round((currentZoneImageBox.height_pct / 100) * canonicalImageSize.height),
      }
    : null;
  const selectedZoneRenderedBox = canonicalRenderedSize
    ? {
        x: Math.round((currentZoneImageBox.x_pct / 100) * canonicalRenderedSize.width),
        y: Math.round((currentZoneImageBox.y_pct / 100) * canonicalRenderedSize.height),
        width: Math.round((currentZoneImageBox.width_pct / 100) * canonicalRenderedSize.width),
        height: Math.round((currentZoneImageBox.height_pct / 100) * canonicalRenderedSize.height),
      }
    : null;
  const isZoneDrawingEnabled = ["boundary", "new_zone", "edit_zone"].includes(
    zoneTrainingMode,
  );
  const zoneCropMismatch = Boolean(
    zoneTestResult &&
      (Math.abs(zoneTestResult.selected_crop.x_pct - currentZone.x_pct) > 0.25 ||
        Math.abs(zoneTestResult.selected_crop.y_pct - currentZone.y_pct) > 0.25 ||
        Math.abs(zoneTestResult.selected_crop.width_pct - currentZone.width_pct) > 0.25 ||
        Math.abs(zoneTestResult.selected_crop.height_pct - currentZone.height_pct) > 0.25),
  );
  const manualCredentialHasValue = manualZoneCredential.length > 0;
  const zonePreferredCandidateType =
    currentZone.zone_type === "pin" ? "pin" : "card_number";
  const zonePromotedCandidates =
    zoneTestResult?.promoted_candidates.filter(
      (candidate) => candidate.candidate_type === zonePreferredCandidateType,
    ) ?? [];
  const downloadOcrDebug = () => {
    if (!zoneTestResult || !giftCard) {
      return;
    }

    const debugPayload = {
      exported_at: new Date().toISOString(),
      card_id: giftCard.id,
      brand: giftCard.brand,
      selected_template: currentZone,
      source_image_paths: {
        original: primaryImage?.original_image_url ?? null,
        processed: primaryImage?.processed_image_url ?? null,
        debug_images: zoneTestResult.debug_image_paths,
      },
      crop_coordinates: {
        selected_crop: zoneTestResult.selected_crop,
        padded_crop: zoneTestResult.crop,
      },
      preprocessing_passes: zoneTestResult.ocr_passes,
      raw_ocr_text: zoneTestResult.raw_text,
      parsed_candidates: zoneTestResult.promoted_candidates,
      rejected_candidates: zoneTestResult.candidates.filter(
        (candidate) => candidate.candidate_type === "rejected",
      ),
      barcode_attempts: zoneTestResult.barcode_attempts,
      stored_rejected_candidates: rejectedCandidates.map((candidate) => ({
        candidate_type: candidate.candidate_type,
        source: candidate.source,
        value: candidate.value,
        confidence_score: candidate.confidence_score,
        notes: candidate.notes,
        created_at: candidate.created_at,
      })),
      final_selected_candidate: zoneTestResult.best_candidate,
      timing: {
        total_ms: zoneTestResult.timing_ms,
        timed_out: zoneTestResult.timed_out,
        stages: zoneTestResult.stage_timings,
      },
    };
    const blob = new Blob([JSON.stringify(debugPayload, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `ocr-debug-card-${giftCard.id}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  };
  const explicitReturnTo = searchParams.get("returnTo");
  const purchaseHref = giftCard
    ? `/purchases/${giftCard.purchase_batch_id}`
    : "/";
  const backHref =
    explicitReturnTo && explicitReturnTo.startsWith("/")
      ? explicitReturnTo
      : purchaseHref;

  function getReturnHref() {
    if (explicitReturnTo && explicitReturnTo.startsWith("/")) {
      return explicitReturnTo;
    }

    if (typeof window !== "undefined" && document.referrer) {
      try {
        const referrerUrl = new URL(document.referrer);

        if (referrerUrl.origin === window.location.origin) {
          if (
            referrerUrl.pathname.startsWith("/verification") ||
            referrerUrl.pathname.startsWith("/purchases/") ||
            referrerUrl.pathname.startsWith("/inventory")
          ) {
            return `${referrerUrl.pathname}${referrerUrl.search}`;
          }
        }
      } catch {
        // Fall back below when the referrer is unavailable or malformed.
      }
    }

    return "/inventory";
  }

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
          setReceipts(details.receipts);
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

  useEffect(() => {
    let isMounted = true;

    async function loadBrandOcrTemplate() {
      if (!giftCard?.brand) {
        return;
      }

      try {
        const response = await fetch(
          `${API_BASE_URL}/card-brands/by-name/${encodeURIComponent(
            giftCard.brand,
          )}/ocr-template`,
        );

        if (!response.ok) {
          return;
        }

        const template = (await response.json()) as { ocr_zones?: string | null };
        const parsedLayouts = parseOcrLayouts(template.ocr_zones);
        const layouts = normalizedBrandName(giftCard.brand).includes("best buy")
          ? normalizeBestBuyLayouts(parsedLayouts)
          : parsedLayouts;
        const defaultBestBuyLayout =
          layouts.find((layout) => layout.active)?.layout_name ??
          "best_buy_barcode_above_number";
        const zones = zonesForBrand(
          giftCard.brand,
          layouts.length > 0
            ? layouts.find((layout) => layout.layout_name === defaultBestBuyLayout)
                ?.zones ?? layouts[0].zones
            : parseOcrZones(template.ocr_zones),
        );

        if (isMounted) {
          setOcrLayouts(layouts);
          if (normalizedBrandName(giftCard.brand).includes("best buy")) {
            setSelectedBestBuyLayout("auto");
          }
          setSavedOcrZones(zones);
          setZoneTemplateSaved(true);

          if (zones[0]) {
            setZoneForm({
              zone_name: zones[0].zone_name,
              zone_type: zones[0].zone_type,
              x_pct: String(zones[0].x_pct),
              y_pct: String(zones[0].y_pct),
              width_pct: String(zones[0].width_pct),
              height_pct: String(zones[0].height_pct),
              priority: String(zones[0].priority || 1),
            });
          }
        }
      } catch {
        // Template loading is optional; verification can continue without it.
      }
    }

    void loadBrandOcrTemplate();

    return () => {
      isMounted = false;
    };
  }, [giftCard?.brand]);

  useEffect(() => {
    let isMounted = true;

    async function loadCleanupReport() {
      if (!cleanupAction || !cleanupGiftCardId) {
        setCleanupReport(null);
        setIsLoadingCleanupReport(false);
        return;
      }

      const endpoint = `${API_BASE_URL}/gift-cards/${cleanupGiftCardId}/cleanup-report`;
      setIsLoadingCleanupReport(true);
      setCleanupError(null);

      try {
        const response = await fetch(endpoint);
        const body = await readResponseBody(response);

        if (!response.ok) {
          console.error("Gift card cleanup report request failed", {
            endpoint,
            status: response.status,
            responseBody: body,
          });
          throw new Error(
            backendErrorMessage(
              body,
              `Failed to inspect cleanup dependencies (${response.status})`,
            ),
          );
        }

        if (isMounted) {
          const report = normalizeCleanupReport(body, cleanupGiftCardFallback);

          if (!report) {
            throw new Error("Cleanup report response was not recognized.");
          }

          setCleanupReport(report);
          setCleanupError(null);
        }
      } catch (err) {
        if (isMounted) {
          console.error("Gift card cleanup report failed", {
            endpoint,
            giftCardId: cleanupGiftCardId,
            error: err,
          });
          setCleanupReport(null);
          setCleanupError(
            err instanceof Error
              ? err.message
              : "Failed to inspect cleanup dependencies.",
          );
        }
      } finally {
        if (isMounted) {
          setIsLoadingCleanupReport(false);
        }
      }
    }

    void loadCleanupReport();

    return () => {
      isMounted = false;
    };
  }, [
    cleanupAction,
    cleanupGiftCardFallback,
    cleanupGiftCardId,
    cleanupReportRequestKey,
  ]);

  useEffect(() => {
    const image = savedReviewImageRef.current;
    if (!image) {
      return;
    }

    const measure = () => {
      const renderedRect = image.getBoundingClientRect();
      setCanonicalRenderedSize({
        width: Math.round(renderedRect.width),
        height: Math.round(renderedRect.height),
      });
      if (image.naturalWidth && image.naturalHeight) {
        setCanonicalImageSize({
          width: image.naturalWidth,
          height: image.naturalHeight,
        });
      }
    };

    measure();
    const resizeObserver = new ResizeObserver(measure);
    resizeObserver.observe(image);
    window.addEventListener("resize", measure);

    return () => {
      resizeObserver.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [reviewImageUrl]);

  useEffect(() => {
    if (!primaryImage || !giftCard || !isOcrPendingStatus(giftCard.ocr_status)) {
      return;
    }

    let isMounted = true;
    let didLoadFinalResults = false;

    async function pollOcrStatus() {
      if (!primaryImage) {
        return;
      }

      try {
        const response = await fetch(
          `${API_BASE_URL}/card-images/${primaryImage.id}/ocr-status`,
        );

        if (!response.ok) {
          return;
        }

        const status = (await response.json()) as CardImageOcrStatus;

        if (!isMounted) {
          return;
        }

        setGiftCard((currentGiftCard) =>
          currentGiftCard
            ? {
                ...currentGiftCard,
                ocr_status: status.ocr_status ?? currentGiftCard.ocr_status,
              }
            : currentGiftCard,
        );
        setCardImages((currentImages) =>
          currentImages.map((image) =>
            image.id === status.card_image_id
              ? {
                  ...image,
                  processed_image_url:
                    status.processed_image_url ?? image.processed_image_url,
                  canonical_rotation_degrees:
                    status.canonical_rotation_degrees ??
                    image.canonical_rotation_degrees,
                  orientation_source:
                    status.orientation_source ?? image.orientation_source,
                  canonical_transform_metadata:
                    status.canonical_transform_metadata ??
                    image.canonical_transform_metadata,
                }
              : image,
          ),
        );

        if (
          status.ocr_status &&
          !isOcrPendingStatus(status.ocr_status) &&
          !didLoadFinalResults
        ) {
          didLoadFinalResults = true;
          const details = await loadGiftCardVerificationDetails(giftCardId);
          if (!isMounted) {
            return;
          }
          setGiftCard(details.giftCard);
          setCardImages(details.cardImages);
          setReceipts(details.receipts);
          setExtractionAttempts(details.extractionAttempts);
          setExtractionCandidates(details.extractionCandidates);
          setForm(getInitialVerificationForm(details));
          setImageUploadMessage(
            status.ocr_status === "failed"
              ? "OCR failed. Manual verification is still available."
              : "OCR completed.",
          );
        }
      } catch {
        // Polling is best-effort; the page remains usable for manual entry.
      }
    }

    void pollOcrStatus();
    const intervalId = window.setInterval(() => {
      void pollOcrStatus();
    }, 2500);

    return () => {
      isMounted = false;
      window.clearInterval(intervalId);
    };
  }, [giftCard, giftCardId, primaryImage]);

  async function handleImageUpload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];

    if (!file) {
      return;
    }

    setIsUploadingImage(true);
    setImageUploadError(null);
    setImageUploadMessage(null);
    setExtractionAttempts([]);
    setExtractionCandidates([]);
    setZoneTestResult(null);
    setGiftCard((currentGiftCard) =>
      currentGiftCard
        ? { ...currentGiftCard, ocr_status: "uploading" }
        : currentGiftCard,
    );

    try {
      const formData = new FormData();
      formData.append("gift_card_id", giftCardId);
      formData.append("file", file);
      const isDigitalUpload = giftCard?.card_source === "digital";
      formData.append(
        "image_type",
        isDigitalUpload ? "digital_attachment" : "primary",
      );
      formData.append(
        "attachment_type",
        isDigitalUpload
          ? file.name.toLowerCase().endsWith(".pdf")
            ? "digital_pdf"
            : "digital_image"
          : "card_image",
      );
      formData.append("run_ocr", String(!isDigitalUpload));

      const response = await fetch(`${API_BASE_URL}/card-images/upload`, {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        throw new Error(`Failed to upload image (${response.status})`);
      }

      const savedImage = (await response.json()) as CardImage & {
        ocr_status?: string;
        message?: string;
      };
      setCardImages((currentImages) => [
        savedImage,
        ...currentImages.filter((image) => image.id !== savedImage.id),
      ]);
      setGiftCard((currentGiftCard) =>
        currentGiftCard
          ? {
              ...currentGiftCard,
              ocr_status: savedImage.ocr_status ?? "uploading",
            }
          : currentGiftCard,
      );
      setImageRotation(0);
      setImageUploadMessage(
        savedImage.message ??
          (isDigitalUpload
            ? "Attachment saved. OCR was not queued."
            : "Image saved — OCR queued."),
      );
    } catch (err) {
      setImageUploadError(
        err instanceof Error ? err.message : "Failed to upload image.",
      );
    } finally {
      event.target.value = "";
      setIsUploadingImage(false);
    }
  }

  async function rescanPrimaryImage(
    successText = "OCR re-scanned.",
    options: { preserveSavedTemplate?: boolean; sync?: boolean } = {},
  ) {
    if (!primaryImage) {
      return;
    }

    setIsRescanningImage(true);
    setImageUploadError(null);
    setImageUploadMessage(null);
    setExtractionAttempts([]);
    setExtractionCandidates([]);
    setZoneTestResult(null);
    setGiftCard((currentGiftCard) =>
      currentGiftCard
        ? { ...currentGiftCard, ocr_status: "preprocessing" }
        : currentGiftCard,
    );

    const endpoint = `${API_BASE_URL}/card-images/${primaryImage.id}/rescan${
      options.sync ? "?sync=true" : ""
    }`;

    try {
      const response = await fetch(endpoint, {
        method: "POST",
      });

      if (!response.ok) {
        const responseBody = await readResponseBody(response);
        console.error("Card image rescan failed", {
          endpoint,
          status: response.status,
          responseBody,
        });
        throw new Error(
          backendErrorMessage(
            responseBody,
            `Failed to re-scan card image (${response.status})`,
          ),
        );
      }

      const result = (await response.json()) as {
        ocr_status?: string;
        message?: string;
      };

      if (options.sync) {
        const details = await loadGiftCardVerificationDetails(giftCardId);
        setGiftCard(details.giftCard);
        setCardImages(details.cardImages);
        setReceipts(details.receipts);
        setExtractionAttempts(details.extractionAttempts);
        setExtractionCandidates(details.extractionCandidates);
        setForm(getInitialVerificationForm(details));
        setZoneTestResult(null);
        if (options.preserveSavedTemplate) {
          setZoneTemplateSaved(true);
          setZoneTemplateMessage(
            "Saved template OCR completed. Review the updated suggestions.",
          );
        } else {
          setSelectedZoneName(null);
          setZoneTrainingMode("idle");
          setZoneTemplateSaved(false);
          setZoneTemplateMessage(
            "OCR completed. Review the updated suggestions from the saved Review/OCR image.",
          );
        }
        setImageUploadMessage(result.message ?? successText);
        return;
      }

      setGiftCard((currentGiftCard) =>
        currentGiftCard
          ? {
              ...currentGiftCard,
              ocr_status: result.ocr_status ?? "preprocessing",
            }
          : currentGiftCard,
      );
      setZoneTestResult(null);
      if (options.preserveSavedTemplate) {
        setZoneTemplateSaved(true);
        setZoneTemplateMessage(
          "Saved template OCR queued. Refresh shortly to see updated suggestions.",
        );
      } else {
        setSelectedZoneName(null);
        setZoneTrainingMode("idle");
        setZoneTemplateSaved(false);
        setZoneTemplateMessage(
          "OCR queued. Draw or test zones against the saved Review/OCR image while processing runs.",
        );
      }
      setImageUploadMessage(result.message ?? successText);
    } catch (err) {
      setImageUploadError(
        err instanceof Error ? err.message : "Failed to re-scan card image.",
      );
    } finally {
      setIsRescanningImage(false);
    }
  }

  async function setSavedOcrOrientation() {
    if (!primaryImage) {
      return;
    }

    setIsSavingOcrOrientation(true);
    setImageUploadError(null);
    setImageUploadMessage(null);
    setExtractionAttempts([]);
    setExtractionCandidates([]);
    setZoneTestResult(null);
    setGiftCard((currentGiftCard) =>
      currentGiftCard
        ? { ...currentGiftCard, ocr_status: "preprocessing" }
        : currentGiftCard,
    );

    const normalizedRotation = ((imageRotation % 360) + 360) % 360;
    const sourceImage = primaryImage.processed_image_url
      ? "saved_review_ocr"
      : "original_upload";
    const endpoint = `${API_BASE_URL}/card-images/${primaryImage.id}/set-ocr-orientation?rotation_degrees=${normalizedRotation}&source_image=${sourceImage}`;

    try {
      const response = await fetch(endpoint, {
        method: "POST",
      });

      if (!response.ok) {
        const responseBody = await readResponseBody(response);
        console.error("Set OCR orientation failed", {
          endpoint,
          status: response.status,
          responseBody,
        });
        throw new Error(
          backendErrorMessage(
            responseBody,
            `Failed to set OCR orientation (${response.status})`,
          ),
        );
      }

      const details = await loadGiftCardVerificationDetails(giftCardId);
      setGiftCard(details.giftCard);
      setCardImages(details.cardImages);
      setReceipts(details.receipts);
      setExtractionAttempts(details.extractionAttempts);
      setExtractionCandidates(details.extractionCandidates);
      setZoneTestResult(null);
      setSelectedZoneName(null);
      setZoneTrainingMode("idle");
      setZoneTemplateSaved(true);
      setImageRotation(0);
      setCanonicalImageSize(null);
      setCanonicalRenderedSize(null);
      setImageUploadMessage(
        "Saved Review/OCR Image updated. OCR and zones will use this orientation.",
      );
    } catch (err) {
      setImageUploadError(
        err instanceof Error ? err.message : "Failed to set OCR orientation.",
      );
    } finally {
      setIsSavingOcrOrientation(false);
    }
  }

  function updateZoneFromPointer(event: PointerEvent<HTMLDivElement>) {
    if (!isZoneDrawingEnabled) {
      return;
    }

    const element = zoneCanvasRef.current;
    const start = dragStartRef.current;

    if (!element || !start) {
      return;
    }

    const rect = element.getBoundingClientRect();
    const fullX = ((event.clientX - rect.left) / rect.width) * 100;
    const fullY = ((event.clientY - rect.top) / rect.height) * 100;
    const usesBoundary =
      Boolean(boundaryZone) &&
      zoneTrainingMode !== "boundary" &&
      currentZone.zone_name !== "card_boundary";
    const currentX = usesBoundary
      ? clampPercent(((fullX - boundaryZone!.x_pct) / boundaryZone!.width_pct) * 100)
      : clampPercent(fullX);
    const currentY = usesBoundary
      ? clampPercent(((fullY - boundaryZone!.y_pct) / boundaryZone!.height_pct) * 100)
      : clampPercent(fullY);
    const x = Math.max(0, Math.min(start.x, currentX));
    const y = Math.max(0, Math.min(start.y, currentY));
    const width = Math.min(100 - x, Math.abs(currentX - start.x));
    const height = Math.min(100 - y, Math.abs(currentY - start.y));

    setZoneForm((currentForm) => ({
      ...currentForm,
      x_pct: x.toFixed(2),
      y_pct: y.toFixed(2),
      width_pct: width.toFixed(2),
      height_pct: height.toFixed(2),
    }));
  }

  function startZoneDraw(event: PointerEvent<HTMLDivElement>) {
    if (!isZoneDrawingEnabled) {
      return;
    }

    const element = zoneCanvasRef.current;

    if (!element) {
      return;
    }

    const rect = element.getBoundingClientRect();
    const fullX = ((event.clientX - rect.left) / rect.width) * 100;
    const fullY = ((event.clientY - rect.top) / rect.height) * 100;
    const usesBoundary =
      Boolean(boundaryZone) &&
      zoneTrainingMode !== "boundary" &&
      selectedZoneName !== "card_boundary";
    dragStartRef.current = {
      x: usesBoundary
        ? clampPercent(((fullX - boundaryZone!.x_pct) / boundaryZone!.width_pct) * 100)
        : clampPercent(fullX),
      y: usesBoundary
        ? clampPercent(((fullY - boundaryZone!.y_pct) / boundaryZone!.height_pct) * 100)
        : clampPercent(fullY),
    };
    if (zoneTrainingMode === "boundary") {
      setSelectedZoneName("card_boundary");
      setZoneForm((currentForm) => ({
        ...currentForm,
        zone_name: "card_boundary",
        zone_type: "card_boundary",
      }));
    } else if (zoneTrainingMode === "new_zone" && !selectedZoneName) {
      const nextIndex = credentialZones.length + 1;
      setSelectedZoneName(`zone_${nextIndex}`);
      setZoneForm((currentForm) => ({
        ...currentForm,
        zone_name: `zone_${nextIndex}`,
      }));
    }
    element.setPointerCapture(event.pointerId);
    updateZoneFromPointer(event);
  }

  function finishZoneDraw(event: PointerEvent<HTMLDivElement>) {
    updateZoneFromPointer(event);
    dragStartRef.current = null;
  }

  function startZoneResize(
    event: PointerEvent<HTMLSpanElement>,
    handle: "nw" | "ne" | "sw" | "se",
  ) {
    if (!isZoneDrawingEnabled) {
      return;
    }

    event.stopPropagation();
    zoneCanvasRef.current?.setPointerCapture(event.pointerId);

    if (handle === "nw") {
      dragStartRef.current = {
        x: currentZone.x_pct + currentZone.width_pct,
        y: currentZone.y_pct + currentZone.height_pct,
      };
    } else if (handle === "ne") {
      dragStartRef.current = {
        x: currentZone.x_pct,
        y: currentZone.y_pct + currentZone.height_pct,
      };
    } else if (handle === "sw") {
      dragStartRef.current = {
        x: currentZone.x_pct + currentZone.width_pct,
        y: currentZone.y_pct,
      };
    } else {
      dragStartRef.current = {
        x: currentZone.x_pct,
        y: currentZone.y_pct,
      };
    }

    updateZoneFromPointer(event as unknown as PointerEvent<HTMLDivElement>);
  }

  function applyZonePreset(preset: string) {
    const zone = zonePresetFor(giftCard?.brand, preset);
      setZoneForm({
        zone_name: zone.zone_name,
      zone_type: zone.zone_type,
      x_pct: String(zone.x_pct),
      y_pct: String(zone.y_pct),
      width_pct: String(zone.width_pct),
      height_pct: String(zone.height_pct),
        priority: String(zone.priority),
      });
      setSelectedZoneName(zone.zone_name);
      setZoneTrainingMode("new_zone");
      setZoneTestResult(null);
    }

  function applyBestBuyLayout(layoutName: string) {
    setSelectedBestBuyLayout(layoutName);
    if (layoutName === "auto") {
      const autoLayout =
        ocrLayouts.find((layout) => layout.active) ??
        ocrLayouts[0] ??
        {
          layout_name: "best_buy_barcode_above_number",
          label: "Best Buy barcode-above-number",
          active: true,
          zones: bestBuyLayoutZones("best_buy_barcode_above_number"),
        };
      setSavedOcrZones(zonesForBrand(giftCard?.brand, autoLayout.zones));
      setZoneTemplateMessage(
        `Best Buy layout set to Auto. Backend will score all active layouts; editing shows ${autoLayout.label}.`,
      );
    } else {
      const layout =
        ocrLayouts.find((candidate) => candidate.layout_name === layoutName) ??
        {
          layout_name: layoutName,
          label: bestBuyLayoutLabel(layoutName),
          active: true,
          zones: bestBuyLayoutZones(layoutName),
        };
      setSavedOcrZones(zonesForBrand(giftCard?.brand, layout.zones));
      setZoneTemplateMessage(`Editing ${layout.label} zones.`);
    }
    setSelectedZoneName(null);
    setZoneTrainingMode("idle");
    setZoneTestResult(null);
    setZoneTemplateSaved(false);
  }

  function useCurrentCardAsNewBestBuyLayout() {
    const existingCustomNumbers = ocrLayouts
      .map((layout) => layout.layout_name.match(/^best_buy_layout_v(\d+)$/)?.[1])
      .filter((value): value is string => Boolean(value))
      .map((value) => Number(value));
    const nextVersion = Math.max(2, ...existingCustomNumbers) + 1;
    const layoutName = `best_buy_layout_v${nextVersion}`;
    const layout: OCRLayout = {
      layout_name: layoutName,
      label: `Best Buy layout v${nextVersion}`,
      active: true,
      coordinate_space: "card_boundary_relative",
      zones:
        savedOcrZones.length > 0
          ? savedOcrZones
          : bestBuyLayoutZones("best_buy_unknown_manual"),
    };

    setOcrLayouts((currentLayouts) => [
      ...currentLayouts.filter(
        (currentLayout) => currentLayout.layout_name !== layoutName,
      ),
      layout,
    ]);
    setSelectedBestBuyLayout(layoutName);
    setSavedOcrZones(layout.zones);
    setZoneTemplateSaved(false);
    setZoneTemplateMessage(
      `${layout.label} prepared from this card. Adjust zones if needed, then save template.`,
    );
  }

  function setBestBuyLayoutActive(layoutName: string, active: boolean) {
    setOcrLayouts((currentLayouts) => {
      const normalizedLayouts = normalizeBestBuyLayouts(currentLayouts);
      const existingLayout =
        normalizedLayouts.find((layout) => layout.layout_name === layoutName) ??
        defaultBestBuyLayout(layoutName);
      return [
        ...normalizedLayouts.filter((layout) => layout.layout_name !== layoutName),
        {
          ...existingLayout,
          active,
          active_managed: true,
        },
      ];
    });
    if (!active && selectedBestBuyLayout === layoutName) {
      setSelectedBestBuyLayout("auto");
    }
    setZoneTemplateSaved(false);
    setZoneTemplateMessage(
      `${bestBuyLayoutLabel(layoutName)} ${active ? "activated" : "deactivated"}. Save template to persist layout visibility.`,
    );
  }

  function deleteBestBuyLayout(layoutName: string) {
    setOcrLayouts((currentLayouts) =>
      normalizeBestBuyLayouts(currentLayouts).filter(
        (layout) => layout.layout_name !== layoutName,
      ),
    );
    if (selectedBestBuyLayout === layoutName) {
      setSelectedBestBuyLayout("auto");
    }
    setZoneTemplateSaved(false);
    setZoneTemplateMessage(
      `${bestBuyLayoutLabel(layoutName)} removed from managed templates. Save template to persist.`,
    );
  }

  function addCurrentZone() {
    const zoneToSave =
      zoneTrainingMode === "boundary"
        ? {
            ...currentZone,
            zone_name: "card_boundary",
            zone_type: "card_boundary",
            notes: "Manual card boundary reference for this brand.",
          }
        : currentZone;

    setSavedOcrZones((currentZones) => [
      ...currentZones.filter(
        (zone) => zone.zone_name !== zoneToSave.zone_name,
      ),
      zoneToSave,
    ]);
    setSelectedZoneName(zoneToSave.zone_name);
    setZoneTrainingMode("idle");
    setZoneTemplateSaved(false);
    setZoneTemplateMessage(
      zoneToSave.zone_name === "card_boundary"
        ? "Card boundary confirmed. Draw a credential zone next."
        : "Zone added. Save template to persist it for this brand.",
    );
  }

  function resetCurrentZone() {
    const zone = zonePresetFor(giftCard?.brand, "general");
    setZoneForm({
      zone_name: zone.zone_name,
      zone_type: zone.zone_type,
      x_pct: String(zone.x_pct),
      y_pct: String(zone.y_pct),
      width_pct: String(zone.width_pct),
      height_pct: String(zone.height_pct),
      priority: String(zone.priority),
    });
    setZoneTestResult(null);
    setSelectedZoneName(null);
    setZoneTrainingMode("idle");
    setZoneTemplateSaved(false);
  }

  function adjustCurrentZone(
    field: "x_pct" | "y_pct" | "width_pct" | "height_pct",
    delta: number,
  ) {
    setZoneForm((currentForm) => {
      const nextForm = { ...currentForm };
      const x = Number(nextForm.x_pct) || 0;
      const y = Number(nextForm.y_pct) || 0;
      const width = Number(nextForm.width_pct) || 0;
      const height = Number(nextForm.height_pct) || 0;
      const value = Number(nextForm[field]) || 0;

      if (field === "x_pct") {
        nextForm.x_pct = Math.max(0, Math.min(100 - width, value + delta)).toFixed(2);
      } else if (field === "y_pct") {
        nextForm.y_pct = Math.max(0, Math.min(100 - height, value + delta)).toFixed(2);
      } else if (field === "width_pct") {
        nextForm.width_pct = Math.max(0.5, Math.min(100 - x, value + delta)).toFixed(2);
      } else {
        nextForm.height_pct = Math.max(0.5, Math.min(100 - y, value + delta)).toFixed(2);
      }

      return nextForm;
    });
    setZoneTemplateSaved(false);
    setZoneTestResult(null);
  }

  function deleteCurrentZone() {
    setSavedOcrZones((currentZones) =>
      currentZones.filter((zone) => zone.zone_name !== currentZone.zone_name),
    );
    setSelectedZoneName(null);
    setZoneTrainingMode("idle");
    setZoneTemplateSaved(false);
    setZoneTemplateMessage("Zone removed. Save template to persist the change.");
  }

  async function testOcrZone() {
    if (!primaryImage || !canonicalReady) {
      return;
    }

    setIsTestingZone(true);
    setZoneTemplateError(null);
    setZoneTestResult(null);
    setManualZoneCredential("");
    setZoneTestStage("generating crop");
    const displayRect = zoneCanvasRef.current?.getBoundingClientRect();
    setCanonicalDisplaySize(
      displayRect
        ? {
            width: Math.round(displayRect.width),
            height: Math.round(displayRect.height),
          }
        : null,
    );

    const progressStages = [
      "generating crop",
      currentZone.zone_type === "barcode" ? "decoding barcode" : "preprocessing",
      currentZone.zone_type === "barcode" ? "testing rotations" : "OCR pass 1/5",
      currentZone.zone_type === "barcode" ? "validating barcode" : "OCR pass 2/5",
      currentZone.zone_type === "barcode" ? "parsing candidates" : "OCR pass 3/5",
      "parsing candidates",
    ];
    let progressIndex = 0;
    const progressTimer = window.setInterval(() => {
      progressIndex = Math.min(progressIndex + 1, progressStages.length - 1);
      setZoneTestStage(progressStages[progressIndex]);
    }, 1400);
    const controller = new AbortController();
    const timeout = window.setTimeout(() => {
      controller.abort();
    }, 12500);

    try {
      const response = await fetch(
        `${API_BASE_URL}/card-images/${primaryImage.id}/test-zone`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: controller.signal,
          body: JSON.stringify({
            ...currentZone,
            coordinate_mode: coordinateMode,
            card_boundary:
              boundaryZone && currentZone.zone_name !== "card_boundary"
                ? boundaryZone
                : null,
            image_source: primaryImage.processed_image_url
              ? "processed"
              : "original",
            rotation_degrees: 0,
          }),
        },
      );

      if (!response.ok) {
        const body = await response.text();
        throw new Error(
          `Failed to test OCR zone (${response.status}): ${
            body || response.statusText
          }`,
        );
      }

      setZoneTestStage("parsing candidates");
      setZoneTestResult((await response.json()) as OCRZoneTestResult);
    } catch (err) {
      setZoneTemplateError(
        err instanceof DOMException && err.name === "AbortError"
          ? "OCR zone test timed out after 12 seconds. The server may still return partial debug in logs; try a smaller zone or use manual fallback."
          : err instanceof Error
            ? err.message
            : "Failed to test OCR zone.",
      );
    } finally {
      window.clearInterval(progressTimer);
      window.clearTimeout(timeout);
      setZoneTestStage(null);
      setIsTestingZone(false);
    }
  }

  async function saveOcrZoneTemplate() {
    if (!giftCard) {
      return;
    }

    setZoneTemplateMessage(null);
    setZoneTemplateError(null);

    const zones = zonesForBrand(
      giftCard.brand,
      [...savedOcrZones].sort(
        (firstZone, secondZone) => firstZone.priority - secondZone.priority,
      ),
    );
    const savedCanonicalRotation =
      primaryImage?.canonical_rotation_degrees ??
      Number(canonicalRotation ?? 0) ??
      0;
    const isBestBuy = normalizedBrandName(giftCard.brand).includes("best buy");
    const managedBestBuyLayouts = isBestBuy
      ? normalizeBestBuyLayouts(ocrLayouts)
      : [];
    const selectedLayoutName =
      selectedBestBuyLayout === "auto"
        ? managedBestBuyLayouts.find((layout) => layout.active)?.layout_name ??
          "best_buy_barcode_above_number"
        : selectedBestBuyLayout;
    if (
      isBestBuy &&
      isDefaultishBestBuyBoundary(zones.find((zone) => zone.zone_name === "card_boundary")) &&
      !window.confirm(
        "Best Buy zones are still using a broad/default card boundary. Set the card boundary to the physical card edges before saving for reliable OCR. Save anyway?",
      )
    ) {
      setZoneTemplateError("Adjust card boundary before saving Best Buy zones.");
      return;
    }
    const savedLayouts = isBestBuy
      ? managedBestBuyLayouts.map((layout) => ({
          layout_name: layout.layout_name,
          name: layout.label,
          active: layout.active,
          active_managed: true,
          coordinate_space: "card_boundary_relative",
          zones: layout.layout_name === selectedLayoutName ? zones : layout.zones,
        }))
      : [];

    try {
      const response = await fetch(
        `${API_BASE_URL}/card-brands/by-name/${encodeURIComponent(
          giftCard.brand,
        )}/ocr-template`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ocr_orientation_preference: "auto",
            credential_type: isRedemptionCodeOnly
              ? "redemption_code_only"
              : "card_number_plus_pin",
            ocr_zones: JSON.stringify(
              {
                coordinate_space: hasBoundary
                  ? "card_boundary_relative"
                  : "full_image_relative",
                processed_image_dimensions: canonicalImageSize,
                canonical_width: canonicalImageSize?.width ?? null,
                canonical_height: canonicalImageSize?.height ?? null,
                trained_orientation: savedCanonicalRotation,
                applied_rotation: 0,
                rotation_degrees: savedCanonicalRotation,
                selected_layout:
                  isBestBuy && selectedBestBuyLayout !== "auto"
                    ? selectedLayoutName
                    : "auto",
                ...(isBestBuy
                  ? { layouts: savedLayouts }
                  : { zones }),
              },
              null,
              2,
            ),
          }),
        },
      );

      if (!response.ok) {
        const body = await response.text();
        console.error("OCR zone template save failed", {
          status: response.status,
          body,
        });
        throw new Error(
          `Failed to save OCR zone (${response.status}): ${
            body || response.statusText
          }`,
        );
      }

      const reloadResponse = await fetch(
        `${API_BASE_URL}/card-brands/by-name/${encodeURIComponent(
          giftCard.brand,
        )}/ocr-template`,
      );

      if (!reloadResponse.ok) {
        const body = await reloadResponse.text();
        throw new Error(
          `OCR zones saved, but reload failed (${reloadResponse.status}): ${
            body || reloadResponse.statusText
          }`,
        );
      }

      const template = (await reloadResponse.json()) as {
        ocr_zones?: string | null;
      };
      const parsedReloadedLayouts = parseOcrLayouts(template.ocr_zones);
      const reloadedLayouts = isBestBuy
        ? normalizeBestBuyLayouts(parsedReloadedLayouts)
        : parsedReloadedLayouts;
      const reloadedZones = zonesForBrand(
        giftCard.brand,
        isBestBuy && reloadedLayouts.length > 0
          ? reloadedLayouts.find(
              (layout) => layout.layout_name === selectedLayoutName,
            )?.zones ?? reloadedLayouts[0].zones
          : parseOcrZones(template.ocr_zones),
      );

      setZoneTemplateMessage(
        "OCR zones saved for this brand. Future uploads will scan these regions first.",
      );
      setOcrLayouts(reloadedLayouts);
      setSavedOcrZones(reloadedZones);
      setZoneTemplateSaved(true);
    } catch (err) {
      setZoneTemplateError(
        err instanceof Error ? err.message : "Failed to save OCR zone.",
      );
    }
  }

  async function handleVerify(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (isSaleLocked && !allowLockedCredentialUpdate) {
      setSubmitError(
        "Sold or settled cards require explicit Update confirmed credentials before saving.",
      );
      return;
    }

    if (isInactiveCard) {
      setSubmitError("Voided or archived cards cannot be verified.");
      return;
    }

    setIsSubmitting(true);
    setSubmitError(null);
    setSuccessMessage(null);
    setDuplicateWarning(null);

    const endpoint = `${API_BASE_URL}/gift-cards/${giftCardId}/verify`;
    let loggedResponseError = false;

    try {
      const response = await fetch(endpoint, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          card_number: form.card_number,
          confirmed_card_number: isRedemptionCodeOnly ? null : form.card_number,
          confirmed_redemption_code: isRedemptionCodeOnly ? form.card_number : null,
          pin: isRedemptionCodeOnly ? null : form.pin,
          confirmed_pin: isRedemptionCodeOnly ? null : form.pin,
          confirmed_source: form.confirmed_source || "manual",
          update_confirmed_credentials: isSaleLocked && allowLockedCredentialUpdate,
          face_value: Number(form.face_value),
          notes: form.notes || null,
        }),
      });

      if (!response.ok) {
        const errorBody = await readResponseBody(response);
        const detail =
          errorBody &&
          typeof errorBody === "object" &&
          "detail" in errorBody
            ? (errorBody as { detail?: unknown }).detail
            : errorBody;
        const duplicate = normalizeDuplicateCardWarning(detail);

        if (response.status === 409 && duplicate) {
          setDuplicateWarning(duplicate);
          return;
        }

        console.error("Gift card verification request failed", {
          endpoint,
          status: response.status,
          responseBody: errorBody,
        });
        loggedResponseError = true;

        throw new Error(
          backendErrorMessage(
            errorBody,
            `Failed to verify gift card (${response.status})`,
          ),
        );
      }

      const updatedGiftCard = (await response.json()) as GiftCard;
      setGiftCard(updatedGiftCard);
      setShowLockedCredentials(false);
      setAllowLockedCredentialUpdate(false);
      router.push(getReturnHref());
    } catch (err) {
      if (!loggedResponseError) {
        console.error("Gift card verification failed", {
          endpoint,
          error: err,
        });
      }
      setSubmitError(
        err instanceof Error
          ? err.message
          : "Failed to confirm card number.",
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  async function voidDuplicateCard() {
    if (!giftCard || !duplicateWarning) {
      return;
    }

    setIsCleaningUpCard(true);
    setCleanupError(null);

    try {
      const existingCard = duplicateWarning.existing_card;
      const endpoint = `${API_BASE_URL}/gift-cards/${giftCard.id}/void`;
      const response = await fetch(endpoint, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          void_reason: "DUPLICATE_CARD_NUMBER",
          duplicate_existing_card_id: existingCard.id,
          notes: giftCard.notes,
        }),
      });

      if (!response.ok) {
        const body = await readResponseBody(response);
        console.error("Void duplicate card request failed", {
          endpoint,
          status: response.status,
          responseBody: body,
        });
        throw new Error(
          backendErrorMessage(
            body,
            `Failed to void duplicate card (${response.status})`,
          ),
        );
      }

      const updatedGiftCard = (await response.json()) as GiftCard;
      setGiftCard(updatedGiftCard);
      setDuplicateWarning(null);
      setCleanupMessage(`Voided duplicate card #${giftCard.id}.`);
    } catch (err) {
      console.error("Duplicate card void failed", {
        giftCardId: giftCard.id,
        duplicateWarning,
        error: err,
      });
      setCleanupError(
        err instanceof Error ? err.message : "Failed to void duplicate card.",
      );
    } finally {
      setIsCleaningUpCard(false);
    }
  }

  async function confirmGiftCardCleanup() {
    if (!giftCard || !cleanupAction || isCleaningUpCard || isLoadingCleanupReport) {
      return;
    }

    if (
      cleanupAction === "delete" &&
      (!cleanupReport || !cleanupReport.can_hard_delete)
    ) {
      return;
    }

    const action = cleanupAction;
    const endpoint =
      action === "delete"
        ? `${API_BASE_URL}/gift-cards/${giftCard.id}`
        : `${API_BASE_URL}/gift-cards/${giftCard.id}/void`;
    const method = action === "delete" ? "DELETE" : "PATCH";
    setIsCleaningUpCard(true);
    setCleanupError(null);
    setCleanupMessage(null);

    try {
      const response = await fetch(endpoint, {
        method,
      });

      if (!response.ok) {
        const body = await readResponseBody(response);
        const report = cleanupReportFromBody(body);
        if (report) {
          setCleanupReport(report);
        }
        console.error("Gift card cleanup request failed", {
          endpoint,
          status: response.status,
          responseBody: body,
        });
        throw new Error(
          backendErrorMessage(
            body,
            `Failed to ${action} card (${response.status})`,
          ),
        );
      }

      setCleanupAction(null);
      setCleanupReport(null);

      if (action === "delete") {
        router.push(getReturnHref());
        return;
      }

      const updatedGiftCard = (await response.json()) as GiftCard;
      setGiftCard(updatedGiftCard);
      setCleanupMessage(`Voided card #${giftCard.id}.`);
    } catch (err) {
      console.error("Gift card detail cleanup failed", {
        action,
        endpoint,
        method,
        giftCardId: giftCard.id,
        error: err,
      });
      setCleanupError(
        err instanceof TypeError
          ? `Network error calling ${method} ${endpoint}. Check that the backend is running and review backend logs.`
          : err instanceof Error
            ? err.message
            : `Failed to ${action} gift card.`,
      );
    } finally {
      setIsCleaningUpCard(false);
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

  if (isInactiveCard) {
    const detectedCardNumber =
      latestExtractionAttempt?.extracted_card_number ??
      bestCardNumberCandidate?.value ??
      null;
    const detectedConfidence =
      latestExtractionAttempt?.confidence_score ??
      bestCardNumberCandidate?.confidence_score ??
      null;

    return (
      <main className="min-h-screen bg-slate-100 px-4 py-5 text-slate-950 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-7xl space-y-6">
          <header className="space-y-3">
            <Link
              className="inline-flex min-h-11 items-center text-sm font-medium text-slate-600 underline-offset-4 hover:text-slate-950 hover:underline"
              href={backHref}
            >
              Back
            </Link>
            <div className="rounded-lg border border-red-200 bg-red-50 p-5 shadow-sm">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <p className="text-xs font-bold uppercase tracking-[0.24em] text-red-700">
                    VOIDED
                  </p>
                  <h1 className="mt-2 text-2xl font-semibold tracking-tight text-slate-950 sm:text-3xl">
                    {giftCard.brand} {formatAmount(giftCard.face_value)}
                  </h1>
                  <p className="mt-2 text-sm font-medium text-red-800">
                    {archiveReasonText(giftCard)}
                  </p>
                  <p className="mt-1 text-sm text-slate-600">
                    Voided on {formatDate(giftCard.updated_at)}
                  </p>
                </div>
                <span className="inline-flex rounded-full border border-red-200 bg-white px-3 py-1 text-xs font-semibold uppercase tracking-wide text-red-700">
                  Archive only
                </span>
              </div>
            </div>
          </header>

          <section className="grid gap-6 xl:grid-cols-[minmax(0,1.25fr)_minmax(360px,0.75fr)]">
            <div className="space-y-4">
              <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
                <h2 className="text-lg font-semibold">Uploaded Card Image</h2>
                <p className="mt-1 text-sm text-slate-500">
                  Preserved for audit trail. Image editing is disabled for
                  archived cards.
                </p>
                {primaryImage ? (
                  <div className="relative mt-4 flex min-h-[24rem] items-center justify-center overflow-hidden rounded-lg border border-slate-200 bg-slate-100 p-3 sm:min-h-[34rem]">
                    <Image
                      alt={`${giftCard.brand} voided card`}
                      className="h-auto max-h-[72vh] w-full max-w-full object-contain opacity-75"
                      height={720}
                      src={buildUploadUrl(
                        primaryImage.processed_image_url ??
                          primaryImage.original_image_url,
                      )}
                      unoptimized
                      width={960}
                    />
                    <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                      <span className="-rotate-12 rounded-md border-4 border-red-500/35 px-8 py-3 text-5xl font-black uppercase tracking-widest text-red-600/35 sm:text-7xl">
                        VOIDED
                      </span>
                    </div>
                  </div>
                ) : (
                  <div className="mt-4 rounded-lg border border-dashed border-slate-300 bg-slate-50 p-8 text-center text-sm text-slate-500">
                    No image was uploaded for this archived card.
                  </div>
                )}
              </div>

              <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <h2 className="text-lg font-semibold">Purchase Receipt</h2>
                    <p className="mt-1 text-sm text-slate-500">
                      {receipts.length}{" "}
                      {receipts.length === 1 ? "receipt" : "receipts"} attached
                      to purchase #{giftCard.purchase_batch_id}.
                    </p>
                  </div>
                  <Link
                    className="inline-flex h-11 cursor-pointer items-center justify-center rounded-md border border-slate-300 px-4 text-sm font-semibold text-slate-700 transition hover:bg-slate-100 active:bg-slate-200"
                    href={purchaseHref}
                  >
                    View Purchase
                  </Link>
                </div>

                {receipts.length === 0 ? (
                  <p className="mt-3 text-sm text-slate-500">
                    No receipt uploaded for this purchase.
                  </p>
                ) : (
                  <div className="mt-4 grid gap-3 sm:grid-cols-2">
                    {receipts.map((receipt) => {
                      const receiptUrl = buildUploadUrl(receipt.image_url);

                      return (
                        <figure
                          className="overflow-hidden rounded-md border border-slate-200 bg-slate-50"
                          key={receipt.id}
                        >
                          <a href={receiptUrl} target="_blank" rel="noreferrer">
                            <Image
                              alt={receipt.original_filename || "Purchase receipt"}
                              className="h-40 w-full object-cover opacity-90"
                              height={160}
                              src={receiptUrl}
                              unoptimized
                              width={320}
                            />
                          </a>
                          <figcaption className="space-y-2 p-3 text-xs text-slate-600">
                            <p className="truncate font-medium text-slate-800">
                              {receipt.original_filename ||
                                `Receipt #${receipt.id}`}
                            </p>
                            <a
                              className="inline-flex h-9 cursor-pointer items-center rounded-md border border-slate-300 bg-white px-3 font-semibold text-slate-700 transition hover:bg-slate-100 active:bg-slate-200"
                              download
                              href={receiptUrl}
                            >
                              Open / Download Receipt
                            </a>
                          </figcaption>
                        </figure>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>

            <aside className="space-y-4">
              <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
                <h2 className="text-lg font-semibold">Archived Card Details</h2>
                <dl className="mt-4 grid gap-3">
                  <ArchiveDetailRow
                    label={primaryCredentialLabel}
                    value={maskSensitiveValue(lockedPrimaryValue)}
                  />
                  {!isRedemptionCodeOnly ? (
                    <ArchiveDetailRow
                      label="PIN"
                      value={maskSensitiveValue(lockedPinValue)}
                    />
                  ) : null}
                  <ArchiveDetailRow
                    label="Export Value Source"
                    value={sourceLabel(giftCard.export_value_source)}
                  />
                  <ArchiveDetailRow
                    label="Face Value"
                    value={formatAmount(giftCard.face_value)}
                  />
                  <ArchiveDetailRow
                    label="Status"
                    value={giftCard.status.replaceAll("_", " ")}
                  />
                  <ArchiveDetailRow
                    label="Notes"
                    value={giftCard.notes ?? ""}
                  />
                </dl>
              </section>

              <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
                <h2 className="text-lg font-semibold">OCR Reference</h2>
                <dl className="mt-4 grid gap-3">
                  <ArchiveDetailRow
                    label={
                      isRedemptionCodeOnly
                        ? "Detected Redemption Code"
                        : "Detected Number"
                    }
                    value={maskSensitiveValue(detectedCardNumber)}
                  />
                  <ArchiveDetailRow
                    label="Confidence"
                    value={formatConfidence(detectedConfidence)}
                  />
                  <ArchiveDetailRow
                    label="Method"
                    value={latestExtractionAttempt?.method ?? "Not recorded"}
                  />
                  {!isRedemptionCodeOnly ? (
                    <ArchiveDetailRow
                      label="Detected PIN"
                      value={maskSensitiveValue(
                        latestExtractionAttempt?.extracted_pin ??
                          bestPinCandidate?.value ??
                          null,
                      )}
                    />
                  ) : null}
                </dl>
              </section>

              {giftCard.sale_history && giftCard.sale_history.length > 0 ? (
                <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
                  <h2 className="text-lg font-semibold">Sale History</h2>
                  <div className="mt-3 space-y-3">
                    {giftCard.sale_history.map((sale) => (
                      <div
                        className="rounded-md border border-slate-200 bg-slate-50 p-3 text-sm"
                        key={sale.sale_id}
                      >
                        <p className="font-semibold">Sale #{sale.sale_id}</p>
                        <p className="text-slate-600">{sale.buyer_name}</p>
                        <p className="mt-2 text-slate-600">
                          {saleStatusLabel(sale.status)} ·{" "}
                          {sale.expected_payout === null
                            ? "No payout recorded"
                            : formatAmount(sale.expected_payout)}
                        </p>
                      </div>
                    ))}
                  </div>
                </section>
              ) : null}
            </aside>
          </section>
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
            href={backHref}
          >
            Back
          </Link>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div className="space-y-1">
              <p className="text-sm font-medium uppercase tracking-wide text-slate-500">
                Confirm Card Details
              </p>
              <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
                {giftCard.brand} {formatAmount(giftCard.face_value)}
              </h1>
              <p className="text-sm text-slate-600">Status: {giftCard.status}</p>
            </div>
            {!isInactiveCard ? (
              <div className="grid grid-cols-2 gap-2 sm:flex">
                {!isSaleLocked || allowLockedCredentialUpdate ? (
                  <button
                    className="h-11 cursor-pointer rounded-md bg-slate-950 px-4 text-sm font-semibold text-white transition hover:bg-slate-800 active:bg-slate-700 disabled:cursor-not-allowed disabled:bg-slate-400"
                    disabled={isSubmitting}
                    form="confirm-card-details-form"
                    type="submit"
                  >
                    {isSubmitting
                      ? "Saving..."
                      : isSaleLocked
                        ? "Update Confirmed Credentials"
                        : "Confirm Details"}
                  </button>
                ) : null}
                {canCleanupGiftCard(giftCard) ? (
                  <>
                <button
                  className="h-11 cursor-pointer rounded-md border border-slate-300 px-4 text-sm font-semibold text-slate-700 transition hover:bg-slate-100 active:bg-slate-200"
                  onClick={() => {
                    setCleanupError(null);
                    setCleanupMessage(null);
                    setCleanupReport(null);
                    setCleanupAction("void");
                  }}
                  type="button"
                >
                  Void
                </button>
                <button
                  className="h-11 cursor-pointer rounded-md border border-red-200 px-4 text-sm font-semibold text-red-700 transition hover:bg-red-50 active:bg-red-100"
                  onClick={() => {
                    setCleanupError(null);
                    setCleanupMessage(null);
                    setCleanupReport(null);
                    setCleanupReportRequestKey((currentKey) => currentKey + 1);
                    setCleanupAction("delete");
                  }}
                  type="button"
                >
                  Delete
                </button>
                  </>
                ) : null}
              </div>
            ) : null}
          </div>
        </header>

        {cleanupMessage ? (
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm font-medium text-emerald-800">
            {cleanupMessage}
          </div>
        ) : null}

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

        {isInactiveCard ? (
          <section className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">
            <h2 className="font-semibold">Voided / inactive card</h2>
            <p className="mt-1">
              This card is preserved for purchase audit history and is not
              available for verification or sale.
            </p>
            {giftCard.void_reason ? (
              <p className="mt-2">
                <span className="font-semibold">Void reason:</span>{" "}
                {giftCard.void_reason}
              </p>
            ) : null}
            {giftCard.notes ? (
              <p className="mt-2 whitespace-pre-wrap">
                <span className="font-semibold">Notes:</span> {giftCard.notes}
              </p>
            ) : null}
          </section>
        ) : null}

        {!isInactiveCard ? (
          isDigitalCard ? (
            <section className="rounded-lg border border-cyan-200 bg-cyan-50 p-4 shadow-sm">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-cyan-700">
                    Digital/manual credential entry
                  </p>
                  <h2 className="mt-1 text-lg font-semibold text-slate-950">
                    OCR is skipped by default
                  </h2>
                  <p className="mt-1 text-sm text-slate-600">
                    Paste copied card credentials into Confirm Card Details. Uploaded
                    PDFs/images are supporting documents unless you explicitly run OCR.
                  </p>
                  {giftCard.digital_source_notes ? (
                    <p className="mt-2 whitespace-pre-wrap text-sm text-slate-700">
                      {giftCard.digital_source_notes}
                    </p>
                  ) : null}
                </div>
                <button
                  className="h-10 cursor-pointer rounded-md bg-slate-950 px-3 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-400"
                  disabled={isSubmitting || isInactiveCard}
                  form="confirm-card-details-form"
                  type="submit"
                >
                  {isSubmitting ? "Saving..." : "Save Manual Credentials"}
                </button>
              </div>
            </section>
          ) : null
        ) : null}

        {!isInactiveCard ? (
          <section className="rounded-lg border border-emerald-200 bg-white p-4 shadow-sm">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-emerald-700">
                  Locked / Confirmed Values
                </p>
                <h2 className="mt-1 text-lg font-semibold text-slate-950">
                  Exported credential source
                </h2>
                <p className="mt-1 text-sm text-slate-500">
                  Inventory, sale previews, and downloads use confirmed credentials,
                  not the latest OCR suggestions.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                {!isSaleLocked || allowLockedCredentialUpdate ? (
                  <button
                    className="h-10 cursor-pointer rounded-md bg-slate-950 px-3 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-400"
                    disabled={isSubmitting || isInactiveCard}
                    form="confirm-card-details-form"
                    type="submit"
                  >
                    {isSubmitting
                      ? "Saving..."
                      : isSaleLocked
                        ? "Update Confirmed Credentials"
                        : "Confirm Card Details"}
                  </button>
                ) : null}
                <button
                  className="h-10 cursor-pointer rounded-md border border-emerald-300 bg-emerald-50 px-3 text-sm font-semibold text-emerald-800 transition hover:bg-emerald-100"
                  onClick={() => setShowLockedCredentials((current) => !current)}
                  type="button"
                >
                  {showLockedCredentials
                    ? "Hide locked credentials"
                    : "Reveal locked credential details"}
                </button>
              </div>
            </div>
            <dl className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
                <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  {primaryCredentialLabel}
                </dt>
                <dd className="mt-1 break-all font-mono text-sm font-semibold text-slate-950">
                  {showLockedCredentials
                    ? lockedPrimaryValue || "Not confirmed"
                    : maskSensitiveValue(lockedPrimaryValue)}
                </dd>
              </div>
              {!isRedemptionCodeOnly ? (
                <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
                  <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Locked PIN
                  </dt>
                  <dd className="mt-1 break-all font-mono text-sm font-semibold text-slate-950">
                    {showLockedCredentials
                      ? lockedPinValue || "Not confirmed"
                      : maskSensitiveValue(lockedPinValue)}
                  </dd>
                </div>
              ) : null}
              <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
                <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Confirmation
                </dt>
                <dd className="mt-1 text-sm font-semibold text-slate-950">
                  {giftCard.confirmed_at
                    ? `Last updated ${formatDate(giftCard.confirmed_at)}`
                    : "Not confirmed"}
                </dd>
                <dd className="mt-1 text-xs text-slate-500">
                  Source: {sourceLabel(giftCard.confirmed_source)}
                </dd>
              </div>
              <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
                <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Export value source
                </dt>
                <dd className="mt-1 text-sm font-semibold text-slate-950">
                  {sourceLabel(giftCard.export_value_source)}
                </dd>
              </div>
            </dl>
            {cardSuggestionMismatch || pinSuggestionMismatch ? (
              <div className="mt-4 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
                New OCR suggestion differs from confirmed value. Exports will keep
                using the locked confirmed credential until you explicitly update it.
              </div>
            ) : null}
            {isSaleLocked ? (
              <label className="mt-4 flex cursor-pointer items-start gap-3 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">
                <input
                  checked={allowLockedCredentialUpdate}
                  className="mt-1 h-4 w-4"
                  onChange={(event) =>
                    setAllowLockedCredentialUpdate(event.target.checked)
                  }
                  type="checkbox"
                />
                <span>
                  <span className="block font-semibold">
                    Update confirmed credentials for a sold card
                  </span>
                  <span className="mt-1 block text-amber-800">
                    This logs an audit event because an export may already have been
                    generated with the previous locked values.
                  </span>
                </span>
              </label>
            ) : null}
          </section>
        ) : null}

        {!isInactiveCard && (bestCardNumberCandidate || bestPinCandidate) ? (
          <section className="rounded-lg border border-cyan-200 bg-white p-4 shadow-sm">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <h2 className="text-lg font-semibold text-slate-950">
                  Current OCR Suggestions
                </h2>
                <p className="mt-1 text-sm text-slate-500">
                  Suggestions come from the saved Review/OCR Image. Manual fields below
                  remain the source of truth.
                </p>
              </div>
              {primaryImage ? (
                <button
                  className="h-10 cursor-pointer rounded-md border border-slate-300 px-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60"
                  disabled={isRescanningImage || !primaryImage.processed_image_url}
                  onClick={() => {
                    void rescanPrimaryImage(
                      "OCR re-run on saved orientation.",
                      { preserveSavedTemplate: true, sync: true },
                    );
                  }}
                  type="button"
                >
                  {isRescanningImage ? "Scanning..." : "Re-run OCR on saved orientation"}
                </button>
              ) : null}
            </div>
            <div className="mt-3 grid gap-3 md:grid-cols-2">
              {bestCardNumberCandidate ? (
                <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                    {isRedemptionCodeOnly ? "Suggested Redemption Code" : "Suggested Card Number"}
                  </p>
                  <p className="mt-1 break-all font-mono text-base font-semibold text-slate-950">
                    {bestCardNumberCandidate.value}
                  </p>
                  <p className="mt-1 text-xs text-slate-500">
                    {bestCardNumberCandidate.source} ·{" "}
                    {formatConfidence(bestCardNumberCandidate.confidence_score)}
                  </p>
                  <button
                    className="mt-3 h-9 cursor-pointer rounded-md bg-cyan-300 px-3 text-xs font-semibold text-slate-950 transition hover:bg-cyan-200"
                    onClick={() =>
                      applyCredentialCandidate(bestCardNumberCandidate, {
                        brand: giftCard.brand,
                        isRedemptionCodeOnly,
                        setForm,
                      })
                    }
                    type="button"
                  >
                    Use {candidateTargetLabel(bestCardNumberCandidate, isRedemptionCodeOnly)}
                  </button>
                </div>
              ) : null}
              {!isRedemptionCodeOnly && bestPinCandidate ? (
                <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Suggested PIN
                  </p>
                  <p className="mt-1 break-all font-mono text-base font-semibold text-slate-950">
                    {bestPinCandidate.value}
                  </p>
                  <p className="mt-1 text-xs text-slate-500">
                    {bestPinCandidate.source} ·{" "}
                    {formatConfidence(bestPinCandidate.confidence_score)}
                  </p>
                  {bestPinCandidate.notes ? (
                    <p className="mt-1 line-clamp-2 text-xs text-slate-500">
                      {bestPinCandidate.notes}
                    </p>
                  ) : null}
                  <button
                    className="mt-3 h-9 cursor-pointer rounded-md bg-cyan-300 px-3 text-xs font-semibold text-slate-950 transition hover:bg-cyan-200"
                    onClick={() =>
                      applyCredentialCandidate(bestPinCandidate, {
                        brand: giftCard.brand,
                        isRedemptionCodeOnly,
                        setForm,
                      })
                    }
                    type="button"
                  >
                    Use PIN
                  </button>
                </div>
              ) : null}
            </div>
          </section>
        ) : null}

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
                        : isDigitalCard
                          ? "Upload Attachment"
                          : primaryImage
                          ? "Replace Image"
                          : "Upload Image"}
                    </span>
                    <input
                      accept={isDigitalCard ? digitalAttachmentAccept : cardImageAccept}
                      className="sr-only"
                      disabled={isUploadingImage}
                      onChange={handleImageUpload}
                      type="file"
                    />
                  </label>
                  {primaryImage && (
                    <>
                      <button
                        className="h-11 cursor-pointer rounded-md border border-slate-300 px-4 text-sm font-medium text-slate-700 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60"
                        disabled={isRescanningImage || isSavingOcrOrientation}
                        onClick={() => {
                          setImageRotation((currentRotation) => currentRotation - 90);
                        }}
                        type="button"
                      >
                        Rotate Left
                      </button>
                      <button
                        className="h-11 cursor-pointer rounded-md border border-slate-300 px-4 text-sm font-medium text-slate-700 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60"
                        disabled={isRescanningImage || isSavingOcrOrientation}
                        onClick={() => {
                          setImageRotation((currentRotation) => currentRotation + 90);
                        }}
                        type="button"
                      >
                        Rotate Right
                      </button>
                      <button
                        className="h-11 cursor-pointer rounded-md bg-slate-950 px-4 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-400"
                        disabled={isRescanningImage || isSavingOcrOrientation}
                        onClick={() => {
                          void setSavedOcrOrientation();
                        }}
                        type="button"
                      >
                        {isSavingOcrOrientation ? "Saving..." : "Set as OCR orientation"}
                      </button>
                      <button
                        className="h-11 cursor-pointer rounded-md border border-slate-300 px-4 text-sm font-medium text-slate-700 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60"
                        disabled={isRescanningImage || !primaryImage.processed_image_url}
                        onClick={() => {
                          void rescanPrimaryImage(
                            "OCR re-run on saved orientation.",
                            { preserveSavedTemplate: true, sync: true },
                          );
                        }}
                        type="button"
                      >
                        Re-run OCR on saved orientation
                      </button>
                      <button
                        className="h-11 cursor-pointer rounded-md border border-slate-300 px-4 text-sm font-medium text-slate-700 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60"
                        disabled={isRescanningImage || isSavingOcrOrientation}
                        onClick={() => {
                          setImageRotation(0);
                        }}
                        type="button"
                      >
                        Reset Preview
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
              {isRescanningImage ? (
                <p className="mb-3 text-sm font-medium text-slate-600">
                  Re-running OCR on saved orientation...
                </p>
              ) : null}
              {isSavingOcrOrientation ? (
                <p className="mb-3 text-sm font-medium text-slate-600">
                  Saving visible rotation as the OCR image...
                </p>
              ) : null}
              {imageUploadError ? (
                <p className="mb-3 text-sm font-medium text-red-700">
                  {imageUploadError}
                </p>
              ) : null}
              {primaryImage ? (
                <>
                  <p className="mb-2 text-xs font-medium text-slate-500">
                    {canonicalReady
                      ? "OCR is using the saved Review/OCR Image. Zones are relative to that image only."
                      : "OCR image not set. Rotate the upload preview, then click Set as OCR orientation."}
                    {primaryImage.processed_image_url
                      ? ` · saved Review/OCR Image ready`
                      : " · OCR and zones are locked until orientation is saved"}
                    {appliedTemplateRotation && appliedTemplateRotation !== "none"
                      ? ` · template tested at ${appliedTemplateRotation}°`
                      : ""}
                    {selectedTemplateLayout
                      ? ` · layout ${selectedTemplateLayout}`
                      : ""}
                    {persistedCanonicalRotation &&
                    persistedCanonicalRotation !== "0"
                      ? ` · canonical image rotated ${persistedCanonicalRotation}°`
                      : ""}
                    {orientationStatusLabel ? ` · ${orientationStatusLabel}` : ""}
                  </p>
                  <div className="mb-3 flex flex-wrap gap-2 text-xs">
                    <a
                      className="font-semibold text-slate-600 underline underline-offset-2 hover:text-slate-950"
                      href={buildUploadUrl(primaryImage.original_image_url)}
                      rel="noreferrer"
                      target="_blank"
                    >
                      Original upload
                    </a>
                    {primaryImage.processed_image_url ? (
                      <a
                        className="font-semibold text-slate-600 underline underline-offset-2 hover:text-slate-950"
                        href={buildUploadUrl(primaryImage.processed_image_url)}
                        rel="noreferrer"
                        target="_blank"
                      >
                        Saved Review/OCR Image
                      </a>
                    ) : null}
                  </div>
                  <dl className="mb-3 grid gap-2 rounded-md border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600 md:grid-cols-2">
                    <div>
                      <dt className="font-semibold text-slate-800">
                        Display image
                      </dt>
                      <dd className="break-all">
                        {primaryImage.processed_image_url
                          ? primaryImage.processed_image_url
                          : primaryImage.original_image_url}
                      </dd>
                    </div>
                    <div>
                      <dt className="font-semibold text-slate-800">OCR image</dt>
                      <dd className="break-all">
                        {primaryImage.processed_image_url ?? "Not set"}
                      </dd>
                    </div>
                    <div>
                      <dt className="font-semibold text-slate-800">
                        Barcode image
                      </dt>
                      <dd className="break-all">
                        {primaryImage.processed_image_url
                          ? "Saved Review/OCR Image plus Best Buy original/crop fallbacks"
                          : "Original upload fallback only"}
                      </dd>
                    </div>
                    <div>
                      <dt className="font-semibold text-slate-800">
                        Image dimensions
                      </dt>
                      <dd>
                        natural{" "}
                        {canonicalImageSize
                          ? `${canonicalImageSize.width} x ${canonicalImageSize.height}`
                          : debugSavedReviewImageDimensions ?? "not loaded"}
                        {" · "}rendered{" "}
                        {canonicalRenderedSize
                          ? `${canonicalRenderedSize.width} x ${canonicalRenderedSize.height}`
                          : "not measured"}
                      </dd>
                    </div>
                    <div>
                      <dt className="font-semibold text-slate-800">
                        Saved rotation
                      </dt>
                      <dd>{orientationStatusLabel ?? "Not set"}</dd>
                    </div>
                    <div>
                      <dt className="font-semibold text-slate-800">
                        Template coordinate source
                      </dt>
                      <dd>
                        {debugTemplateCoordinateSource ??
                          coordinateMode}
                      </dd>
                    </div>
                    <div>
                      <dt className="font-semibold text-slate-800">
                        Card boundary
                      </dt>
                      <dd className="break-all">
                        {boundaryZone
                          ? `x ${boundaryZone.x_pct.toFixed(2)}%, y ${boundaryZone.y_pct.toFixed(2)}%, w ${boundaryZone.width_pct.toFixed(2)}%, h ${boundaryZone.height_pct.toFixed(2)}%`
                          : debugOcrCardBoundary ?? "Not set"}
                      </dd>
                    </div>
                    <div>
                      <dt className="font-semibold text-slate-800">
                        OCR zone image size
                      </dt>
                      <dd>{debugOcrZoneImageNaturalSize ?? "Not recorded"}</dd>
                    </div>
                  </dl>
                  <div className="mb-3 grid gap-3 md:grid-cols-2">
                    <figure className="overflow-hidden rounded-lg border border-slate-200 bg-slate-50">
                      <figcaption className="border-b border-slate-200 px-3 py-2 text-xs font-semibold text-slate-600">
                        Original Upload Preview
                        {imageRotation % 360
                          ? ` · preview ${((imageRotation % 360) + 360) % 360}°`
                          : ""}
                      </figcaption>
                      <img
                        alt={`${giftCard.brand} original upload`}
                        className="h-48 w-full object-contain"
                        src={originalUploadPreviewUrl}
                        style={{
                          transform: `rotate(${imageRotation}deg)`,
                        }}
                      />
                    </figure>
                    <figure className="overflow-hidden rounded-lg border border-slate-200 bg-slate-50">
                      <figcaption className="border-b border-slate-200 px-3 py-2 text-xs font-semibold text-slate-600">
                        Saved Review/OCR Image
                        {orientationStatusLabel
                          ? ` · ${orientationStatusLabel}`
                          : ""}
                      </figcaption>
                      {primaryImage.processed_image_url ? (
                        <img
                          alt={`${giftCard.brand} saved Review/OCR Image`}
                          className="h-48 w-full object-contain"
                          src={savedReviewOcrImageUrl}
                          style={{
                            transform: `rotate(${imageRotation}deg)`,
                          }}
                        />
                      ) : (
                        <div className="flex h-48 items-center justify-center text-sm text-slate-500">
                          No saved Review/OCR Image yet
                        </div>
                      )}
                    </figure>
                  </div>
                  {reviewImagePath ? (
                    <div className="relative flex min-h-[28rem] touch-none items-center justify-center overflow-hidden rounded-lg border border-slate-200 bg-slate-100 p-3 sm:min-h-[34rem] md:min-h-[40rem] lg:min-h-[44rem]">
                      <div
                        className="relative inline-block max-h-[78vh] max-w-full"
                      >
                        <img
                          ref={savedReviewImageRef}
                          alt={`${giftCard.brand} review/OCR working image`}
                          className="block h-auto max-h-[78vh] w-auto max-w-full object-contain"
                          onLoad={(event) => {
                            const renderedRect =
                              event.currentTarget.getBoundingClientRect();
                            setCanonicalImageSize({
                              width: event.currentTarget.naturalWidth,
                              height: event.currentTarget.naturalHeight,
                            });
                            setCanonicalRenderedSize({
                              width: Math.round(renderedRect.width),
                              height: Math.round(renderedRect.height),
                            });
                          }}
                          src={reviewImageUrl}
                          style={{
                            transform: `rotate(${imageRotation}deg)`,
                          }}
                        />
                      {canonicalReady && imageRotation % 360 === 0 ? (
                        <div
                          className="absolute inset-0 cursor-crosshair"
                          onPointerCancel={finishZoneDraw}
                          onPointerDown={startZoneDraw}
                          onPointerMove={updateZoneFromPointer}
                          onPointerUp={finishZoneDraw}
                          ref={zoneCanvasRef}
                        >
                          {savedOcrZones.map((zone) => {
                            const displayBox = zoneImageBox(zone, boundaryZone);
                            return (
                              <div
                                className={`absolute rounded ${
                                  zone.zone_name === "card_boundary"
                                    ? "border-2 border-blue-400 bg-blue-400/10"
                                    : zone.zone_name === selectedZoneName
                                      ? "border-2 border-orange-400 bg-orange-500/20"
                                      : "border border-emerald-300 bg-emerald-300/10"
                                }`}
                                key={zone.zone_name}
                                onClick={(event) => {
                                  event.stopPropagation();
                                  setSelectedZoneName(zone.zone_name);
                                  setZoneTrainingMode("idle");
                                  setZoneForm({
                                    zone_name: zone.zone_name,
                                    zone_type: zone.zone_type,
                                    x_pct: String(zone.x_pct),
                                    y_pct: String(zone.y_pct),
                                    width_pct: String(zone.width_pct),
                                    height_pct: String(zone.height_pct),
                                    priority: String(zone.priority || 1),
                                  });
                                }}
                                style={{
                                  left: `${displayBox.x_pct}%`,
                                  top: `${displayBox.y_pct}%`,
                                  width: `${displayBox.width_pct}%`,
                                  height: `${displayBox.height_pct}%`,
                                }}
                              >
                                <span className="absolute left-1 top-1 rounded bg-slate-950 px-1.5 py-0.5 text-[10px] font-semibold text-white shadow">
                                  {zone.zone_name}
                                </span>
                              </div>
                            );
                          })}
                          {isZoneDrawingEnabled ? (
                          <div
                            className={`absolute rounded border-2 shadow-[0_0_0_9999px_rgba(15,23,42,0.18)] ${
                              zoneTrainingMode === "boundary"
                                ? "border-blue-400 bg-blue-400/20"
                                : zoneTrainingMode === "edit_zone"
                                  ? "border-orange-400 bg-orange-500/20"
                                  : "border-emerald-300 bg-emerald-300/20"
                            }`}
                            style={{
                              left: `${currentZoneImageBox.x_pct}%`,
                              top: `${currentZoneImageBox.y_pct}%`,
                              width: `${currentZoneImageBox.width_pct}%`,
                              height: `${currentZoneImageBox.height_pct}%`,
                            }}
                          >
                            <span className="absolute left-1 top-1 rounded bg-slate-950 px-1.5 py-0.5 text-[10px] font-semibold text-white shadow">
                              {currentZone.zone_name}
                            </span>
                            {[
                              ["nw", "-left-1 -top-1 cursor-nwse-resize"],
                              ["ne", "-right-1 -top-1 cursor-nesw-resize"],
                              ["sw", "-bottom-1 -left-1 cursor-nesw-resize"],
                              ["se", "-bottom-1 -right-1 cursor-nwse-resize"],
                            ].map(([handle, position]) => (
                                <span
                                  className={`absolute h-3 w-3 rounded-full border border-slate-950 bg-orange-300 ${position}`}
                                  key={handle}
                                  onPointerDown={(event) =>
                                    startZoneResize(
                                      event,
                                      handle as "nw" | "ne" | "sw" | "se",
                                    )
                                  }
                                />
                              ))}
                          </div>
                          ) : null}
                        </div>
                      ) : imageRotation % 360 !== 0 ? (
                        <div className="absolute inset-x-3 bottom-3 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-900 shadow">
                          Preview rotation is not saved yet. Click Set as OCR
                          orientation to persist this view and reload zones.
                        </div>
                      ) : null}
                      </div>
                    </div>
                  ) : (
                    <div className="flex min-h-[24rem] items-center justify-center overflow-hidden rounded-lg border border-slate-200 bg-slate-100 p-3">
                      <img
                        alt={`${giftCard.brand} original upload`}
                        className="block h-auto max-h-[70vh] w-auto max-w-full object-contain"
                        src={originalUploadPreviewUrl}
                        style={{
                          transform: `rotate(${imageRotation}deg)`,
                        }}
                      />
                    </div>
                  )}
                </>
              ) : (
                <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-8 text-center text-sm text-slate-500">
                  {isDigitalCard
                    ? "No physical OCR image. Digital cards can be verified from manual copied credentials."
                    : "No image uploaded. Upload an image to review and verify this card."}
                </div>
              )}
            </div>

            {supportingAttachments.length > 0 ? (
              <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
                <h2 className="text-lg font-semibold">Supporting Attachments</h2>
                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  {supportingAttachments.map((attachment) => {
                    const purged =
                      (attachment.retention_status ?? "active") === "purged";
                    const attachmentUrl = buildUploadUrl(
                      attachment.original_image_url,
                    );

                    return (
                      <div
                        className="rounded-md border border-slate-200 bg-slate-50 p-3 text-sm"
                        key={attachment.id}
                      >
                        <p className="font-semibold text-slate-900">
                          {attachment.original_filename ||
                            `Attachment #${attachment.id}`}
                        </p>
                        <p className="mt-1 text-xs uppercase tracking-wide text-slate-500">
                          {attachment.attachment_type?.replaceAll("_", " ") ??
                            attachment.image_type}
                        </p>
                        {purged ? (
                          <p className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-900">
                            Attachment purged per retention policy
                            {attachment.purged_at
                              ? ` on ${formatDate(attachment.purged_at)}`
                              : ""}
                            .
                          </p>
                        ) : (
                          <a
                            className="mt-3 inline-flex h-9 items-center rounded-md border border-slate-300 bg-white px-3 text-xs font-semibold text-slate-700 hover:bg-slate-100"
                            href={attachmentUrl}
                            rel="noreferrer"
                            target="_blank"
                          >
                            Open / Download
                          </a>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : null}

            <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h2 className="text-lg font-semibold">Purchase Receipt</h2>
                  <p className="mt-1 text-sm text-slate-500">
                    {receipts.length}{" "}
                    {receipts.length === 1 ? "receipt" : "receipts"} attached
                    to purchase #{giftCard.purchase_batch_id}.
                  </p>
                </div>
                <Link
                  className="inline-flex h-11 cursor-pointer items-center justify-center rounded-md border border-slate-300 px-4 text-sm font-semibold text-slate-700 transition hover:bg-slate-100 active:bg-slate-200"
                  href={purchaseHref}
                >
                  View Purchase
                </Link>
              </div>

              {receipts.length === 0 ? (
                <p className="mt-3 text-sm text-slate-500">
                  No receipt uploaded for this purchase yet.
                </p>
              ) : (
                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  {receipts.map((receipt) => {
                    const receiptUrl = buildUploadUrl(receipt.image_url);
                    const purged =
                      (receipt.retention_status ?? "active") === "purged";

                    return (
                      <figure
                        className="overflow-hidden rounded-md border border-slate-200 bg-slate-50"
                        key={receipt.id}
                      >
                        {purged ? (
                          <div className="flex h-40 items-center justify-center bg-amber-50 px-4 text-center text-sm font-medium text-amber-900">
                            Attachment purged per retention policy
                          </div>
                        ) : (
                          <a href={receiptUrl} target="_blank" rel="noreferrer">
                            <Image
                              alt={receipt.original_filename || "Purchase receipt"}
                              className="h-40 w-full object-cover"
                              height={160}
                              src={receiptUrl}
                              unoptimized
                              width={320}
                            />
                          </a>
                        )}
                        <figcaption className="space-y-2 p-3 text-xs text-slate-600">
                          <p className="truncate font-medium text-slate-800">
                            {receipt.original_filename || `Receipt #${receipt.id}`}
                          </p>
                          {purged ? null : (
                            <a
                              className="inline-flex h-9 cursor-pointer items-center rounded-md border border-slate-300 bg-white px-3 font-semibold text-slate-700 transition hover:bg-slate-100 active:bg-slate-200"
                              download
                              href={receiptUrl}
                            >
                              Open / Download Receipt
                            </a>
                          )}
                        </figcaption>
                      </figure>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
              <h2 className="text-lg font-semibold">Extraction Summary</h2>
              {latestExtractionAttempt ? (
                <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2">
                  <div>
                    <dt className="font-medium text-slate-500">OCR Status</dt>
                    <dd className="capitalize">
                      {giftCard.ocr_status?.replaceAll("_", " ") ?? "completed"}
                    </dd>
                  </div>
                  <div>
                    <dt className="font-medium text-slate-500">Candidates</dt>
                    <dd>
                      {usefulExtractionCandidateCount} found
                      {rejectedCandidates.length > 0
                        ? ` · ${rejectedCandidates.length} rejected`
                        : ""}
                    </dd>
                  </div>
                  <div>
                    <dt className="font-medium text-slate-500">Detected Brand</dt>
                    <dd>{giftCard.brand}</dd>
                  </div>
                  <div>
                    <dt className="font-medium text-slate-500">OCR Rotation</dt>
                    <dd>
                      {selectedOcrRotation ? `${selectedOcrRotation}°` : "Not recorded"}
                    </dd>
                  </div>
                  <div>
                    <dt className="font-medium text-slate-500">
                      Canonical Orientation
                    </dt>
                    <dd>
                      {canonicalRotation
                        ? `${canonicalRotation}° (${canonicalOrientationSource ?? "auto"})`
                        : primaryImage?.canonical_rotation_degrees !== null &&
                            primaryImage?.canonical_rotation_degrees !== undefined
                          ? `${primaryImage.canonical_rotation_degrees}° (${
                              primaryImage.orientation_source ?? "auto"
                            })`
                          : "Not recorded"}
                    </dd>
                  </div>
                  <div>
                    <dt className="font-medium text-slate-500">
                      Coordinate Space
                    </dt>
                    <dd>{canonicalCoordinateSpace ?? "saved Review/OCR image %"}</dd>
                  </div>
                  <div>
                    <dt className="font-medium text-slate-500">Profile</dt>
                    <dd>{detectedOcrProfile ?? "generic"}</dd>
                  </div>
                  <div>
                    <dt className="font-medium text-slate-500">Credential Type</dt>
                    <dd>{detectedCredentialType ?? "Not recorded"}</dd>
                  </div>
                  <div>
                    <dt className="font-medium text-slate-500">Preprocessing</dt>
                    <dd>{preprocessingMethod ?? "Not recorded"}</dd>
                  </div>
                  <div>
                    <dt className="font-medium text-slate-500">OCR Source Used</dt>
                    <dd>{selectedOcrImageSource ?? "Not recorded"}</dd>
                  </div>
                  <div className="sm:col-span-2">
                    <dt className="font-medium text-slate-500">
                      Image Routing
                    </dt>
                    <dd className="break-all">
                      display: {debugDisplayImageUsed ?? primaryImage?.processed_image_url ?? "not recorded"}
                      <br />
                      OCR: {debugOcrImageUsed ?? primaryImage?.processed_image_url ?? "not recorded"}
                      <br />
                      barcode: {debugBarcodeImageUsed ?? "not recorded"}
                    </dd>
                  </div>
                  <div>
                    <dt className="font-medium text-slate-500">
                      Saved Image Dimensions
                    </dt>
                    <dd>
                      {debugSavedReviewImageDimensions ??
                        (canonicalImageSize
                          ? `${canonicalImageSize.width}x${canonicalImageSize.height}`
                          : "Not recorded")}
                    </dd>
                  </div>
                  <div>
                    <dt className="font-medium text-slate-500">Template/Layout</dt>
                    <dd>{selectedTemplateLayout ?? "Not recorded"}</dd>
                  </div>
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
                    <dt className="font-medium text-slate-500">
                      {isRedemptionCodeOnly
                        ? "Redemption Code"
                        : "Card Number"}
                    </dt>
                    <dd>{latestExtractionAttempt.extracted_card_number ?? "None"}</dd>
                  </div>
                  {!isRedemptionCodeOnly ? (
                    <div>
                      <dt className="font-medium text-slate-500">PIN</dt>
                      <dd>{latestExtractionAttempt.extracted_pin ?? "None"}</dd>
                    </div>
                  ) : null}
                  <div className="sm:col-span-2">
                    <dt className="font-medium text-slate-500">Created</dt>
                    <dd>{formatDate(latestExtractionAttempt.created_at)}</dd>
                  </div>
                  <div className="sm:col-span-2 rounded-md border border-slate-200 bg-slate-50 p-3">
                    <dt className="font-medium text-slate-500">
                      Confirmed / Exported Credential Audit
                    </dt>
                    <dd className="mt-2 grid gap-2 sm:grid-cols-2">
                      <span>
                        Confirmed:{" "}
                        <span className="font-mono">
                          {maskSensitiveValue(lockedPrimaryValue)}
                        </span>
                      </span>
                      <span>
                        Exported:{" "}
                        <span className="font-mono">
                          {maskSensitiveValue(lockedPrimaryValue)}
                        </span>
                      </span>
                      <span>
                        Last OCR:{" "}
                        <span className="font-mono">
                          {maskSensitiveValue(
                            latestExtractionAttempt.extracted_card_number,
                          )}
                        </span>
                      </span>
                      <span>
                        Mismatch:{" "}
                        <span className="font-semibold">
                          {cardSuggestionMismatch || pinSuggestionMismatch
                            ? "Yes"
                            : "No"}
                        </span>
                      </span>
                    </dd>
                  </div>
                </dl>
              ) : (
                <div className="mt-3 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600">
                  <p>No extraction yet.</p>
                  {giftCard.ocr_status &&
                  isOcrPendingStatus(giftCard.ocr_status) ? (
                    <p className="mt-1 font-medium text-cyan-800">
                      OCR {giftCard.ocr_status}. Refresh this page shortly for
                      suggestions.
                    </p>
                  ) : giftCard.ocr_status === "failed" ? (
                    <p className="mt-1 font-medium text-red-700">
                      OCR failed. You can enter details manually or re-scan the
                      image.
                    </p>
                  ) : null}
                </div>
              )}
              {isOcrReadyStatus(giftCard.ocr_status) &&
              latestExtractionAttempt &&
              usefulExtractionCandidateCount === 0 ? (
                <div className="mt-3 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                  No code detected - open OCR debug to inspect raw OCR text,
                  rejected candidates, and selected rotation.
                </div>
              ) : null}
              {latestExtractionAttempt?.raw_text ? (
                <details className="mt-4 rounded-md border border-slate-200 bg-slate-50 p-3">
                  <summary className="cursor-pointer text-sm font-semibold text-slate-700">
                    OCR Debug
                  </summary>
                  <dl className="mt-3 grid gap-2 text-xs sm:grid-cols-2">
                    <div>
                      <dt className="font-semibold text-slate-500">Detected brand</dt>
                      <dd>{giftCard.brand}</dd>
                    </div>
                    <div>
                      <dt className="font-semibold text-slate-500">Selected rotation</dt>
                      <dd>
                        {selectedOcrRotation
                          ? `${selectedOcrRotation}°`
                          : "Not recorded"}
                      </dd>
                    </div>
                    <div>
                      <dt className="font-semibold text-slate-500">
                        Canonical orientation
                      </dt>
                      <dd>
                        {canonicalRotation
                          ? `${canonicalRotation}° (${canonicalOrientationSource ?? "auto"})`
                          : "Not recorded"}
                      </dd>
                    </div>
                    <div>
                      <dt className="font-semibold text-slate-500">
                        Orientation score
                      </dt>
                      <dd>{canonicalOrientationScore ?? "Not recorded"}</dd>
                    </div>
                    <div>
                      <dt className="font-semibold text-slate-500">Preprocessing</dt>
                      <dd>{preprocessingMethod ?? "Not recorded"}</dd>
                    </div>
                    <div>
                      <dt className="font-semibold text-slate-500">Candidates found</dt>
                      <dd>{usefulExtractionCandidateCount}</dd>
                    </div>
                    <div>
                      <dt className="font-semibold text-slate-500">
                        Rejected candidates
                      </dt>
                      <dd>{rejectedCandidates.length}</dd>
                    </div>
                  </dl>
                  {rejectedCandidates.length > 0 ? (
                    <div className="mt-3 rounded-md border border-slate-200 bg-white p-2">
                      <p className="text-xs font-semibold text-slate-600">
                        Rejected Values
                      </p>
                      <div className="mt-2 space-y-2">
                        {rejectedCandidates.slice(0, 8).map((candidate) => (
                          <div
                            className="rounded border border-slate-200 bg-slate-50 px-2 py-1 text-xs"
                            key={candidate.id}
                          >
                            <p className="font-mono text-slate-900">
                              {candidate.value}
                            </p>
                            <p className="text-slate-500">
                              {candidate.notes || "Rejected by parser profile."}
                            </p>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : null}
                  {ocrModeResults ? (
                    <div className="mt-3 rounded-md border border-slate-200 bg-white p-2">
                      <p className="text-xs font-semibold text-slate-600">
                        OCR Mode Results
                      </p>
                      <pre className="mt-2 overflow-auto rounded bg-slate-950 p-2 text-xs text-slate-100">
                        {ocrModeResults}
                      </pre>
                    </div>
                  ) : null}
                  {canonicalReasonSelected ? (
                    <div className="mt-3 rounded-md border border-slate-200 bg-white p-2">
                      <p className="text-xs font-semibold text-slate-600">
                        Orientation Reason
                      </p>
                      <p className="mt-2 text-xs text-slate-700">
                        {canonicalReasonSelected}
                      </p>
                    </div>
                  ) : null}
                  {canonicalOrientationTrials ? (
                    <div className="mt-3 rounded-md border border-slate-200 bg-white p-2">
                      <p className="text-xs font-semibold text-slate-600">
                        Canonical Orientation Trials
                      </p>
                      <pre className="mt-2 overflow-auto rounded bg-slate-950 p-2 text-xs text-slate-100">
                        {canonicalOrientationTrials}
                      </pre>
                    </div>
                  ) : null}
                  <p className="mt-2 text-xs text-slate-500">
                    Developer view with selected profile, credential type,
                    OCR bounding-box token data, candidates, and rejected values.
                  </p>
                  <pre className="mt-3 max-h-72 overflow-auto rounded-md bg-slate-950 p-3 text-xs text-slate-100">
                    {latestExtractionAttempt.raw_text}
                  </pre>
                </details>
              ) : null}

              <details className="mt-4 rounded-md border border-slate-700 bg-slate-950 p-3 text-slate-100">
                <summary className="cursor-pointer text-sm font-semibold text-cyan-200">
                  Improve recognition / set OCR zone
                </summary>
                <p className="mt-2 text-xs text-slate-300">
                  Drag directly on the saved Review/OCR Image to label credential
                  zones. With a card boundary, credential zones are saved relative
                  to the physical card boundary.
                </p>
                {isBestBuyCard ? (
                  <div className="mt-3 grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
                    <label className="block text-xs font-medium text-slate-200">
                      Best Buy layout
                      <select
                        className="mt-1 h-10 w-full rounded-md border border-slate-600 bg-slate-900 px-2 text-slate-100"
                        onChange={(event) => applyBestBuyLayout(event.target.value)}
                        value={selectedBestBuyLayout}
                      >
                        {bestBuyLayoutOptions.map(([value, label]) => (
                          <option key={value} value={value}>
                            {label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <button
                      className="h-10 rounded-md border border-slate-600 bg-slate-900 px-3 text-xs font-semibold text-slate-200 hover:bg-slate-800"
                      onClick={useCurrentCardAsNewBestBuyLayout}
                      type="button"
                    >
                      Use this card as new Best Buy layout
                    </button>
                    <span className="text-xs text-slate-400 sm:col-span-2">
                      Set the card boundary first, then adjust credential zones.
                      Layouts describe the printed card design. Barcode card-number
                      detection still runs independently of the selected layout.
                    </span>
                    {bestBuyBoundaryNeedsAdjustment ? (
                      <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-950 sm:col-span-2">
                        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                          <span>
                            Adjust card boundary before saving Best Buy zones.
                          </span>
                          <button
                            className="h-8 rounded-md bg-amber-300 px-3 text-xs font-semibold text-slate-950 transition hover:bg-amber-200"
                            onClick={() => {
                              setSelectedZoneName("card_boundary");
                              setZoneTrainingMode("boundary");
                              setZoneForm((currentForm) => ({
                                ...currentForm,
                                zone_name: "card_boundary",
                                zone_type: "card_boundary",
                              }));
                            }}
                            type="button"
                          >
                            Set Card Boundary
                          </button>
                        </div>
                      </div>
                    ) : null}
                    <details className="rounded-md border border-slate-700 bg-slate-900 p-3 sm:col-span-2">
                      <summary className="cursor-pointer text-xs font-semibold text-cyan-200">
                        Manage Best Buy layout templates
                      </summary>
                      <div className="mt-3 space-y-2">
                        {normalizeBestBuyLayouts(ocrLayouts).map((layout) => {
                          const isStandardLayout = BEST_BUY_LAYOUT_OPTIONS.some(
                            ([layoutName]) => layoutName === layout.layout_name,
                          );
                          return (
                            <div
                              className="grid gap-2 rounded-md border border-slate-700 bg-slate-950 p-2 text-xs text-slate-200 sm:grid-cols-[minmax(0,1fr)_auto]"
                              key={layout.layout_name}
                            >
                              <div>
                                <p className="font-semibold">{layout.label}</p>
                                <p className="mt-1 text-slate-400">
                                  {layout.active ? "Active" : "Inactive"} ·{" "}
                                  {layout.zones.length} zones
                                </p>
                              </div>
                              <div className="flex flex-wrap gap-2">
                                <button
                                  className="h-8 rounded border border-slate-600 px-2 font-semibold text-slate-100 hover:border-cyan-300"
                                  onClick={() =>
                                    setBestBuyLayoutActive(
                                      layout.layout_name,
                                      !layout.active,
                                    )
                                  }
                                  type="button"
                                >
                                  {layout.active ? "Deactivate" : "Activate"}
                                </button>
                                {!isStandardLayout ? (
                                  <button
                                    className="h-8 rounded border border-red-400/60 px-2 font-semibold text-red-200 hover:bg-red-950"
                                    onClick={() =>
                                      deleteBestBuyLayout(layout.layout_name)
                                    }
                                    type="button"
                                  >
                                    Delete
                                  </button>
                                ) : null}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                      <p className="mt-3 text-xs text-slate-400">
                        Save template after changing layout visibility. Inactive
                        templates are recoverable here but hidden from the normal
                        verification dropdown.
                      </p>
                    </details>
                  </div>
                ) : null}
                <dl className="mt-3 grid gap-2 rounded-md border border-slate-800 bg-slate-900 p-3 text-xs text-slate-300 sm:grid-cols-3">
                  <div>
                    <dt className="font-semibold text-slate-100">
                      Coordinate mode
                    </dt>
                    <dd>{coordinateMode}</dd>
                  </div>
                  <div>
                    <dt className="font-semibold text-slate-100">
                      Selected layout
                    </dt>
                    <dd>
                      {selectedTemplateLayout
                        ? bestBuyLayoutLabel(selectedTemplateLayout)
                        : selectedBestBuyLayout === "auto"
                          ? "Auto"
                          : bestBuyLayoutLabel(selectedBestBuyLayout)}
                    </dd>
                  </div>
                  <div>
                    <dt className="font-semibold text-slate-100">
                      Layout confidence
                    </dt>
                    <dd>{selectedTemplateConfidence ?? "Not scored yet"}</dd>
                  </div>
                </dl>
                {templateMismatch === "yes" ? (
                  <p className="mt-3 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-900">
                    Template mismatch — choose another layout or redraw zones.
                  </p>
                ) : null}
                {bestBuyBoundaryNeedsAdjustment ? (
                  <p className="mt-3 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-900">
                    Adjust card boundary before saving Best Buy zones.
                  </p>
                ) : null}
                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                  <button
                    className={`h-10 rounded-md border px-3 text-xs font-semibold disabled:cursor-not-allowed disabled:opacity-50 ${
                      ["new_zone", "edit_zone"].includes(zoneTrainingMode)
                        ? "border-cyan-300 bg-cyan-300 text-slate-950"
                        : "border-slate-600 bg-slate-900 text-slate-200"
                    }`}
                    disabled={!canonicalReady || !hasBoundary}
                    onClick={() => {
                      const nextIndex = credentialZones.length + 1;
                      setSelectedZoneName(null);
                      setZoneTrainingMode("new_zone");
                      setZoneForm((currentForm) => ({
                        ...currentForm,
                        zone_name: `zone_${nextIndex}`,
                        zone_type: isRedemptionCodeOnly
                          ? "redemption_code"
                          : "card_number",
                      }));
                    }}
                    type="button"
                  >
                    Draw Credential Zone
                  </button>
                  <button
                    className={`h-10 rounded-md border px-3 text-xs font-semibold ${
                      zoneTrainingMode === "boundary"
                        ? "border-cyan-300 bg-cyan-300 text-slate-950"
                        : "border-slate-600 bg-slate-900 text-slate-200"
                    }`}
                    onClick={() => {
                      setSelectedZoneName("card_boundary");
                      setZoneTrainingMode("boundary");
                      setZoneForm((currentForm) => ({
                        ...currentForm,
                        zone_name: "card_boundary",
                        zone_type: "card_boundary",
                      }));
                    }}
                    type="button"
                  >
                    Set Card Boundary
                  </button>
                </div>
                {!canonicalReady ? (
                  <p className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800">
                    Saved Review/OCR Image unavailable. Zone training and template
                    OCR stay locked until an OCR orientation is saved.
                  </p>
                ) : null}
                <div className="mt-3 grid gap-2 text-xs sm:grid-cols-5">
                  {[
                    ["1", "Canonical", canonicalReady],
                    ["2", "Boundary", hasBoundary],
                    ["3", "Zones", hasCredentialZone],
                    ["4", "Test", Boolean(zoneTestResult)],
                    ["5", "Save", zoneTemplateSaved],
                  ].map(([number, label, complete]) => (
                    <div
                      className={`rounded-md border px-2 py-1 ${
                        complete
                          ? "border-emerald-400 bg-emerald-400/10 text-emerald-100"
                          : "border-slate-700 bg-slate-900 text-slate-300"
                      }`}
                      key={String(label)}
                    >
                      <span className="font-semibold">Step {number}</span>{" "}
                      {label}
                    </div>
                  ))}
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {zonePresetsForBrand(giftCard.brand).map(([preset, label]) => (
                    <button
                      className="h-9 rounded-md border border-slate-600 bg-slate-900 px-3 text-xs font-semibold text-slate-100 hover:border-cyan-300 hover:text-cyan-200"
                      key={preset}
                      onClick={() => {
                        applyZonePreset(preset);
                        setZoneTrainingMode("new_zone");
                      }}
                      type="button"
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <div className="mt-3 grid gap-2 sm:grid-cols-3">
                  <label className="text-xs font-medium text-slate-200">
                    Zone name
                    <input
                      className="mt-1 h-9 w-full rounded-md border border-slate-600 bg-slate-900 px-2 text-slate-100"
                      onChange={(event) =>
                        {
                          setZoneForm({ ...zoneForm, zone_name: event.target.value });
                          setZoneTemplateSaved(false);
                          setZoneTestResult(null);
                        }
                      }
                      value={zoneForm.zone_name}
                    />
                  </label>
                  <label className="text-xs font-medium text-slate-200">
                    Zone type
                    <select
                      className="mt-1 h-9 w-full rounded-md border border-slate-600 bg-slate-900 px-2 text-slate-100"
                      onChange={(event) =>
                        {
                          setZoneForm({ ...zoneForm, zone_type: event.target.value });
                          setZoneTemplateSaved(false);
                          setZoneTestResult(null);
                        }
                      }
                      value={zoneForm.zone_type}
                    >
                      <option value="card_boundary">Card Boundary</option>
                      <option value="redemption_code">Redemption Code</option>
                      <option value="card_number">Card Number</option>
                      <option value="pin">PIN</option>
                      <option value="barcode">Barcode</option>
                      <option value="ignore">Ignore</option>
                    </select>
                  </label>
                  <label className="text-xs font-medium text-slate-200">
                    Priority
                    <input
                      className="mt-1 h-9 w-full rounded-md border border-slate-600 bg-slate-900 px-2 text-slate-100"
                      min="1"
                      onChange={(event) =>
                        {
                          setZoneForm({ ...zoneForm, priority: event.target.value });
                          setZoneTemplateSaved(false);
                        }
                      }
                      type="number"
                      value={zoneForm.priority}
                    />
                  </label>
                  {(["x_pct", "y_pct", "width_pct", "height_pct"] as const).map(
                    (field) => (
                      <label
                        className="text-xs font-medium text-slate-200"
                        key={field}
                      >
                        {field.replace("_pct", " %").toUpperCase()}
                        <input
                          className="mt-1 h-9 w-full rounded-md border border-slate-600 bg-slate-900 px-2 text-slate-100"
                          max="100"
                          min="0"
                          onChange={(event) =>
                            {
                              setZoneForm({
                                ...zoneForm,
                                [field]: event.target.value,
                              });
                              setZoneTemplateSaved(false);
                              setZoneTestResult(null);
                            }
                          }
                          type="number"
                          value={zoneForm[field]}
                        />
                      </label>
                    ),
                  )}
                </div>
                <div className="mt-3 rounded-md border border-slate-700 bg-slate-900 p-2 text-xs text-slate-200">
                  <div className="flex flex-col gap-2 lg:flex-row lg:items-start lg:justify-between">
                    <div>
                      <p className="font-semibold text-slate-100">
                        Selected zone alignment
                      </p>
                      <p className="mt-1 text-slate-400">
                        Basis: {coordinateMode}
                        {boundaryZone ? (
                          <>
                            {" "}· boundary x {boundaryZone.x_pct.toFixed(2)}, y{" "}
                            {boundaryZone.y_pct.toFixed(2)}, w{" "}
                            {boundaryZone.width_pct.toFixed(2)}, h{" "}
                            {boundaryZone.height_pct.toFixed(2)}
                          </>
                        ) : (
                          " · no card boundary"
                        )}
                      </p>
                      <p className="mt-1 font-mono text-[11px] text-slate-300">
                        zone pct x {currentZone.x_pct.toFixed(2)}, y{" "}
                        {currentZone.y_pct.toFixed(2)}, w{" "}
                        {currentZone.width_pct.toFixed(2)}, h{" "}
                        {currentZone.height_pct.toFixed(2)}
                      </p>
                      <p className="mt-1 font-mono text-[11px] text-slate-300">
                        image pct x {currentZoneImageBox.x_pct.toFixed(2)}, y{" "}
                        {currentZoneImageBox.y_pct.toFixed(2)}, w{" "}
                        {currentZoneImageBox.width_pct.toFixed(2)}, h{" "}
                        {currentZoneImageBox.height_pct.toFixed(2)}
                      </p>
                      <p className="mt-1 font-mono text-[11px] text-slate-300">
                        natural px{" "}
                        {selectedZonePixelBox
                          ? `x ${selectedZonePixelBox.x}, y ${selectedZonePixelBox.y}, w ${selectedZonePixelBox.width}, h ${selectedZonePixelBox.height}`
                          : "not measured"}
                      </p>
                      <p className="mt-1 font-mono text-[11px] text-slate-300">
                        rendered px{" "}
                        {selectedZoneRenderedBox
                          ? `x ${selectedZoneRenderedBox.x}, y ${selectedZoneRenderedBox.y}, w ${selectedZoneRenderedBox.width}, h ${selectedZoneRenderedBox.height}`
                          : "not measured"}
                      </p>
                    </div>
                    <div className="grid grid-cols-4 gap-1 sm:min-w-[20rem]">
                      {[
                        ["Left", "x_pct", -0.5],
                        ["Right", "x_pct", 0.5],
                        ["Up", "y_pct", -0.5],
                        ["Down", "y_pct", 0.5],
                        ["Narrow", "width_pct", -0.5],
                        ["Widen", "width_pct", 0.5],
                        ["Shorter", "height_pct", -0.5],
                        ["Taller", "height_pct", 0.5],
                      ].map(([label, field, delta]) => (
                        <button
                          className="h-8 rounded border border-slate-600 bg-slate-950 px-2 text-[11px] font-semibold text-slate-100 transition hover:border-cyan-300 hover:text-cyan-200"
                          key={`${field}-${delta}`}
                          onClick={() =>
                            adjustCurrentZone(
                              field as "x_pct" | "y_pct" | "width_pct" | "height_pct",
                              delta as number,
                            )
                          }
                          type="button"
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
                {savedOcrZones.length > 0 ? (
                  <div className="mt-3 rounded-md border border-slate-700 bg-slate-900 p-2">
                    <p className="text-xs font-semibold text-slate-100">
                      Saved zones for {giftCard.brand}
                    </p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {savedOcrZones.map((zone) => (
                        <button
                          className={`rounded-md border px-2 py-1 text-xs font-medium ${
                            zone.zone_name === currentZone.zone_name
                              ? "border-orange-400 bg-orange-500/20 text-orange-100"
                              : "border-slate-600 bg-slate-950 text-slate-200"
                          }`}
                          key={zone.zone_name}
                          onClick={() => {
                            setSelectedZoneName(zone.zone_name);
                            setZoneTrainingMode("idle");
                            setZoneForm({
                              zone_name: zone.zone_name,
                              zone_type: zone.zone_type,
                              x_pct: String(zone.x_pct),
                              y_pct: String(zone.y_pct),
                              width_pct: String(zone.width_pct),
                              height_pct: String(zone.height_pct),
                              priority: String(zone.priority || 1),
                            });
                          }}
                          type="button"
                        >
                          {zone.zone_name} · {zone.zone_type}
                        </button>
                      ))}
                    </div>
                  </div>
                ) : null}
                <div className="mt-3 flex flex-wrap gap-2">
                  {selectedZoneName ? (
                    <button
                      className="h-10 rounded-md border border-yellow-300 bg-yellow-300 px-3 text-xs font-semibold text-slate-950 transition hover:bg-yellow-200"
                      onClick={() => setZoneTrainingMode("edit_zone")}
                      type="button"
                    >
                      Edit Selected Zone
                    </button>
                  ) : null}
                  <button
                    className="h-10 rounded-md border border-slate-600 bg-slate-900 px-3 text-xs font-semibold text-slate-100 transition hover:border-cyan-300 hover:text-cyan-200"
                    onClick={addCurrentZone}
                    type="button"
                  >
                    {zoneTrainingMode === "boundary"
                      ? "Confirm Boundary"
                      : savedOcrZones.some(
                          (zone) => zone.zone_name === currentZone.zone_name,
                        )
                        ? "Update Zone"
                        : "Add Zone"}
                  </button>
                  <button
                    className="h-10 rounded-md border border-slate-600 bg-slate-900 px-3 text-xs font-semibold text-slate-100 transition hover:border-cyan-300 hover:text-cyan-200"
                    onClick={resetCurrentZone}
                    type="button"
                  >
                    Reset Zone
                  </button>
                  <button
                    className="h-10 rounded-md border border-red-400/60 bg-slate-900 px-3 text-xs font-semibold text-red-200 transition hover:bg-red-950"
                    onClick={deleteCurrentZone}
                    type="button"
                  >
                    Delete Zone
                  </button>
                  <button
                    className="h-10 rounded-md border border-slate-600 bg-slate-900 px-3 text-xs font-semibold text-slate-100 transition hover:border-cyan-300 hover:text-cyan-200 disabled:cursor-not-allowed disabled:opacity-60"
                    disabled={
                      isTestingZone ||
                      !primaryImage ||
                      !canonicalReady ||
                      currentZone.zone_type === "card_boundary"
                    }
                    onClick={() => void testOcrZone()}
                    type="button"
                  >
                    {isTestingZone ? "Testing..." : "Test OCR Zone"}
                  </button>
                  <button
                    className="h-10 rounded-md bg-cyan-300 px-3 text-xs font-semibold text-slate-950 transition hover:bg-cyan-200 disabled:cursor-not-allowed disabled:opacity-60"
                    disabled={
                      !canonicalReady ||
                      !hasBoundary ||
                      !hasCredentialZone
                    }
                    onClick={() => void saveOcrZoneTemplate()}
                    type="button"
                  >
                    Save OCR Zones for Brand
                  </button>
                </div>
                {isTestingZone && zoneTestStage ? (
                  <div className="mt-3 rounded-md border border-cyan-400/40 bg-cyan-950/30 px-3 py-2 text-xs font-semibold text-cyan-100">
                    {zoneTestStage}
                  </div>
                ) : null}
                {zoneTestResult ? (
                  <div className="mt-3 rounded-md border border-slate-700 bg-slate-900 p-3 text-xs">
                    {zoneTestResult.selected_crop_image_data_url ? (
                      <div className="mb-3 grid gap-3 md:grid-cols-2">
                        <div className="rounded-md border border-slate-700 bg-slate-950 p-2">
                          <p className="mb-2 text-xs font-semibold text-slate-100">
                            Exact selected rectangle
                          </p>
                          <img
                            alt="Exact selected OCR zone"
                            className="max-h-48 w-auto max-w-full rounded border border-slate-700 bg-slate-950"
                            src={zoneTestResult.selected_crop_image_data_url}
                          />
                        </div>
                        <div className="rounded-md border border-slate-700 bg-slate-950 p-2">
                          <p className="mb-2 text-xs font-semibold text-slate-100">
                            {currentZone.zone_type === "barcode"
                              ? "Padded crop sent to barcode decoder"
                              : "Padded crop sent to OCR"}
                          </p>
                          <img
                            alt="Padded OCR crop"
                            className="max-h-48 w-auto max-w-full rounded border border-slate-700 bg-slate-950"
                            src={zoneTestResult.crop_image_data_url}
                          />
                        </div>
                      </div>
                    ) : null}
                    {zoneCropMismatch ? (
                      <p className="mb-3 rounded-md border border-red-400/60 bg-red-950/40 px-3 py-2 font-semibold text-red-100">
                        Zone crop mismatch — check coordinate transform.
                      </p>
                    ) : (
                      <p className="mb-3 rounded-md border border-emerald-400/40 bg-emerald-950/30 px-3 py-2 font-semibold text-emerald-100">
                        Selected preview matches the backend zone.{" "}
                        {currentZone.zone_type === "barcode"
                          ? "Barcode decoding tests the exact and padded crops across rotations."
                          : "OCR uses the padded crop for extra context."}
                      </p>
                    )}
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                      <p className="font-semibold text-slate-100">
                        {currentZone.zone_type === "barcode"
                          ? "Zone Barcode Result"
                          : "Zone OCR Result"}
                      </p>
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-slate-300">
                          Confidence {formatConfidence(zoneTestResult.confidence)}
                        </p>
                        <button
                          className="h-8 rounded-md border border-slate-600 bg-slate-950 px-2 text-[11px] font-semibold text-slate-100 transition hover:border-cyan-300 hover:text-cyan-200"
                          onClick={downloadOcrDebug}
                          type="button"
                        >
                          Download OCR Debug
                        </button>
                      </div>
                    </div>
                    <p className="mt-1 text-slate-400">
                      Source {zoneTestResult.image_source} · rotation{" "}
                      {zoneTestResult.rotation_degrees}° ·{" "}
                      {zoneTestResult.transform_chain} · total{" "}
                      {zoneTestResult.timing_ms}ms
                      {zoneTestResult.timed_out ? " · timed out with partial results" : ""}
                    </p>
                    <dl className="mt-3 grid gap-2 rounded-md border border-slate-700 bg-slate-950 p-2 text-slate-300 sm:grid-cols-2">
                      <div>
                        <dt className="font-semibold text-slate-100">
                          Zone
                        </dt>
                        <dd>
                          {currentZone.zone_name} · {currentZone.zone_type}
                        </dd>
                      </div>
                      <div>
                        <dt className="font-semibold text-slate-100">
                          Source image
                        </dt>
                        <dd>
                          {zoneTestResult.source_image_dimensions.width} x{" "}
                          {zoneTestResult.source_image_dimensions.height}
                        </dd>
                      </div>
                      <div>
                        <dt className="font-semibold text-slate-100">
                          Displayed image
                        </dt>
                        <dd>
                          {canonicalDisplaySize
                            ? `${canonicalDisplaySize.width} x ${canonicalDisplaySize.height}`
                            : "Not captured"}
                        </dd>
                      </div>
                      <div>
                        <dt className="font-semibold text-slate-100">
                          Crop pixels
                        </dt>
                        <dd>
                          selected x {zoneTestResult.selected_crop.x_px}, y{" "}
                          {zoneTestResult.selected_crop.y_px}, w{" "}
                          {zoneTestResult.selected_crop.width_px}, h{" "}
                          {zoneTestResult.selected_crop.height_px}
                          <br />
                          padded x {zoneTestResult.crop.x_px}, y{" "}
                          {zoneTestResult.crop.y_px}, w{" "}
                          {zoneTestResult.crop.width_px}, h{" "}
                          {zoneTestResult.crop.height_px}
                        </dd>
                      </div>
                      <div className="sm:col-span-2">
                        <dt className="font-semibold text-slate-100">
                          Crop percentages
                        </dt>
                        <dd>
                          x {zoneTestResult.crop.x_pct.toFixed(2)}%, y{" "}
                          {zoneTestResult.crop.y_pct.toFixed(2)}%, w{" "}
                          {zoneTestResult.crop.width_pct.toFixed(2)}%, h{" "}
                          {zoneTestResult.crop.height_pct.toFixed(2)}%
                        </dd>
                      </div>
                      {zoneTestResult.debug_image_paths.length > 0 ? (
                        <div className="sm:col-span-2">
                          <dt className="font-semibold text-slate-100">
                            Debug images saved
                          </dt>
                          <dd className="font-mono text-[11px]">
                            {zoneTestResult.debug_image_paths.join(" | ")}
                          </dd>
                        </div>
                      ) : null}
                      {zoneTestResult.stage_timings.length > 0 ? (
                        <div className="sm:col-span-2">
                          <dt className="font-semibold text-slate-100">
                            Timing
                          </dt>
                          <dd>
                            <pre className="mt-1 max-h-28 overflow-auto rounded bg-slate-900 p-2 text-[11px] text-slate-300">
                              {JSON.stringify(zoneTestResult.stage_timings, null, 2)}
                            </pre>
                          </dd>
                        </div>
                      ) : null}
                    </dl>
                    <pre className="mt-2 max-h-28 overflow-auto rounded bg-slate-950 p-2 text-slate-100">
                      {zoneTestResult.raw_text || "No text detected."}
                    </pre>
                    {zoneTestResult.barcode_attempts.length > 0 ? (
                      <div className="mt-3 rounded-md border border-slate-700 bg-slate-950 p-2">
                        <p className="font-semibold text-slate-100">
                          Barcode decode attempts
                        </p>
                        <div className="mt-2 space-y-2">
                          {zoneTestResult.barcode_attempts.map((attempt, index) => (
                            <div
                              className={`rounded border px-2 py-1 ${
                                attempt.accepted
                                  ? "border-emerald-500/40 bg-emerald-950/30"
                                  : "border-slate-800 bg-slate-900"
                              }`}
                              key={`${attempt.source}-${attempt.zone_name ?? ""}-${attempt.crop ?? ""}-${attempt.rotation}-${index}`}
                            >
                              <p className="font-mono text-xs text-slate-100">
                                {attempt.decoded_value || "No barcode decoded"}
                              </p>
                              <p className="mt-1 text-[11px] text-slate-300">
                                {attempt.source}
                                {attempt.zone_name ? ` · ${attempt.zone_name}` : ""} ·{" "}
                                {attempt.crop ?? "crop"} · rotation {attempt.rotation}
                                ° · {attempt.barcode_type || "none"} ·{" "}
                                {attempt.accepted
                                  ? "accepted"
                                  : attempt.rejected_reason || "rejected"}
                              </p>
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : null}
                    {zonePromotedCandidates.length > 0 ? (
                      <div className="mt-3 rounded-md border border-cyan-400/30 bg-cyan-950/20 p-2">
                        <p className="text-xs font-semibold uppercase tracking-wide text-cyan-100">
                          {zonePreferredCandidateType === "pin"
                            ? "Suggested PIN Candidates"
                            : isRedemptionCodeOnly
                              ? "Suggested Redemption Code"
                              : "Suggested Card Number Candidates"}
                        </p>
                        <div className="mt-2 space-y-2">
                          {zonePromotedCandidates
                            .slice(0, 6)
                            .map((candidate, index) => (
                              <div
                                className="flex flex-col gap-2 rounded-md border border-slate-700 bg-slate-950 p-2 sm:flex-row sm:items-center sm:justify-between"
                                key={`${candidate.source}-${candidate.value}-${candidate.confidence_score}-${index}`}
                              >
                                <div className="min-w-0">
                                  <p className="break-all font-mono text-sm font-semibold text-white">
                                    {candidate.value}
                                  </p>
                                  <p className="mt-1 text-[11px] text-slate-300">
                                    {candidate.source} ·{" "}
                                    {formatConfidence(candidate.confidence_score)}
                                  </p>
                                  {candidate.notes ? (
                                    <p className="mt-1 line-clamp-2 text-[11px] text-slate-400">
                                      {candidate.notes}
                                    </p>
                                  ) : null}
                                </div>
                                <button
                                  className="h-9 shrink-0 rounded-md bg-cyan-300 px-3 text-xs font-semibold text-slate-950 transition hover:bg-cyan-200"
                                  onClick={() =>
                                    applyCredentialCandidate(candidate, {
                                      brand: giftCard.brand,
                                      isRedemptionCodeOnly,
                                      setForm,
                                    })
                                  }
                                  type="button"
                                >
                                  Use {candidateTargetLabel(candidate, isRedemptionCodeOnly)}
                                </button>
                              </div>
                            ))}
                        </div>
                      </div>
                    ) : null}
                    {zoneTestResult.ocr_passes.length > 0 ? (
                      <div className="mt-3 rounded-md border border-slate-700 bg-slate-950 p-2">
                        <p className="font-semibold text-slate-100">
                          OCR preprocessing passes
                        </p>
                        <div className="mt-2 space-y-2">
                          {zoneTestResult.ocr_passes.map((passResult) => (
                            <details
                              className="rounded border border-slate-800 bg-slate-900 p-2"
                              key={passResult.pass_name}
                            >
                              <summary className="cursor-pointer list-none">
                                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                                  <div className="min-w-0">
                                    <p className="font-semibold text-slate-100">
                                      {passResult.pass_name}
                                    </p>
                                    <p className="mt-1 truncate font-mono text-[11px] text-slate-300">
                                      {passResult.text.trim() || "No text"}
                                    </p>
                                    {passResult.best_candidate ? (
                                      <p className="mt-1 break-all font-mono text-xs font-semibold text-cyan-100">
                                        Candidate: {passResult.best_candidate.value}
                                      </p>
                                    ) : (
                                      <p className="mt-1 text-[11px] text-slate-500">
                                        No parsed candidate
                                      </p>
                                    )}
                                  </div>
                                  <div className="flex shrink-0 items-center gap-2">
                                    <p className="text-right text-[11px] text-slate-400">
                                      score {passResult.score} ·{" "}
                                      {passResult.duration_ms}ms
                                      {passResult.timed_out ? " · timeout" : ""}
                                      {passResult.best_candidate
                                        ? ` · ${formatConfidence(
                                            passResult.best_candidate
                                              .confidence_score,
                                          )}`
                                        : ""}
                                    </p>
                                    {passResult.best_candidate ? (
                                      <button
                                        className="h-8 rounded-md bg-cyan-300 px-2 text-[11px] font-semibold text-slate-950 transition hover:bg-cyan-200"
                                        onClick={(event) => {
                                          event.preventDefault();
                                          applyCredentialCandidate(
                                            passResult.best_candidate as OCRCandidatePayload,
                                            {
                                              brand: giftCard.brand,
                                              isRedemptionCodeOnly,
                                              setForm,
                                            },
                                          );
                                        }}
                                        type="button"
                                      >
                                        Use{" "}
                                        {candidateTargetLabel(
                                          passResult.best_candidate,
                                          isRedemptionCodeOnly,
                                        )}
                                      </button>
                                    ) : null}
                                  </div>
                                </div>
                              </summary>
                              <p className="mt-1 text-[11px] text-slate-400">
                                engine {passResult.engine_called ? "called" : "not called"} · lang{" "}
                                {passResult.language} · psm {passResult.psm} · oem{" "}
                                {passResult.oem} · {passResult.image_width}x
                                {passResult.image_height} {passResult.image_mode}
                              </p>
                              <p className="mt-1 break-all font-mono text-[11px] text-slate-500">
                                {passResult.config}
                              </p>
                              <p className="mt-1 break-all font-mono text-[11px] text-slate-500">
                                {passResult.debug_image_path}
                              </p>
                              {passResult.error ? (
                                <p className="mt-1 rounded border border-red-400/50 bg-red-950/30 px-2 py-1 text-[11px] text-red-100">
                                  {passResult.error}
                                </p>
                              ) : null}
                              <pre className="mt-1 whitespace-pre-wrap text-slate-300">
                                {passResult.text.trim() || "No text"}
                              </pre>
                              {passResult.raw_tokens.length > 0 ? (
                                <pre className="mt-1 max-h-24 overflow-auto rounded bg-slate-950 p-1 text-[11px] text-slate-400">
                                  {JSON.stringify(passResult.raw_tokens, null, 2)}
                                </pre>
                              ) : null}
                            </details>
                          ))}
                        </div>
                      </div>
                    ) : currentZone.zone_type === "barcode" ? (
                      <div className="mt-3 rounded-md border border-slate-700 bg-slate-950 p-2 text-slate-300">
                        Barcode zones use the barcode decoder instead of
                        Tesseract OCR passes.
                      </div>
                    ) : null}
                    {zoneTestResult.best_candidate ? (
                      <div className="mt-2 flex flex-col gap-2 rounded-md border border-emerald-400/30 bg-emerald-950/20 p-2 sm:flex-row sm:items-center sm:justify-between">
                        <p className="font-mono text-slate-100">
                          Best: {zoneTestResult.best_candidate.value}
                        </p>
                        <button
                          className="h-9 rounded-md bg-cyan-300 px-3 text-xs font-semibold text-slate-950 transition hover:bg-cyan-200"
                          onClick={() =>
                            zoneTestResult.best_candidate
                              ? applyCredentialCandidate(
                                  zoneTestResult.best_candidate,
                                  { brand: giftCard.brand, isRedemptionCodeOnly, setForm },
                                )
                              : undefined
                          }
                          type="button"
                        >
                          Use{" "}
                          {candidateTargetLabel(
                            zoneTestResult.best_candidate,
                            isRedemptionCodeOnly,
                          )}
                        </button>
                      </div>
                    ) : null}
                    <div className="mt-3 rounded-md border border-slate-700 bg-slate-950 p-2">
                      <p className="text-xs font-semibold text-slate-100">
                        Manual fallback
                      </p>
                      <p className="mt-1 text-slate-400">
                        If the crop is visually correct but OCR returns no
                        usable text, enter the visible code here and continue.
                      </p>
                      <div className="mt-2 flex flex-col gap-2 sm:flex-row">
                        <input
                          className="h-10 min-w-0 flex-1 rounded-md border border-slate-700 bg-slate-900 px-3 font-mono text-sm text-slate-100 outline-none focus:border-cyan-300"
                          onChange={(event) =>
                            setManualZoneCredential(event.target.value)
                          }
                          placeholder={
                            isRedemptionCodeOnly
                              ? "NAAW GJTM 9BZE QN8V"
                              : "Enter visible credential"
                          }
                          value={manualZoneCredential}
                        />
                        <button
                          className="h-10 rounded-md border border-cyan-300 bg-cyan-300 px-3 text-xs font-semibold text-slate-950 transition hover:bg-cyan-200 disabled:cursor-not-allowed disabled:opacity-60"
                          disabled={!manualCredentialHasValue}
                          onClick={() => {
                            const value = formatManualCredential(
                              manualZoneCredential,
                            );
                            if (
                              !isValidManualCredentialForBrand(
                                value,
                                giftCard.brand,
                              )
                            ) {
                              setZoneTemplateError(
                                isRedemptionCodeOnly
                                  ? `Manual value does not match the expected ${giftCard.brand} redemption code format.`
                                  : "Manual value is empty or invalid.",
                              );
                              return;
                            }

                            setManualZoneCredential(value);
                            setZoneTemplateError(null);
                            setZoneTemplateMessage(
                              "Manual debug fallback applied to the confirmation field.",
                            );
                            const manualCandidateType = candidateTypeForZone(
                              currentZone.zone_type,
                              isRedemptionCodeOnly,
                            );
                            applyCredentialCandidate(
                              {
                                candidate_type: manualCandidateType,
                                source: "manual_debug_fallback",
                                value:
                                  manualCandidateType === "pin"
                                    ? value.replace(/\D/g, "")
                                    : value,
                                confidence_score: null,
                                notes: `Manual OCR zone correction from ${currentZone.zone_name}.`,
                              },
                              { brand: giftCard.brand, isRedemptionCodeOnly, setForm },
                            );
                            setForm((currentForm) => ({
                              ...currentForm,
                              notes: [
                                currentForm.notes,
                                `Manual OCR zone correction from ${currentZone.zone_name} (source=manual_debug_fallback, target=${candidateTargetLabel(
                                  { candidate_type: manualCandidateType },
                                  isRedemptionCodeOnly,
                                )}): ${value}`,
                              ]
                                .filter(Boolean)
                                .join("\n"),
                            }));
                          }}
                          type="button"
                        >
                          Use manual value
                        </button>
                      </div>
                    </div>
                  </div>
                ) : null}
                {zoneTemplateMessage ? (
                  <p className="mt-3 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-medium text-emerald-800">
                    {zoneTemplateMessage}
                  </p>
                ) : null}
                {zoneTemplateError ? (
                  <p className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs font-medium text-red-700">
                    {zoneTemplateError}
                  </p>
                ) : null}
              </details>
            </div>
          </div>

          <form
            className="space-y-4 rounded-lg border border-slate-200 bg-white p-4 shadow-sm xl:sticky xl:top-6 xl:self-start"
            id="confirm-card-details-form"
            onSubmit={handleVerify}
          >
            <div>
              <h2 className="text-lg font-semibold">Confirm Card Details</h2>
              <p className="mt-1 text-sm text-slate-500">
                Review the suggestions, then save the usable card details.
              </p>
            </div>

            {isSaleLocked ? (
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

            {giftCard.sale_history && giftCard.sale_history.length > 0 ? (
              <section className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                <h3 className="text-sm font-semibold text-slate-900">
                  Sale History
                </h3>
                <div className="mt-3 space-y-3">
                  {giftCard.sale_history.map((sale) => (
                    <div
                      className="rounded-md border border-slate-200 bg-white p-3 text-sm"
                      key={sale.sale_id}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="font-semibold">Sale #{sale.sale_id}</p>
                          <p className="text-slate-600">{sale.buyer_name}</p>
                        </div>
                        <Link
                          className="inline-flex h-8 items-center rounded-md border border-slate-300 px-2 text-xs font-semibold text-slate-700 hover:bg-slate-100"
                          href="/sales"
                        >
                          View sales
                        </Link>
                      </div>
                      <dl className="mt-3 grid gap-2 sm:grid-cols-2">
                        <div>
                          <dt className="font-medium text-slate-500">Sold</dt>
                          <dd>{formatSaleDate(sale.sold_at)}</dd>
                        </div>
                        <div>
                          <dt className="font-medium text-slate-500">Status</dt>
                          <dd>{saleStatusLabel(sale.status)}</dd>
                        </div>
                        <div>
                          <dt className="font-medium text-slate-500">Payout</dt>
                          <dd>
                            {sale.expected_payout === null
                              ? "-"
                              : formatAmount(sale.expected_payout)}
                          </dd>
                        </div>
                        <div>
                          <dt className="font-medium text-slate-500">
                            Received
                          </dt>
                          <dd>
                            {sale.payout_received === null
                              ? "-"
                              : formatAmount(sale.payout_received)}
                          </dd>
                        </div>
                      </dl>
                      {sale.notes ? (
                        <p className="mt-2 whitespace-pre-wrap text-slate-600">
                          {sale.notes}
                        </p>
                      ) : null}
                    </div>
                  ))}
                </div>
              </section>
            ) : null}

            {isRedemptionCodeOnly && bestCardNumberCandidate ? (
              <section className="rounded-lg border border-cyan-400 bg-slate-950 p-3 text-slate-50 shadow-sm">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-cyan-200">
                      Suggested Redemption Code
                    </p>
                    <p className="mt-1 text-xs text-slate-300">
                      This brand uses one redemption code and no separate PIN.
                    </p>
                    <p className="mt-1 break-all font-mono text-sm text-white">
                      Code: {bestCardNumberCandidate.value}
                    </p>
                    <p className="mt-1 text-xs text-slate-300">
                      Source: {bestCardNumberCandidate.source} · Confidence:{" "}
                      {formatConfidence(bestCardNumberCandidate.confidence_score)}
                    </p>
                  </div>
                  <button
                    className="h-11 rounded-md bg-cyan-300 px-4 text-sm font-semibold text-slate-950 transition hover:bg-cyan-200 active:bg-cyan-400"
                    onClick={() =>
                      setForm((currentForm) => ({
                        ...currentForm,
                        card_number: bestCardNumberCandidate.value,
                        pin: "",
                        confirmed_source: bestCardNumberCandidate.source || "OCR",
                      }))
                    }
                    type="button"
                  >
                    Use suggested code
                  </button>
                </div>
              </section>
            ) : null}

            {!isRedemptionCodeOnly && bestCardNumberCandidate && bestPinCandidate ? (
              <section className="rounded-lg border border-cyan-400 bg-slate-950 p-3 text-slate-50 shadow-sm">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-cyan-200">
                      Suggested Card + PIN
                    </p>
                    <p className="mt-1 text-xs text-slate-300">
                      Best matched card number + PIN combination.
                    </p>
                    <p className="mt-1 font-mono text-sm text-white">
                      Card: {bestCardNumberCandidate.value}
                    </p>
                    <p className="mt-1 font-mono text-sm text-white">
                      PIN: {bestPinCandidate.value}
                    </p>
                    <p className="mt-1 text-xs text-slate-300">
                      Source: {bestCardNumberCandidate.source} +{" "}
                      {bestPinCandidate.source} · Confidence:{" "}
                      {formatConfidence(
                        Math.min(
                          bestCardNumberCandidate.confidence_score ?? 0,
                          bestPinCandidate.confidence_score ?? 0,
                        ),
                      )}
                    </p>
                  </div>
                  <button
                    className="h-11 rounded-md bg-cyan-300 px-4 text-sm font-semibold text-slate-950 transition hover:bg-cyan-200 active:bg-cyan-400"
                    onClick={() =>
                      setForm((currentForm) => ({
                        ...currentForm,
                        card_number: bestCardNumberCandidate.value,
                        pin: bestPinCandidate.value,
                        confirmed_source:
                          bestCardNumberCandidate.source === bestPinCandidate.source
                            ? bestCardNumberCandidate.source || "suggested_pair"
                            : "suggested_pair",
                      }))
                    }
                    type="button"
                  >
                    Use suggested pair
                  </button>
                </div>
              </section>
            ) : null}

            <section className="rounded-lg border border-slate-200 bg-slate-50 p-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                    {isRedemptionCodeOnly
                      ? "Suggested Redemption Code"
                      : "Suggested Card Number"}
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
                      {bestCardNumberCandidate.notes ? (
                        <p className="mt-1 text-xs text-slate-500">
                          {bestCardNumberCandidate.notes}
                        </p>
                      ) : null}
                    </>
                  ) : (
                    <p className="mt-1 text-sm text-slate-500">
                      {isRedemptionCodeOnly
                        ? "No useful redemption code candidate."
                        : "No useful card number candidate."}
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
                        confirmed_source: bestCardNumberCandidate.source || "OCR",
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
                            confirmed_source: candidate.source || "OCR",
                          }))
                        }
                      />
                    ))}
                  </div>
                </details>
              )}
            </section>

            {!isRedemptionCodeOnly && bestPinCandidate && (
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
                    {bestPinCandidate.notes ? (
                      <p className="mt-1 text-xs text-slate-500">
                        {bestPinCandidate.notes}
                      </p>
                    ) : null}
                  </div>
                  <button
                    className="h-11 rounded-md border border-slate-300 bg-white px-4 text-sm font-medium hover:bg-slate-100"
                    onClick={() =>
                      setForm((currentForm) => ({
                        ...currentForm,
                        pin: bestPinCandidate.value,
                        confirmed_source: bestPinCandidate.source || "OCR",
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
                              confirmed_source: candidate.source || "OCR",
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
              <span>{primaryCredentialLabel}</span>
              <input
                className="h-12 w-full rounded-md border border-slate-300 px-3 text-base text-slate-950 outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-200"
                onChange={(event) =>
                  setForm((currentForm) => ({
                    ...currentForm,
                    card_number: event.target.value,
                    confirmed_source: "manual",
                  }))
                }
                required
                type="text"
                value={form.card_number}
              />
            </label>

            {!isRedemptionCodeOnly ? (
              <label className="block space-y-2 text-sm font-medium text-slate-700">
                <span>Confirmed PIN (optional)</span>
                <input
                  className="h-12 w-full rounded-md border border-slate-300 px-3 text-base text-slate-950 outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-200"
                  onChange={(event) =>
                    setForm((currentForm) => ({
                    ...currentForm,
                    pin: event.target.value,
                    confirmed_source: "manual",
                  }))
                  }
                  type="text"
                  value={form.pin}
                />
              </label>
            ) : null}

            <label className="block space-y-2 text-sm font-medium text-slate-700">
              <span>Face Value</span>
              <input
                className="h-12 w-full rounded-md border border-slate-300 px-3 text-base text-slate-950 outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-200"
                min="0"
                onChange={(event) =>
                  setForm((currentForm) => ({
                    ...currentForm,
                    face_value: event.target.value,
                  }))
                }
                required
                step="0.01"
                type="number"
                value={form.face_value}
              />
            </label>

            <label className="block space-y-2 text-sm font-medium text-slate-700">
              <span>Notes</span>
              <textarea
                className="min-h-24 w-full rounded-md border border-slate-300 px-3 py-2 text-base text-slate-950 outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-200"
                onChange={(event) =>
                  setForm((currentForm) => ({
                    ...currentForm,
                    notes: event.target.value,
                  }))
                }
                value={form.notes}
              />
            </label>

            {submitError && (
              <p className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                {submitError}
              </p>
            )}

            {duplicateWarning ? (
              <section className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950">
                <div>
                  <h3 className="font-semibold">Duplicate card number found</h3>
                  <p className="mt-1 text-amber-800">
                    {duplicateWarning.message}
                  </p>
                </div>
                <dl className="mt-3 grid gap-2 sm:grid-cols-2">
                  <div>
                    <dt className="font-medium text-amber-700">Existing Card</dt>
                    <dd>#{duplicateWarning.existing_card.id}</dd>
                  </div>
                  <div>
                    <dt className="font-medium text-amber-700">Purchase</dt>
                    <dd>#{duplicateWarning.existing_card.purchase_batch_id}</dd>
                  </div>
                  <div>
                    <dt className="font-medium text-amber-700">Brand</dt>
                    <dd>{duplicateWarning.existing_card.brand}</dd>
                  </div>
                  <div>
                    <dt className="font-medium text-amber-700">Face Value</dt>
                    <dd>{formatAmount(duplicateWarning.existing_card.face_value)}</dd>
                  </div>
                  <div>
                    <dt className="font-medium text-amber-700">Status</dt>
                    <dd>{saleStatusLabel(duplicateWarning.existing_card.status)}</dd>
                  </div>
                  <div>
                    <dt className="font-medium text-amber-700">Card Ending</dt>
                    <dd>
                      {duplicateWarning.existing_card.card_ending
                        ? `Card ending ${duplicateWarning.existing_card.card_ending}`
                        : "Unknown"}
                    </dd>
                  </div>
                </dl>
                {cleanupError ? (
                  <p className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 font-medium text-red-700">
                    {cleanupError}
                  </p>
                ) : null}
                <div className="mt-4 grid gap-2 sm:grid-cols-2">
                  <Link
                    className="inline-flex h-11 cursor-pointer items-center justify-center rounded-md border border-amber-300 bg-white px-3 font-semibold text-amber-900 transition hover:bg-amber-100 active:bg-amber-200"
                    href={`/gift-cards/${duplicateWarning.existing_card.id}/verify?returnTo=/gift-cards/${giftCard.id}/verify`}
                  >
                    View Existing Card
                  </Link>
                  <Link
                    className="inline-flex h-11 cursor-pointer items-center justify-center rounded-md border border-amber-300 bg-white px-3 font-semibold text-amber-900 transition hover:bg-amber-100 active:bg-amber-200"
                    href={purchaseHref}
                  >
                    View This Purchase
                  </Link>
                  <button
                    className="h-11 cursor-pointer rounded-md border border-amber-300 bg-white px-3 font-semibold text-amber-900 transition hover:bg-amber-100 active:bg-amber-200"
                    onClick={() => {
                      setForm((currentForm) => ({
                        ...currentForm,
                        card_number: "",
                      }));
                      setDuplicateWarning(null);
                    }}
                    type="button"
                  >
                    Replace Entered Card Number
                  </button>
                  <button
                    className="h-11 cursor-pointer rounded-md bg-red-700 px-3 font-semibold text-white transition hover:bg-red-800 active:bg-red-900 disabled:cursor-not-allowed disabled:opacity-60"
                    disabled={isCleaningUpCard}
                    onClick={() => void voidDuplicateCard()}
                    type="button"
                  >
                    {isCleaningUpCard
                      ? "Voiding..."
                      : "Void This Card as Duplicate"}
                  </button>
                </div>
              </section>
            ) : null}

            <button
              className="h-12 w-full rounded-md bg-slate-950 px-4 font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-400"
              disabled={
                isSubmitting ||
                (isSaleLocked && !allowLockedCredentialUpdate) ||
                isInactiveCard
              }
              type="submit"
            >
              {isInactiveCard
                ? "Inactive Card"
                : isSubmitting
                  ? "Saving..."
                  : isSaleLocked
                    ? "Update Confirmed Credentials"
                    : "Confirm Card Details"}
            </button>
          </form>
        </section>
      </div>

      {cleanupAction ? (
        <div className="fixed inset-0 z-[70] flex items-center justify-center modal-backdrop p-4">
          <div className="max-h-[calc(100dvh-2rem)] w-full max-w-md overflow-y-auto rounded-lg bg-white p-5 shadow-xl">
            <h2 className="text-lg font-semibold text-slate-950">
              {cleanupAction === "delete"
                ? "Delete gift card?"
                : "Void gift card?"}
            </h2>
            <p className="mt-2 text-sm text-slate-600">
              {cleanupAction === "delete"
                ? `Delete ${giftCard.brand} card #${giftCard.id}? This removes unsold test/intake records and related OCR data.`
                : `Void ${giftCard.brand} card #${giftCard.id}? This keeps the record but removes it from normal inventory workflow.`}
            </p>
            {cleanupAction === "delete" ? (
              <div className="mt-3 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
                {isLoadingCleanupReport ? (
                  <p>Inspecting cleanup dependencies...</p>
                ) : cleanupReport ? (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between gap-3">
                      <span className="font-medium text-slate-950">
                        Lifecycle
                      </span>
                      <span className="rounded-full bg-slate-200 px-2 py-0.5 text-xs font-semibold uppercase tracking-wide text-slate-700">
                        {cleanupReport.lifecycle_state.replaceAll("_", " ")}
                      </span>
                    </div>
                    <div className="grid grid-cols-2 gap-2 text-xs">
                      <span>
                        OCR attempts:{" "}
                        {cleanupReport.ocr_assets.extraction_attempts}
                      </span>
                      <span>
                        OCR candidates:{" "}
                        {cleanupReport.ocr_assets.extraction_candidates}
                      </span>
                      <span>
                        OCR metrics:{" "}
                        {cleanupReport.ocr_assets.extraction_profile_metrics ??
                          0}
                      </span>
                      <span>
                        Card images:{" "}
                        {cleanupReport.image_references.card_images}
                      </span>
                      <span>
                        Sale links: {cleanupReport.linked_sales.length}
                      </span>
                    </div>
                    {cleanupReport.linked_purchase ? (
                      <p className="text-xs text-slate-600">
                        Purchase #{cleanupReport.linked_purchase.purchase_id} ·{" "}
                        {cleanupReport.linked_purchase.store_name} ·{" "}
                        {formatAmount(cleanupReport.linked_purchase.total_paid)}
                      </p>
                    ) : null}
                    {cleanupReport.blocking_dependencies.length > 0 ? (
                      <div className="rounded-md border border-red-200 bg-red-50 px-2 py-1.5 text-xs font-medium text-red-700">
                        {cleanupReport.blocking_dependencies.map((blocker) => (
                          <p key={`${blocker.type}-${blocker.sale_id ?? "card"}`}>
                            {blocker.message}
                          </p>
                        ))}
                      </div>
                    ) : (
                      <p className="rounded-md border border-emerald-200 bg-emerald-50 px-2 py-1.5 text-xs font-medium text-emerald-700">
                        No blocking sale/export/settlement dependencies found.
                      </p>
                    )}
                    {cleanupReport.warnings.length > 0 ? (
                      <div className="text-xs text-amber-700">
                        {cleanupReport.warnings.map((warning) => (
                          <p key={warning}>{warning}</p>
                        ))}
                      </div>
                    ) : null}
                  </div>
                ) : (
                  <p>
                    This will remove the card and related unsold intake/OCR
                    records. The backend will block deletion if settled,
                    exported, or active-sale dependencies exist.
                  </p>
                )}
              </div>
            ) : null}
            {cleanupError ? (
              <div className="mt-3 space-y-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-700">
                <p>{cleanupError}</p>
                {cleanupAction === "delete" ? (
                  <button
                    className="text-sm font-semibold underline underline-offset-4 hover:text-red-900 disabled:cursor-not-allowed disabled:opacity-60"
                    disabled={isLoadingCleanupReport || isCleaningUpCard}
                    onClick={() => {
                      setCleanupError(null);
                      setCleanupReport(null);
                      setCleanupReportRequestKey(
                        (currentKey) => currentKey + 1,
                      );
                    }}
                    type="button"
                  >
                    Retry dependency inspection
                  </button>
                ) : null}
              </div>
            ) : null}
            <div className="mt-5 grid gap-2 sm:grid-cols-2">
              <button
                className="h-11 cursor-pointer rounded-md border border-slate-300 px-4 text-sm font-semibold text-slate-700 transition hover:bg-slate-100 active:bg-slate-200 disabled:cursor-not-allowed disabled:opacity-60"
                disabled={isCleaningUpCard}
                onClick={() => {
                  setCleanupAction(null);
                  setCleanupReport(null);
                  setCleanupError(null);
                }}
                type="button"
              >
                Cancel
              </button>
              <button
                className={`h-11 cursor-pointer rounded-md px-4 text-sm font-semibold text-white transition disabled:cursor-not-allowed disabled:opacity-60 ${
                  cleanupAction === "delete"
                    ? "bg-red-700 hover:bg-red-800 active:bg-red-900"
                    : "bg-slate-900 hover:bg-slate-700 active:bg-slate-800"
                }`}
                disabled={
                  isCleaningUpCard ||
                  isLoadingCleanupReport ||
                  (cleanupAction === "delete" &&
                    (!cleanupReport || !cleanupReport.can_hard_delete))
                }
                onClick={() => void confirmGiftCardCleanup()}
                type="button"
              >
                {isCleaningUpCard
                  ? "Working..."
                  : cleanupAction === "delete"
                    ? "Confirm Delete"
                    : "Confirm Void"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
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
        {candidate.notes ? (
          <p className="mt-1 text-xs text-slate-500">{candidate.notes}</p>
        ) : null}
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
