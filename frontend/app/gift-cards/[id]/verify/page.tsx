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
  face_value: string | number;
  status: string;
  ocr_status?: string;
  card_number_encrypted: string | null;
  pin_encrypted: string | null;
  notes: string | null;
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
  processed_image_url: string | null;
  created_at?: string;
};

type Receipt = {
  id: number;
  purchase_batch_id: number;
  image_url: string;
  original_filename: string | null;
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
    x_px: number;
    y_px: number;
    width_px: number;
    height_px: number;
  };
  selected_crop_image_data_url: string;
  crop_image_data_url: string;
  debug_image_paths: string[];
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
    return candidate.cleanup_report as CleanupReport;
  }

  if (
    candidate.detail &&
    typeof candidate.detail === "object" &&
    "cleanup_report" in candidate.detail &&
    typeof (candidate.detail as { cleanup_report?: unknown }).cleanup_report ===
      "object"
  ) {
    return (candidate.detail as { cleanup_report: CleanupReport })
      .cleanup_report;
  }

  return null;
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
      return /^\d{5,6}$/.test(normalizedValue);
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
  const [
    receiptsResponse,
    attemptsResponse,
    candidatesResponse,
  ] = await Promise.all([
    fetch(`${API_BASE_URL}/receipts/purchase/${giftCard.purchase_batch_id}`),
    fetch(`${API_BASE_URL}/extraction-attempts/gift-card/${giftCardId}`),
    fetch(`${API_BASE_URL}/extraction-candidates/gift-card/${giftCardId}`),
  ]);

  if (!receiptsResponse.ok) {
    throw new Error(`Failed to load receipts (${receiptsResponse.status})`);
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
    giftCard,
    cardImages: (await imagesResponse.json()) as CardImage[],
    receipts: (await receiptsResponse.json()) as Receipt[],
    extractionAttempts: (await attemptsResponse.json()) as ExtractionAttempt[],
    extractionCandidates:
      (await candidatesResponse.json()) as ExtractionCandidate[],
  };
}

function getInitialVerificationForm(details: VerificationDetails) {
  const isRedemptionCodeOnly = isRedemptionCodeOnlyBrand(details.giftCard.brand);
  const loadedCandidates = isOcrReadyStatus(details.giftCard.ocr_status)
    ? details.extractionCandidates
    : [];
  const bestLoadedCardNumberCandidate = getBestCandidate(
    loadedCandidates,
    "card_number",
    details.giftCard.brand,
  );
  const bestLoadedPinCandidate = getBestCandidate(
    loadedCandidates,
    "pin",
    details.giftCard.brand,
  );

  return {
    // TODO: Mask and encrypt these values before production.
    card_number:
      details.giftCard.card_number_encrypted ??
      bestLoadedCardNumberCandidate?.value ??
      "",
    pin: isRedemptionCodeOnly
      ? ""
      : details.giftCard.pin_encrypted ?? bestLoadedPinCandidate?.value ?? "",
    face_value: String(details.giftCard.face_value),
    notes: details.giftCard.notes ?? "",
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
  });
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [imageRotation, setImageRotation] = useState(0);
  const [isUploadingImage, setIsUploadingImage] = useState(false);
  const [isRescanningImage, setIsRescanningImage] = useState(false);
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
  const [isLoadingCleanupReport, setIsLoadingCleanupReport] = useState(false);
  const [isCleaningUpCard, setIsCleaningUpCard] = useState(false);
  const [duplicateWarning, setDuplicateWarning] =
    useState<DuplicateCardWarning | null>(null);
  const [zoneTemplateMessage, setZoneTemplateMessage] = useState<string | null>(null);
  const [zoneTemplateError, setZoneTemplateError] = useState<string | null>(null);
  const [isTestingZone, setIsTestingZone] = useState(false);
  const [zoneTestResult, setZoneTestResult] = useState<OCRZoneTestResult | null>(
    null,
  );
  const [zoneTestStage, setZoneTestStage] = useState<string | null>(null);
  const [savedOcrZones, setSavedOcrZones] = useState<OCRZone[]>([]);
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
  const [zoneTemplateSaved, setZoneTemplateSaved] = useState(false);
  const [manualZoneCredential, setManualZoneCredential] = useState("");
  const zoneCanvasRef = useRef<HTMLDivElement | null>(null);
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
      cardImages.find((image) => image.image_type === "primary") ??
      cardImages[0] ??
      null
    );
  }, [cardImages]);
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
  const selectedTemplateLayout = ocrDebugValue(
    latestExtractionAttempt?.raw_text,
    "OCR_SELECTED_TEMPLATE_LAYOUT",
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
  const isRedemptionCodeOnly = isRedemptionCodeOnlyBrand(giftCard?.brand);
  const primaryCredentialLabel = isRedemptionCodeOnly
    ? "Confirmed Redemption Code"
    : "Confirmed Card Number";
  const canonicalZoneImageUrl =
    canonicalReady ? primaryImage?.processed_image_url : null;
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
  const hasCredentialZone = credentialZones.length > 0;
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
        const zones = zonesForBrand(
          giftCard.brand,
          parseOcrZones(template.ocr_zones),
        );

        if (isMounted) {
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
      if (!cleanupAction || !giftCard) {
        setCleanupReport(null);
        return;
      }

      const endpoint = `${API_BASE_URL}/gift-cards/${giftCard.id}/cleanup-report`;
      setIsLoadingCleanupReport(true);

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
          setCleanupReport(body as CleanupReport);
          setCleanupError(null);
        }
      } catch (err) {
        if (isMounted) {
          console.error("Gift card cleanup report failed", {
            endpoint,
            giftCardId: giftCard.id,
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
  }, [cleanupAction, giftCard]);

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
      setReceipts(details.receipts);
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

  async function rescanPrimaryImage(
    successText = "OCR re-scanned.",
    rotationDegrees = imageRotation,
    options: { preserveSavedTemplate?: boolean } = {},
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

    const endpoint = `${API_BASE_URL}/card-images/${primaryImage.id}/rescan?rotation_degrees=${rotationDegrees}`;

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

      const details = await loadGiftCardVerificationDetails(giftCardId);
      setGiftCard(details.giftCard);
      setCardImages(details.cardImages);
      setReceipts(details.receipts);
      setExtractionAttempts(details.extractionAttempts);
      setExtractionCandidates(details.extractionCandidates);
      setZoneTestResult(null);
      if (options.preserveSavedTemplate) {
        setZoneTemplateSaved(true);
        setZoneTemplateMessage(
          "Saved template OCR re-run. Suggestions were refreshed above.",
        );
      } else {
        setSelectedZoneName(null);
        setZoneTrainingMode("idle");
        setZoneTemplateSaved(false);
        setZoneTemplateMessage(
          "Image transform changed. Draw or test zones against the processed OCR image before saving.",
        );
      }
      setImageUploadMessage(successText);
    } catch (err) {
      setImageUploadError(
        err instanceof Error ? err.message : "Failed to re-scan card image.",
      );
    } finally {
      setIsRescanningImage(false);
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
    const currentX = ((event.clientX - rect.left) / rect.width) * 100;
    const currentY = ((event.clientY - rect.top) / rect.height) * 100;
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
    dragStartRef.current = {
      x: ((event.clientX - rect.left) / rect.width) * 100,
      y: ((event.clientY - rect.top) / rect.height) * 100,
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
      "preprocessing",
      "OCR pass 1/5",
      "OCR pass 2/5",
      "OCR pass 3/5",
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
                coordinate_space: "canonical_processed_image",
                processed_image_dimensions: canonicalImageSize,
                canonical_width: canonicalImageSize?.width ?? null,
                canonical_height: canonicalImageSize?.height ?? null,
                trained_orientation: imageRotation % 360,
                applied_rotation: 0,
                rotation_degrees: imageRotation % 360,
                zones,
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
      const reloadedZones = zonesForBrand(
        giftCard.brand,
        parseOcrZones(template.ocr_zones),
      );

      setZoneTemplateMessage(
        "OCR zones saved for this brand. Future uploads will scan these regions first.",
      );
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

    if (isSaleLocked) {
      setSubmitError("Sold or settled cards cannot be re-verified from this page.");
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
          pin: isRedemptionCodeOnly ? null : form.pin,
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
    if (!giftCard || !cleanupAction) {
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
                    value={maskSensitiveValue(giftCard.card_number_encrypted)}
                  />
                  {!isRedemptionCodeOnly ? (
                    <ArchiveDetailRow
                      label="PIN"
                      value={maskSensitiveValue(giftCard.pin_encrypted)}
                    />
                  ) : null}
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
                {!isSaleLocked ? (
                  <button
                    className="h-11 cursor-pointer rounded-md bg-slate-950 px-4 text-sm font-semibold text-white transition hover:bg-slate-800 active:bg-slate-700 disabled:cursor-not-allowed disabled:bg-slate-400"
                    disabled={isSubmitting}
                    form="confirm-card-details-form"
                    type="submit"
                  >
                    {isSubmitting ? "Saving..." : "Confirm Details"}
                  </button>
                ) : null}
                {canCleanupGiftCard(giftCard) ? (
                  <>
                <button
                  className="h-11 cursor-pointer rounded-md border border-slate-300 px-4 text-sm font-semibold text-slate-700 transition hover:bg-slate-100 active:bg-slate-200"
                  onClick={() => {
                    setCleanupError(null);
                    setCleanupMessage(null);
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

        {!isInactiveCard && (bestCardNumberCandidate || bestPinCandidate) ? (
          <section className="rounded-lg border border-cyan-200 bg-white p-4 shadow-sm">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <h2 className="text-lg font-semibold text-slate-950">
                  Best Detected Values
                </h2>
                <p className="mt-1 text-sm text-slate-500">
                  Saved brand templates run automatically. Debug details stay below.
                </p>
              </div>
              {primaryImage ? (
                <button
                  className="h-10 cursor-pointer rounded-md border border-slate-300 px-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60"
                  disabled={isRescanningImage}
                  onClick={() => {
                    setImageRotation(0);
                    void rescanPrimaryImage(
                      "Saved template OCR re-run.",
                      0,
                      { preserveSavedTemplate: true },
                    );
                  }}
                  type="button"
                >
                  {isRescanningImage ? "Scanning..." : "Re-run Saved Template OCR"}
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
                        className="h-11 cursor-pointer rounded-md border border-slate-300 px-4 text-sm font-medium text-slate-700 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60"
                        disabled={isRescanningImage}
                        onClick={() => {
                          const nextRotation = imageRotation - 90;
                          setImageRotation(nextRotation);
                          void rescanPrimaryImage(
                            "Image rotated left. OCR re-scanned.",
                            nextRotation,
                          );
                        }}
                        type="button"
                      >
                        Rotate Left
                      </button>
                      <button
                        className="h-11 cursor-pointer rounded-md border border-slate-300 px-4 text-sm font-medium text-slate-700 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60"
                        disabled={isRescanningImage}
                        onClick={() => {
                          const nextRotation = imageRotation + 90;
                          setImageRotation(nextRotation);
                          void rescanPrimaryImage(
                            "Image rotated right. OCR re-scanned.",
                            nextRotation,
                          );
                        }}
                        type="button"
                      >
                        Rotate Right
                      </button>
                      <button
                        className="h-11 cursor-pointer rounded-md border border-slate-300 px-4 text-sm font-medium text-slate-700 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60"
                        disabled={isRescanningImage}
                        onClick={() => {
                          setImageRotation(0);
                          void rescanPrimaryImage(
                            "Saved template OCR re-run.",
                            0,
                            { preserveSavedTemplate: true },
                          );
                        }}
                        type="button"
                      >
                        Re-run Saved Template OCR
                      </button>
                      <button
                        className="h-11 cursor-pointer rounded-md border border-slate-300 px-4 text-sm font-medium text-slate-700 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60"
                        disabled={isRescanningImage}
                        onClick={() => {
                          setImageRotation(0);
                          void rescanPrimaryImage(
                            "Image reset. OCR re-scanned.",
                            0,
                          );
                        }}
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
              {isRescanningImage ? (
                <p className="mb-3 text-sm font-medium text-slate-600">
                  Re-scanning image...
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
                      ? "Showing canonical OCR image for zone editing"
                      : "Showing original upload while OCR preprocessing runs"}
                    {primaryImage.processed_image_url
                      ? ` · OCR used ${selectedOcrImageSource ?? "best"} source`
                      : " · OCR preprocessing pending or unavailable"}
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
                        Canonical OCR image
                      </a>
                    ) : null}
                  </div>
                  {canonicalReady && canonicalZoneImageUrl ? (
                    <div className="relative flex min-h-[28rem] touch-none items-center justify-center overflow-hidden rounded-lg border border-slate-200 bg-slate-100 p-3 sm:min-h-[34rem] md:min-h-[40rem] lg:min-h-[44rem]">
                      <div className="relative inline-flex max-h-[78vh] max-w-full">
                        <img
                          alt={`${giftCard.brand} canonical OCR card`}
                          className="block h-auto max-h-[78vh] w-auto max-w-full object-contain"
                          onLoad={(event) => {
                            setCanonicalImageSize({
                              width: event.currentTarget.naturalWidth,
                              height: event.currentTarget.naturalHeight,
                            });
                          }}
                          src={buildUploadUrl(canonicalZoneImageUrl)}
                        />
                      <div
                        className="absolute inset-0 cursor-crosshair"
                        onPointerCancel={finishZoneDraw}
                        onPointerDown={startZoneDraw}
                        onPointerMove={updateZoneFromPointer}
                        onPointerUp={finishZoneDraw}
                        ref={zoneCanvasRef}
                      >
                        {savedOcrZones.map((zone) => (
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
                              left: `${zone.x_pct}%`,
                              top: `${zone.y_pct}%`,
                              width: `${zone.width_pct}%`,
                              height: `${zone.height_pct}%`,
                            }}
                          >
                            <span className="absolute left-1 top-1 rounded bg-slate-950 px-1.5 py-0.5 text-[10px] font-semibold text-white shadow">
                              {zone.zone_name}
                            </span>
                          </div>
                        ))}
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
                              left: `${currentZone.x_pct}%`,
                              top: `${currentZone.y_pct}%`,
                              width: `${currentZone.width_pct}%`,
                              height: `${currentZone.height_pct}%`,
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
                      </div>
                    </div>
                  ) : (
                    <div className="flex min-h-[24rem] items-center justify-center overflow-hidden rounded-lg border border-slate-200 bg-slate-100 p-3">
                      <img
                        alt={`${giftCard.brand} original upload`}
                        className="block h-auto max-h-[70vh] w-auto max-w-full object-contain"
                        src={buildUploadUrl(primaryImage.original_image_url)}
                      />
                    </div>
                  )}
                </>
              ) : (
                <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-8 text-center text-sm text-slate-500">
                  No image uploaded. Upload an image to review and verify this
                  card.
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
                  No receipt uploaded for this purchase yet.
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
                            className="h-40 w-full object-cover"
                            height={160}
                            src={receiptUrl}
                            unoptimized
                            width={320}
                          />
                        </a>
                        <figcaption className="space-y-2 p-3 text-xs text-slate-600">
                          <p className="truncate font-medium text-slate-800">
                            {receipt.original_filename || `Receipt #${receipt.id}`}
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
                  Drag directly on the canonical OCR image to label credential
                  zones. Zones are saved relative to that normalized card crop.
                </p>
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
                    Canonical OCR image unavailable. Zone training and template
                    OCR stay locked until preprocessing reaches canonical ready.
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
                            Padded crop sent to OCR
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
                        Selected preview matches the backend zone. OCR uses the
                        padded crop for extra context.
                      </p>
                    )}
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                      <p className="font-semibold text-slate-100">
                        Zone OCR Result
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
              <span>{primaryCredentialLabel}</span>
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

            {!isRedemptionCodeOnly ? (
              <label className="block space-y-2 text-sm font-medium text-slate-700">
                <span>Confirmed PIN (optional)</span>
                <input
                  className="h-12 w-full rounded-md border border-slate-300 px-3 text-base text-slate-950 outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-200"
                  onChange={(event) =>
                    setForm((currentForm) => ({
                      ...currentForm,
                      pin: event.target.value,
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
              disabled={isSubmitting || isSaleLocked || isInactiveCard}
              type="submit"
            >
              {isSaleLocked || isInactiveCard
                ? "Inactive Card"
                : isSubmitting
                  ? "Saving..."
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
              <p className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-700">
                {cleanupError}
              </p>
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
                    cleanupReport !== null &&
                    !cleanupReport.can_hard_delete)
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
