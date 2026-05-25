"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Component,
  ErrorInfo,
  FormEvent,
  ReactNode,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { API_BASE_URL } from "@/lib/api";

type RewardProgram = {
  id: number;
  name: string;
  short_code: string;
  category: string;
  active: boolean;
};

type CreditCard = {
  id: number;
  player_id: number | null;
  player: Player | null;
  nickname: string;
  issuer: string;
  network: string | null;
  last_four: string | null;
  credit_limit: string | number;
  current_balance: string | number | null;
  statement_balance: string | number | null;
  statement_paid_amount: string | number | null;
  statement_remaining: string | number | null;
  minimum_payment_due: string | number | null;
  minimum_payment_paid: boolean;
  payment_due_date: string | null;
  next_statement_close_date: string | null;
  preferred_utilization: string | number | null;
  payment_needed_for_preferred_utilization: string | number | null;
  statement_close_day: number | null;
  payment_due_day: number | null;
  signup_bonus_spend: string | number | null;
  signup_bonus_deadline: string | null;
  current_spend_progress: string | number;
  reward_program_id: number | null;
  reward_program: RewardProgram | null;
  reward_rules: RewardRule[];
  rewards_type: string;
  rewards_rate: string | number | null;
  is_active: boolean;
  notes: string | null;
  utilization_percent: number | null;
  msr_remaining: string | number | null;
  days_until_statement_close: number | null;
  days_until_payment_due: number | null;
};

type AppSettings = {
  multi_player_mode_enabled: boolean;
};

type Player = {
  id: number;
  label: string;
  name: string | null;
  active: boolean;
};

type SpendingCategory = {
  id: number;
  key: string;
  name: string;
  active?: boolean;
};

type Store = {
  id: number;
  name: string;
  merchant_type: string | null;
  merchant_category: string | null;
  active: boolean;
};

type RewardRule = {
  id: number;
  spending_category_id: number;
  store_id: number | null;
  reward_program_id: number | null;
  reward_type: string;
  merchant_type: string | null;
  multiplier: string | number;
  value: string | number | null;
  priority: number;
  active: boolean;
  effective_start_date: string;
  effective_end_date: string | null;
  notes: string | null;
  spending_category: SpendingCategory;
  reward_program: RewardProgram | null;
  store: Store | null;
};

type RewardRuleDraft = {
  local_id: string;
  id: number | null;
  spending_category_id: string;
  reward_type: string;
  merchant_type: string;
  store_id: string;
  reward_program_id: string;
  multiplier: string;
  value: string;
  priority: string;
  effective_start_date: string;
  active: boolean;
  notes: string;
};

type CardForm = {
  player_id: string;
  nickname: string;
  issuer: string;
  network: string;
  last_four: string;
  credit_limit: string;
  current_balance: string;
  statement_close_day: string;
  payment_due_day: string;
  signup_bonus_spend: string;
  signup_bonus_deadline: string;
  current_spend_progress: string;
  reward_program_id: string;
  rewards_rate: string;
  notes: string;
};

const emptyForm: CardForm = {
  player_id: "",
  nickname: "",
  issuer: "",
  network: "",
  last_four: "",
  credit_limit: "",
  current_balance: "",
  statement_close_day: "",
  payment_due_day: "",
  signup_bonus_spend: "",
  signup_bonus_deadline: "",
  current_spend_progress: "0",
  reward_program_id: "",
  rewards_rate: "",
  notes: "",
};

const NETWORK_OPTIONS = [
  "Visa",
  "Mastercard",
  "American Express",
  "Discover",
  "Other",
];

const REWARD_TYPE_OPTIONS = [
  { value: "points_multiplier", label: "Points Multiplier" },
  { value: "cashback_percent", label: "Cashback %" },
  { value: "instant_discount_percent", label: "Instant Discount %" },
  { value: "statement_credit", label: "Statement Credit" },
  { value: "none", label: "None" },
];

const MERCHANT_TYPE_OPTIONS = [
  "target",
  "lowes",
  "costco",
  "kroger",
  "speedway",
  "wholesale",
  "grocery",
  "fuel",
  "retail",
];

class CreditCardsRenderBoundary extends Component<
  { children: ReactNode },
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[CreditCards] caught render error", error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <main className="min-h-screen bg-slate-50 px-4 py-8 text-slate-950 sm:px-6 lg:px-8">
          <section className="mx-auto max-w-4xl rounded-lg border border-red-200 bg-red-50 p-4 text-sm font-medium text-red-700">
            Credit Cards failed to render: {this.state.error.message}
          </section>
        </main>
      );
    }

    return this.props.children;
  }
}

class CreditCardModalBoundary extends Component<
  { children: ReactNode; onClose: () => void },
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[CreditCardsModal] caught render error", error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm font-medium text-red-700 shadow-xl">
          <p>Credit card modal failed to render: {this.state.error.message}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              className="h-9 rounded-md border border-red-200 bg-white px-3 text-xs font-semibold text-red-700"
              onClick={this.props.onClose}
              type="button"
            >
              Close
            </button>
            <button
              className="h-9 rounded-md bg-red-700 px-3 text-xs font-semibold text-white"
              onClick={() => window.location.reload()}
              type="button"
            >
              Reload
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

function useRenderLoopDiagnostics(name: string, extra?: Record<string, unknown>) {
  const countRef = useRef(0);
  const windowStartRef = useRef<number | null>(null);

  useEffect(() => {
    const now = Date.now();
    if (windowStartRef.current === null || now - windowStartRef.current > 2000) {
      windowStartRef.current = now;
      countRef.current = 1;
      return;
    }

    countRef.current += 1;
    if (countRef.current > 25) {
      console.warn(`[${name}] high render count`, {
        renders: countRef.current,
        windowMs: now - windowStartRef.current,
        ...extra,
      });
    }
  });
}

async function responseError(response: Response, fallback: string) {
  const body = await response.text().catch(() => "");
  return `${fallback} at ${response.url} (${response.status})${
    body ? `: ${body}` : ""
  }`;
}

function formatAmount(value: string | number | null) {
  if (value === null || value === "") {
    return "-";
  }

  const amount = Number(value);

  if (Number.isNaN(amount)) {
    return String(value);
  }

  return amount.toLocaleString(undefined, {
    style: "currency",
    currency: "USD",
  });
}

function formatPercent(value: number | null) {
  if (value === null) {
    return "-";
  }

  return `${Math.round(value)}%`;
}

function getProgress(card: CreditCard) {
  const target = Number(card.signup_bonus_spend ?? 0);
  const current = Number(card.current_spend_progress ?? 0);

  if (!target || Number.isNaN(target)) {
    return 0;
  }

  return Math.min(100, Math.round((current / target) * 100));
}

function isDeadlineSoon(value: string | null) {
  if (!value) {
    return false;
  }

  const deadline = new Date(`${value}T00:00:00`);
  const today = new Date();
  const days = Math.ceil(
    (deadline.getTime() - today.getTime()) / (1000 * 60 * 60 * 24),
  );

  return days >= 0 && days <= 30;
}

export default function CreditCardsPage() {
  return (
    <CreditCardsRenderBoundary>
      <Suspense
        fallback={
          <main className="min-h-screen bg-slate-50 px-4 py-8 text-slate-950 sm:px-6 lg:px-8">
            <div className="mx-auto max-w-7xl rounded-lg border border-slate-200 bg-white p-6 text-slate-600 shadow-sm">
              Loading credit cards...
            </div>
          </main>
        }
      >
        <CreditCardsContent />
      </Suspense>
    </CreditCardsRenderBoundary>
  );
}

function focusLabel(focus: string | null) {
  if (focus === "utilization") {
    return "Showing credit utilization exposure";
  }
  if (focus === "statement_balances") {
    return "Showing cards with outstanding statement balances";
  }
  return null;
}

function statementBalanceOutstanding(card: CreditCard) {
  return (
    Number(card.statement_remaining ?? 0) > 0 ||
    Number(card.statement_balance ?? 0) > 0 ||
    Number(card.minimum_payment_due ?? 0) > 0
  );
}

function isPaymentDueSoon(card: CreditCard) {
  return (
    card.days_until_payment_due !== null &&
    card.days_until_payment_due >= 0 &&
    card.days_until_payment_due <= 7
  );
}

function isPaymentOverdue(card: CreditCard) {
  return card.days_until_payment_due !== null && card.days_until_payment_due < 0;
}

function utilizationThreshold(card: CreditCard) {
  return Number(card.preferred_utilization ?? 30);
}

function aggregateUtilization(cards: CreditCard[]) {
  const creditLimit = cards.reduce(
    (total, card) => total + Number(card.credit_limit ?? 0),
    0,
  );
  const balance = cards.reduce(
    (total, card) => total + Number(card.current_balance ?? 0),
    0,
  );

  if (creditLimit <= 0) {
    return null;
  }

  return (balance / creditLimit) * 100;
}

function formatRuleValue(rule: RewardRule) {
  if (rule.reward_type === "points" || rule.reward_type === "points_multiplier") {
    return `${Number(rule.multiplier).toFixed(Number(rule.multiplier) % 1 === 0 ? 0 : 1)}x`;
  }
  if (rule.reward_type === "none") {
    return "no rewards";
  }
  const suffix =
    rule.reward_type === "cashback_percent" ||
    rule.reward_type === "instant_discount_percent" ||
    rule.reward_type === "purchase_discount"
      ? "%"
      : "";
  return `${Number(rule.value ?? 0).toFixed(Number(rule.value ?? 0) % 1 === 0 ? 0 : 2)}${suffix}`;
}

function todayIsoDate() {
  return new Date().toISOString().slice(0, 10);
}

function normalizeRewardRuleType(value: string) {
  return value === "points" ? "points_multiplier" : value;
}

function apiRewardRuleType(value: string) {
  return value === "points_multiplier" ? "points" : value;
}

function makeLocalId() {
  return typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function newRewardRuleDraft(
  cardRewardProgramId: number | string | null = null,
): RewardRuleDraft {
  return {
    local_id: `new-${makeLocalId()}`,
    id: null,
    spending_category_id: "",
    reward_type: "points_multiplier",
    merchant_type: "",
    store_id: "",
    reward_program_id:
      cardRewardProgramId === null || cardRewardProgramId === ""
        ? ""
        : String(cardRewardProgramId),
    multiplier: "",
    value: "",
    priority: "100",
    effective_start_date: todayIsoDate(),
    active: true,
    notes: "",
  };
}

function rewardRuleToDraft(rule: RewardRule, cardRewardProgramId: number | null) {
  const rewardType = normalizeRewardRuleType(rule.reward_type);
  return {
    local_id: `existing-${rule.id}`,
    id: rule.id,
    spending_category_id: String(rule.spending_category_id),
    reward_type: rewardType,
    merchant_type: rule.merchant_type ?? "",
    store_id: rule.store_id === null ? "" : String(rule.store_id),
    reward_program_id:
      rewardType !== "points_multiplier"
        ? ""
        : rule.reward_program_id === null
        ? cardRewardProgramId === null
          ? ""
          : String(cardRewardProgramId)
        : String(rule.reward_program_id),
    multiplier: String(rule.multiplier ?? ""),
    value: rule.value === null ? "" : String(rule.value),
    priority: String(rule.priority ?? 100),
    effective_start_date: rule.effective_start_date ?? todayIsoDate(),
    active: rule.active,
    notes: rule.notes ?? "",
  };
}

function rewardRulePayload(
  rule: RewardRuleDraft,
  cardRewardProgramId: string,
  fallbackCategoryId: string,
) {
  const rewardType = apiRewardRuleType(rule.reward_type);
  return {
    spending_category_id: Number(rule.spending_category_id || fallbackCategoryId),
    reward_type: rewardType,
    multiplier:
      rewardType === "points"
        ? rule.multiplier || rule.value
        : rewardType === "none"
          ? "0"
          : null,
    value:
      rewardType === "points"
        ? rule.value || rule.multiplier
        : rewardType === "none"
          ? "0"
          : rule.value,
    merchant_type: rule.merchant_type.trim() || null,
    store_id: rule.store_id ? Number(rule.store_id) : null,
    reward_program_id:
      rewardType === "points"
        ? rule.reward_program_id
          ? Number(rule.reward_program_id)
          : cardRewardProgramId
            ? Number(cardRewardProgramId)
            : null
        : null,
    priority: rule.priority ? Number(rule.priority) : 100,
    effective_start_date: rule.effective_start_date || todayIsoDate(),
    active: rule.active,
    notes: rule.notes.trim() || null,
  };
}

function rewardTypeLabel(value: string) {
  return (
    REWARD_TYPE_OPTIONS.find((option) => option.value === normalizeRewardRuleType(value))
      ?.label ?? value.replaceAll("_", " ")
  );
}

function isAdvancedRewardRule(rule: RewardRuleDraft) {
  return (
    rule.reward_type !== "points_multiplier" ||
    Boolean(rule.merchant_type.trim()) ||
    Boolean(rule.store_id) ||
    rule.active === false
  );
}

function rewardRuleSummary(card: CreditCard) {
  const activeRules = (card.reward_rules ?? [])
    .filter((rule) => rule.active && rule.effective_end_date === null)
    .sort((first, second) => first.priority - second.priority);

  if (activeRules.length === 0) {
    return card.rewards_rate ? `${card.rewards_rate}x legacy default` : "No rules configured";
  }

  const baseRules = activeRules.filter(
    (rule) =>
      rule.spending_category.key === "general" &&
      !rule.merchant_type,
  );
  const categoryRules = activeRules.filter(
    (rule) =>
      rule.spending_category.key !== "general" &&
      !rule.merchant_type &&
      rule.reward_type === "points",
  );
  const merchantRules = activeRules.filter((rule) => rule.merchant_type);
  const parts: string[] = [];

  if (baseRules[0]) {
    parts.push(`${formatRuleValue(baseRules[0])} base`);
  }

  const groupedCategories = new Map<string, string[]>();
  for (const rule of categoryRules) {
    const value = formatRuleValue(rule);
    groupedCategories.set(value, [
      ...(groupedCategories.get(value) ?? []),
      rule.spending_category.name.toLowerCase(),
    ]);
  }
  for (const [value, categories] of groupedCategories) {
    parts.push(`${value} ${categories.join("/")}`);
  }

  for (const rule of merchantRules.slice(0, 3)) {
    const merchant = rule.merchant_type?.replaceAll("_", " ") ?? "merchant";
    const label =
      rule.reward_type === "instant_discount_percent" ||
      rule.reward_type === "purchase_discount"
        ? "instant discount"
        : rule.reward_type === "none"
          ? "no rewards"
          : rule.reward_type.replaceAll("_", " ");
    parts.push(`${formatRuleValue(rule)} ${merchant} ${label}`);
  }

  return parts.length > 0 ? parts.join(", ") : `${activeRules.length} reward rules`;
}

function CreditCardsContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const focus = searchParams.get("focus");
  const [cards, setCards] = useState<CreditCard[]>([]);
  const [rewardPrograms, setRewardPrograms] = useState<RewardProgram[]>([]);
  const [players, setPlayers] = useState<Player[]>([]);
  const [spendingCategories, setSpendingCategories] = useState<SpendingCategory[]>([]);
  const [stores, setStores] = useState<Store[]>([]);
  const [isMultiPlayerModeEnabled, setIsMultiPlayerModeEnabled] = useState(false);
  const [form, setForm] = useState<CardForm>(emptyForm);
  const [rewardRuleDrafts, setRewardRuleDrafts] = useState<RewardRuleDraft[]>([]);
  const [deletedRewardRuleIds, setDeletedRewardRuleIds] = useState<number[]>([]);
  const [isAdvancedRulesOpen, setIsAdvancedRulesOpen] = useState(false);
  const [editingCard, setEditingCard] = useState<CreditCard | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const hasLoadedRef = useRef(false);
  useRenderLoopDiagnostics("CreditCards", {
    isLoading,
    cardCount: cards.length,
    hasError: Boolean(error),
  });

  const activeCards = useMemo(() => {
    const filteredCards = cards.filter((card) => card.is_active);

    if (focus === "statement_balances") {
      return filteredCards
        .filter(statementBalanceOutstanding)
        .sort((first, second) => {
          const firstUrgency = first.days_until_payment_due ?? 9999;
          const secondUrgency = second.days_until_payment_due ?? 9999;
          if (firstUrgency !== secondUrgency) {
            return firstUrgency - secondUrgency;
          }
          return (
            Number(second.statement_remaining ?? second.statement_balance ?? 0) -
            Number(first.statement_remaining ?? first.statement_balance ?? 0)
          );
        });
    }

    if (focus === "utilization") {
      return filteredCards.sort(
        (first, second) =>
          Number(second.utilization_percent ?? 0) -
          Number(first.utilization_percent ?? 0),
      );
    }

    return filteredCards;
  }, [cards, focus]);
  const aggregateUtilizationPercent = useMemo(
    () => aggregateUtilization(cards.filter((card) => card.is_active)),
    [cards],
  );
  const focusMessage = focusLabel(focus);
  const activePlayers = useMemo(
    () => players.filter((player) => player.active),
    [players],
  );
  const generalCategoryId = useMemo(() => {
    const generalCategory = spendingCategories.find(
      (category) =>
        category.key.toLowerCase() === "general" ||
        category.name.toLowerCase() === "general",
    );
    return generalCategory ? String(generalCategory.id) : "";
  }, [spendingCategories]);
  const simpleRewardRules = useMemo(
    () => rewardRuleDrafts.filter((rule) => !isAdvancedRewardRule(rule)),
    [rewardRuleDrafts],
  );
  const advancedRewardRules = useMemo(
    () => rewardRuleDrafts.filter(isAdvancedRewardRule),
    [rewardRuleDrafts],
  );
  const activeMerchantTypes = useMemo(
    () =>
      new Set(
        stores
          .filter((store) => store.active && store.merchant_type)
          .map((store) => store.merchant_type?.toLowerCase()),
      ),
    [stores],
  );

  const loadCards = useCallback(async () => {
    console.info("[CreditCards] fetch start");
    setIsLoading(true);
    setError(null);

    try {
      const [
        cardsResponse,
        programsResponse,
        settingsResponse,
        playersResponse,
        categoriesResponse,
        storesResponse,
      ] =
        await Promise.all([
          fetch(`${API_BASE_URL}/credit-cards`),
          fetch(
            `${API_BASE_URL}/reward-programs/?active_only=true&eligible_for_credit_cards=true&include_protection=false`,
          ),
          fetch(`${API_BASE_URL}/app-settings`),
          fetch(`${API_BASE_URL}/players/`),
          fetch(`${API_BASE_URL}/spending-categories/`),
          fetch(`${API_BASE_URL}/stores/`),
        ]);

      if (!cardsResponse.ok) {
        throw new Error(
          await responseError(cardsResponse, "Failed to load credit cards"),
        );
      }
      if (!programsResponse.ok) {
        throw new Error(
          await responseError(programsResponse, "Failed to load reward programs"),
        );
      }
      if (!settingsResponse.ok) {
        throw new Error(
          await responseError(settingsResponse, "Failed to load app settings"),
        );
      }
      if (!playersResponse.ok) {
        throw new Error(await responseError(playersResponse, "Failed to load players"));
      }
      if (!categoriesResponse.ok) {
        throw new Error(
          await responseError(categoriesResponse, "Failed to load spending categories"),
        );
      }
      if (!storesResponse.ok) {
        throw new Error(await responseError(storesResponse, "Failed to load stores"));
      }

      const cardsData = (await cardsResponse.json()) as CreditCard[];
      const programsData = (await programsResponse.json()) as RewardProgram[];
      console.info("[CreditCards] parsed response shape", {
        cardsIsArray: Array.isArray(cardsData),
        cardCount: Array.isArray(cardsData) ? cardsData.length : null,
        programsIsArray: Array.isArray(programsData),
        programCount: Array.isArray(programsData) ? programsData.length : null,
      });
      setCards(cardsData);
      setRewardPrograms(programsData);
      const settings = (await settingsResponse.json()) as AppSettings;
      setIsMultiPlayerModeEnabled(settings.multi_player_mode_enabled);
      setPlayers((await playersResponse.json()) as Player[]);
      setSpendingCategories((await categoriesResponse.json()) as SpendingCategory[]);
      setStores((await storesResponse.json()) as Store[]);
      console.info("[CreditCards] state updated", {
        cardCount: cardsData.length,
        programCount: programsData.length,
      });
    } catch (err) {
      console.error("[CreditCards] fetch failed", err);
      setError(err instanceof Error ? err.message : "Failed to load cards.");
    } finally {
      console.info("[CreditCards] fetch end");
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    console.info("[CreditCards] mount");
    if (!hasLoadedRef.current) {
      hasLoadedRef.current = true;
      void loadCards();
    }
    return () => {
      console.info("[CreditCards] unmount");
    };
  }, [loadCards]);

  useEffect(() => {
    console.info("[CreditCards] render state", {
      isLoading,
      cardCount: cards.length,
      rewardProgramCount: rewardPrograms.length,
      playerCount: players.length,
      categoryCount: spendingCategories.length,
      storeCount: stores.length,
      hasError: Boolean(error),
    });
  }, [
    cards.length,
    error,
    isLoading,
    players.length,
    rewardPrograms.length,
    spendingCategories.length,
    stores.length,
  ]);

  const closeCreditCardModal = useCallback(() => {
    console.info("[CreditCardsModal] close/reset");
    setIsModalOpen(false);
    setEditingCard(null);
    setForm(emptyForm);
    setRewardRuleDrafts([]);
    setDeletedRewardRuleIds([]);
    setIsAdvancedRulesOpen(false);
    setIsSaving(false);
  }, []);

  useEffect(() => {
    if (!isModalOpen) {
      return;
    }

    console.info("[CreditCardsModal] open");

    function handleKeydown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        closeCreditCardModal();
      }
    }

    function handlePopState() {
      console.info("[CreditCardsModal] popstate close");
      closeCreditCardModal();
    }

    window.addEventListener("keydown", handleKeydown);
    window.addEventListener("popstate", handlePopState);

    return () => {
      console.info("[CreditCardsModal] cleanup");
      window.removeEventListener("keydown", handleKeydown);
      window.removeEventListener("popstate", handlePopState);
    };
  }, [closeCreditCardModal, isModalOpen]);

  function openCreateModal() {
    setEditingCard(null);
    setForm({
      ...emptyForm,
      player_id: activePlayers.length === 1 ? String(activePlayers[0].id) : "",
    });
    setRewardRuleDrafts([]);
    setDeletedRewardRuleIds([]);
    setIsAdvancedRulesOpen(false);
    setIsModalOpen(true);
  }

  function openEditModal(card: CreditCard) {
    setEditingCard(card);
    setForm({
      nickname: card.nickname,
      player_id: card.player_id === null ? "" : String(card.player_id),
      issuer: card.issuer,
      network: card.network ?? "",
      last_four: card.last_four ?? "",
      credit_limit: String(card.credit_limit),
      current_balance:
        card.current_balance === null ? "" : String(card.current_balance),
      statement_close_day:
        card.statement_close_day === null ? "" : String(card.statement_close_day),
      payment_due_day:
        card.payment_due_day === null ? "" : String(card.payment_due_day),
      signup_bonus_spend:
        card.signup_bonus_spend === null ? "" : String(card.signup_bonus_spend),
      signup_bonus_deadline: card.signup_bonus_deadline ?? "",
      current_spend_progress: String(card.current_spend_progress ?? 0),
      reward_program_id:
        card.reward_program_id === null ? "" : String(card.reward_program_id),
      rewards_rate: card.rewards_rate === null ? "" : String(card.rewards_rate),
      notes: card.notes ?? "",
    });
    setRewardRuleDrafts(
      card.reward_rules.map((rule) => rewardRuleToDraft(rule, card.reward_program_id)),
    );
    setDeletedRewardRuleIds([]);
    setIsAdvancedRulesOpen(card.reward_rules.some((rule) => isAdvancedRewardRule(rewardRuleToDraft(rule, card.reward_program_id))));
    setIsModalOpen(true);
  }

  function updateFormField(field: keyof CardForm, value: string) {
    setForm((currentForm) => ({
      ...currentForm,
      [field]: value,
    }));
  }

  function updateRewardRuleDraft(
    localId: string,
    field: keyof RewardRuleDraft,
    value: string | boolean,
  ) {
    setRewardRuleDrafts((currentDrafts) =>
      currentDrafts.map((rule) => {
        if (rule.local_id !== localId) {
          return rule;
        }

        const nextRule = {
          ...rule,
          [field]: value,
        };

        if (field === "reward_type" && value === "none") {
          nextRule.multiplier = "0";
          nextRule.value = "0";
        }

        return nextRule;
      }),
    );
  }

  function addSimpleRewardRuleDraft() {
    setRewardRuleDrafts((currentDrafts) => [
      ...currentDrafts,
      newRewardRuleDraft(form.reward_program_id),
    ]);
  }

  function addAdvancedRuleDraft(rewardType = "instant_discount_percent") {
    setIsAdvancedRulesOpen(true);
    setRewardRuleDrafts((currentDrafts) => [
      ...currentDrafts,
      {
        ...newRewardRuleDraft(form.reward_program_id),
        spending_category_id: generalCategoryId,
        reward_type: rewardType,
        merchant_type: "",
        store_id: "",
        reward_program_id: "",
        multiplier: "0",
        value: rewardType === "none" ? "0" : "",
        priority: "10",
      },
    ]);
  }

  function removeRewardRuleDraft(rule: RewardRuleDraft) {
    if (rule.id !== null) {
      const ruleId = rule.id;
      setDeletedRewardRuleIds((currentIds) =>
        currentIds.includes(ruleId) ? currentIds : [...currentIds, ruleId],
      );
    }
    setRewardRuleDrafts((currentDrafts) =>
      currentDrafts.filter((currentRule) => currentRule.local_id !== rule.local_id),
    );
  }

  function validateRewardRuleDrafts() {
    for (const rule of rewardRuleDrafts) {
      const hasMerchantOverride = Boolean(rule.merchant_type.trim() || rule.store_id);
      if (!rule.spending_category_id && !hasMerchantOverride) {
        return "Select a category for every reward rule.";
      }

      if (!rule.spending_category_id && !generalCategoryId) {
        return "Create a General spending category before saving merchant-only reward rules.";
      }

      const rewardType = apiRewardRuleType(rule.reward_type);
      if (rewardType === "points" && !rule.multiplier && !rule.value) {
        return "Enter a multiplier for every points rule.";
      }

      if (rewardType !== "points" && rewardType !== "none" && !rule.value) {
        return "Enter a value for every non-points reward rule.";
      }
    }

    return null;
  }

  async function syncRewardRules(cardId: number, cardRewardProgramId: string) {
    for (const ruleId of deletedRewardRuleIds) {
      const response = await fetch(`${API_BASE_URL}/credit-cards/reward-rules/${ruleId}`, {
        method: "DELETE",
      });

      if (!response.ok) {
        throw new Error(
          await responseError(response, "Failed to delete reward rule"),
        );
      }
    }

    for (const rule of rewardRuleDrafts) {
      const response = await fetch(
        rule.id === null
          ? `${API_BASE_URL}/credit-cards/${cardId}/reward-rules`
          : `${API_BASE_URL}/credit-cards/reward-rules/${rule.id}`,
        {
          method: rule.id === null ? "POST" : "PATCH",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(
            rewardRulePayload(rule, cardRewardProgramId, generalCategoryId),
          ),
        },
      );

      if (!response.ok) {
        throw new Error(
          await responseError(response, "Failed to save reward rule"),
        );
      }
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSaving(true);
    setError(null);

    const rewardRuleError = validateRewardRuleDrafts();
    if (rewardRuleError) {
      setError(rewardRuleError);
      setIsSaving(false);
      return;
    }

    const payload = {
      player_id: form.player_id ? Number(form.player_id) : null,
      nickname: form.nickname.trim(),
      issuer: form.issuer.trim(),
      network: form.network.trim() || null,
      last_four: form.last_four.trim() || null,
      credit_limit: form.credit_limit,
      current_balance: form.current_balance || null,
      statement_close_day: form.statement_close_day
        ? Number(form.statement_close_day)
        : null,
      payment_due_day: form.payment_due_day ? Number(form.payment_due_day) : null,
      signup_bonus_spend: form.signup_bonus_spend || null,
      signup_bonus_deadline: form.signup_bonus_deadline || null,
      current_spend_progress: form.current_spend_progress || "0",
      reward_program_id: form.reward_program_id
        ? Number(form.reward_program_id)
        : null,
      rewards_rate: form.rewards_rate || null,
      notes: form.notes.trim() || null,
    };

    try {
      const response = await fetch(
        editingCard
          ? `${API_BASE_URL}/credit-cards/${editingCard.id}`
          : `${API_BASE_URL}/credit-cards`,
        {
          method: editingCard ? "PATCH" : "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(payload),
        },
      );

      if (!response.ok) {
        throw new Error(
          await responseError(response, "Failed to save credit card"),
        );
      }

      const savedCard = (await response.json()) as CreditCard;
      await syncRewardRules(savedCard.id, String(savedCard.reward_program_id ?? ""));
      if (!editingCard) {
        closeCreditCardModal();
        router.push(`/credit-cards/${savedCard.id}`);
        return;
      }
      await loadCards();
      closeCreditCardModal();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save card.");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-8 text-slate-950 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-7xl space-y-6">
        <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-sm font-medium text-slate-500">Funding Sources</p>
            <h1 className="mt-1 text-3xl font-semibold tracking-tight">
              Credit Cards
            </h1>
          </div>
          <button
            className="h-11 cursor-pointer rounded-md bg-slate-950 px-4 text-sm font-semibold text-white transition hover:bg-slate-800 active:bg-slate-900"
            onClick={openCreateModal}
            type="button"
          >
            Add Card
          </button>
        </header>

        {error ? (
          <p className="rounded-md border border-red-200 bg-red-50 p-3 text-sm font-medium text-red-700">
            {error}
          </p>
        ) : null}

        {focusMessage ? (
          <section className="flex flex-col gap-3 rounded-md border border-cyan-200 bg-cyan-50 px-4 py-3 text-sm text-cyan-950 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="font-semibold">{focusMessage}</p>
              {focus === "utilization" ? (
                <p className="mt-1 text-xs">
                  Aggregate utilization:{" "}
                  {aggregateUtilizationPercent === null
                    ? "-"
                    : formatPercent(aggregateUtilizationPercent)}
                </p>
              ) : null}
            </div>
            <Link className="font-semibold hover:underline" href="/credit-cards">
              Clear filter
            </Link>
          </section>
        ) : null}

        {isLoading ? (
          <div className="rounded-lg border border-slate-200 bg-white p-6 text-slate-600 shadow-sm">
            Loading credit cards...
          </div>
        ) : activeCards.length === 0 ? (
          <div className="rounded-lg border border-slate-200 bg-white p-6 text-slate-600 shadow-sm">
            No active credit cards yet.
          </div>
        ) : (
          <section className="grid gap-4 lg:grid-cols-2">
            {activeCards.map((card) => {
              const progress = getProgress(card);
              const utilizationWarning =
                (card.utilization_percent ?? 0) > utilizationThreshold(card);
              const statementSoon =
                card.days_until_statement_close !== null &&
                card.days_until_statement_close <= 5;
              const paymentDueSoon = isPaymentDueSoon(card);
              const paymentOverdue = isPaymentOverdue(card);
              const deadlineSoon = isDeadlineSoon(card.signup_bonus_deadline);

              return (
                <article
                  className={`space-y-4 rounded-lg border bg-white p-5 shadow-sm ${
                    focus === "utilization" && utilizationWarning
                      ? "border-amber-300 ring-2 ring-amber-100"
                      : focus === "statement_balances" &&
                          (paymentOverdue || paymentDueSoon)
                        ? "border-red-300 ring-2 ring-red-100"
                        : "border-slate-200"
                  }`}
                  key={card.id}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h2 className="text-xl font-semibold">{card.nickname}</h2>
                      <p className="text-sm text-slate-500">
                        {card.issuer}
                        {card.network ? ` · ${card.network}` : ""}
                        {card.last_four ? ` · ${card.last_four}` : ""}
                      </p>
                    </div>
                    <button
                      className="h-10 cursor-pointer rounded-md border border-slate-300 px-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-100 active:bg-slate-200"
                      onClick={() => openEditModal(card)}
                      type="button"
                    >
                      Edit
                    </button>
                  </div>

                  <dl className="grid gap-3 text-sm sm:grid-cols-4">
                    <div>
                      <dt className="font-medium text-slate-500">Limit</dt>
                      <dd className="font-semibold">
                        {formatAmount(card.credit_limit)}
                      </dd>
                    </div>
                    <div>
                      <dt className="font-medium text-slate-500">
                        Estimated Balance
                      </dt>
                      <dd className="font-semibold">
                        {formatAmount(card.current_balance)}
                      </dd>
                    </div>
                    <div>
                      <dt className="font-medium text-slate-500">Utilization</dt>
                      <dd
                        className={
                          utilizationWarning
                            ? "font-semibold text-red-700"
                            : "font-semibold"
                        }
                      >
                        {formatPercent(card.utilization_percent)}
                      </dd>
                    </div>
                    <div>
                      <dt className="font-medium text-slate-500">Rewards</dt>
                      <dd className="font-semibold">
                        {card.reward_program
                          ? card.reward_program.name
                          : card.rewards_type}
                      </dd>
                    </div>
                  </dl>

                  <div className="rounded-md border border-slate-200 bg-slate-50 p-3 text-sm">
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                      <div>
                        <p className="font-medium text-slate-500">Rule Summary</p>
                        <p className="mt-1 font-semibold text-slate-950">
                          {rewardRuleSummary(card)}
                        </p>
                      </div>
                      <Link
                        className="inline-flex h-8 shrink-0 items-center justify-center rounded-md border border-slate-300 px-3 text-xs font-semibold text-slate-700 transition hover:bg-white"
                        href={`/credit-cards/${card.id}`}
                      >
                        Manage Rules
                      </Link>
                    </div>
                  </div>

                  {focus === "utilization" ? (
                    <div className="rounded-md border border-slate-200 bg-slate-50 p-3 text-sm">
                      <div className="grid gap-3 sm:grid-cols-3">
                        <div>
                          <p className="font-medium text-slate-500">
                            Preferred Utilization
                          </p>
                          <p className="font-semibold">
                            {formatPercent(utilizationThreshold(card))}
                          </p>
                        </div>
                        <div>
                          <p className="font-medium text-slate-500">
                            Paydown to Preferred
                          </p>
                          <p className="font-semibold">
                            {formatAmount(
                              card.payment_needed_for_preferred_utilization,
                            )}
                          </p>
                        </div>
                        <div>
                          <p className="font-medium text-slate-500">
                            Current Exposure
                          </p>
                          <p
                            className={
                              utilizationWarning
                                ? "font-semibold text-amber-700"
                                : "font-semibold"
                            }
                          >
                            {formatPercent(card.utilization_percent)}
                          </p>
                        </div>
                      </div>
                    </div>
                  ) : null}

                  {focus === "statement_balances" ? (
                    <div className="rounded-md border border-slate-200 bg-slate-50 p-3 text-sm">
                      <div className="grid gap-3 sm:grid-cols-4">
                        <div>
                          <p className="font-medium text-slate-500">
                            Statement Balance
                          </p>
                          <p className="font-semibold">
                            {formatAmount(card.statement_balance)}
                          </p>
                        </div>
                        <div>
                          <p className="font-medium text-slate-500">
                            Amount Paid
                          </p>
                          <p className="font-semibold">
                            {formatAmount(card.statement_paid_amount)}
                          </p>
                        </div>
                        <div>
                          <p className="font-medium text-slate-500">
                            Remaining
                          </p>
                          <p className="font-semibold">
                            {formatAmount(card.statement_remaining)}
                          </p>
                        </div>
                        <div>
                          <p className="font-medium text-slate-500">Due</p>
                          <p
                            className={
                              paymentOverdue
                                ? "font-semibold text-red-700"
                                : paymentDueSoon
                                  ? "font-semibold text-amber-700"
                                  : "font-semibold"
                            }
                          >
                            {card.payment_due_date ?? "Day "}
                            {card.payment_due_date
                              ? ""
                              : card.payment_due_day ?? "-"}
                          </p>
                        </div>
                      </div>
                      <p
                        className={`mt-2 text-xs font-semibold ${
                          paymentOverdue
                            ? "text-red-700"
                            : paymentDueSoon
                              ? "text-amber-700"
                              : "text-slate-500"
                        }`}
                      >
                        Payment due in {card.days_until_payment_due ?? "-"} days
                        {Number(card.minimum_payment_due ?? 0) > 0
                          ? ` · Minimum due ${formatAmount(
                              card.minimum_payment_due,
                            )}`
                          : ""}
                      </p>
                    </div>
                  ) : null}

                  {card.signup_bonus_spend ? (
                    <div>
                      <div className="flex justify-between text-sm">
                        <span className="font-medium text-slate-600">
                          MSR Progress
                        </span>
                        <span>
                          {formatAmount(card.current_spend_progress)} /{" "}
                          {formatAmount(card.signup_bonus_spend)}
                        </span>
                      </div>
                      <div className="mt-2 h-3 overflow-hidden rounded-full bg-slate-100">
                        <div
                          className="h-full rounded-full bg-emerald-600"
                          style={{ width: `${progress}%` }}
                        />
                      </div>
                      <p className="mt-1 text-xs text-slate-500">
                        Remaining: {formatAmount(card.msr_remaining)}
                      </p>
                    </div>
                  ) : null}

                  <div className="flex flex-wrap gap-2 text-xs font-semibold">
                    <span
                      className={`rounded-full px-2 py-1 ${
                        statementSoon
                          ? "bg-amber-100 text-amber-800"
                          : "bg-slate-100 text-slate-700"
                      }`}
                    >
                      Statement closes in{" "}
                      {card.days_until_statement_close ?? "-"} days
                    </span>
                    <span className="rounded-full bg-slate-100 px-2 py-1 text-slate-700">
                      Payment due in {card.days_until_payment_due ?? "-"} days
                    </span>
                    {deadlineSoon ? (
                      <span className="rounded-full bg-red-100 px-2 py-1 text-red-800">
                        MSR deadline soon
                      </span>
                    ) : null}
                  </div>
                </article>
              );
            })}
          </section>
        )}
      </div>

      {isModalOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/90 p-4">
          <CreditCardModalBoundary onClose={closeCreditCardModal}>
          <div className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-lg bg-white p-5 shadow-xl">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-xl font-semibold">
                {editingCard ? "Edit Credit Card" : "Add Credit Card"}
              </h2>
              <button
                className="h-10 cursor-pointer rounded-md border border-slate-300 px-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-100"
                onClick={closeCreditCardModal}
                type="button"
              >
                Close
              </button>
            </div>

            <form className="mt-5 grid gap-4 sm:grid-cols-2" onSubmit={handleSubmit}>
              {isMultiPlayerModeEnabled ? (
                <label className="space-y-2 text-sm font-medium text-slate-700 sm:col-span-2">
                  <span>Owner / Player</span>
                  <select
                    className="h-11 w-full rounded-md border border-slate-300 px-3 text-slate-950 outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-200"
                    onChange={(event) => updateFormField("player_id", event.target.value)}
                    required={activePlayers.length > 1}
                    value={form.player_id}
                  >
                    <option value="">Select owner</option>
                    {players
                      .filter(
                        (player) =>
                          player.active ||
                          (editingCard !== null &&
                            String(player.id) === form.player_id),
                      )
                      .map((player) => (
                        <option key={player.id} value={player.id}>
                          {player.label}
                          {player.name ? ` · ${player.name}` : ""}
                          {player.active ? "" : " (inactive)"}
                        </option>
                      ))}
                  </select>
                  <p className="text-xs text-slate-500">
                    Required when multiple active players are enabled.
                  </p>
                </label>
              ) : null}

              {([
                ["nickname", "Nickname", "text", true],
                ["issuer", "Issuer", "text", true],
                ["last_four", "Last Four", "text", false],
                ["credit_limit", "Credit Limit", "number", true],
                ["current_balance", "Estimated Balance", "number", false],
                ["statement_close_day", "Statement Close Day", "number", false],
                ["payment_due_day", "Payment Due Day", "number", false],
                ["signup_bonus_spend", "Signup Bonus Spend", "number", false],
                ["signup_bonus_deadline", "Signup Bonus Deadline", "date", false],
                ["current_spend_progress", "Current Spend Progress", "number", false],
                ["rewards_rate", "Rewards Rate", "number", false],
              ] as const).map(([field, label, type, required]) => (
                <label className="space-y-2 text-sm font-medium text-slate-700" key={field}>
                  <span>{label}</span>
                  <input
                    className="h-11 w-full rounded-md border border-slate-300 px-3 text-slate-950 outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-200"
                    min={type === "number" ? "0" : undefined}
                    onChange={(event) => updateFormField(field, event.target.value)}
                    required={required}
                    step={type === "number" ? "0.01" : undefined}
                    type={type}
                    value={form[field]}
                  />
                  {field === "current_balance" ? (
                    <p className="text-xs text-slate-500">
                      This only tracks MS Tracker purchases unless manually
                      updated.
                    </p>
                  ) : null}
                </label>
              ))}

              <label className="space-y-2 text-sm font-medium text-slate-700">
                <span>Network</span>
                <select
                  className="h-11 w-full rounded-md border border-slate-300 px-3 text-slate-950 outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-200"
                  onChange={(event) => updateFormField("network", event.target.value)}
                  value={form.network}
                >
                  <option value="">Select network</option>
                  {NETWORK_OPTIONS.map((network) => (
                    <option key={network} value={network}>
                      {network}
                    </option>
                  ))}
                </select>
              </label>

              <label className="space-y-2 text-sm font-medium text-slate-700">
                <span>Reward Program</span>
                <select
                  className="h-11 w-full rounded-md border border-slate-300 px-3 text-slate-950 outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-200"
                  onChange={(event) => updateFormField("reward_program_id", event.target.value)}
                  value={form.reward_program_id}
                >
                  <option value="">No default program</option>
                  {rewardPrograms.map((program) => (
                    <option key={program.id} value={program.id}>
                      {program.name} ({program.short_code})
                    </option>
                  ))}
                </select>
                <p className="text-xs text-slate-500">
                  Legacy default. Use Manage Rules for base, category, and merchant
                  earning behavior.
                </p>
              </label>

              <section className="space-y-3 rounded-md border border-slate-200 bg-slate-50 p-3 sm:col-span-2">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <h3 className="text-base font-semibold text-slate-950">
                      Reward Rules
                    </h3>
                    <p className="mt-1 text-xs text-slate-500">
                      Set the default earning rate and category multipliers here.
                    </p>
                  </div>
                  <button
                    className="h-9 cursor-pointer rounded-md bg-slate-950 px-3 text-xs font-semibold text-white transition hover:bg-slate-800"
                    onClick={addSimpleRewardRuleDraft}
                    type="button"
                  >
                    Add Category Rate
                  </button>
                </div>

                {simpleRewardRules.length === 0 ? (
                  <p className="rounded-md border border-dashed border-slate-300 bg-white p-3 text-sm text-slate-500">
                    No simple point rules configured.
                  </p>
                ) : (
                  <div className="space-y-3">
                    {simpleRewardRules.map((rule, index) => (
                      <div
                        className="grid gap-3 rounded-md border border-slate-200 bg-white p-3 sm:grid-cols-[1.4fr_1fr_1.4fr_auto]"
                        key={rule.local_id}
                      >
                        <label className="space-y-1 text-sm font-medium text-slate-700">
                          <span>{index === 0 ? "Category" : "Category"}</span>
                          <select
                            className="h-10 w-full rounded-md border border-slate-300 bg-white px-2 text-sm text-slate-950 outline-none focus:border-slate-500 focus:ring-2 focus:ring-slate-200"
                            onChange={(event) =>
                              updateRewardRuleDraft(
                                rule.local_id,
                                "spending_category_id",
                                event.target.value,
                              )
                            }
                            required
                            value={rule.spending_category_id}
                          >
                            <option value="">Select category</option>
                            {spendingCategories
                              .filter(
                                (category) =>
                                  category.active !== false ||
                                  String(category.id) === rule.spending_category_id,
                              )
                              .map((category) => (
                                <option key={category.id} value={category.id}>
                                  {category.name}
                                  {category.active === false ? " (inactive)" : ""}
                                </option>
                              ))}
                          </select>
                        </label>

                        <label className="space-y-1 text-sm font-medium text-slate-700">
                          <span>Multiplier</span>
                          <input
                            className="h-10 w-full rounded-md border border-slate-300 bg-white px-2 text-sm text-slate-950 outline-none focus:border-slate-500 focus:ring-2 focus:ring-slate-200"
                            min="0"
                            onChange={(event) =>
                              updateRewardRuleDraft(
                                rule.local_id,
                                "multiplier",
                                event.target.value,
                              )
                            }
                            required
                            step="0.01"
                            type="number"
                            value={rule.multiplier}
                          />
                        </label>

                        <label className="space-y-1 text-sm font-medium text-slate-700">
                          <span>Program</span>
                          <select
                            className="h-10 w-full rounded-md border border-slate-300 bg-white px-2 text-sm text-slate-950 outline-none focus:border-slate-500 focus:ring-2 focus:ring-slate-200 disabled:bg-slate-100"
                            disabled={rule.reward_type !== "points_multiplier"}
                            onChange={(event) =>
                              updateRewardRuleDraft(
                                rule.local_id,
                                "reward_program_id",
                                event.target.value,
                              )
                            }
                            value={rule.reward_program_id}
                          >
                            <option value="">Card default</option>
                            {rewardPrograms.map((program) => (
                              <option key={program.id} value={program.id}>
                                {program.short_code} · {program.name}
                              </option>
                            ))}
                          </select>
                        </label>

                        <button
                          className="h-10 cursor-pointer self-end rounded-md border border-red-200 px-3 text-xs font-semibold text-red-700 transition hover:bg-red-50"
                          onClick={() => removeRewardRuleDraft(rule)}
                          type="button"
                        >
                          Delete
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                <div className="rounded-md border border-slate-200 bg-white">
                  <button
                    className="flex w-full cursor-pointer items-center justify-between gap-3 px-3 py-2 text-left text-sm font-semibold text-slate-800 transition hover:bg-slate-50"
                    onClick={() => setIsAdvancedRulesOpen((isOpen) => !isOpen)}
                    type="button"
                  >
                    <span>Advanced merchant rules</span>
                    <span className="text-xs text-slate-500">
                      {advancedRewardRules.length} configured
                    </span>
                  </button>

                  {isAdvancedRulesOpen ? (
                    <div className="space-y-3 border-t border-slate-200 p-3">
                      <div className="flex flex-wrap gap-2">
                        <button
                          className="h-9 cursor-pointer rounded-md bg-slate-950 px-3 text-xs font-semibold text-white transition hover:bg-slate-800"
                          onClick={() => addAdvancedRuleDraft("instant_discount_percent")}
                          type="button"
                        >
                          Add Instant Discount Rule
                        </button>
                        <button
                          className="h-9 cursor-pointer rounded-md border border-slate-300 px-3 text-xs font-semibold text-slate-700 transition hover:bg-slate-100"
                          onClick={() => addAdvancedRuleDraft("points_multiplier")}
                          type="button"
                        >
                          Add Merchant Override Rule
                        </button>
                      </div>

                      {advancedRewardRules.length === 0 ? (
                        <p className="rounded-md border border-dashed border-slate-300 bg-slate-50 p-3 text-sm text-slate-500">
                          No advanced merchant rules configured.
                        </p>
                      ) : (
                        <div className="space-y-3">
                          {advancedRewardRules.map((rule) => (
                            <div
                              className="grid gap-3 rounded-md border border-slate-200 bg-slate-50 p-3 sm:grid-cols-2 xl:grid-cols-4"
                              key={rule.local_id}
                            >
                              <label className="space-y-1 text-sm font-medium text-slate-700">
                                <span>Rule Type</span>
                                <select
                                  className="h-10 w-full rounded-md border border-slate-300 bg-white px-2 text-sm text-slate-950 outline-none focus:border-slate-500 focus:ring-2 focus:ring-slate-200"
                                  onChange={(event) =>
                                    updateRewardRuleDraft(
                                      rule.local_id,
                                      "reward_type",
                                      event.target.value,
                                    )
                                  }
                                  value={rule.reward_type}
                                >
                                  {REWARD_TYPE_OPTIONS.map((option) => (
                                    <option key={option.value} value={option.value}>
                                      {option.label}
                                    </option>
                                  ))}
                                </select>
                              </label>

                              <label className="space-y-1 text-sm font-medium text-slate-700">
                                <span>Merchant Type Override</span>
                                <input
                                  className="relative z-50 h-10 w-full rounded-md border border-slate-300 bg-white px-2 text-sm text-slate-950 outline-none focus:border-slate-500 focus:ring-2 focus:ring-slate-200"
                                  list="credit-card-merchant-type-options"
                                  onChange={(event) =>
                                    updateRewardRuleDraft(
                                      rule.local_id,
                                      "merchant_type",
                                      event.target.value,
                                    )
                                  }
                                  placeholder="target, lowes, grocery..."
                                  value={rule.merchant_type}
                                />
                                <p className="text-xs text-slate-500">
                                  Matches any store with this merchant type.
                                </p>
                              </label>

                              {rule.merchant_type.trim() &&
                              !activeMerchantTypes.has(
                                rule.merchant_type.trim().toLowerCase(),
                              ) ? (
                                <p className="self-end rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-800">
                                  Merchant type exists, but no active store currently
                                  uses {rule.merchant_type.trim()}.
                                </p>
                              ) : null}

                              <label className="space-y-1 text-sm font-medium text-slate-700">
                                <span>Value / Rate</span>
                                <input
                                  className="h-10 w-full rounded-md border border-slate-300 bg-white px-2 text-sm text-slate-950 outline-none focus:border-slate-500 focus:ring-2 focus:ring-slate-200"
                                  min="0"
                                  onChange={(event) =>
                                    updateRewardRuleDraft(
                                      rule.local_id,
                                      rule.reward_type === "points_multiplier"
                                        ? "multiplier"
                                        : "value",
                                      event.target.value,
                                    )
                                  }
                                  required={rule.reward_type !== "none"}
                                  step="0.01"
                                  type="number"
                                  value={
                                    rule.reward_type === "points_multiplier"
                                      ? rule.multiplier
                                      : rule.value
                                  }
                                />
                              </label>

                              {rule.reward_type === "points_multiplier" ? (
                                <label className="space-y-1 text-sm font-medium text-slate-700">
                                  <span>Program</span>
                                  <select
                                    className="h-10 w-full rounded-md border border-slate-300 bg-white px-2 text-sm text-slate-950 outline-none focus:border-slate-500 focus:ring-2 focus:ring-slate-200"
                                    onChange={(event) =>
                                      updateRewardRuleDraft(
                                        rule.local_id,
                                        "reward_program_id",
                                        event.target.value,
                                      )
                                    }
                                    value={rule.reward_program_id}
                                  >
                                    <option value="">Card default</option>
                                    {rewardPrograms.map((program) => (
                                      <option key={program.id} value={program.id}>
                                        {program.short_code} · {program.name}
                                      </option>
                                    ))}
                                  </select>
                                </label>
                              ) : (
                                <p className="self-end rounded-md border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-500">
                                  Program not applicable.
                                </p>
                              )}

                              <label className="space-y-1 text-sm font-medium text-slate-700">
                                <span>Specific Store</span>
                                <select
                                  className="relative z-50 h-10 w-full min-w-0 rounded-md border border-slate-300 bg-white px-2 text-sm text-slate-950 outline-none focus:border-slate-500 focus:ring-2 focus:ring-slate-200"
                                  onChange={(event) =>
                                    updateRewardRuleDraft(
                                      rule.local_id,
                                      "store_id",
                                      event.target.value,
                                    )
                                  }
                                  value={rule.store_id}
                                >
                                  <option value="">Any store with merchant type</option>
                                  {stores
                                    .filter(
                                      (store) =>
                                        store.active || String(store.id) === rule.store_id,
                                    )
                                    .map((store) => (
                                      <option key={store.id} value={store.id}>
                                        {store.name}
                                      </option>
                                    ))}
                                </select>
                              </label>

                              <label className="space-y-1 text-sm font-medium text-slate-700">
                                <span>Fallback Category</span>
                                <select
                                  className="h-10 w-full rounded-md border border-slate-300 bg-white px-2 text-sm text-slate-950 outline-none focus:border-slate-500 focus:ring-2 focus:ring-slate-200"
                                  onChange={(event) =>
                                    updateRewardRuleDraft(
                                      rule.local_id,
                                      "spending_category_id",
                                      event.target.value,
                                    )
                                  }
                                  value={rule.spending_category_id}
                                >
                                  <option value="">General/default</option>
                                  {spendingCategories
                                    .filter(
                                      (category) =>
                                        category.active !== false ||
                                        String(category.id) === rule.spending_category_id,
                                    )
                                    .map((category) => (
                                      <option key={category.id} value={category.id}>
                                        {category.name}
                                        {category.active === false ? " (inactive)" : ""}
                                      </option>
                                    ))}
                                </select>
                              </label>

                              <label className="space-y-1 text-sm font-medium text-slate-700">
                                <span>Priority</span>
                                <input
                                  className="h-10 w-full rounded-md border border-slate-300 bg-white px-2 text-sm text-slate-950 outline-none focus:border-slate-500 focus:ring-2 focus:ring-slate-200"
                                  min="1"
                                  onChange={(event) =>
                                    updateRewardRuleDraft(
                                      rule.local_id,
                                      "priority",
                                      event.target.value,
                                    )
                                  }
                                  step="1"
                                  type="number"
                                  value={rule.priority}
                                />
                              </label>

                              <label className="space-y-1 text-sm font-medium text-slate-700">
                                <span>Effective Date</span>
                                <input
                                  className="h-10 w-full rounded-md border border-slate-300 bg-white px-2 text-sm text-slate-950 outline-none focus:border-slate-500 focus:ring-2 focus:ring-slate-200"
                                  onChange={(event) =>
                                    updateRewardRuleDraft(
                                      rule.local_id,
                                      "effective_start_date",
                                      event.target.value,
                                    )
                                  }
                                  type="date"
                                  value={rule.effective_start_date}
                                />
                              </label>

                              <label className="flex h-10 items-center gap-2 self-end text-sm font-medium text-slate-700">
                                <input
                                  checked={rule.active}
                                  className="h-4 w-4 rounded border-slate-300"
                                  onChange={(event) =>
                                    updateRewardRuleDraft(
                                      rule.local_id,
                                      "active",
                                      event.target.checked,
                                    )
                                  }
                                  type="checkbox"
                                />
                                <span>Active</span>
                              </label>

                              <label className="space-y-1 text-sm font-medium text-slate-700 sm:col-span-2 xl:col-span-3">
                                <span>Notes</span>
                                <input
                                  className="h-10 w-full rounded-md border border-slate-300 bg-white px-2 text-sm text-slate-950 outline-none focus:border-slate-500 focus:ring-2 focus:ring-slate-200"
                                  onChange={(event) =>
                                    updateRewardRuleDraft(
                                      rule.local_id,
                                      "notes",
                                      event.target.value,
                                    )
                                  }
                                  placeholder="Optional"
                                  value={rule.notes}
                                />
                              </label>

                              <button
                                className="h-10 cursor-pointer self-end rounded-md border border-red-200 px-3 text-xs font-semibold text-red-700 transition hover:bg-red-50"
                                onClick={() => removeRewardRuleDraft(rule)}
                                type="button"
                              >
                                Delete
                              </button>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  ) : null}
                </div>
                <datalist id="credit-card-merchant-type-options">
                  {MERCHANT_TYPE_OPTIONS.map((merchantType) => (
                    <option key={merchantType} value={merchantType} />
                  ))}
                </datalist>
              </section>

              <label className="space-y-2 text-sm font-medium text-slate-700 sm:col-span-2">
                <span>Notes</span>
                <textarea
                  className="min-h-24 w-full rounded-md border border-slate-300 px-3 py-2 text-slate-950 outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-200"
                  onChange={(event) => updateFormField("notes", event.target.value)}
                  value={form.notes}
                />
              </label>

              <div className="flex justify-end gap-2 sm:col-span-2">
                <button
                  className="h-11 cursor-pointer rounded-md border border-slate-300 px-4 text-sm font-semibold text-slate-700 transition hover:bg-slate-100"
                  onClick={closeCreditCardModal}
                  type="button"
                >
                  Cancel
                </button>
                <button
                  className="h-11 cursor-pointer rounded-md bg-slate-950 px-4 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
                  disabled={isSaving}
                  type="submit"
                >
                  {isSaving ? "Saving..." : "Save Card"}
                </button>
              </div>
            </form>
          </div>
          </CreditCardModalBoundary>
        </div>
      ) : null}
    </main>
  );
}
