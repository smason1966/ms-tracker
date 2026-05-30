"use client";

import { ChangeEvent, FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";

import { API_BASE_URL } from "@/lib/api";

type PurchaseBatch = {
  id: number;
  store_name: string;
  purchase_date: string;
  total_amount: string | number;
  purchase_total_paid: string | number | null;
  credit_card_id: number | null;
  sales_tax: string | number | null;
  activation_fees: string | number | null;
  discounts: string | number | null;
  fuel_points_quantity: number | null;
  fuel_points_unit: number | null;
  fuel_points_notes: string | null;
  financial_notes: string | null;
  notes: string | null;
  store_earns_fuel_points: boolean;
  store_default_fuel_multiplier: number | null;
  spending_category_id: number | null;
  reward_transactions?: RewardTransaction[];
  fuel_point_entries?: FuelPointEntry[];
};

type FuelAccount = {
  id: number;
  retailer: string;
  email: string | null;
  alt_id: string | null;
  status: string;
  target_points: number | null;
  current_points: number;
  expiration_cycle: string | null;
};

type FuelPointEntry = {
  id: number;
  fuel_reward_account_id: number;
  purchase_batch_id: number | null;
  earned_date: string;
  expires_on: string;
  multiplier: number | null;
  qualifying_spend: string | number | null;
  points_earned: number;
  entry_type: string;
  notes: string | null;
  fuel_account?: {
    id: number;
    retailer: string;
    email: string | null;
    alt_id: string | null;
    status: string;
    target_points: number | null;
    current_points: number;
  } | null;
};

type Receipt = {
  id: number;
  purchase_batch_id: number;
  image_url: string;
  original_filename: string | null;
  notes: string | null;
  created_at: string;
};

type PurchasePayment = {
  id: number;
  purchase_batch_id: number;
  payment_type: string;
  credit_card_id: number | null;
  spending_category_id?: number | null;
  reward_program_id?: number | null;
  matched_rule_id?: number | null;
  amount: string | number;
  reward_multiplier?: string | number | null;
  calculated_rewards?: string | number | null;
  reward_type?: string | null;
  points_earned?: string | number | null;
  cashback_amount?: string | number | null;
  statement_credit_amount?: string | number | null;
  purchase_discount_amount?: string | number | null;
  effective_savings_amount?: string | number | null;
  calculation_source?: string | null;
  notes: string | null;
  created_at: string;
};

type RewardTransaction = {
  id: number;
  credit_card_id: number;
  reward_program_id: number | null;
  spending_category_id: number | null;
  qualifying_spend: string | number;
  multiplier: string | number;
  rewards_earned: string | number;
  reward_type: string;
  points_earned: string | number;
  cashback_amount: string | number;
  statement_credit_amount: string | number;
  purchase_discount_amount: string | number;
  effective_savings_amount: string | number;
  calculation_source: string;
  credit_card_product_snapshot: string | null;
  notes: string | null;
  credit_card?: {
    id: number;
    nickname: string;
    last_four: string | null;
  } | null;
};

type CreditCard = {
  id: number;
  nickname: string;
  issuer: string;
  network: string | null;
  last_four: string | null;
  is_active: boolean;
};

type SpendingCategory = {
  id: number;
  key: string;
  name: string;
  active: boolean;
};

type GiftCard = {
  id: number;
  brand: string;
  face_value: string | number;
  acquisition_cost: string | number | null;
  sale_price: string | number | null;
  status: string;
  verification_status?: string | null;
  confirmed_at?: string | null;
  card_number_encrypted: string | null;
  confirmed_card_number?: string | null;
  confirmed_pin?: string | null;
  confirmed_redemption_code?: string | null;
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

type PurchaseFinancialForm = {
  purchase_total_paid: string;
  sales_tax: string;
  activation_fees: string;
  discounts: string;
  fuel_points_amount: string;
  fuel_points_unit: string;
  financial_notes: string;
};

type FuelPointCorrectionForm = {
  fuel_reward_account_id: string;
  fuel_points_amount: string;
  fuel_points_unit: string;
  expires_on: string;
  multiplier: string;
  qualifying_spend: string;
  fuel_points_notes: string;
};

type FundingPaymentForm = {
  payment_type: string;
  credit_card_id: string;
  amount: string;
  spending_category_id: string;
  notes: string;
};

type PurchaseDeleteReport = {
  can_delete: boolean;
  blocking_dependencies: { message?: string }[];
  warnings: string[];
  impact: {
    gift_cards_to_delete: number;
    receipts_to_delete: number;
    fuel_point_entries_to_delete: number;
    fuel_points_to_reverse: number;
    payment_lines_to_remove: number;
    reward_transactions_to_delete: number;
    ocr_attempts_to_delete: number;
    ocr_candidates_to_delete: number;
    ocr_metrics_to_delete: number;
    card_images_to_delete: number;
  };
};

const emptyGiftCardForm: GiftCardForm = {
  brand: "",
  face_value: "",
  notes: "",
};

const emptyPurchaseFinancialForm: PurchaseFinancialForm = {
  purchase_total_paid: "",
  sales_tax: "",
  activation_fees: "",
  discounts: "",
  fuel_points_amount: "",
  fuel_points_unit: "1000",
  financial_notes: "",
};

const emptyFuelPointCorrectionForm: FuelPointCorrectionForm = {
  fuel_reward_account_id: "",
  fuel_points_amount: "",
  fuel_points_unit: "1000",
  expires_on: "",
  multiplier: "",
  qualifying_spend: "",
  fuel_points_notes: "",
};

const emptyFundingPaymentForm: FundingPaymentForm = {
  payment_type: "CREDIT_CARD",
  credit_card_id: "",
  amount: "",
  spending_category_id: "",
  notes: "",
};

const cardImageAccept = "image/jpeg,image/png,image/webp,image/heic,.jpg,.jpeg,.png,.webp,.heic";

function calculateFuelPointsQuantity(amount: string, unit: string) {
  const parsedAmount = Number(amount);
  const parsedUnit = Number(unit);

  if (!amount || Number.isNaN(parsedAmount) || Number.isNaN(parsedUnit)) {
    return null;
  }

  return Math.max(0, Math.round(parsedAmount * parsedUnit));
}

function formatFuelPoints(quantity: number | null, unit: number | null) {
  if (!quantity || !unit) {
    return "";
  }

  const amount = quantity / unit;

  return `${amount.toLocaleString()} × ${unit.toLocaleString()} = ${quantity.toLocaleString()} points`;
}

export default function PurchaseDetailPage() {
  const params = useParams<{ id: string | string[] }>();
  const router = useRouter();
  const purchaseId = useMemo(() => {
    const rawId = params.id;
    return Array.isArray(rawId) ? rawId[0] : rawId;
  }, [params.id]);

  const [purchase, setPurchase] = useState<PurchaseBatch | null>(null);
  const [payments, setPayments] = useState<PurchasePayment[]>([]);
  const [receipts, setReceipts] = useState<Receipt[]>([]);
  const [giftCards, setGiftCards] = useState<GiftCard[]>([]);
  const [destinationPurchases, setDestinationPurchases] = useState<PurchaseBatch[]>([]);
  const [cardBrands, setCardBrands] = useState<CardBrand[]>([]);
  const [fuelAccounts, setFuelAccounts] = useState<FuelAccount[]>([]);
  const [creditCards, setCreditCards] = useState<CreditCard[]>([]);
  const [spendingCategories, setSpendingCategories] = useState<SpendingCategory[]>([]);
  const [revealedCardNumbers, setRevealedCardNumbers] = useState<
    Record<number, boolean>
  >({});
  const [form, setForm] = useState<GiftCardForm>(emptyGiftCardForm);
  const [financialForm, setFinancialForm] = useState<PurchaseFinancialForm>(
    emptyPurchaseFinancialForm,
  );
  const [fuelPointForm, setFuelPointForm] = useState<FuelPointCorrectionForm>(
    emptyFuelPointCorrectionForm,
  );
  const [fundingPaymentForm, setFundingPaymentForm] =
    useState<FundingPaymentForm>(emptyFundingPaymentForm);
  const [cardImageFile, setCardImageFile] = useState<File | null>(null);
  const [cardImageInputKey, setCardImageInputKey] = useState(0);
  const [isEditingFinancials, setIsEditingFinancials] = useState(false);
  const [isLoadingPurchase, setIsLoadingPurchase] = useState(true);
  const [isLoadingPayments, setIsLoadingPayments] = useState(true);
  const [isLoadingReceipts, setIsLoadingReceipts] = useState(true);
  const [isUploadingReceipt, setIsUploadingReceipt] = useState(false);
  const [isLoadingGiftCards, setIsLoadingGiftCards] = useState(true);
  const [isLoadingDestinationPurchases, setIsLoadingDestinationPurchases] =
    useState(true);
  const [isLoadingCardBrands, setIsLoadingCardBrands] = useState(true);
  const [isLoadingFuelAccounts, setIsLoadingFuelAccounts] = useState(true);
  const [isLoadingCreditCards, setIsLoadingCreditCards] = useState(true);
  const [isLoadingSpendingCategories, setIsLoadingSpendingCategories] =
    useState(true);
  const [isRecalculatingAllocation, setIsRecalculatingAllocation] =
    useState(false);
  const [isSavingFinancials, setIsSavingFinancials] = useState(false);
  const [isEditingFuelPoints, setIsEditingFuelPoints] = useState(false);
  const [isSavingFuelPoints, setIsSavingFuelPoints] = useState(false);
  const [isAddingFundingPayment, setIsAddingFundingPayment] = useState(false);
  const [editingFundingPaymentId, setEditingFundingPaymentId] = useState<number | null>(null);
  const [isRecalculatingRewards, setIsRecalculatingRewards] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [movingGiftCardId, setMovingGiftCardId] = useState<number | null>(null);
  const [moveTargetPurchaseId, setMoveTargetPurchaseId] = useState("");
  const [isMovingGiftCard, setIsMovingGiftCard] = useState(false);
  const [deleteReport, setDeleteReport] = useState<PurchaseDeleteReport | null>(null);
  const [isLoadingDeleteReport, setIsLoadingDeleteReport] = useState(false);
  const [isDeletingPurchase, setIsDeletingPurchase] = useState(false);
  const [isRemovingFuelPointEntry, setIsRemovingFuelPointEntry] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [receiptsError, setReceiptsError] = useState<string | null>(null);
  const [paymentsError, setPaymentsError] = useState<string | null>(null);
  const [receiptUploadError, setReceiptUploadError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [cardBrandsError, setCardBrandsError] = useState<string | null>(null);
  const [allocationError, setAllocationError] = useState<string | null>(null);
  const [financialError, setFinancialError] = useState<string | null>(null);
  const [fuelAccountsError, setFuelAccountsError] = useState<string | null>(null);
  const [fuelPointError, setFuelPointError] = useState<string | null>(null);
  const [fuelPointMessage, setFuelPointMessage] = useState<string | null>(null);
  const [fundingError, setFundingError] = useState<string | null>(null);
  const [fundingMessage, setFundingMessage] = useState<string | null>(null);
  const [rewardRecalculationMessage, setRewardRecalculationMessage] =
    useState<string | null>(null);
  const [moveError, setMoveError] = useState<string | null>(null);
  const [moveMessage, setMoveMessage] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const purchaseUrl = `${API_BASE_URL}/purchase-batches/${purchaseId}`;
  const purchasesUrl = `${API_BASE_URL}/purchase-batches/`;
  const deleteReportUrl = `${API_BASE_URL}/purchase-batches/${purchaseId}/delete-report`;
  const paymentsUrl = `${API_BASE_URL}/purchase-batches/${purchaseId}/payments`;
  const receiptsUrl = `${API_BASE_URL}/receipts/purchase/${purchaseId}`;
  const giftCardsUrl = `${API_BASE_URL}/gift-cards/purchase/${purchaseId}`;
  const cardBrandsUrl = `${API_BASE_URL}/card-brands/`;
  const fuelAccountsUrl = `${API_BASE_URL}/fuel-accounts/active`;
  const creditCardsUrl = `${API_BASE_URL}/credit-cards`;
  const spendingCategoriesUrl = `${API_BASE_URL}/spending-categories/`;
  const rewardRecalculateUrl = `${purchaseUrl}/reward-transaction/recalculate`;
  const financialFuelPointsQuantity = calculateFuelPointsQuantity(
    financialForm.fuel_points_amount,
    financialForm.fuel_points_unit,
  );
  const correctionFuelPointsQuantity = calculateFuelPointsQuantity(
    fuelPointForm.fuel_points_amount,
    fuelPointForm.fuel_points_unit,
  );
  const storeEarnsFuelPoints = Boolean(purchase?.store_earns_fuel_points);
  const currentFuelPointEntry = purchase?.fuel_point_entries?.[0] ?? null;
  const currentFuelAccountId =
    currentFuelPointEntry?.fuel_reward_account_id ?? null;
  const selectedFuelAccountId = fuelPointForm.fuel_reward_account_id
    ? Number(fuelPointForm.fuel_reward_account_id)
    : null;
  const isMovingFuelPoints =
    Boolean(currentFuelAccountId) &&
    Boolean(selectedFuelAccountId) &&
    currentFuelAccountId !== selectedFuelAccountId;
  const rewardTransactions = purchase?.reward_transactions ?? [];
  const hasCreditCardFunding = payments.some(
    (payment) =>
      payment.payment_type === "CREDIT_CARD" && payment.credit_card_id !== null,
  );
  const showMissingFundingDiagnostic =
    !isLoadingPayments && payments.length === 0;
  const showMissingRewardDiagnostic =
    !isLoadingPayments &&
    payments.length > 0 &&
    hasCreditCardFunding &&
    rewardTransactions.length === 0;
  const defaultFundingAmount =
    editingFundingPaymentId !== null ||
    fundingPaymentForm.payment_type !== "CREDIT_CARD" ||
    purchase?.purchase_total_paid === null ||
    purchase?.purchase_total_paid === undefined
      ? ""
      : String(purchase.purchase_total_paid);
  const selectedFundingAmount = fundingPaymentForm.amount || defaultFundingAmount;
  const selectedFundingCategoryId =
    fundingPaymentForm.spending_category_id ||
    (purchase?.spending_category_id ? String(purchase.spending_category_id) : "");

  const purchaseSummary = useMemo(() => {
    const summary = giftCards.reduce(
      (summary, giftCard) => {
        const faceValue = Number(giftCard.face_value) || 0;
        const acquisitionCost = Number(giftCard.acquisition_cost) || 0;
        const salePrice = Number(giftCard.sale_price) || 0;
        const isSold = giftCard.status === "SOLD";

        summary.totalFaceValue += faceValue;
        summary.totalAcquisitionCost += acquisitionCost;
        summary.totalAllocatedCost += acquisitionCost;
        summary.totalCards += 1;

        if (giftCard.status === "VERIFIED_AVAILABLE") {
          summary.verifiedAvailableCards += 1;
          summary.unsoldInventoryValue += faceValue;
        }

        if (isSold) {
          summary.soldCards += 1;
          summary.totalSoldValue += salePrice;
          summary.realizedProfit += salePrice - acquisitionCost;
        }

        if (giftCard.status === "NEEDS_VERIFICATION") {
          summary.pendingVerificationCards += 1;
        }

        return summary;
      },
      {
        totalFaceValue: 0,
        totalAcquisitionCost: 0,
        totalAllocatedCost: 0,
        totalSoldValue: 0,
        realizedProfit: 0,
        unsoldInventoryValue: 0,
        totalCards: 0,
        verifiedAvailableCards: 0,
        soldCards: 0,
        pendingVerificationCards: 0,
        allocationDifference: 0,
      },
    );

    const purchaseTotalPaid =
      purchase?.purchase_total_paid === null ||
        purchase?.purchase_total_paid === undefined
        ? null
        : Number(purchase.purchase_total_paid);

    summary.allocationDifference =
      purchaseTotalPaid === null || Number.isNaN(purchaseTotalPaid)
        ? 0
        : purchaseTotalPaid - summary.totalAcquisitionCost;

    return summary;
  }, [giftCards, purchase]);
  const deleteImpact = deleteReport?.impact;
  const nonFuelRealDeleteImpactCount = deleteImpact
    ? deleteImpact.gift_cards_to_delete +
      deleteImpact.ocr_attempts_to_delete +
      deleteImpact.ocr_candidates_to_delete +
      deleteImpact.ocr_metrics_to_delete +
      deleteImpact.card_images_to_delete
    : 0;
  const realRecordDeleteImpactCount = deleteImpact
    ? deleteImpact.gift_cards_to_delete +
      deleteImpact.fuel_point_entries_to_delete +
      deleteImpact.ocr_attempts_to_delete +
      deleteImpact.ocr_candidates_to_delete +
      deleteImpact.ocr_metrics_to_delete +
      deleteImpact.card_images_to_delete
    : 0;
  const generatedCleanupRows = deleteImpact
    ? [
        ["Receipts", deleteImpact.receipts_to_delete],
        ["Generated payment records", deleteImpact.payment_lines_to_remove],
        [
          "Generated reward transactions",
          deleteImpact.reward_transactions_to_delete,
        ],
      ].filter(([, count]) => Number(count) > 0)
    : [];
  const canDeleteEmptyPurchase =
    Boolean(deleteReport?.can_delete) && realRecordDeleteImpactCount === 0;
  const canRemoveFuelPointEntry =
    Boolean(deleteReport?.can_delete) &&
    Boolean(deleteImpact?.fuel_point_entries_to_delete) &&
    nonFuelRealDeleteImpactCount === 0;
  const deleteBlockedReason =
    deleteReport?.blocking_dependencies[0]?.message ??
    (deleteReport && realRecordDeleteImpactCount > 0
      ? "Purchase has inventory, fuel, OCR, or card-image records."
      : null);
  const deleteImpactRows = deleteImpact
    ? [
        ["Gift cards", deleteImpact.gift_cards_to_delete],
        ["Fuel point entries", deleteImpact.fuel_point_entries_to_delete],
        ["OCR attempts", deleteImpact.ocr_attempts_to_delete],
        ["OCR candidates", deleteImpact.ocr_candidates_to_delete],
        ["OCR metrics", deleteImpact.ocr_metrics_to_delete],
        ["Card images", deleteImpact.card_images_to_delete],
      ].filter(([, count]) => Number(count) > 0)
    : [];
  const moveDestinationOptions = useMemo(
    () =>
      destinationPurchases
        .filter((destinationPurchase) => String(destinationPurchase.id) !== purchaseId)
        .sort((left, right) => {
          const rightDate = new Date(right.purchase_date).getTime();
          const leftDate = new Date(left.purchase_date).getTime();

          if (rightDate !== leftDate) {
            return rightDate - leftDate;
          }

          return right.id - left.id;
        }),
    [destinationPurchases, purchaseId],
  );
  const selectedMoveDestination = useMemo(
    () =>
      moveDestinationOptions.find(
        (destinationPurchase) =>
          String(destinationPurchase.id) === moveTargetPurchaseId,
      ) ?? null,
    [moveDestinationOptions, moveTargetPurchaseId],
  );
  const movingGiftCard = useMemo(
    () =>
      giftCards.find((giftCard) => giftCard.id === movingGiftCardId) ?? null,
    [giftCards, movingGiftCardId],
  );
  const moveWarnings = useMemo(() => {
    if (!purchase || !selectedMoveDestination) {
      return [];
    }

    const warnings: string[] = [];
    const currentPurchaseDate = purchase.purchase_date.slice(0, 10);
    const destinationPurchaseDate =
      selectedMoveDestination.purchase_date.slice(0, 10);

    if (purchase.store_name !== selectedMoveDestination.store_name) {
      warnings.push(
        `Store differs: ${purchase.store_name} → ${selectedMoveDestination.store_name}`,
      );
    }

    if (currentPurchaseDate !== destinationPurchaseDate) {
      warnings.push(
        `Purchase date differs: ${formatDate(purchase.purchase_date)} → ${formatDate(
          selectedMoveDestination.purchase_date,
        )}`,
      );
    }

    if (purchase.credit_card_id !== selectedMoveDestination.credit_card_id) {
      warnings.push(
        `Funding card differs: ${purchase.credit_card_id ? `Card #${purchase.credit_card_id}` : "none"} → ${
          selectedMoveDestination.credit_card_id
            ? `Card #${selectedMoveDestination.credit_card_id}`
            : "none"
        }`,
      );
    }

    return warnings;
  }, [purchase, selectedMoveDestination]);

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

  const loadDeleteReport = useCallback(
    async (options: { showLoading?: boolean } = {}) => {
      if (!purchaseId) {
        return;
      }

      if (options.showLoading ?? true) {
        setIsLoadingDeleteReport(true);
      }

      setDeleteError(null);

      try {
        const response = await fetch(deleteReportUrl);

        if (!response.ok) {
          throw new Error(`Failed to load delete report (${response.status})`);
        }

        const data = (await response.json()) as PurchaseDeleteReport;
        setDeleteReport(data);
      } catch (err) {
        setDeleteError(
          err instanceof Error
            ? err.message
            : "Failed to load delete safety report.",
        );
      } finally {
        setIsLoadingDeleteReport(false);
      }
    },
    [deleteReportUrl, purchaseId],
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

    async function loadPayments() {
      if (!purchaseId) {
        return;
      }

      setIsLoadingPayments(true);
      setPaymentsError(null);

      try {
        const response = await fetch(paymentsUrl);

        if (!response.ok) {
          throw new Error(`Failed to load payments (${response.status})`);
        }

        const data = (await response.json()) as PurchasePayment[];

        if (isMounted) {
          setPayments(data);
        }
      } catch (err) {
        if (isMounted) {
          setPaymentsError(
            err instanceof Error ? err.message : "Failed to load payments.",
          );
        }
      } finally {
        if (isMounted) {
          setIsLoadingPayments(false);
        }
      }
    }

    loadPayments();

    return () => {
      isMounted = false;
    };
  }, [paymentsUrl, purchaseId]);

  useEffect(() => {
    let isMounted = true;

    async function loadDestinationPurchases() {
      setIsLoadingDestinationPurchases(true);
      setMoveError(null);

      try {
        const response = await fetch(purchasesUrl);

        if (!response.ok) {
          throw new Error(
            `Failed to load destination purchases (${response.status})`,
          );
        }

        const data = (await response.json()) as PurchaseBatch[];

        if (isMounted) {
          setDestinationPurchases(data);
        }
      } catch (err) {
        if (isMounted) {
          setMoveError(
            err instanceof Error
              ? err.message
              : "Failed to load destination purchases.",
          );
        }
      } finally {
        if (isMounted) {
          setIsLoadingDestinationPurchases(false);
        }
      }
    }

    loadDestinationPurchases();

    return () => {
      isMounted = false;
    };
  }, [purchasesUrl]);

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

    async function loadFuelAccounts() {
      setIsLoadingFuelAccounts(true);
      setFuelAccountsError(null);

      try {
        const response = await fetch(fuelAccountsUrl);

        if (!response.ok) {
          throw new Error(`Failed to load fuel accounts (${response.status})`);
        }

        const data = (await response.json()) as FuelAccount[];

        if (isMounted) {
          setFuelAccounts(data);
        }
      } catch (err) {
        if (isMounted) {
          setFuelAccountsError(
            err instanceof Error ? err.message : "Failed to load fuel accounts.",
          );
        }
      } finally {
        if (isMounted) {
          setIsLoadingFuelAccounts(false);
        }
      }
    }

    loadFuelAccounts();

    return () => {
      isMounted = false;
    };
  }, [fuelAccountsUrl]);

  useEffect(() => {
    let isMounted = true;

    async function loadCreditCards() {
      setIsLoadingCreditCards(true);

      try {
        const response = await fetch(creditCardsUrl);

        if (!response.ok) {
          throw new Error(`Failed to load credit cards (${response.status})`);
        }

        const data = (await response.json()) as CreditCard[];

        if (isMounted) {
          setCreditCards(data);
        }
      } catch (err) {
        if (isMounted) {
          setFundingError(
            err instanceof Error ? err.message : "Failed to load credit cards.",
          );
        }
      } finally {
        if (isMounted) {
          setIsLoadingCreditCards(false);
        }
      }
    }

    loadCreditCards();

    return () => {
      isMounted = false;
    };
  }, [creditCardsUrl]);

  useEffect(() => {
    let isMounted = true;

    async function loadSpendingCategories() {
      setIsLoadingSpendingCategories(true);

      try {
        const response = await fetch(spendingCategoriesUrl);

        if (!response.ok) {
          throw new Error(
            `Failed to load spending categories (${response.status})`,
          );
        }

        const data = (await response.json()) as SpendingCategory[];

        if (isMounted) {
          setSpendingCategories(data);
        }
      } catch (err) {
        if (isMounted) {
          setFundingError(
            err instanceof Error
              ? err.message
              : "Failed to load spending categories.",
          );
        }
      } finally {
        if (isMounted) {
          setIsLoadingSpendingCategories(false);
        }
      }
    }

    loadSpendingCategories();

    return () => {
      isMounted = false;
    };
  }, [spendingCategoriesUrl]);

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

  useEffect(() => {
    void Promise.resolve().then(() => loadDeleteReport());
  }, [loadDeleteReport]);

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
          acquisition_cost: form.face_value,
          notes: form.notes.trim() || null,
          purchase_batch_id: Number(purchaseId),
        }),
      });

      if (!response.ok) {
        throw new Error(`Failed to create gift card (${response.status})`);
      }

      const giftCard = (await response.json()) as GiftCard;

      if (cardImageFile) {
        const formData = new FormData();
        formData.append("gift_card_id", String(giftCard.id));
        formData.append("file", cardImageFile);

        const imageResponse = await fetch(`${API_BASE_URL}/card-images/upload`, {
          method: "POST",
          body: formData,
        });

        if (!imageResponse.ok) {
          await loadGiftCards({ showLoading: false });
          throw new Error(
            `Gift card created, but image upload failed (${imageResponse.status})`,
          );
        }
      }

      setForm((currentForm) => ({
        ...currentForm,
        notes: "",
      }));
      setCardImageFile(null);
      setCardImageInputKey((currentKey) => currentKey + 1);
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

  async function handleRecalculateAllocation() {
    if (!purchaseId) {
      return;
    }

    setIsRecalculatingAllocation(true);
    setAllocationError(null);

    try {
      const response = await fetch(
        `${API_BASE_URL}/purchase-batches/${purchaseId}/recalculate-allocation`,
        {
          method: "PATCH",
        },
      );

      if (!response.ok) {
        throw new Error(`Failed to recalculate allocation (${response.status})`);
      }

      await loadGiftCards({ showLoading: false });
    } catch (err) {
      setAllocationError(
        err instanceof Error
          ? err.message
          : "Failed to recalculate allocation.",
      );
    } finally {
      setIsRecalculatingAllocation(false);
    }
  }

  function beginMoveGiftCard(giftCard: GiftCard) {
    setMovingGiftCardId(giftCard.id);
    setMoveTargetPurchaseId("");
    setMoveError(null);
    setMoveMessage(null);
  }

  function cancelMoveGiftCard() {
    if (isMovingGiftCard) {
      return;
    }

    setMovingGiftCardId(null);
    setMoveTargetPurchaseId("");
    setMoveError(null);
  }

  function purchaseOptionLabel(destinationPurchase: PurchaseBatch) {
    return `#${destinationPurchase.id} · ${destinationPurchase.store_name} · ${formatDate(
      destinationPurchase.purchase_date,
    )} · ${formatAmount(destinationPurchase.total_amount)}`;
  }

  function apiErrorDetail(bodyText: string) {
    if (!bodyText) {
      return "";
    }

    try {
      const parsed = JSON.parse(bodyText) as { detail?: unknown };
      if (typeof parsed.detail === "string") {
        return parsed.detail;
      }
      if (
        parsed.detail &&
        typeof parsed.detail === "object" &&
        "message" in parsed.detail &&
        typeof parsed.detail.message === "string"
      ) {
        return parsed.detail.message;
      }
    } catch {
      return bodyText;
    }

    return bodyText;
  }

  async function refreshPurchaseDetails() {
    const response = await fetch(purchaseUrl);

    if (!response.ok) {
      throw new Error(`Failed to refresh purchase (${response.status})`);
    }

    setPurchase((await response.json()) as PurchaseBatch);
  }

  function updateFundingPaymentFormField(
    field: keyof FundingPaymentForm,
    value: string,
  ) {
    setFundingPaymentForm((currentForm) => ({
      ...currentForm,
      [field]: value,
      ...(field === "payment_type" && value !== "CREDIT_CARD"
        ? { credit_card_id: "" }
        : {}),
    }));
    setFundingError(null);
    setFundingMessage(null);
  }

  async function refreshPurchasePayments() {
    const response = await fetch(paymentsUrl);
    if (!response.ok) {
      throw new Error(`Failed to refresh payments (${response.status})`);
    }
    setPayments((await response.json()) as PurchasePayment[]);
  }

  function beginEditFundingPayment(payment: PurchasePayment) {
    setEditingFundingPaymentId(payment.id);
    setFundingPaymentForm({
      payment_type: payment.payment_type,
      credit_card_id: payment.credit_card_id ? String(payment.credit_card_id) : "",
      amount: String(payment.amount ?? ""),
      spending_category_id: payment.spending_category_id
        ? String(payment.spending_category_id)
        : "",
      notes: payment.notes ?? "",
    });
    setFundingError(null);
    setFundingMessage(null);
  }

  function cancelFundingPaymentEdit() {
    if (isAddingFundingPayment) {
      return;
    }
    setEditingFundingPaymentId(null);
    setFundingPaymentForm(emptyFundingPaymentForm);
    setFundingError(null);
  }

  function creditCardLabel(cardId: number | null | undefined) {
    if (!cardId) {
      return "";
    }

    const card = creditCards.find((currentCard) => currentCard.id === cardId);
    if (!card) {
      return `Card #${cardId}`;
    }

    return `${card.nickname}${card.last_four ? ` · ${card.last_four}` : ""}`;
  }

  function spendingCategoryLabel(categoryId: number | null | undefined) {
    if (!categoryId) {
      return "Store/default category";
    }

    const category = spendingCategories.find(
      (currentCategory) => currentCategory.id === categoryId,
    );
    return category?.name ?? `Category #${categoryId}`;
  }

  function formatRewardValue(transaction: RewardTransaction) {
    if (Number(transaction.points_earned) > 0) {
      return `${Number(transaction.points_earned).toLocaleString()} points`;
    }

    const savingsAmount = Number(transaction.effective_savings_amount);
    if (savingsAmount > 0) {
      return formatAmount(savingsAmount);
    }

    return String(transaction.rewards_earned);
  }

  async function handleSaveFundingPayment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!purchaseId) {
      return;
    }

    const paymentType = fundingPaymentForm.payment_type || "CREDIT_CARD";

    if (paymentType === "CREDIT_CARD" && !fundingPaymentForm.credit_card_id) {
      setFundingError("Choose the credit card used to fund this purchase.");
      return;
    }

    if (!selectedFundingAmount || Number(selectedFundingAmount) <= 0) {
      setFundingError("Enter a positive payment amount.");
      return;
    }

    setIsAddingFundingPayment(true);
    setFundingError(null);
    setFundingMessage(null);
    setRewardRecalculationMessage(null);

    try {
      const endpoint =
        editingFundingPaymentId === null
          ? paymentsUrl
          : `${API_BASE_URL}/purchase-payments/${editingFundingPaymentId}`;
      const response = await fetch(endpoint, {
        method: editingFundingPaymentId === null ? "POST" : "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          payment_type: paymentType,
          credit_card_id:
            paymentType === "CREDIT_CARD"
              ? Number(fundingPaymentForm.credit_card_id)
              : null,
          amount: selectedFundingAmount,
          spending_category_id: selectedFundingCategoryId
            ? Number(selectedFundingCategoryId)
            : null,
          notes:
            fundingPaymentForm.notes.trim() === ""
              ? null
              : fundingPaymentForm.notes.trim(),
        }),
      });

      if (!response.ok) {
        const bodyText = await response.text();
        throw new Error(
          apiErrorDetail(bodyText) ||
            `Failed to save funding payment (${response.status})`,
        );
      }

      setFundingMessage(
        editingFundingPaymentId === null
          ? "Funding payment added and rewards recalculated."
          : "Funding payment updated and rewards recalculated.",
      );
      setEditingFundingPaymentId(null);
      setFundingPaymentForm(emptyFundingPaymentForm);
      await Promise.all([
        refreshPurchaseDetails(),
        loadDeleteReport({ showLoading: false }),
        refreshPurchasePayments(),
      ]);
    } catch (err) {
      setFundingError(
        err instanceof Error ? err.message : "Failed to save funding payment.",
      );
    } finally {
      setIsAddingFundingPayment(false);
    }
  }

  async function handleRecalculateRewards() {
    if (!purchaseId) {
      return;
    }

    setIsRecalculatingRewards(true);
    setFundingError(null);
    setRewardRecalculationMessage(null);

    try {
      const response = await fetch(rewardRecalculateUrl, {
        method: "POST",
      });

      if (!response.ok) {
        const bodyText = await response.text();
        throw new Error(
          apiErrorDetail(bodyText) ||
            `Failed to recalculate rewards (${response.status})`,
        );
      }

      const result = (await response.json()) as {
        transaction_count: number;
        created_count?: number;
        updated_count?: number;
        skipped_reason?: string | null;
      };
      setRewardRecalculationMessage(
        result.skipped_reason
          ? result.skipped_reason
          : `Reward transactions recalculated: ${
              result.transaction_count
            } active, ${result.created_count ?? 0} created, ${
              result.updated_count ?? 0
            } updated.`,
      );
      await Promise.all([refreshPurchaseDetails(), refreshPurchasePayments()]);
    } catch (err) {
      setFundingError(
        err instanceof Error
          ? err.message
          : "Failed to recalculate rewards.",
      );
    } finally {
      setIsRecalculatingRewards(false);
    }
  }

  async function handleMoveGiftCard(giftCard: GiftCard) {
    if (!moveTargetPurchaseId || !selectedMoveDestination) {
      setMoveError("Select a destination purchase before moving.");
      return;
    }

    const warningText =
      moveWarnings.length > 0 ? `\n\nWarnings:\n${moveWarnings.join("\n")}` : "";
    const confirmed = window.confirm(
      `Move ${giftCard.brand} card #${giftCard.id} to purchase #${selectedMoveDestination.id}?${warningText}`,
    );

    if (!confirmed) {
      return;
    }

    setIsMovingGiftCard(true);
    setMoveError(null);
    setMoveMessage(null);

    try {
      const response = await fetch(`${API_BASE_URL}/gift-cards/${giftCard.id}/move`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          purchase_batch_id: Number(moveTargetPurchaseId),
        }),
      });

      if (!response.ok) {
        const bodyText = await response.text();
        const detail = apiErrorDetail(bodyText);
        throw new Error(
          detail || `Failed to move gift card (${response.status})`,
        );
      }

      setMoveMessage(
        `${giftCard.brand} card #${giftCard.id} moved to purchase #${selectedMoveDestination.id}.`,
      );
      setMovingGiftCardId(null);
      setMoveTargetPurchaseId("");
      await loadGiftCards({ showLoading: false });
    } catch (err) {
      setMoveError(
        err instanceof Error ? err.message : "Failed to move gift card.",
      );
    } finally {
      setIsMovingGiftCard(false);
    }
  }

  async function handleDeleteEmptyPurchase() {
    if (!purchaseId || !canDeleteEmptyPurchase) {
      return;
    }

    const confirmed = window.confirm(
      "Delete this empty purchase and related receipt/payment/reward records? This cannot be undone.",
    );

    if (!confirmed) {
      return;
    }

    setIsDeletingPurchase(true);
    setDeleteError(null);

    try {
      const response = await fetch(purchaseUrl, {
        method: "DELETE",
      });

      if (!response.ok) {
        const responseBody = await response.text();
        throw new Error(
          `Failed to delete purchase (${response.status}): ${responseBody}`,
        );
      }

      router.push("/purchases");
    } catch (err) {
      setDeleteError(
        err instanceof Error ? err.message : "Failed to delete purchase.",
      );
    } finally {
      setIsDeletingPurchase(false);
    }
  }

  async function handleRemoveFuelPointEntry() {
    if (!purchaseId || !canRemoveFuelPointEntry) {
      return;
    }

    const confirmed = window.confirm(
      "This will remove the fuel points earned from this purchase and update the fuel account balance.",
    );

    if (!confirmed) {
      return;
    }

    setIsRemovingFuelPointEntry(true);
    setDeleteError(null);

    try {
      const response = await fetch(`${purchaseUrl}/fuel-info`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          fuel_reward_account_id: null,
          fuel_points_quantity: null,
          fuel_points_unit: null,
          fuel_points_notes: null,
        }),
      });

      if (!response.ok) {
        const responseBody = await response.text();
        throw new Error(
          `Failed to remove fuel point entry (${response.status}): ${responseBody}`,
        );
      }

      const updatedPurchase = (await response.json()) as PurchaseBatch;
      setPurchase(updatedPurchase);
      await loadDeleteReport({ showLoading: false });
    } catch (err) {
      setDeleteError(
        err instanceof Error
          ? err.message
          : "Failed to remove fuel point entry.",
      );
    } finally {
      setIsRemovingFuelPointEntry(false);
    }
  }

  function getInputValue(value: string | number | null) {
    return value === null ? "" : String(value);
  }

  function getOptionalFieldValue(value: string) {
    const trimmedValue = value.trim();

    return trimmedValue === "" ? null : trimmedValue;
  }

  function getFuelPointsAmount(
    quantity: number | null,
    unit: number | null,
  ) {
    if (!quantity || !unit) {
      return "";
    }

    return String(quantity / unit);
  }

  function openFuelPointEditor() {
    if (!purchase) {
      return;
    }

    const entry = purchase.fuel_point_entries?.[0] ?? null;
    const unit =
      purchase.fuel_points_unit ??
      entry?.multiplier ??
      purchase.store_default_fuel_multiplier ??
      1000;

    setFuelPointForm({
      fuel_reward_account_id: entry?.fuel_reward_account_id
        ? String(entry.fuel_reward_account_id)
        : "",
      fuel_points_amount: getFuelPointsAmount(
        purchase.fuel_points_quantity ?? entry?.points_earned ?? null,
        purchase.fuel_points_unit ?? unit,
      ),
      fuel_points_unit: String(unit),
      expires_on: entry?.expires_on ? entry.expires_on.slice(0, 10) : "",
      multiplier: entry?.multiplier ? String(entry.multiplier) : "",
      qualifying_spend:
        entry?.qualifying_spend === null ||
        entry?.qualifying_spend === undefined
          ? ""
          : String(entry.qualifying_spend),
      fuel_points_notes: purchase.fuel_points_notes ?? entry?.notes ?? "",
    });
    setFuelPointError(null);
    setFuelPointMessage(null);
    setIsEditingFuelPoints(true);
  }

  function closeFuelPointEditor() {
    if (isSavingFuelPoints) {
      return;
    }

    setIsEditingFuelPoints(false);
    setFuelPointError(null);
  }

  function openFinancialEditor() {
    if (!purchase) {
      return;
    }

    setFinancialForm({
      purchase_total_paid: getInputValue(purchase.purchase_total_paid),
      sales_tax: getInputValue(purchase.sales_tax),
      activation_fees: getInputValue(purchase.activation_fees),
      discounts: getInputValue(purchase.discounts),
      fuel_points_amount: purchase.store_earns_fuel_points
        ? getFuelPointsAmount(
            purchase.fuel_points_quantity,
            purchase.fuel_points_unit,
          )
        : "",
      fuel_points_unit: String(
        purchase.fuel_points_unit ??
          purchase.store_default_fuel_multiplier ??
          1000,
      ),
      financial_notes: purchase.financial_notes ?? "",
    });
    setFinancialError(null);
    setIsEditingFinancials(true);
  }

  function closeFinancialEditor() {
    if (isSavingFinancials) {
      return;
    }

    setIsEditingFinancials(false);
    setFinancialError(null);
  }

  function updateFuelPointFormField(
    field: keyof FuelPointCorrectionForm,
    value: string,
  ) {
    setFuelPointForm((currentForm) => ({
      ...currentForm,
      [field]: value,
    }));
  }

  async function handleFinancialSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!purchaseId) {
      return;
    }

    setIsSavingFinancials(true);
    setFinancialError(null);

    try {
      const payload = {
        purchase_total_paid: getOptionalFieldValue(
          financialForm.purchase_total_paid,
        ),
        sales_tax: getOptionalFieldValue(financialForm.sales_tax),
        activation_fees: getOptionalFieldValue(financialForm.activation_fees),
        discounts: getOptionalFieldValue(financialForm.discounts),
        financial_notes:
          financialForm.financial_notes.trim() === ""
            ? null
            : financialForm.financial_notes.trim(),
        ...(storeEarnsFuelPoints
          ? {
              fuel_points_quantity: financialFuelPointsQuantity,
              fuel_points_unit: financialFuelPointsQuantity
                ? Number(financialForm.fuel_points_unit)
                : null,
            }
          : {}),
      };

      const response = await fetch(purchaseUrl, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        throw new Error(`Failed to save financials (${response.status})`);
      }

      const updatedPurchase = (await response.json()) as PurchaseBatch;
      setPurchase(updatedPurchase);
      setIsEditingFinancials(false);
      await loadGiftCards({ showLoading: false });
    } catch (err) {
      setFinancialError(
        err instanceof Error
          ? err.message
          : "Failed to save financial details.",
      );
    } finally {
      setIsSavingFinancials(false);
    }
  }

  async function handleFuelPointSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!purchaseId) {
      return;
    }

    if (!fuelPointForm.fuel_reward_account_id) {
      setFuelPointError("Choose the fuel account that should receive these points.");
      return;
    }

    if (!correctionFuelPointsQuantity) {
      setFuelPointError("Enter the fuel points amount to save.");
      return;
    }

    setIsSavingFuelPoints(true);
    setFuelPointError(null);
    setFuelPointMessage(null);

    try {
      const payload = {
        fuel_reward_account_id: Number(fuelPointForm.fuel_reward_account_id),
        fuel_points_quantity: correctionFuelPointsQuantity,
        fuel_points_unit: Number(fuelPointForm.fuel_points_unit),
        expires_on:
          fuelPointForm.expires_on.trim() === ""
            ? null
            : fuelPointForm.expires_on,
        multiplier:
          fuelPointForm.multiplier.trim() === ""
            ? null
            : Number(fuelPointForm.multiplier),
        qualifying_spend: getOptionalFieldValue(fuelPointForm.qualifying_spend),
        fuel_points_notes:
          fuelPointForm.fuel_points_notes.trim() === ""
            ? null
            : fuelPointForm.fuel_points_notes.trim(),
      };

      const response = await fetch(`${purchaseUrl}/fuel-info`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const responseBody = await response.text();
        throw new Error(
          `Failed to save fuel point correction (${response.status}): ${responseBody}`,
        );
      }

      const updatedPurchase = (await response.json()) as PurchaseBatch;
      setPurchase(updatedPurchase);
      setIsEditingFuelPoints(false);
      setFuelPointMessage("Fuel points updated.");
      await loadDeleteReport({ showLoading: false });
    } catch (err) {
      setFuelPointError(
        err instanceof Error
          ? err.message
          : "Failed to save fuel point correction.",
      );
    } finally {
      setIsSavingFuelPoints(false);
    }
  }

  function updateFormField(field: keyof GiftCardForm, value: string) {
    setForm((currentForm) => ({
      ...currentForm,
      [field]: value,
    }));
  }

  function updateFinancialFormField(
    field: keyof PurchaseFinancialForm,
    value: string,
  ) {
    setFinancialForm((currentForm) => ({
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

  function formatOptionalAmount(value: string | number | null) {
    if (value === null || value === "") {
      return "";
    }

    return formatAmount(value);
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

  function getCardEndingDisplay(giftCard: GiftCard) {
    const cardNumber = giftCard.card_number_encrypted;

    if (!cardNumber) {
      return "Card number not verified";
    }

    const normalizedCardNumber = cardNumber.replace(/\s/g, "");
    const lastFour = normalizedCardNumber.slice(-4);

    return lastFour ? `Ending ${lastFour}` : "Card number saved";
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
          <details>
            <summary className="cursor-pointer text-lg font-semibold">
              Purchase Cleanup
            </summary>
            <p className="mt-1 text-sm text-slate-500">
              Delete eligibility and cleanup actions for empty purchase records.
            </p>
            <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="mt-1 text-sm text-slate-500">
                Purchases with no gift cards or inventory records can be
                deleted. Related receipt records and generated payment/reward
                records will be removed with the purchase.
              </p>
              {isLoadingDeleteReport ? (
                <p className="mt-2 text-sm text-slate-500">
                  Checking delete safety...
                </p>
              ) : deleteBlockedReason ? (
                <p className="mt-2 text-sm font-medium text-amber-700">
                  {deleteBlockedReason}
                </p>
              ) : canDeleteEmptyPurchase ? (
                <p className="mt-2 text-sm font-medium text-emerald-700">
                  This purchase is safe to delete.
                </p>
              ) : null}
              {deleteReport?.blocking_dependencies.length ? (
                <div className="mt-3 text-sm text-slate-600">
                  <p className="font-medium text-slate-700">Delete blockers</p>
                  <ul className="mt-1 list-disc space-y-1 pl-5">
                    {deleteReport.blocking_dependencies.map((blocker, index) => (
                      <li key={index}>
                        {blocker.message ?? "Related dependency blocks delete."}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {deleteImpactRows.length ? (
                <div className="mt-3 text-sm text-slate-600">
                  <p className="font-medium text-slate-700">
                    Records blocking empty-purchase delete
                  </p>
                  <ul className="mt-1 grid gap-1 sm:grid-cols-2">
                    {deleteImpactRows.map(([label, count]) => (
                      <li key={label}>
                        {label}: {count}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {canRemoveFuelPointEntry && deleteImpact ? (
                <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                  <p className="font-medium">Fuel point entry can be removed first.</p>
                  <p className="mt-1">
                    This will remove{" "}
                    {deleteImpact.fuel_points_to_reverse.toLocaleString()} fuel
                    points from the linked fuel account, then refresh cleanup
                    eligibility.
                  </p>
                </div>
              ) : null}
              {generatedCleanupRows.length ? (
                <div className="mt-3 text-sm text-slate-600">
                  <p className="font-medium text-slate-700">
                    Will also clean up
                  </p>
                  <ul className="mt-1 grid gap-1 sm:grid-cols-2">
                    {generatedCleanupRows.map(([label, count]) => (
                      <li key={label}>
                        {label}: {count}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {deleteReport?.warnings.length ? (
                <div className="mt-3 text-sm text-slate-600">
                  <p className="font-medium text-slate-700">Warnings</p>
                  <ul className="mt-1 list-disc space-y-1 pl-5">
                    {deleteReport.warnings.map((warning, index) => (
                      <li key={index}>{warning}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {deleteError ? (
                <p className="mt-2 text-sm font-medium text-red-700">
                  {deleteError}
                </p>
              ) : null}
            </div>
            <div className="flex flex-col gap-2 sm:items-end">
              {canRemoveFuelPointEntry ? (
                <button
                  className="h-10 rounded-md border border-amber-300 px-4 text-sm font-semibold text-amber-800 transition hover:bg-amber-50 disabled:cursor-not-allowed disabled:border-slate-200 disabled:text-slate-400 disabled:hover:bg-transparent"
                  disabled={isLoadingDeleteReport || isRemovingFuelPointEntry}
                  onClick={handleRemoveFuelPointEntry}
                  type="button"
                >
                  {isRemovingFuelPointEntry
                    ? "Removing fuel entry..."
                    : "Remove fuel point entry"}
                </button>
              ) : null}
              <button
                className="h-10 rounded-md border border-red-300 px-4 text-sm font-semibold text-red-700 transition hover:bg-red-50 disabled:cursor-not-allowed disabled:border-slate-200 disabled:text-slate-400 disabled:hover:bg-transparent"
                disabled={
                  isLoadingDeleteReport ||
                  isDeletingPurchase ||
                  !canDeleteEmptyPurchase
                }
                onClick={handleDeleteEmptyPurchase}
                type="button"
              >
                {isDeletingPurchase ? "Deleting..." : "Delete Empty Purchase"}
              </button>
            </div>
          </div>
          </details>
        </section>

        <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h2 className="text-lg font-semibold">Purchase Summary</h2>
              <p className="mt-1 text-sm text-slate-500">
                Economics and card status for this purchase batch.
              </p>
            </div>
            <div className="flex flex-col gap-2 sm:items-end">
              {isLoadingGiftCards ? (
                <p className="text-sm text-slate-500">
                  Loading card metrics...
                </p>
              ) : null}
              <button
                className="h-10 rounded-md border border-slate-300 px-4 text-sm font-semibold text-slate-700 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:text-slate-400"
                disabled={isRecalculatingAllocation || isLoadingGiftCards}
                onClick={handleRecalculateAllocation}
                type="button"
              >
                {isRecalculatingAllocation
                  ? "Recalculating..."
                  : "Recalculate Allocation"}
              </button>
            </div>
          </div>

          {allocationError ? (
            <div className="mt-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-800">
              {allocationError}
            </div>
          ) : null}

          <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <SummaryMetric
              label="Total Face Value"
              value={formatAmount(purchaseSummary.totalFaceValue)}
            />
            <SummaryMetric
              label="Total Acquisition Cost"
              value={formatAmount(purchaseSummary.totalAcquisitionCost)}
            />
            <SummaryMetric
              label="Total Allocated Cost"
              value={formatAmount(purchaseSummary.totalAllocatedCost)}
            />
            <SummaryMetric
              label="Allocation Difference"
              value={formatAmount(purchaseSummary.allocationDifference)}
            />
            <SummaryMetric
              label="Total Sold Value"
              value={formatAmount(purchaseSummary.totalSoldValue)}
            />
            <SummaryMetric
              label="Realized Profit"
              value={formatAmount(purchaseSummary.realizedProfit)}
            />
            <SummaryMetric
              label="Unsold Inventory Value"
              value={formatAmount(purchaseSummary.unsoldInventoryValue)}
            />
          </div>

          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <SummaryMetric
              label="Total Cards"
              value={String(purchaseSummary.totalCards)}
            />
            <SummaryMetric
              label="Verified Available"
              value={String(purchaseSummary.verifiedAvailableCards)}
            />
            <SummaryMetric
              label="Sold"
              value={String(purchaseSummary.soldCards)}
            />
            <SummaryMetric
              label="Pending Verification"
              value={String(purchaseSummary.pendingVerificationCards)}
            />
          </div>
        </section>

        {purchase ? (
          <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <h2 className="text-lg font-semibold">
                Purchase Financial Details
              </h2>
              <div className="flex flex-wrap gap-2">
                {(storeEarnsFuelPoints || currentFuelPointEntry) ? (
                  <button
                    className="h-10 rounded-md border border-slate-300 px-4 text-sm font-semibold text-slate-700 transition hover:bg-slate-100"
                    onClick={openFuelPointEditor}
                    type="button"
                  >
                    Correct Fuel Points
                  </button>
                ) : null}
                <button
                  className="h-10 rounded-md border border-slate-300 px-4 text-sm font-semibold text-slate-700 transition hover:bg-slate-100"
                  onClick={openFinancialEditor}
                  type="button"
                >
                  Edit Financials
                </button>
              </div>
            </div>
            {fuelPointMessage ? (
              <p className="mt-3 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-800">
                {fuelPointMessage}
              </p>
            ) : null}
            <dl className="mt-5 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              <div>
                <dt className="text-sm font-medium text-slate-500">
                  Total Paid
                </dt>
                <dd className="mt-1 text-base font-semibold">
                  {formatOptionalAmount(purchase.purchase_total_paid)}
                </dd>
              </div>
              <div>
                <dt className="text-sm font-medium text-slate-500">
                  Sales Tax
                </dt>
                <dd className="mt-1 text-base font-semibold">
                  {formatOptionalAmount(purchase.sales_tax)}
                </dd>
              </div>
              <div>
                <dt className="text-sm font-medium text-slate-500">
                  Activation Fees
                </dt>
                <dd className="mt-1 text-base font-semibold">
                  {formatOptionalAmount(purchase.activation_fees)}
                </dd>
              </div>
              <div>
                <dt className="text-sm font-medium text-slate-500">
                  Discounts
                </dt>
                <dd className="mt-1 text-base font-semibold">
                  {formatOptionalAmount(purchase.discounts)}
                </dd>
              </div>
              <div>
                <dt className="text-sm font-medium text-slate-500">
                  Fuel Points
                </dt>
                <dd className="mt-1 text-base font-semibold">
                  {formatFuelPoints(
                    purchase.fuel_points_quantity,
                    purchase.fuel_points_unit,
                  )}
                </dd>
              </div>
              <div>
                <dt className="text-sm font-medium text-slate-500">
                  Fuel Account
                </dt>
                <dd className="mt-1 text-base font-semibold">
                  {currentFuelPointEntry?.fuel_account?.retailer ??
                    (currentFuelPointEntry
                      ? `Account #${currentFuelPointEntry.fuel_reward_account_id}`
                      : "")}
                </dd>
              </div>
              {currentFuelPointEntry ? (
                <div>
                  <dt className="text-sm font-medium text-slate-500">
                    Fuel Points Expire
                  </dt>
                  <dd className="mt-1 text-base font-semibold">
                    {formatDate(currentFuelPointEntry.expires_on)}
                  </dd>
                </div>
              ) : null}
              <div className="sm:col-span-2 lg:col-span-3">
                <dt className="text-sm font-medium text-slate-500">
                  Financial Notes
                </dt>
                <dd className="mt-1 whitespace-pre-wrap text-base text-slate-800">
                  {purchase.financial_notes || ""}
                </dd>
              </div>
            </dl>
          </section>
        ) : null}

        <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h2 className="text-lg font-semibold">Payments & Funding</h2>
              <p className="mt-1 text-sm text-slate-500">
                Funding rows drive credit card reward calculations for this
                purchase.
              </p>
            </div>
            <button
              className="h-10 rounded-md border border-slate-300 px-4 text-sm font-semibold text-slate-700 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:text-slate-400"
              disabled={isRecalculatingRewards}
              onClick={handleRecalculateRewards}
              type="button"
            >
              {isRecalculatingRewards ? "Recalculating..." : "Generate/Recalculate Rewards"}
            </button>
          </div>

          {showMissingFundingDiagnostic ? (
            <div className="mt-4 rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
              <p className="font-semibold">No funding/payment rows recorded.</p>
              <p className="mt-1">
                Credit card rewards cannot be calculated until a funding row is
                added.
              </p>
            </div>
          ) : null}

          {showMissingRewardDiagnostic ? (
            <div className="mt-4 rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
              <p className="font-semibold">Rewards have not been generated.</p>
              <p className="mt-1">
                Funding rows exist, but there are no credit card reward
                transactions yet. Recalculate rewards to rebuild them.
              </p>
            </div>
          ) : null}

          {fundingMessage ? (
            <p className="mt-4 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-800">
              {fundingMessage}
            </p>
          ) : null}

          {rewardRecalculationMessage ? (
            <p className="mt-4 rounded-md border border-cyan-200 bg-cyan-50 px-3 py-2 text-sm font-medium text-cyan-900">
              {rewardRecalculationMessage}
            </p>
          ) : null}

          {fundingError ? (
            <p className="mt-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-700">
              {fundingError}
            </p>
          ) : null}

          {isLoadingPayments ? (
            <p className="mt-4 text-sm text-slate-500">Loading payments...</p>
          ) : paymentsError ? (
            <p className="mt-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm font-medium text-red-700">
              {paymentsError}
            </p>
          ) : payments.length === 0 ? (
            <p className="mt-4 text-sm text-slate-500">
              No payment lines recorded.
            </p>
          ) : (
            <div className="mt-4 overflow-x-auto">
              <table className="min-w-full divide-y divide-slate-200 text-sm">
                <thead className="bg-slate-100 text-left text-xs font-semibold uppercase tracking-wide text-slate-600">
                  <tr>
                    <th className="px-4 py-3">Type</th>
                    <th className="px-4 py-3">Funding Card</th>
                    <th className="px-4 py-3">Category</th>
                    <th className="px-4 py-3">Amount</th>
                    <th className="px-4 py-3">Reward Calc</th>
                    <th className="px-4 py-3">Notes</th>
                    <th className="px-4 py-3 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 bg-white">
                  {payments.map((payment) => (
                    <tr key={payment.id}>
                      <td className="whitespace-nowrap px-4 py-3 font-medium">
                        {payment.payment_type.replace("_", " ")}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-slate-700">
                        {creditCardLabel(payment.credit_card_id)}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-slate-700">
                        {spendingCategoryLabel(payment.spending_category_id)}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 font-semibold">
                        {formatAmount(payment.amount)}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-slate-700">
                        {payment.calculated_rewards
                          ? `${payment.calculated_rewards} ${
                              payment.reward_type ?? "rewards"
                            }`
                          : payment.payment_type === "CREDIT_CARD"
                            ? "Needs reward rule/card"
                            : ""}
                      </td>
                      <td className="px-4 py-3 text-slate-600">
                        {payment.notes || ""}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-right">
                        <button
                          className="inline-flex h-8 items-center rounded-md border border-slate-300 px-3 text-xs font-semibold text-slate-700 transition hover:bg-slate-100"
                          onClick={() => beginEditFundingPayment(payment)}
                          type="button"
                        >
                          Edit
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <form
            className="mt-5 grid gap-4 rounded-md border border-slate-200 bg-slate-50 p-4 md:grid-cols-4"
            onSubmit={handleSaveFundingPayment}
          >
            <div className="md:col-span-4">
              <p className="text-sm font-semibold text-slate-900">
                {editingFundingPaymentId === null
                  ? "Add Funding Payment"
                  : `Edit Funding Payment #${editingFundingPaymentId}`}
              </p>
              <p className="mt-1 text-xs text-slate-500">
                Use CASH for small split tender rows and CREDIT_CARD for reward
                generating funding rows.
              </p>
            </div>

            <label className="space-y-2 text-sm font-medium text-slate-700">
              <span>Payment Type</span>
              <select
                className="h-11 w-full rounded-md border border-slate-300 bg-white px-3 text-slate-950 outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-200"
                disabled={isAddingFundingPayment}
                onChange={(event) =>
                  updateFundingPaymentFormField(
                    "payment_type",
                    event.target.value,
                  )
                }
                value={fundingPaymentForm.payment_type}
              >
                <option value="CREDIT_CARD">Credit Card</option>
                <option value="CASH">Cash</option>
              </select>
            </label>

            <label className="space-y-2 text-sm font-medium text-slate-700">
              <span>Credit Card</span>
              <select
                className="h-11 w-full rounded-md border border-slate-300 bg-white px-3 text-slate-950 outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-200"
                disabled={
                  isLoadingCreditCards ||
                  isAddingFundingPayment ||
                  fundingPaymentForm.payment_type !== "CREDIT_CARD"
                }
                onChange={(event) =>
                  updateFundingPaymentFormField(
                    "credit_card_id",
                    event.target.value,
                  )
                }
                required={fundingPaymentForm.payment_type === "CREDIT_CARD"}
                value={fundingPaymentForm.credit_card_id}
              >
                <option value="">
                  {fundingPaymentForm.payment_type !== "CREDIT_CARD"
                    ? "Not needed for cash"
                    : isLoadingCreditCards
                      ? "Loading cards..."
                      : "Select funding card"}
                </option>
                {creditCards
                  .filter((card) => card.is_active)
                  .map((card) => (
                    <option key={card.id} value={card.id}>
                      {card.nickname}
                      {card.last_four ? ` · ${card.last_four}` : ""}
                    </option>
                  ))}
              </select>
            </label>

            <label className="space-y-2 text-sm font-medium text-slate-700">
              <span>Amount</span>
              <input
                className="h-11 w-full rounded-md border border-slate-300 bg-white px-3 text-slate-950 outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-200"
                min="0"
                onChange={(event) =>
                  updateFundingPaymentFormField("amount", event.target.value)
                }
                required
                step="0.01"
                type="number"
                value={selectedFundingAmount}
              />
            </label>

            <label className="space-y-2 text-sm font-medium text-slate-700">
              <span>Spending Category</span>
              <select
                className="h-11 w-full rounded-md border border-slate-300 bg-white px-3 text-slate-950 outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-200"
                disabled={isLoadingSpendingCategories || isAddingFundingPayment}
                onChange={(event) =>
                  updateFundingPaymentFormField(
                    "spending_category_id",
                    event.target.value,
                  )
                }
                value={selectedFundingCategoryId}
              >
                <option value="">Use store/default category</option>
                {spendingCategories
                  .filter((category) => category.active)
                  .map((category) => (
                    <option key={category.id} value={category.id}>
                      {category.name}
                    </option>
                  ))}
              </select>
            </label>

            <label className="space-y-2 text-sm font-medium text-slate-700 md:col-span-3">
              <span>Notes</span>
              <input
                className="h-11 w-full rounded-md border border-slate-300 bg-white px-3 text-slate-950 outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-200"
                onChange={(event) =>
                  updateFundingPaymentFormField("notes", event.target.value)
                }
                placeholder="Optional funding note"
                value={fundingPaymentForm.notes}
              />
            </label>

            <div className="flex items-end">
              <div className="grid w-full gap-2">
                <button
                  className="h-11 w-full rounded-md bg-slate-900 px-4 text-sm font-semibold text-white transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:bg-slate-400"
                  disabled={
                    isAddingFundingPayment ||
                    (fundingPaymentForm.payment_type === "CREDIT_CARD" &&
                      (isLoadingCreditCards || creditCards.length === 0))
                  }
                  type="submit"
                >
                  {isAddingFundingPayment
                    ? "Saving..."
                    : editingFundingPaymentId === null
                      ? "Add Funding Payment"
                      : "Save Funding Payment"}
                </button>
                {editingFundingPaymentId !== null ? (
                  <button
                    className="h-10 w-full rounded-md border border-slate-300 px-4 text-sm font-semibold text-slate-700 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:text-slate-400"
                    disabled={isAddingFundingPayment}
                    onClick={cancelFundingPaymentEdit}
                    type="button"
                  >
                    Cancel Edit
                  </button>
                ) : null}
              </div>
            </div>
          </form>
        </section>

        <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-lg font-semibold">Credit Card Rewards</h2>
          <p className="mt-1 text-sm text-slate-500">
            Rewards are generated from CREDIT_CARD funding rows.
          </p>

          {showMissingFundingDiagnostic ? (
            <p className="mt-4 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-medium text-amber-900">
              Missing funding payment: add a CREDIT_CARD payment row before
              recalculating rewards.
            </p>
          ) : null}

          {hasCreditCardFunding && rewardTransactions.length === 0 ? (
            <p className="mt-4 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-medium text-amber-900">
              No reward transaction found. Check funding card, spending
              category, and matching reward rules, then recalculate.
            </p>
          ) : null}

          {rewardTransactions.length > 0 ? (
            <div className="mt-4 overflow-x-auto">
              <table className="min-w-full divide-y divide-slate-200 text-sm">
                <thead className="bg-slate-100 text-left text-xs font-semibold uppercase tracking-wide text-slate-600">
                  <tr>
                    <th className="px-4 py-3">Card</th>
                    <th className="px-4 py-3">Spend</th>
                    <th className="px-4 py-3">Reward</th>
                    <th className="px-4 py-3">Rule/Source</th>
                    <th className="px-4 py-3">Notes</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 bg-white">
                  {rewardTransactions.map((transaction) => (
                    <tr key={transaction.id}>
                      <td className="whitespace-nowrap px-4 py-3 font-medium">
                        {transaction.credit_card?.nickname ??
                          creditCardLabel(transaction.credit_card_id)}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-slate-700">
                        {formatAmount(transaction.qualifying_spend)}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 font-semibold">
                        {formatRewardValue(transaction)}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-slate-700">
                        {transaction.calculation_source.replaceAll("_", " ")}
                      </td>
                      <td className="px-4 py-3 text-slate-600">
                        {transaction.notes || ""}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </section>

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
                  Face Value
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
                className={`inline-flex h-10 cursor-pointer items-center rounded-md border border-slate-300 px-4 text-sm font-medium transition ${isUploadingReceipt
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

            <label className="space-y-2 text-sm font-medium text-slate-700">
              <span>Card Image</span>
              <div className="flex h-11 cursor-pointer items-center rounded-md border border-dashed border-slate-300 px-3 text-sm text-slate-600 transition hover:bg-slate-50">
                {cardImageFile ? cardImageFile.name : "Optional image upload"}
              </div>
              <input
                accept={cardImageAccept}
                className="sr-only"
                key={cardImageInputKey}
                onChange={(event) =>
                  setCardImageFile(event.target.files?.[0] ?? null)
                }
                type="file"
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

            <div className="flex items-end md:col-span-2">
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
            {moveMessage ? (
              <p className="mt-3 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-800">
                {moveMessage}
              </p>
            ) : null}
            {moveError ? (
              <p className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-700">
                {moveError}
              </p>
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
                    <th className="px-6 py-3">Brand</th>
                    <th className="px-6 py-3">Face Value</th>
                    <th className="px-6 py-3">Cost</th>
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
                        {giftCard.acquisition_cost === null
                          ? ""
                          : formatAmount(giftCard.acquisition_cost)}
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
                        <div className="flex flex-wrap gap-2">
                          <Link
                            className={`inline-flex h-9 items-center rounded-md px-4 text-xs font-semibold transition ${
                              isGiftCardVerified(giftCard)
                                ? "border border-slate-300 text-slate-700 hover:bg-slate-100"
                                : "bg-red-700 text-white hover:bg-red-800"
                            }`}
                            href={`/gift-cards/${giftCard.id}/verify?returnTo=/purchases/${purchaseId}`}
                          >
                            {isGiftCardVerified(giftCard) ? "Details" : "Verify"}
                          </Link>
                          <button
                            className="inline-flex h-9 items-center rounded-md border border-slate-300 px-4 text-xs font-semibold text-slate-700 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:text-slate-400"
                            disabled={isMovingGiftCard}
                            onClick={() => beginMoveGiftCard(giftCard)}
                            type="button"
                          >
                            Move
                          </button>
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

      {movingGiftCard ? (
        <MoveGiftCardModal
          cardEndingLabel={getCardEndingDisplay(movingGiftCard)}
          currentPurchase={purchase}
          destinationOptions={moveDestinationOptions}
          error={moveError}
          giftCard={movingGiftCard}
          isLoadingDestinations={isLoadingDestinationPurchases}
          isMoving={isMovingGiftCard}
          moveWarnings={moveWarnings}
          onCancel={cancelMoveGiftCard}
          onConfirm={() => handleMoveGiftCard(movingGiftCard)}
          onDestinationChange={setMoveTargetPurchaseId}
          purchaseOptionLabel={purchaseOptionLabel}
          selectedDestination={selectedMoveDestination}
          selectedDestinationId={moveTargetPurchaseId}
        />
      ) : null}

      {isEditingFuelPoints ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/40 px-4 py-6 sm:items-center">
          <form
            className="max-h-[calc(100vh-3rem)] w-full max-w-2xl overflow-y-auto rounded-lg bg-white p-5 shadow-xl"
            onSubmit={handleFuelPointSave}
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-lg font-semibold">Correct Fuel Points</h2>
                <p className="mt-1 text-sm text-slate-500">
                  Move or update the fuel points tied to this purchase.
                </p>
              </div>
              <button
                className="rounded-md p-2 text-slate-500 transition hover:bg-slate-100"
                onClick={closeFuelPointEditor}
                type="button"
              >
                ✕
              </button>
            </div>

            {fuelPointError ? (
              <div className="mt-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-800">
                {fuelPointError}
              </div>
            ) : null}

            {fuelAccountsError ? (
              <div className="mt-4 rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-900">
                {fuelAccountsError}
              </div>
            ) : null}

            {isMovingFuelPoints ? (
              <div className="mt-4 rounded-md border border-cyan-200 bg-cyan-50 px-4 py-3 text-sm font-medium text-cyan-900">
                This will move the fuel points from the current fuel account to
                the selected account.
              </div>
            ) : null}

            <div className="mt-5 grid gap-4 sm:grid-cols-2">
              <label className="space-y-2 text-sm font-medium text-slate-700 sm:col-span-2">
                <span>Fuel Account</span>
                <select
                  className="h-11 w-full rounded-md border border-slate-300 px-3 text-slate-950 outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-200"
                  disabled={isLoadingFuelAccounts}
                  onChange={(event) =>
                    updateFuelPointFormField(
                      "fuel_reward_account_id",
                      event.target.value,
                    )
                  }
                  required
                  value={fuelPointForm.fuel_reward_account_id}
                >
                  <option value="">
                    {isLoadingFuelAccounts
                      ? "Loading fuel accounts..."
                      : "Choose fuel account"}
                  </option>
                  {fuelAccounts.map((account) => (
                    <option key={account.id} value={account.id}>
                      {account.retailer}
                      {account.email ? ` · ${account.email}` : ""}
                      {account.current_points !== null
                        ? ` · ${account.current_points.toLocaleString()} pts`
                        : ""}
                    </option>
                  ))}
                </select>
              </label>

              <label className="space-y-2 text-sm font-medium text-slate-700">
                <span>Fuel Points Amount</span>
                <input
                  className="h-11 w-full rounded-md border border-slate-300 px-3 text-slate-950 outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-200"
                  min="0"
                  onChange={(event) =>
                    updateFuelPointFormField(
                      "fuel_points_amount",
                      event.target.value,
                    )
                  }
                  required
                  step="1"
                  type="number"
                  value={fuelPointForm.fuel_points_amount}
                />
              </label>

              <label className="space-y-2 text-sm font-medium text-slate-700">
                <span>Fuel Points Unit</span>
                <select
                  className="h-11 w-full rounded-md border border-slate-300 px-3 text-slate-950 outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-200"
                  onChange={(event) =>
                    updateFuelPointFormField(
                      "fuel_points_unit",
                      event.target.value,
                    )
                  }
                  value={fuelPointForm.fuel_points_unit}
                >
                  <option value="100">100</option>
                  <option value="1000">1,000</option>
                </select>
              </label>

              <label className="space-y-2 text-sm font-medium text-slate-700">
                <span>Expiration / Cycle Date</span>
                <input
                  className="h-11 w-full rounded-md border border-slate-300 px-3 text-slate-950 outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-200"
                  onChange={(event) =>
                    updateFuelPointFormField("expires_on", event.target.value)
                  }
                  type="date"
                  value={fuelPointForm.expires_on}
                />
              </label>

              <label className="space-y-2 text-sm font-medium text-slate-700">
                <span>Multiplier</span>
                <input
                  className="h-11 w-full rounded-md border border-slate-300 px-3 text-slate-950 outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-200"
                  min="0"
                  onChange={(event) =>
                    updateFuelPointFormField("multiplier", event.target.value)
                  }
                  step="1"
                  type="number"
                  value={fuelPointForm.multiplier}
                />
              </label>

              <label className="space-y-2 text-sm font-medium text-slate-700">
                <span>Qualifying Spend</span>
                <input
                  className="h-11 w-full rounded-md border border-slate-300 px-3 text-slate-950 outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-200"
                  min="0"
                  onChange={(event) =>
                    updateFuelPointFormField(
                      "qualifying_spend",
                      event.target.value,
                    )
                  }
                  step="0.01"
                  type="number"
                  value={fuelPointForm.qualifying_spend}
                />
              </label>

              <div className="space-y-2 text-sm font-medium text-slate-700">
                <span>Total Points</span>
                <div className="flex h-11 items-center rounded-md border border-slate-200 bg-slate-50 px-3 text-slate-700">
                  {correctionFuelPointsQuantity
                    ? `${correctionFuelPointsQuantity.toLocaleString()} points`
                    : "Enter amount and unit"}
                </div>
              </div>

              <label className="space-y-2 text-sm font-medium text-slate-700 sm:col-span-2">
                <span>Notes</span>
                <textarea
                  className="min-h-24 w-full rounded-md border border-slate-300 px-3 py-2 text-slate-950 outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-200"
                  onChange={(event) =>
                    updateFuelPointFormField(
                      "fuel_points_notes",
                      event.target.value,
                    )
                  }
                  value={fuelPointForm.fuel_points_notes}
                />
              </label>
            </div>

            <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <button
                className="h-11 rounded-md border border-slate-300 px-4 text-sm font-medium text-slate-700 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:text-slate-400"
                disabled={isSavingFuelPoints}
                onClick={closeFuelPointEditor}
                type="button"
              >
                Cancel
              </button>
              <button
                className="h-11 rounded-md bg-slate-900 px-4 text-sm font-semibold text-white transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:bg-slate-400"
                disabled={isSavingFuelPoints || isLoadingFuelAccounts}
                type="submit"
              >
                {isSavingFuelPoints ? "Saving..." : "Save Fuel Points"}
              </button>
            </div>
          </form>
        </div>
      ) : null}

      {isEditingFinancials ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/40 px-4 py-6 sm:items-center">
          <form
            className="max-h-[calc(100vh-3rem)] w-full max-w-2xl overflow-y-auto rounded-lg bg-white p-5 shadow-xl"
            onSubmit={handleFinancialSave}
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-lg font-semibold">
                  Edit Financial Details
                </h2>
                <p className="mt-1 text-sm text-slate-500">
                  Total paid is receipt/payment context. Gift card cost is managed on each card.
                </p>
              </div>
              <button
                className="h-10 rounded-md border border-slate-300 px-4 text-sm font-medium text-slate-700 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:text-slate-400"
                disabled={isSavingFinancials}
                onClick={closeFinancialEditor}
                type="button"
              >
                Close
              </button>
            </div>

            {financialError ? (
              <div className="mt-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-800">
                {financialError}
              </div>
            ) : null}

            <div className="mt-5 grid gap-4 sm:grid-cols-2">
              <label className="space-y-2 text-sm font-medium text-slate-700">
                <span>Total Paid</span>
                <input
                  className="h-11 w-full rounded-md border border-slate-300 px-3 text-slate-950 outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-200"
                  min="0"
                  onChange={(event) =>
                    updateFinancialFormField(
                      "purchase_total_paid",
                      event.target.value,
                    )
                  }
                  step="0.01"
                  type="number"
                  value={financialForm.purchase_total_paid}
                />
              </label>

              <label className="space-y-2 text-sm font-medium text-slate-700">
                <span>Sales Tax</span>
                <input
                  className="h-11 w-full rounded-md border border-slate-300 px-3 text-slate-950 outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-200"
                  min="0"
                  onChange={(event) =>
                    updateFinancialFormField("sales_tax", event.target.value)
                  }
                  step="0.01"
                  type="number"
                  value={financialForm.sales_tax}
                />
              </label>

              <label className="space-y-2 text-sm font-medium text-slate-700">
                <span>Activation Fees</span>
                <input
                  className="h-11 w-full rounded-md border border-slate-300 px-3 text-slate-950 outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-200"
                  min="0"
                  onChange={(event) =>
                    updateFinancialFormField(
                      "activation_fees",
                      event.target.value,
                    )
                  }
                  step="0.01"
                  type="number"
                  value={financialForm.activation_fees}
                />
              </label>

              <label className="space-y-2 text-sm font-medium text-slate-700">
                <span>Discounts</span>
                <input
                  className="h-11 w-full rounded-md border border-slate-300 px-3 text-slate-950 outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-200"
                  min="0"
                  onChange={(event) =>
                    updateFinancialFormField("discounts", event.target.value)
                  }
                  step="0.01"
                  type="number"
                  value={financialForm.discounts}
                />
              </label>

              {storeEarnsFuelPoints ? (
                <div className="space-y-2 text-sm font-medium text-slate-700">
                  <span>Fuel Points</span>
                  <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
                    <input
                      className="h-11 w-full rounded-md border border-slate-300 px-3 text-slate-950 outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-200"
                      min="0"
                      onChange={(event) =>
                        updateFinancialFormField(
                          "fuel_points_amount",
                          event.target.value,
                        )
                      }
                      step="1"
                      type="number"
                      value={financialForm.fuel_points_amount}
                    />
                    <select
                      className="h-11 rounded-md border border-slate-300 px-3 text-slate-950 outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-200"
                      onChange={(event) =>
                        updateFinancialFormField(
                          "fuel_points_unit",
                          event.target.value,
                        )
                      }
                      value={financialForm.fuel_points_unit}
                    >
                      <option value="100">100</option>
                      <option value="1000">1,000</option>
                    </select>
                  </div>
                  <p className="text-xs text-slate-500">
                    Total:{" "}
                    {financialFuelPointsQuantity
                      ? `${financialFuelPointsQuantity.toLocaleString()} points`
                      : ""}
                  </p>
                </div>
              ) : null}

              <label className="space-y-2 text-sm font-medium text-slate-700 sm:col-span-2">
                <span>Financial Notes</span>
                <textarea
                  className="min-h-28 w-full rounded-md border border-slate-300 px-3 py-2 text-slate-950 outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-200"
                  onChange={(event) =>
                    updateFinancialFormField(
                      "financial_notes",
                      event.target.value,
                    )
                  }
                  value={financialForm.financial_notes}
                />
              </label>
            </div>

            <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <button
                className="h-11 rounded-md border border-slate-300 px-4 text-sm font-medium text-slate-700 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:text-slate-400"
                disabled={isSavingFinancials}
                onClick={closeFinancialEditor}
                type="button"
              >
                Cancel
              </button>
              <button
                className="h-11 rounded-md bg-slate-900 px-4 text-sm font-semibold text-white transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:bg-slate-400"
                disabled={isSavingFinancials}
                type="submit"
              >
                {isSavingFinancials ? "Saving..." : "Save Financials"}
              </button>
            </div>
          </form>
        </div>
      ) : null}
    </main>
  );
}

function isGiftCardVerified(giftCard: GiftCard) {
  return (
    giftCard.verification_status === "VERIFIED" ||
    Boolean(giftCard.confirmed_at) ||
    Boolean(
      giftCard.confirmed_card_number ||
        giftCard.confirmed_redemption_code ||
        giftCard.card_number_encrypted,
    )
  );
}

function MoveGiftCardModal({
  cardEndingLabel,
  currentPurchase,
  destinationOptions,
  error,
  giftCard,
  isLoadingDestinations,
  isMoving,
  moveWarnings,
  onCancel,
  onConfirm,
  onDestinationChange,
  purchaseOptionLabel,
  selectedDestination,
  selectedDestinationId,
}: {
  cardEndingLabel: string;
  currentPurchase: PurchaseBatch | null;
  destinationOptions: PurchaseBatch[];
  error: string | null;
  giftCard: GiftCard;
  isLoadingDestinations: boolean;
  isMoving: boolean;
  moveWarnings: string[];
  onCancel: () => void;
  onConfirm: () => void;
  onDestinationChange: (purchaseId: string) => void;
  purchaseOptionLabel: (purchase: PurchaseBatch) => string;
  selectedDestination: PurchaseBatch | null;
  selectedDestinationId: string;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/60 px-4 py-6 sm:items-center">
      <section className="max-h-[calc(100vh-3rem)] w-full max-w-2xl overflow-y-auto rounded-lg bg-white p-5 shadow-xl">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-sm font-medium text-slate-500">
              Move Gift Card
            </p>
            <h2 className="mt-1 text-xl font-semibold text-slate-950">
              Move to another purchase
            </h2>
          </div>
          <button
            className="h-10 rounded-md border border-slate-300 px-4 text-sm font-medium text-slate-700 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:text-slate-400"
            disabled={isMoving}
            onClick={onCancel}
            type="button"
          >
            Close
          </button>
        </div>

        <div className="mt-5 grid gap-3 sm:grid-cols-2">
          <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Card
            </p>
            <p className="mt-2 text-sm font-semibold text-slate-950">
              {giftCard.brand} · {formatModalAmount(giftCard.face_value)}
            </p>
            <p className="mt-1 text-xs text-slate-500">{cardEndingLabel}</p>
          </div>

          <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Current Purchase
            </p>
            <p className="mt-2 text-sm font-semibold text-slate-950">
              {currentPurchase ? purchaseOptionLabel(currentPurchase) : "Loading..."}
            </p>
            {currentPurchase?.credit_card_id ? (
              <p className="mt-1 text-xs text-slate-500">
                Funding card #{currentPurchase.credit_card_id}
              </p>
            ) : null}
          </div>
        </div>

        <label className="mt-5 block space-y-2 text-sm font-medium text-slate-700">
          <span>Destination purchase</span>
          <select
            className="h-11 w-full rounded-md border border-slate-300 bg-white px-3 text-slate-950 outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-200"
            disabled={isLoadingDestinations || isMoving}
            onChange={(event) => onDestinationChange(event.target.value)}
            value={selectedDestinationId}
          >
            <option value="">
              {isLoadingDestinations ? "Loading purchases..." : "Select destination"}
            </option>
            {destinationOptions.map((destinationPurchase) => (
              <option key={destinationPurchase.id} value={destinationPurchase.id}>
                {purchaseOptionLabel(destinationPurchase)}
              </option>
            ))}
          </select>
        </label>

        {selectedDestination && moveWarnings.length > 0 ? (
          <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
            <p className="font-semibold">
              Destination differs from the current purchase:
            </p>
            <ul className="mt-1 list-disc space-y-1 pl-5">
              {moveWarnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          </div>
        ) : null}

        {error ? (
          <div className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-700">
            {error}
          </div>
        ) : null}

        <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button
            className="h-11 rounded-md border border-slate-300 px-4 text-sm font-medium text-slate-700 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:text-slate-400"
            disabled={isMoving}
            onClick={onCancel}
            type="button"
          >
            Cancel
          </button>
          <button
            className="h-11 rounded-md bg-slate-900 px-4 text-sm font-semibold text-white transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:bg-slate-400"
            disabled={isMoving || !selectedDestinationId || isLoadingDestinations}
            onClick={onConfirm}
            type="button"
          >
            {isMoving ? "Moving..." : "Confirm Move"}
          </button>
        </div>
      </section>
    </div>
  );
}

function formatModalAmount(value: string | number | null) {
  const amount = Number(value);

  if (Number.isNaN(amount)) {
    return String(value ?? "");
  }

  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(amount);
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

function SummaryMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-slate-200 bg-slate-50 p-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
        {label}
      </p>
      <p className="mt-2 text-xl font-semibold text-slate-950">{value}</p>
    </div>
  );
}
