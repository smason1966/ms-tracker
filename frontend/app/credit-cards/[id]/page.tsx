"use client";

import Link from "next/link";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";

import { API_BASE_URL } from "@/lib/api";
import { DAY_OF_MONTH_OPTIONS, formatOrdinalDay } from "@/lib/billing-days";

type CreditCard = {
  id: number;
  player_id: number | null;
  player: Player | null;
  issuer_id: number | null;
  issuer_ref: CardIssuer | null;
  network_id: number | null;
  network_ref: CardNetwork | null;
  reward_program_id: number | null;
  reward_program: RewardProgram | null;
  nickname: string;
  issuer: string;
  network: string | null;
  last_four: string | null;
  credit_limit: string | number | null;
  current_balance: string | number | null;
  statement_balance: string | number | null;
  statement_paid_amount: string | number | null;
  statement_remaining: string | number | null;
  available_credit: string | number | null;
  calculated_available_credit: string | number | null;
  reported_utilization: string | number | null;
  minimum_payment_due: string | number | null;
  minimum_payment_paid: boolean;
  autopay_enabled: boolean;
  interest_risk: boolean;
  minimum_payment_missing: boolean;
  payment_due_date: string | null;
  next_statement_close_date: string | null;
  preferred_utilization: string | number | null;
  payment_needed_for_preferred_utilization: string | number | null;
  apr: string | number | null;
  estimated_monthly_interest: string | number | null;
  payment_options: string | null;
  statement_close_day: number | null;
  payment_due_day: number | null;
  opened_date: string | null;
  annual_fee: string | number | null;
  date_last_used: string | null;
  date_last_product_change: string | null;
  date_closed: string | null;
  date_last_cli: string | null;
  signup_bonus_spend: string | number | null;
  signup_bonus_points: number | null;
  signup_bonus_deadline: string | null;
  current_spend_progress: string | number;
  rewards_type: string;
  rewards_rate: string | number | null;
  reward_rules: RewardRule[];
  product_changes: ProductChange[];
  rewards_earned: {
    current_month: string | number;
    ytd: string | number;
    all_time: string | number;
  };
  reward_transactions: RewardTransaction[];
  category_tags: string | null;
  is_active: boolean;
  reports_to_ex: boolean;
  reports_to_tu: boolean;
  reports_to_eq: boolean;
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
  linked_credit_card_count?: number;
};

type RewardProgram = {
  id: number;
  name: string;
  short_code: string;
  category: string;
  active: boolean;
};

type SpendingCategory = {
  id: number;
  key: string;
  name: string;
};

type Store = {
  id: number;
  name: string;
  merchant_type: string | null;
  merchant_category: string | null;
  active: boolean;
};

type CardIssuer = {
  id: number;
  name: string;
  short_name: string | null;
  active: boolean;
  issuer_type: string | null;
};

type CardNetwork = {
  id: number;
  name: string;
  code: string;
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
  effective_start_date: string;
  effective_end_date: string | null;
  active: boolean;
  notes: string | null;
  spending_category: SpendingCategory;
  reward_program: RewardProgram | null;
  store: Store | null;
};

type ProductChange = {
  id: number;
  previous_product_name: string;
  new_product_name: string;
  effective_date: string;
  notes: string | null;
  created_at: string;
};

type RewardTransaction = {
  id: number;
  purchase_id: number;
  purchase_date: string;
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
  notes: string | null;
};

type CardForm = {
  player_id: string;
  reward_program_id: string;
  issuer_id: string;
  network_id: string;
  nickname: string;
  issuer: string;
  network: string;
  last_four: string;
  credit_limit: string;
  no_preset_limit: boolean;
  current_balance: string;
  statement_balance: string;
  statement_paid_amount: string;
  available_credit: string;
  reported_utilization: string;
  minimum_payment_due: string;
  minimum_payment_paid: boolean;
  autopay_enabled: boolean;
  payment_due_date: string;
  next_statement_close_date: string;
  preferred_utilization: string;
  apr: string;
  payment_options: string;
  statement_close_day: string;
  payment_due_day: string;
  opened_date: string;
  annual_fee: string;
  date_last_used: string;
  date_last_product_change: string;
  date_closed: string;
  date_last_cli: string;
  signup_bonus_spend: string;
  signup_bonus_points: string;
  signup_bonus_deadline: string;
  current_spend_progress: string;
  rewards_rate: string;
  category_tags: string;
  reports_to_ex: boolean;
  reports_to_tu: boolean;
  reports_to_eq: boolean;
  is_active: boolean;
  notes: string;
};

type DisplayItem = {
  label: string;
  value: string;
  tone?: "warning" | "danger";
};

type EditableSection =
  | "overview"
  | "defaults"
  | "cycle"
  | "rewards"
  | "bonus"
  | "notes";

type StatementCycleDateField = "payment_due_date" | "next_statement_close_date";

type ParsedDateInput =
  | { ok: true; value: string }
  | { ok: false; message: string };

const REWARD_TYPE_OPTIONS = [
  { value: "points", label: "Points Multiplier" },
  { value: "cashback_percent", label: "Cashback %" },
  { value: "instant_discount_percent", label: "Instant Discount %" },
  { value: "statement_credit", label: "Fixed Credit" },
  { value: "none", label: "None / exclusion" },
];

const NETWORK_CODES = new Set(["VISA", "MASTERCARD", "AMEX", "DISCOVER", "OTHER"]);

function rewardTypeLabel(value: string) {
  if (value === "purchase_discount") {
    return "Instant Discount %";
  }

  return (
    REWARD_TYPE_OPTIONS.find((option) => option.value === value)?.label ??
    value.replaceAll("_", " ")
  );
}

function isInstantDiscountRuleType(value: string) {
  return value === "instant_discount_percent" || value === "purchase_discount";
}

function formatRuleRate(rule: RewardRule) {
  if (rule.reward_type === "points") {
    return `${Number(rule.multiplier).toFixed(1)}x`;
  }

  if (rule.reward_type === "none") {
    return "No rewards";
  }

  if (isInstantDiscountRuleType(rule.reward_type)) {
    return `${Number(rule.value ?? 0).toFixed(
      Number(rule.value ?? 0) % 1 === 0 ? 0 : 2,
    )}% instant discount`;
  }

  return `${Number(rule.value ?? 0).toFixed(2)}${
    rule.reward_type.includes("percent") ? "%" : ""
  }`;
}

function rewardRulePrimaryLabel(rule: RewardRule) {
  if (isInstantDiscountRuleType(rule.reward_type) && rule.store) {
    return `${rule.store.name} · ${formatRuleRate(rule)}`;
  }

  return rule.spending_category.name;
}

function rewardRuleSecondaryLabel(rule: RewardRule, card: CreditCard) {
  if (isInstantDiscountRuleType(rule.reward_type)) {
    return rule.store ? "Store rule · Program not applicable" : "Program not applicable";
  }

  if (rule.reward_type === "points" && rule.reward_program) {
    return `${rewardTypeLabel(rule.reward_type)} · ${rule.reward_program.short_code} · ${rule.reward_program.name}`;
  }

  if (rule.reward_type === "points" && card.reward_program) {
    return `${rewardTypeLabel(rule.reward_type)} · ${card.reward_program.short_code} · ${card.reward_program.name}`;
  }

  return rewardTypeLabel(rule.reward_type);
}

function optionalString(value: string | number | null | undefined) {
  return value === null || value === undefined ? "" : String(value);
}

function wholeDollarFormValue(value: string | number | null | undefined) {
  if (value === null || value === undefined || value === "") {
    return "";
  }

  const amount = Number(value);
  if (!Number.isNaN(amount) && Number.isInteger(amount)) {
    return String(amount);
  }

  return String(value);
}

function formatAmount(value: string | number | null) {
  if (value === null || value === "") {
    return "Not set";
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

function formatCreditLimit(value: string | number | null) {
  if (value === null || value === "") {
    return "No preset limit";
  }

  const amount = Number(value);

  if (Number.isNaN(amount)) {
    return String(value);
  }

  return amount.toLocaleString(undefined, {
    currency: "USD",
    maximumFractionDigits: 0,
    minimumFractionDigits: 0,
    style: "currency",
  });
}

function formatPercent(value: string | number | null) {
  if (value === null || value === "") {
    return "Not set";
  }

  const amount = Number(value);

  if (Number.isNaN(amount)) {
    return String(value);
  }

  return `${amount.toFixed(1)}%`;
}

function formatDate(value: string | null) {
  if (!value) {
    return "Not set";
  }

  const date = new Date(`${value}T00:00:00`);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date);
}

function formatIsoDateForInput(value: string | null | undefined) {
  if (!value) {
    return "";
  }

  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);

  if (!match) {
    return value;
  }

  return `${match[2]}/${match[3]}/${match[1]}`;
}

function statementCycleDateInputsFromForm(form: CardForm) {
  return {
    payment_due_date: formatIsoDateForInput(form.payment_due_date),
    next_statement_close_date: formatIsoDateForInput(
      form.next_statement_close_date,
    ),
  };
}

function normalizeShortYear(year: number) {
  if (year >= 100) {
    return year;
  }

  return year <= 69 ? 2000 + year : 1900 + year;
}

function parseDateInput(
  value: string,
  label: string,
  options: { rejectMoreThanOneYearPast?: boolean } = {},
): ParsedDateInput {
  const trimmedValue = value.trim();

  if (!trimmedValue) {
    return { ok: true, value: "" };
  }

  const isoMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmedValue);
  const separatedMatch = /^(\d{1,2})[/-](\d{1,2})[/-](\d{2}|\d{4})$/.exec(
    trimmedValue,
  );
  const compactValue = trimmedValue.replace(/\s+/g, "");

  let year = isoMatch ? Number(isoMatch[1]) : null;
  let month = isoMatch ? Number(isoMatch[2]) : null;
  let day = isoMatch ? Number(isoMatch[3]) : null;

  if (!isoMatch && separatedMatch) {
    month = Number(separatedMatch[1]);
    day = Number(separatedMatch[2]);
    year = normalizeShortYear(Number(separatedMatch[3]));
  }

  if (!isoMatch && !separatedMatch && /^\d{8}$/.test(compactValue)) {
    month = Number(compactValue.slice(0, 2));
    day = Number(compactValue.slice(2, 4));
    year = Number(compactValue.slice(4, 8));
  }

  if (!isoMatch && !separatedMatch && /^\d{6}$/.test(compactValue)) {
    month = Number(compactValue.slice(0, 2));
    day = Number(compactValue.slice(2, 4));
    year = normalizeShortYear(Number(compactValue.slice(4, 6)));
  }

  if (!isoMatch && !separatedMatch && /^\d{4}$/.test(compactValue)) {
    month = Number(compactValue.slice(0, 1));
    day = Number(compactValue.slice(1, 2));
    year = normalizeShortYear(Number(compactValue.slice(2, 4)));
  }

  if (year === null || month === null || day === null) {
    return {
      ok: false,
      message: `${label} must use a date like MM/DD/YYYY or 06202026.`,
    };
  }

  const date = new Date(year, month - 1, day);
  const isValid =
    date.getFullYear() === year &&
    date.getMonth() === month - 1 &&
    date.getDate() === day;

  if (!isValid) {
    return { ok: false, message: `${label} must be a valid calendar date.` };
  }

  if (options.rejectMoreThanOneYearPast) {
    const oneYearAgo = new Date();
    oneYearAgo.setHours(0, 0, 0, 0);
    oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);

    if (date.getTime() < oneYearAgo.getTime()) {
      return {
        ok: false,
        message: `${label} cannot be more than 1 year in the past.`,
      };
    }
  }

  return {
    ok: true,
    value: `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
  };
}

function formatStatementAmount(value: string | number | null) {
  return value === null || value === "" ? "No current statement" : formatAmount(value);
}

function formatDaysUntil(value: number | null) {
  if (value === null) {
    return "Not set";
  }

  if (value < 0) {
    return `${Math.abs(value)} days overdue`;
  }

  if (value === 0) {
    return "Today";
  }

  return `${value} days`;
}

function toNumber(value: string | number | null) {
  if (value === null || value === "") {
    return 0;
  }

  const amount = Number(value);

  return Number.isNaN(amount) ? 0 : amount;
}

function isPastDate(value: string | null) {
  if (!value) {
    return false;
  }

  const date = new Date(`${value}T23:59:59`);

  return !Number.isNaN(date.getTime()) && date.getTime() < Date.now();
}

function daysUntilDate(value: string | null) {
  if (!value) {
    return null;
  }

  const date = new Date(`${value}T00:00:00`);

  if (Number.isNaN(date.getTime())) {
    return null;
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  return Math.ceil((date.getTime() - today.getTime()) / 86400000);
}

function formatProgressPercent(current: number, target: number) {
  if (target <= 0) {
    return "0.0%";
  }

  return `${Math.min(100, (current / target) * 100).toFixed(1)}%`;
}

function toForm(card: CreditCard): CardForm {
  return {
    player_id: card.player_id === null ? "" : String(card.player_id),
    reward_program_id:
      card.reward_program_id === null ? "" : String(card.reward_program_id),
    issuer_id: card.issuer_id === null ? "" : String(card.issuer_id),
    network_id: card.network_id === null ? "" : String(card.network_id),
    nickname: card.nickname,
    issuer: card.issuer,
    network: card.network ?? "",
    last_four: card.last_four ?? "",
    credit_limit: wholeDollarFormValue(card.credit_limit),
    no_preset_limit: card.credit_limit === null,
    current_balance: optionalString(card.current_balance),
    statement_balance: optionalString(card.statement_balance),
    statement_paid_amount: optionalString(card.statement_paid_amount),
    available_credit: optionalString(card.available_credit),
    reported_utilization: optionalString(card.reported_utilization),
    minimum_payment_due: optionalString(card.minimum_payment_due),
    minimum_payment_paid: card.minimum_payment_paid,
    autopay_enabled: card.autopay_enabled,
    payment_due_date: card.payment_due_date ?? "",
    next_statement_close_date: card.next_statement_close_date ?? "",
    preferred_utilization: optionalString(card.preferred_utilization),
    apr: optionalString(card.apr),
    payment_options: card.payment_options ?? "",
    statement_close_day:
      card.statement_close_day === null ? "" : String(card.statement_close_day),
    payment_due_day:
      card.payment_due_day === null ? "" : String(card.payment_due_day),
    opened_date: card.opened_date ?? "",
    annual_fee: optionalString(card.annual_fee),
    date_last_used: card.date_last_used ?? "",
    date_last_product_change: card.date_last_product_change ?? "",
    date_closed: card.date_closed ?? "",
    date_last_cli: card.date_last_cli ?? "",
    signup_bonus_spend: optionalString(card.signup_bonus_spend),
    signup_bonus_points: optionalString(card.signup_bonus_points),
    signup_bonus_deadline: card.signup_bonus_deadline ?? "",
    current_spend_progress: String(card.current_spend_progress ?? 0),
    rewards_rate: optionalString(card.rewards_rate),
    category_tags: card.category_tags ?? "",
    reports_to_ex: card.reports_to_ex,
    reports_to_tu: card.reports_to_tu,
    reports_to_eq: card.reports_to_eq,
    is_active: card.is_active,
    notes: card.notes ?? "",
  };
}

function buildPayload(form: CardForm) {
  return {
    player_id: form.player_id ? Number(form.player_id) : null,
    reward_program_id: form.reward_program_id
      ? Number(form.reward_program_id)
      : null,
    issuer_id: form.issuer_id ? Number(form.issuer_id) : null,
    network_id: form.network_id ? Number(form.network_id) : null,
    nickname: form.nickname.trim(),
    last_four: form.last_four.trim() || null,
    credit_limit: form.no_preset_limit ? null : form.credit_limit || null,
    current_balance: form.current_balance || null,
    statement_balance: form.statement_balance || null,
    statement_paid_amount: form.statement_paid_amount || null,
    available_credit: form.available_credit || null,
    reported_utilization: form.reported_utilization || null,
    minimum_payment_due: form.minimum_payment_due || null,
    minimum_payment_paid: form.minimum_payment_paid,
    autopay_enabled: form.autopay_enabled,
    payment_due_date: form.payment_due_date || null,
    next_statement_close_date: form.next_statement_close_date || null,
    preferred_utilization: form.preferred_utilization || null,
    apr: form.apr || null,
    payment_options: form.payment_options.trim() || null,
    statement_close_day: form.statement_close_day
      ? Number(form.statement_close_day)
      : null,
    payment_due_day: form.payment_due_day ? Number(form.payment_due_day) : null,
    opened_date: form.opened_date || null,
    annual_fee: form.annual_fee || null,
    date_last_used: form.date_last_used || null,
    date_last_product_change: form.date_last_product_change || null,
    date_closed: form.date_closed || null,
    date_last_cli: form.date_last_cli || null,
    signup_bonus_spend: form.signup_bonus_spend || null,
    signup_bonus_points: form.signup_bonus_points
      ? Number(form.signup_bonus_points)
      : null,
    signup_bonus_deadline: form.signup_bonus_deadline || null,
    current_spend_progress: form.current_spend_progress || "0",
    rewards_rate: form.rewards_rate || null,
    category_tags: form.category_tags.trim() || null,
    reports_to_ex: form.reports_to_ex,
    reports_to_tu: form.reports_to_tu,
    reports_to_eq: form.reports_to_eq,
    is_active: form.is_active,
    notes: form.notes.trim() || null,
  };
}

function DetailSection({
  title,
  items,
  isEditing,
  onEdit,
  children,
}: {
  title: string;
  items: DisplayItem[];
  isEditing?: boolean;
  onEdit?: () => void;
  children?: React.ReactNode;
}) {
  return (
    <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-lg font-semibold text-slate-950">{title}</h2>
        {onEdit ? (
          <button
            className="h-9 cursor-pointer rounded-md border border-slate-300 px-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-100 active:bg-slate-200"
            onClick={onEdit}
            type="button"
          >
            {isEditing ? "Close" : "Edit"}
          </button>
        ) : null}
      </div>
      {isEditing ? (
        <div className="mt-4">{children}</div>
      ) : (
        <dl className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {items.map((item) => (
            <div key={item.label}>
              <dt className="text-sm font-medium text-slate-500">{item.label}</dt>
              <dd
                className={`mt-1 text-base font-semibold ${
                  item.tone === "danger"
                    ? "text-red-700"
                    : item.tone === "warning"
                      ? "text-amber-700"
                      : "text-slate-950"
                }`}
              >
                {item.value}
              </dd>
            </div>
          ))}
        </dl>
      )}
    </section>
  );
}

export default function CreditCardDetailPage() {
  const params = useParams<{ id: string | string[] }>();
  const cardId = Array.isArray(params.id) ? params.id[0] : params.id;
  const [card, setCard] = useState<CreditCard | null>(null);
  const [form, setForm] = useState<CardForm | null>(null);
  const [editingSection, setEditingSection] = useState<EditableSection | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [categories, setCategories] = useState<SpendingCategory[]>([]);
  const [players, setPlayers] = useState<Player[]>([]);
  const [cardIssuers, setCardIssuers] = useState<CardIssuer[]>([]);
  const [cardNetworks, setCardNetworks] = useState<CardNetwork[]>([]);
  const [stores, setStores] = useState<Store[]>([]);
  const generalCategoryId = useMemo(() => {
    const generalCategory = categories.find(
      (category) =>
        category.key.toLowerCase() === "general" ||
        category.name.toLowerCase() === "general",
    );
    return generalCategory ? String(generalCategory.id) : "";
  }, [categories]);
  const [rewardPrograms, setRewardPrograms] = useState<RewardProgram[]>([]);
  const [isMultiPlayerModeEnabled, setIsMultiPlayerModeEnabled] = useState(false);
  const [rewardRuleCategoryId, setRewardRuleCategoryId] = useState("");
  const [rewardRuleType, setRewardRuleType] = useState("points");
  const [rewardRuleMultiplier, setRewardRuleMultiplier] = useState("");
  const [rewardRuleValue, setRewardRuleValue] = useState("");
  const [rewardRuleProgramId, setRewardRuleProgramId] = useState("");
  const [rewardRuleStoreId, setRewardRuleStoreId] = useState("");
  const [rewardRulePriority, setRewardRulePriority] = useState("100");
  const [rewardRuleActive, setRewardRuleActive] = useState(true);
  const [rewardRuleNotes, setRewardRuleNotes] = useState("");
  const [editingRewardRuleId, setEditingRewardRuleId] = useState<number | null>(null);
  const [rewardRulePendingDelete, setRewardRulePendingDelete] =
    useState<RewardRule | null>(null);
  const [isHistoricalRulesOpen, setIsHistoricalRulesOpen] = useState(false);
  const [productChangeForm, setProductChangeForm] = useState({
    previous_product_name: "",
    new_product_name: "",
    effective_date: "",
    notes: "",
  });
  const [isProductChangeOpen, setIsProductChangeOpen] = useState(false);
  const [isSavingProductChange, setIsSavingProductChange] = useState(false);
  const [isSavingRewardRule, setIsSavingRewardRule] = useState(false);
  const [isDeletingRewardRule, setIsDeletingRewardRule] = useState(false);
  const [isRecalculatingRewards, setIsRecalculatingRewards] = useState(false);
  const [statementCycleDateInputs, setStatementCycleDateInputs] = useState<
    Record<StatementCycleDateField, string>
  >({
    payment_due_date: "",
    next_statement_close_date: "",
  });
  const [statementCycleDateErrors, setStatementCycleDateErrors] = useState<
    Partial<Record<StatementCycleDateField, string>>
  >({});
  const [statementCycleDateDirty, setStatementCycleDateDirty] = useState<
    Record<StatementCycleDateField, boolean>
  >({
    payment_due_date: false,
    next_statement_close_date: false,
  });
  const [error, setError] = useState<string | null>(null);
  const [sectionMessage, setSectionMessage] = useState<string | null>(null);
  const [rewardRuleMessage, setRewardRuleMessage] = useState<string | null>(null);
  const [isArchivedBonusOpen, setIsArchivedBonusOpen] = useState(false);
  const activePlayers = useMemo(
    () => players.filter((player) => player.active),
    [players],
  );
  const currentRewardRules = useMemo(
    () =>
      (card?.reward_rules ?? []).filter(
        (rule) => rule.active && rule.effective_end_date === null,
      ),
    [card],
  );
  const historicalRewardRules = useMemo(
    () =>
      (card?.reward_rules ?? []).filter(
        (rule) => !rule.active || rule.effective_end_date !== null,
      ),
    [card],
  );
  const issuerSelectOptions = useMemo(
    () =>
      cardIssuers.filter(
        (issuer) =>
          issuer.active ||
          (form?.issuer_id !== "" && String(issuer.id) === form?.issuer_id),
      ),
    [cardIssuers, form?.issuer_id],
  );
  const networkSelectOptions = useMemo(
    () =>
      cardNetworks.filter(
        (network) =>
          NETWORK_CODES.has(network.code) &&
          (network.active ||
            (form?.network_id !== "" && String(network.id) === form?.network_id)),
      ),
    [cardNetworks, form?.network_id],
  );

  function resetStatementCycleDateState(cardForm: CardForm) {
    setStatementCycleDateInputs(statementCycleDateInputsFromForm(cardForm));
    setStatementCycleDateErrors({});
    setStatementCycleDateDirty({
      payment_due_date: false,
      next_statement_close_date: false,
    });
  }

  const loadCard = useCallback(async () => {
    if (!cardId) {
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const [
        cardResponse,
        categoriesResponse,
        settingsResponse,
        playersResponse,
        issuersResponse,
        networksResponse,
        storesResponse,
        rewardProgramsResponse,
      ] = await Promise.all([
        fetch(`${API_BASE_URL}/credit-cards/${cardId}`),
        fetch(`${API_BASE_URL}/spending-categories/`),
        fetch(`${API_BASE_URL}/app-settings`),
        fetch(`${API_BASE_URL}/players/`),
        fetch(`${API_BASE_URL}/card-issuers/`),
        fetch(`${API_BASE_URL}/card-networks/`),
        fetch(`${API_BASE_URL}/stores/`),
        fetch(
          `${API_BASE_URL}/reward-programs/?active_only=true&eligible_for_credit_cards=true&include_protection=false`,
        ),
      ]);

      if (!cardResponse.ok) {
        throw new Error(`Failed to load credit card (${cardResponse.status})`);
      }

      if (!categoriesResponse.ok) {
        throw new Error(
          `Failed to load spending categories (${categoriesResponse.status})`,
        );
      }

      if (!settingsResponse.ok) {
        throw new Error(`Failed to load app settings (${settingsResponse.status})`);
      }

      if (!playersResponse.ok) {
        throw new Error(`Failed to load players (${playersResponse.status})`);
      }
      if (!issuersResponse.ok) {
        throw new Error(`Failed to load card issuers (${issuersResponse.status})`);
      }
      if (!networksResponse.ok) {
        throw new Error(`Failed to load card networks (${networksResponse.status})`);
      }
      if (!storesResponse.ok) {
        throw new Error(`Failed to load stores (${storesResponse.status})`);
      }
      if (!rewardProgramsResponse.ok) {
        throw new Error(
          `Failed to load reward programs (${rewardProgramsResponse.status})`,
        );
      }

      const data = (await cardResponse.json()) as CreditCard;
      const cardForm = toForm(data);
      const settings = (await settingsResponse.json()) as AppSettings;
      setCard(data);
      setForm(cardForm);
      resetStatementCycleDateState(cardForm);
      setCategories((await categoriesResponse.json()) as SpendingCategory[]);
      setIsMultiPlayerModeEnabled(settings.multi_player_mode_enabled);
      setPlayers((await playersResponse.json()) as Player[]);
      setCardIssuers((await issuersResponse.json()) as CardIssuer[]);
      setCardNetworks((await networksResponse.json()) as CardNetwork[]);
      setStores((await storesResponse.json()) as Store[]);
      setRewardPrograms((await rewardProgramsResponse.json()) as RewardProgram[]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load card.");
    } finally {
      setIsLoading(false);
    }
  }, [cardId]);

  const refreshCard = useCallback(async () => {
    if (!cardId) {
      return null;
    }

    const response = await fetch(`${API_BASE_URL}/credit-cards/${cardId}`);

    if (!response.ok) {
      throw new Error(`Failed to refresh credit card (${response.status})`);
    }

    const data = (await response.json()) as CreditCard;
    const cardForm = toForm(data);
    setCard(data);
    setForm(cardForm);
    resetStatementCycleDateState(cardForm);
    return data;
  }, [cardId]);

  useEffect(() => {
    queueMicrotask(() => {
      void loadCard();
    });
  }, [loadCard]);

  useEffect(() => {
    if (!card || rewardRuleProgramId) {
      return;
    }

    queueMicrotask(() => {
      setRewardRuleProgramId(
        card.reward_program_id ? String(card.reward_program_id) : "",
      );
    });
  }, [card, rewardRuleProgramId]);

  const warnings = useMemo(() => {
    if (!card) {
      return [];
    }

    const messages: string[] = [];

    if (card.minimum_payment_missing) {
      messages.push("Minimum payment has not been marked paid.");
    }

    if (card.interest_risk) {
      messages.push("Last statement balance is not fully paid.");
    }

    if (
      card.preferred_utilization !== null &&
      card.utilization_percent !== null &&
      card.utilization_percent > Number(card.preferred_utilization)
    ) {
      messages.push("Utilization is above preferred utilization.");
    }

    if (
      card.days_until_payment_due !== null &&
      card.days_until_payment_due >= 0 &&
      card.days_until_payment_due <= 7
    ) {
      messages.push("Payment due within 7 days.");
    }

    if (
      card.days_until_statement_close !== null &&
      card.days_until_statement_close >= 0 &&
      card.days_until_statement_close <= 3
    ) {
      messages.push("Statement closes within 3 days.");
    }

    return messages;
  }, [card]);

  const signupBonus = useMemo(() => {
    if (!card || !card.signup_bonus_spend) {
      return null;
    }

    const requiredSpend = toNumber(card.signup_bonus_spend);
    const currentProgress = toNumber(card.current_spend_progress);
    const remainingSpend = Math.max(0, requiredSpend - currentProgress);
    const progressPercent =
      requiredSpend > 0 ? Math.min(100, (currentProgress / requiredSpend) * 100) : 0;
    const daysUntilDeadline = daysUntilDate(card.signup_bonus_deadline);
    const isCompleted = requiredSpend > 0 && currentProgress >= requiredSpend;
    const isExpired = isPastDate(card.signup_bonus_deadline);
    const isActive = requiredSpend > 0 && !isCompleted && !isExpired;

    return {
      daysUntilDeadline,
      isActive,
      isCompleted,
      isExpired,
      progressPercent,
      remainingSpend,
      requiredSpend,
    };
  }, [card]);

  function updateFormField(field: keyof CardForm, value: string) {
    setForm((currentForm) =>
      currentForm
        ? {
            ...currentForm,
            [field]: value,
          }
        : currentForm,
    );
  }

  function updateNoPresetLimit(value: boolean) {
    setForm((currentForm) =>
      currentForm
        ? {
            ...currentForm,
            credit_limit: value ? "" : currentForm.credit_limit,
            no_preset_limit: value,
          }
        : currentForm,
    );
  }

  async function saveCurrentSection(section: EditableSection) {
    if (!form || !card) {
      return;
    }

    let payloadForm = form;

    setIsSaving(true);
    setError(null);
    setSectionMessage(null);

    if (
      isMultiPlayerModeEnabled &&
      activePlayers.length > 1 &&
      form.player_id === ""
    ) {
      setError("Select a player for this card.");
      setEditingSection(section);
      setIsSaving(false);
      return;
    }

    if (section === "cycle") {
      const parsedPaymentDueDate = parseDateInput(
        statementCycleDateInputs.payment_due_date,
        "Payment Due Date",
        {
          rejectMoreThanOneYearPast: statementCycleDateDirty.payment_due_date,
        },
      );
      const parsedStatementCloseDate = parseDateInput(
        statementCycleDateInputs.next_statement_close_date,
        "Next Statement Close Date",
        {
          rejectMoreThanOneYearPast:
            statementCycleDateDirty.next_statement_close_date,
        },
      );

      if (!parsedPaymentDueDate.ok) {
        setError(parsedPaymentDueDate.message);
        setStatementCycleDateErrors({
          payment_due_date: parsedPaymentDueDate.message,
        });
        setEditingSection(section);
        setIsSaving(false);
        return;
      }

      if (!parsedStatementCloseDate.ok) {
        setError(parsedStatementCloseDate.message);
        setStatementCycleDateErrors({
          next_statement_close_date: parsedStatementCloseDate.message,
        });
        setEditingSection(section);
        setIsSaving(false);
        return;
      }

      setStatementCycleDateErrors({});
      setStatementCycleDateInputs({
        payment_due_date: formatIsoDateForInput(parsedPaymentDueDate.value),
        next_statement_close_date: formatIsoDateForInput(
          parsedStatementCloseDate.value,
        ),
      });

      payloadForm = {
        ...form,
        payment_due_date: parsedPaymentDueDate.value,
        next_statement_close_date: parsedStatementCloseDate.value,
      };
    }

    try {
      const response = await fetch(`${API_BASE_URL}/credit-cards/${card.id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(buildPayload(payloadForm)),
      });

      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(
          body?.detail || `Failed to save credit card (${response.status})`,
        );
      }

      const data = (await response.json()) as CreditCard;
      const cardForm = toForm(data);
      setCard(data);
      setForm(cardForm);
      resetStatementCycleDateState(cardForm);
      setEditingSection(null);
      setSectionMessage("Section saved.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save section.");
      setEditingSection(section);
    } finally {
      setIsSaving(false);
    }
  }

  async function handleRewardRuleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (
      !card ||
      (!rewardRuleCategoryId && !isInstantDiscountRuleType(rewardRuleType)) ||
      (isInstantDiscountRuleType(rewardRuleType) && !generalCategoryId) ||
      (rewardRuleType === "points" && !rewardRuleMultiplier) ||
      (rewardRuleType !== "points" && rewardRuleType !== "none" && !rewardRuleValue) ||
      (isInstantDiscountRuleType(rewardRuleType) && !rewardRuleStoreId)
    ) {
      return;
    }

    setIsSavingRewardRule(true);
    setError(null);

    try {
      const endpoint =
        editingRewardRuleId === null
          ? `${API_BASE_URL}/credit-cards/${card.id}/reward-rules`
          : `${API_BASE_URL}/credit-cards/reward-rules/${editingRewardRuleId}`;
      const response = await fetch(
        endpoint,
        {
          method: editingRewardRuleId === null ? "POST" : "PATCH",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            spending_category_id: Number(
              isInstantDiscountRuleType(rewardRuleType)
                ? generalCategoryId
                : rewardRuleCategoryId,
            ),
            reward_type: rewardRuleType,
            multiplier:
              rewardRuleType === "points"
                ? rewardRuleMultiplier
                : rewardRuleType === "none"
                  ? "0"
                  : null,
            value:
              rewardRuleType === "points"
                ? rewardRuleValue || rewardRuleMultiplier
                : rewardRuleType === "none"
                  ? "0"
                  : rewardRuleValue,
            reward_program_id:
              rewardRuleType === "points"
                ? rewardRuleProgramId
                  ? Number(rewardRuleProgramId)
                  : card.reward_program_id
                : null,
            merchant_type: null,
            store_id: rewardRuleStoreId ? Number(rewardRuleStoreId) : null,
            priority: rewardRulePriority ? Number(rewardRulePriority) : 100,
            active: rewardRuleActive,
            notes: rewardRuleNotes.trim() || null,
          }),
        },
      );

      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(
          body?.detail || `Failed to save reward rule (${response.status})`,
        );
      }

      setRewardRuleCategoryId("");
      setRewardRuleType("points");
      setRewardRuleMultiplier("");
      setRewardRuleValue("");
      setRewardRuleProgramId(card.reward_program_id ? String(card.reward_program_id) : "");
      setRewardRuleStoreId("");
      setRewardRulePriority("100");
      setRewardRuleActive(true);
      setRewardRuleNotes("");
      setEditingRewardRuleId(null);
      setRewardRuleMessage(
        editingRewardRuleId === null
          ? "Reward rule added. Affected purchase rewards were recalculated."
          : "Reward rule updated. Affected purchase rewards were recalculated.",
      );
      await refreshCard();
    } catch (err) {
      setRewardRuleMessage(
        err instanceof Error ? err.message : "Failed to save reward rule.",
      );
    } finally {
      setIsSavingRewardRule(false);
    }
  }

  function startEditingRewardRule(rule: RewardRule) {
    setEditingRewardRuleId(rule.id);
    setRewardRuleCategoryId(String(rule.spending_category_id));
    setRewardRuleType(
      rule.reward_type === "purchase_discount"
        ? "instant_discount_percent"
        : rule.reward_type ?? "points",
    );
    setRewardRuleMultiplier(String(rule.multiplier));
    setRewardRuleValue(rule.value === null ? "" : String(rule.value));
    setRewardRuleProgramId(
      isInstantDiscountRuleType(rule.reward_type)
        ? ""
        : rule.reward_program_id
        ? String(rule.reward_program_id)
        : card?.reward_program_id
          ? String(card.reward_program_id)
          : "",
    );
    setRewardRuleStoreId(rule.store_id === null ? "" : String(rule.store_id));
    setRewardRulePriority(String(rule.priority ?? 100));
    setRewardRuleActive(rule.active);
    setRewardRuleNotes(rule.notes ?? "");
    setRewardRuleMessage(null);
  }

  function cancelRewardRuleEdit() {
    setEditingRewardRuleId(null);
    setRewardRuleCategoryId("");
    setRewardRuleType("points");
    setRewardRuleMultiplier("");
    setRewardRuleValue("");
    setRewardRuleProgramId(card?.reward_program_id ? String(card.reward_program_id) : "");
    setRewardRuleStoreId("");
    setRewardRulePriority("100");
    setRewardRuleActive(true);
    setRewardRuleNotes("");
  }

  async function handleDeleteRewardRule() {
    if (!rewardRulePendingDelete) {
      return;
    }

    setIsDeletingRewardRule(true);
    setRewardRuleMessage(null);

    try {
      const response = await fetch(
        `${API_BASE_URL}/credit-cards/reward-rules/${rewardRulePendingDelete.id}`,
        {
          method: "DELETE",
        },
      );

      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(
          body?.detail || `Failed to remove reward rule (${response.status})`,
        );
      }

      setRewardRulePendingDelete(null);
      setRewardRuleMessage(
        "Reward rule removed. Future purchases will use remaining rules or fallback resolution.",
      );
      if (editingRewardRuleId === rewardRulePendingDelete.id) {
        cancelRewardRuleEdit();
      }
      await refreshCard();
    } catch (err) {
      setRewardRuleMessage(
        err instanceof Error ? err.message : "Failed to remove reward rule.",
      );
    } finally {
      setIsDeletingRewardRule(false);
    }
  }

  async function handleRecalculateCardRewards() {
    if (!card) {
      return;
    }

    setIsRecalculatingRewards(true);
    setRewardRuleMessage(null);

    try {
      const response = await fetch(
        `${API_BASE_URL}/credit-cards/${card.id}/reward-transactions/recalculate`,
        {
          method: "POST",
        },
      );

      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(
          body?.detail || `Failed to recalculate rewards (${response.status})`,
        );
      }

      const body = (await response.json()) as { purchase_count?: number };
      setRewardRuleMessage(
        `Rewards recalculated for ${body.purchase_count ?? 0} ${
          body.purchase_count === 1 ? "purchase" : "purchases"
        }.`,
      );
      await refreshCard();
    } catch (err) {
      setRewardRuleMessage(
        err instanceof Error ? err.message : "Failed to recalculate rewards.",
      );
    } finally {
      setIsRecalculatingRewards(false);
    }
  }

  async function handleProductChangeSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!card || !productChangeForm.new_product_name || !productChangeForm.effective_date) {
      return;
    }

    setIsSavingProductChange(true);
    setError(null);

    try {
      const response = await fetch(
        `${API_BASE_URL}/credit-cards/${card.id}/product-changes`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            previous_product_name:
              productChangeForm.previous_product_name.trim() || null,
            new_product_name: productChangeForm.new_product_name.trim(),
            effective_date: productChangeForm.effective_date,
            notes: productChangeForm.notes.trim() || null,
          }),
        },
      );

      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(
          body?.detail || `Failed to record product change (${response.status})`,
        );
      }

      const data = (await response.json()) as CreditCard;
      setCard(data);
      setForm(toForm(data));
      setProductChangeForm({
        previous_product_name: "",
        new_product_name: "",
        effective_date: "",
        notes: "",
      });
      setIsProductChangeOpen(false);
      setSectionMessage("Product change recorded. Existing reward rules were closed and cloned forward.");
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to record product change.",
      );
    } finally {
      setIsSavingProductChange(false);
    }
  }

  function toggleSection(section: EditableSection) {
    setSectionMessage(null);
    setEditingSection((currentSection) =>
      currentSection === section ? null : section,
    );

    if (section === "cycle" && editingSection !== "cycle" && form) {
      resetStatementCycleDateState(form);
    }
  }

  function renderInlineInput(
    field: keyof CardForm,
    label: string,
    type: "date" | "number" | "text" = "text",
    required = false,
  ) {
    if (!form) {
      return null;
    }

    return (
      <label className="space-y-1 text-sm font-medium text-slate-700" key={field}>
        <span>{label}</span>
        <input
          className="h-10 w-full rounded-md border border-slate-300 px-3 text-sm text-slate-950 outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-200"
          min={type === "number" ? "0" : undefined}
          onChange={(event) => updateFormField(field, event.target.value)}
          required={required}
          step={type === "number" ? "0.01" : undefined}
          type={type}
          value={String(form[field])}
        />
      </label>
    );
  }

  function renderInlineCheckbox(field: keyof CardForm, label: string) {
    if (!form) {
      return null;
    }

    return (
      <label
        className="flex h-10 items-center gap-2 text-sm font-medium text-slate-700"
        key={field}
      >
        <input
          checked={Boolean(form[field])}
          className="h-4 w-4 rounded border-slate-300"
          onChange={(event) =>
            setForm((currentForm) =>
              currentForm
                ? {
                    ...currentForm,
                    [field]: event.target.checked,
                  }
                : currentForm,
            )
          }
          type="checkbox"
        />
        <span>{label}</span>
      </label>
    );
  }

  function renderStatementCycleDateInput(
    field: StatementCycleDateField,
    label: string,
  ) {
    const errorMessage = statementCycleDateErrors[field];

    return (
      <label className="space-y-1 text-sm font-medium text-slate-700" key={field}>
        <span>{label}</span>
        <input
          aria-invalid={errorMessage ? true : undefined}
          className={`h-10 w-full rounded-md border px-3 text-sm text-slate-950 outline-none transition placeholder:text-slate-400 focus:ring-2 ${
            errorMessage
              ? "border-red-300 focus:border-red-500 focus:ring-red-100"
              : "border-slate-300 focus:border-slate-500 focus:ring-slate-200"
          }`}
          inputMode="numeric"
          onBlur={() => {
            const parsedValue = parseDateInput(
              statementCycleDateInputs[field],
              label,
              {
                rejectMoreThanOneYearPast: statementCycleDateDirty[field],
              },
            );

            if (parsedValue.ok) {
              setStatementCycleDateInputs((currentInputs) => ({
                ...currentInputs,
                [field]: formatIsoDateForInput(parsedValue.value),
              }));
              setStatementCycleDateErrors((currentErrors) => {
                const nextErrors = { ...currentErrors };
                delete nextErrors[field];
                return nextErrors;
              });
            } else {
              setStatementCycleDateErrors((currentErrors) => ({
                ...currentErrors,
                [field]: parsedValue.message,
              }));
            }
          }}
          onChange={(event) => {
            setStatementCycleDateDirty((currentDirtyFields) => ({
              ...currentDirtyFields,
              [field]: true,
            }));
            setStatementCycleDateErrors((currentErrors) => {
              const nextErrors = { ...currentErrors };
              delete nextErrors[field];
              return nextErrors;
            });
            setStatementCycleDateInputs((currentInputs) => ({
              ...currentInputs,
              [field]: event.target.value,
            }));
          }}
          placeholder="MM/DD/YYYY"
          type="text"
          value={statementCycleDateInputs[field]}
        />
        {errorMessage ? (
          <span className="block text-xs font-semibold text-red-700">
            {errorMessage}
          </span>
        ) : (
          <span className="block text-xs font-normal text-slate-500">
            Accepts 06/20/2026, 6-20-26, or 06202026. Leave blank if not set.
          </span>
        )}
      </label>
    );
  }

  function renderPlayerSelect() {
    if (!form || !isMultiPlayerModeEnabled) {
      return null;
    }

    return (
      <label className="space-y-1 text-sm font-medium text-slate-700">
        <span>Player</span>
        <select
          className="h-10 w-full rounded-md border border-slate-300 px-3 text-slate-950 outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-200"
          onChange={(event) => updateFormField("player_id", event.target.value)}
          value={form.player_id}
        >
          <option value="">Unassigned</option>
          {players
            .filter((player) => player.active || String(player.id) === form.player_id)
            .map((player) => (
              <option key={player.id} value={String(player.id)}>
                {player.label}
                {player.name ? ` · ${player.name}` : ""}
                {player.active ? "" : " (inactive)"}
              </option>
            ))}
        </select>
      </label>
    );
  }

  function renderSectionActions(section: EditableSection) {
    return (
      <div className="flex justify-end gap-2">
        <button
          className="h-10 cursor-pointer rounded-md border border-slate-300 px-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-100 active:bg-slate-200"
          onClick={() => {
            if (card) {
              const resetForm = toForm(card);
              setForm(resetForm);
              resetStatementCycleDateState(resetForm);
            }
            setEditingSection(null);
          }}
          type="button"
        >
          Cancel
        </button>
        <button
          className="h-10 cursor-pointer rounded-md bg-slate-950 px-3 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
          disabled={isSaving}
          onClick={() => void saveCurrentSection(section)}
          type="button"
        >
          {isSaving ? "Saving..." : "Save"}
        </button>
      </div>
    );
  }

  if (isLoading) {
    return (
      <main className="min-h-screen bg-slate-50 px-4 py-8 text-slate-950 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-6xl rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
          Loading credit card...
        </div>
      </main>
    );
  }

  if (!card || !form) {
    return (
      <main className="min-h-screen bg-slate-50 px-4 py-8 text-slate-950 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-6xl space-y-4">
          <p className="rounded-md border border-red-200 bg-red-50 p-3 text-sm font-medium text-red-700">
            {error ?? "Credit card not found."}
          </p>
          <Link
            className="inline-flex h-11 items-center rounded-md border border-slate-300 px-4 text-sm font-semibold text-slate-700"
            href="/credit-cards"
          >
            Back to credit cards
          </Link>
        </div>
      </main>
    );
  }

  const hasCurrentStatement =
    card.statement_balance !== null ||
    card.statement_paid_amount !== null ||
    card.minimum_payment_due !== null ||
    card.payment_due_date !== null ||
    card.next_statement_close_date !== null;

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-8 text-slate-950 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-7xl space-y-6">
        <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-sm font-medium text-slate-500">Funding Source</p>
            <h1 className="mt-1 text-3xl font-semibold tracking-tight">
              {card.nickname}
            </h1>
            <p className="mt-1 text-sm text-slate-500">
              {card.issuer}
              {card.network ? ` · ${card.network}` : ""}
              {card.last_four ? ` · ${card.last_four}` : ""}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link
              className="inline-flex h-11 cursor-pointer items-center rounded-md border border-slate-300 px-4 text-sm font-semibold text-slate-700 transition hover:bg-slate-100 active:bg-slate-200"
              href="/credit-cards"
            >
              Back
            </Link>
          </div>
        </header>

        {error ? (
          <p className="rounded-md border border-red-200 bg-red-50 p-3 text-sm font-medium text-red-700">
            {error}
          </p>
        ) : null}

        {warnings.length > 0 ? (
          <div className="grid gap-2 sm:grid-cols-3">
            {warnings.map((warning) => (
              <p
                className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm font-semibold text-amber-800"
                key={warning}
              >
                {warning}
              </p>
            ))}
          </div>
        ) : null}

        {sectionMessage ? (
          <p className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm font-medium text-emerald-800">
            {sectionMessage}
          </p>
        ) : null}

        <div className="grid gap-5">
            <DetailSection
              isEditing={editingSection === "overview"}
              items={[
                ...(isMultiPlayerModeEnabled
                  ? [
                      {
                        label: "Player",
                        value: card.player
                          ? `${card.player.label}${card.player.name ? ` · ${card.player.name}` : ""}`
                          : "Unassigned",
                      },
                    ]
                  : []),
                { label: "Issuer", value: card.issuer },
                { label: "Network", value: card.network ?? "Not set" },
                { label: "Last Four", value: card.last_four ?? "Not set" },
                { label: "Status", value: card.is_active ? "Active" : "Inactive" },
              ]}
              onEdit={() => toggleSection("overview")}
              title="Card Basics"
            >
              <div className="grid gap-3 rounded-md border border-slate-200 bg-slate-50 p-3 sm:grid-cols-2">
                {renderPlayerSelect()}
                {renderInlineInput("nickname", "Nickname", "text", true)}
                <label className="space-y-1 text-sm font-medium text-slate-700">
                  <span>Issuer</span>
                  <select
                    className="h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-950"
                    onChange={(event) => updateFormField("issuer_id", event.target.value)}
                    required
                    value={form.issuer_id}
                  >
                    <option value="">Select issuer</option>
                    {issuerSelectOptions.map((issuer) => (
                      <option key={issuer.id} value={issuer.id}>
                        {issuer.name}
                        {issuer.active ? "" : " (inactive)"}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="space-y-1 text-sm font-medium text-slate-700">
                  <span>Network</span>
                  <select
                    className="h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-950"
                    onChange={(event) => updateFormField("network_id", event.target.value)}
                    value={form.network_id}
                  >
                    <option value="">Select network</option>
                    {networkSelectOptions.map((network) => (
                      <option key={network.id} value={network.id}>
                        {network.name}
                        {network.active ? "" : " (inactive)"}
                      </option>
                    ))}
                  </select>
                </label>
                {renderInlineInput("last_four", "Last Four")}
                {renderInlineCheckbox("is_active", "Active")}
                {renderSectionActions("overview")}
              </div>
            </DetailSection>
            <DetailSection
              isEditing={editingSection === "defaults"}
              items={[
                { label: "Credit Limit", value: formatCreditLimit(card.credit_limit) },
                {
                  label: "Preferred Utilization",
                  value: formatPercent(card.preferred_utilization),
                },
                { label: "APR", value: formatPercent(card.apr) },
                {
                  label: "Payment Due Day",
                  value: formatOrdinalDay(card.payment_due_day),
                },
                {
                  label: "Statement Close Day",
                  value: formatOrdinalDay(card.statement_close_day),
                },
              ]}
              onEdit={() => toggleSection("defaults")}
              title="Credit & Defaults"
            >
              <div className="grid gap-3 rounded-md border border-slate-200 bg-slate-50 p-3 sm:grid-cols-2 xl:grid-cols-3">
                <div className="space-y-1 text-sm font-medium text-slate-700">
                  <label className="space-y-1">
                    <span>Credit Limit</span>
                    <input
                      className="h-10 w-full rounded-md border border-slate-300 px-3 text-sm text-slate-950 outline-none transition disabled:bg-slate-100 disabled:text-slate-500 focus:border-slate-500 focus:ring-2 focus:ring-slate-200"
                      disabled={form.no_preset_limit}
                      min="0"
                      onChange={(event) =>
                        updateFormField("credit_limit", event.target.value)
                      }
                      placeholder="10000"
                      step="100"
                      type="number"
                      value={form.credit_limit}
                    />
                  </label>
                  <label className="flex items-start gap-2 text-xs font-medium text-slate-600">
                    <input
                      checked={form.no_preset_limit}
                      className="mt-0.5 h-4 w-4 rounded border-slate-300"
                      onChange={(event) =>
                        updateNoPresetLimit(event.target.checked)
                      }
                      type="checkbox"
                    />
                    <span>
                      No preset spending limit / N/A for charge cards or cards
                      without a published limit.
                    </span>
                  </label>
                </div>
                {renderInlineInput("preferred_utilization", "Preferred Utilization %", "number")}
                {renderInlineInput("apr", "APR %", "number")}
                <label className="space-y-1 text-sm font-medium text-slate-700">
                  <span>Statement Close Day</span>
                  <select
                    className="h-10 w-full rounded-md border border-slate-300 px-3 text-sm text-slate-950 outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-200"
                    onChange={(event) =>
                      updateFormField("statement_close_day", event.target.value)
                    }
                    value={form.statement_close_day}
                  >
                    <option value="">Select statement close day</option>
                    {DAY_OF_MONTH_OPTIONS.map((day) => (
                      <option key={day} value={day}>
                        {formatOrdinalDay(day)}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="space-y-1 text-sm font-medium text-slate-700">
                  <span>Payment Due Day</span>
                  <select
                    className="h-10 w-full rounded-md border border-slate-300 px-3 text-sm text-slate-950 outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-200"
                    onChange={(event) =>
                      updateFormField("payment_due_day", event.target.value)
                    }
                    value={form.payment_due_day}
                  >
                    <option value="">Select payment due day</option>
                    {DAY_OF_MONTH_OPTIONS.map((day) => (
                      <option key={day} value={day}>
                        {formatOrdinalDay(day)}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="sm:col-span-2 xl:col-span-3">
                  {renderSectionActions("defaults")}
                </div>
              </div>
            </DetailSection>
            <DetailSection
              isEditing={editingSection === "cycle"}
              items={[
                {
                  label: "Estimated Balance",
                  value: formatAmount(card.current_balance),
                },
                {
                  label: "Available Credit",
                  value: formatAmount(card.calculated_available_credit),
                },
                {
                  label: "Utilization",
                  value: formatPercent(card.utilization_percent),
                  tone:
                    card.preferred_utilization !== null &&
                    card.utilization_percent !== null &&
                    card.utilization_percent > Number(card.preferred_utilization)
                      ? "danger"
                      : undefined,
                },
                {
                  label: "Payment Needed for Preferred Utilization",
                  value: formatAmount(
                    card.payment_needed_for_preferred_utilization,
                  ),
                },
                {
                  label: "Last Statement Balance",
                  value: formatStatementAmount(card.statement_balance),
                },
                {
                  label: "Paid Toward Statement",
                  value: hasCurrentStatement
                    ? formatAmount(card.statement_paid_amount)
                    : "No current statement",
                },
                {
                  label: "Statement Remaining",
                  value: hasCurrentStatement
                    ? formatAmount(card.statement_remaining)
                    : "No current statement",
                  tone: card.interest_risk ? "danger" : undefined,
                },
                {
                  label: "Minimum Payment Due",
                  value: hasCurrentStatement
                    ? formatAmount(card.minimum_payment_due)
                    : "No current statement",
                },
                {
                  label: "Minimum Payment Made",
                  value: card.minimum_payment_paid ? "Yes" : "No",
                  tone: card.minimum_payment_missing ? "danger" : undefined,
                },
                {
                  label: "Autopay Enabled",
                  value: card.autopay_enabled ? "Yes" : "No",
                },
                {
                  label: "Payment Due Date",
                  value: formatDate(card.payment_due_date),
                },
                {
                  label: "Days Until Due",
                  value: formatDaysUntil(card.days_until_payment_due),
                  tone:
                    card.days_until_payment_due !== null &&
                    card.days_until_payment_due >= 0 &&
                    card.days_until_payment_due <= 7
                      ? "danger"
                      : undefined,
                },
                {
                  label: "Next Statement Close",
                  value: formatDate(card.next_statement_close_date),
                },
                {
                  label: "Days Until Statement Close",
                  value: formatDaysUntil(card.days_until_statement_close),
                  tone:
                    card.days_until_statement_close !== null &&
                    card.days_until_statement_close >= 0 &&
                    card.days_until_statement_close <= 3
                      ? "warning"
                      : undefined,
                },
                {
                  label: "Estimated Monthly Interest",
                  value: formatAmount(card.estimated_monthly_interest),
                },
              ]}
              onEdit={() => toggleSection("cycle")}
              title="Current Statement Cycle"
            >
              <div className="grid gap-3 rounded-md border border-slate-200 bg-slate-50 p-3 sm:grid-cols-2 xl:grid-cols-3">
                {renderInlineInput("current_balance", "Estimated Balance", "number")}
                {renderInlineInput("statement_balance", "Last Statement Balance", "number")}
                {renderInlineInput("statement_paid_amount", "Amount Paid Toward Statement", "number")}
                {renderInlineInput("minimum_payment_due", "Minimum Payment Due", "number")}
                {renderInlineCheckbox("minimum_payment_paid", "Minimum Payment Made")}
                {renderInlineCheckbox("autopay_enabled", "Autopay Enabled")}
                {renderStatementCycleDateInput("payment_due_date", "Payment Due Date")}
                {renderStatementCycleDateInput(
                  "next_statement_close_date",
                  "Next Statement Close Date",
                )}
                <div className="sm:col-span-2 xl:col-span-3">
                  {renderSectionActions("cycle")}
                </div>
              </div>
            </DetailSection>
            {signupBonus?.isActive ? (
              <DetailSection
                isEditing={editingSection === "bonus"}
                items={[
                  {
                    label: "Required Spend",
                    value: formatAmount(card.signup_bonus_spend),
                  },
                  {
                    label: "Current Progress",
                    value: formatAmount(card.current_spend_progress),
                  },
                  {
                    label: "Remaining Spend",
                    value: formatAmount(signupBonus.remainingSpend),
                    tone: signupBonus.remainingSpend > 0 ? "warning" : undefined,
                  },
                  {
                    label: "Deadline",
                    value: formatDate(card.signup_bonus_deadline),
                    tone:
                      signupBonus.daysUntilDeadline !== null &&
                      signupBonus.daysUntilDeadline <= 30
                        ? "danger"
                        : undefined,
                  },
                  {
                    label: "Estimated Completion",
                    value: formatProgressPercent(
                      toNumber(card.current_spend_progress),
                      signupBonus.requiredSpend,
                    ),
                  },
                  {
                    label: "Signup Bonus Points",
                    value:
                      card.signup_bonus_points === null
                        ? "Not set"
                        : card.signup_bonus_points.toLocaleString(),
                  },
                ]}
                onEdit={() => toggleSection("bonus")}
                title="Active Signup Bonus / MSR"
              >
                <div className="mb-4 overflow-hidden rounded-full bg-slate-200">
                  <div
                    className={`h-3 rounded-full ${
                      signupBonus.daysUntilDeadline !== null &&
                      signupBonus.daysUntilDeadline <= 30
                        ? "bg-amber-500"
                        : "bg-emerald-600"
                    }`}
                    style={{ width: `${signupBonus.progressPercent}%` }}
                  />
                </div>
                {signupBonus.daysUntilDeadline !== null &&
                signupBonus.daysUntilDeadline <= 30 ? (
                  <p className="mb-4 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-800">
                    Deadline approaching with spend still incomplete.
                  </p>
                ) : null}
                <div className="grid gap-3 rounded-md border border-slate-200 bg-slate-50 p-3 sm:grid-cols-2 xl:grid-cols-3">
                  {renderInlineInput("signup_bonus_spend", "Signup Bonus Spend", "number")}
                  {renderInlineInput("current_spend_progress", "Current Spend Progress", "number")}
                  {renderInlineInput("signup_bonus_points", "Signup Bonus Points", "number")}
                  {renderInlineInput("signup_bonus_deadline", "Signup Bonus Deadline", "date")}
                  <div className="sm:col-span-2 xl:col-span-3">
                    {renderSectionActions("bonus")}
                  </div>
                </div>
              </DetailSection>
            ) : null}
            <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <h2 className="text-lg font-semibold text-slate-950">
                    Reward Rules
                  </h2>
                  <p className="mt-1 text-sm text-slate-500">
                    Store rules apply first, then category rules, then General fallback.
                  </p>
                  <p className="mt-1 text-xs text-slate-500">
                    For store-specific discounts, select Rule Type = Instant
                    Discount %, choose the store, and leave Program as Not
                    applicable.
                  </p>
                </div>
                <button
                  className="h-10 cursor-pointer rounded-md border border-slate-300 px-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60"
                  disabled={isRecalculatingRewards}
                  onClick={handleRecalculateCardRewards}
                  type="button"
                >
                  {isRecalculatingRewards ? "Recalculating..." : "Recalculate Rewards"}
                </button>
              </div>
              {currentRewardRules.length > 0 ? (
                <div className="mt-4 divide-y divide-slate-200 rounded-md border border-slate-200">
                  {currentRewardRules.map((rule) => (
                    <div
                      className="grid gap-3 px-3 py-2 text-sm sm:grid-cols-[1fr_auto_auto]"
                      key={rule.id}
                    >
                      <div>
                        <p className="font-semibold text-slate-950">
                          {rewardRulePrimaryLabel(rule)}
                        </p>
                        <p className="text-xs font-semibold text-slate-500">
                          {rewardRuleSecondaryLabel(rule, card)}
                        </p>
                        {(rule.merchant_type || rule.store) &&
                        !isInstantDiscountRuleType(rule.reward_type) ? (
                          <p className="text-xs text-slate-500">
                            Store rule:{" "}
                            {rule.store
                              ? rule.store.name
                              : rule.merchant_type?.replaceAll("_", " ")}
                          </p>
                        ) : null}
                        {rule.notes ? (
                          <p className="text-xs text-slate-500">{rule.notes}</p>
                        ) : null}
                        <p className="text-xs text-slate-400">
                          Priority {rule.priority ?? 100} · Effective{" "}
                          {formatDate(rule.effective_start_date)}
                        </p>
                      </div>
                      <p className="font-semibold text-slate-950">
                        {formatRuleRate(rule)}
                      </p>
                      <div className="flex flex-wrap gap-2 sm:justify-end">
                        <button
                          className="h-8 cursor-pointer rounded-md border border-slate-300 px-3 text-xs font-semibold text-slate-700 transition hover:bg-slate-100"
                          onClick={() => startEditingRewardRule(rule)}
                          type="button"
                        >
                          Edit
                        </button>
                        <button
                          className="h-8 cursor-pointer rounded-md border border-red-200 px-3 text-xs font-semibold text-red-700 transition hover:bg-red-50"
                          onClick={() => setRewardRulePendingDelete(rule)}
                          type="button"
                        >
                          Remove
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="mt-3 text-sm text-slate-500">
                  No current category multipliers yet.
                </p>
              )}
              {historicalRewardRules.length > 0 ? (
                <div className="mt-3">
                  <button
                    className="h-8 cursor-pointer rounded-md border border-slate-300 px-3 text-xs font-semibold text-slate-700 transition hover:bg-slate-100"
                    onClick={() => setIsHistoricalRulesOpen((isOpen) => !isOpen)}
                    type="button"
                  >
                    {isHistoricalRulesOpen ? "Hide" : "View"} historical reward rules
                  </button>
                  {isHistoricalRulesOpen ? (
                    <div className="mt-3 divide-y divide-slate-200 rounded-md border border-slate-200 bg-slate-50">
                      {historicalRewardRules.map((rule) => (
                        <div
                          className="grid gap-2 px-3 py-2 text-sm sm:grid-cols-[1fr_auto]"
                          key={rule.id}
                        >
                          <div>
                            <p className="font-semibold text-slate-700">
                              {rule.spending_category.name}
                            </p>
                            <p className="text-xs text-slate-500">
                              {rule.reward_program
                                ? `${rule.reward_program.short_code} · ${rule.reward_program.name}`
                                : "Card default"}
                            </p>
                            <p className="text-xs text-slate-400">
                              {formatDate(rule.effective_start_date)} -{" "}
                              {formatDate(rule.effective_end_date)}
                            </p>
                          </div>
                          <p className="font-semibold text-slate-700">
                            {Number(rule.multiplier).toFixed(1)}x
                          </p>
                        </div>
                      ))}
                    </div>
                  ) : null}
                </div>
              ) : null}
              {rewardRuleMessage ? (
                <p
                  className={`mt-3 rounded-md border px-3 py-2 text-sm font-medium ${
                    rewardRuleMessage.toLowerCase().includes("failed")
                      ? "border-red-200 bg-red-50 text-red-700"
                      : "border-emerald-200 bg-emerald-50 text-emerald-700"
                  }`}
                >
                  {rewardRuleMessage}
                </p>
              ) : null}
              <form
                className="mt-4 grid gap-3 rounded-md border border-slate-200 bg-slate-50 p-3 sm:grid-cols-2 xl:grid-cols-4"
                onSubmit={handleRewardRuleSubmit}
              >
                {isInstantDiscountRuleType(rewardRuleType) ? null : (
                  <label className="space-y-1 text-sm font-medium text-slate-700">
                    <span>Category</span>
                    <select
                      className="h-10 w-full rounded-md border border-slate-300 bg-white px-2 text-sm text-slate-950"
                      onChange={(event) =>
                        setRewardRuleCategoryId(event.target.value)
                      }
                      required
                      value={rewardRuleCategoryId}
                    >
                      <option value="">Select category</option>
                      {categories.map((category) => (
                        <option key={category.id} value={category.id}>
                          {category.name}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                <label className="space-y-1 text-sm font-medium text-slate-700">
                  <span>Reward Type</span>
                  <select
                    className="h-10 w-full rounded-md border border-slate-300 bg-white px-2 text-sm text-slate-950"
                    onChange={(event) => {
                      const nextType = event.target.value;
                      setRewardRuleType(nextType);
                      if (nextType !== "points") {
                        setRewardRuleProgramId("");
                      }
                      if (nextType === "none") {
                        setRewardRuleValue("0");
                        setRewardRuleMultiplier("0");
                      }
                    }}
                    value={rewardRuleType}
                  >
                    {REWARD_TYPE_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="space-y-1 text-sm font-medium text-slate-700">
                  <span>{rewardRuleType === "points" ? "Multiplier" : "Value"}</span>
                  <input
                    className="h-10 w-full rounded-md border border-slate-300 bg-white px-2 text-sm text-slate-950"
                    min="0"
                    onChange={(event) =>
                      rewardRuleType === "points"
                        ? setRewardRuleMultiplier(event.target.value)
                        : setRewardRuleValue(event.target.value)
                    }
                    required={rewardRuleType !== "none"}
                    step="0.01"
                    type="number"
                    value={
                      rewardRuleType === "points"
                        ? rewardRuleMultiplier
                        : rewardRuleValue
                    }
                  />
                  <p className="text-xs text-slate-500">
                    Use 5 for a 5% rate.
                  </p>
                </label>
                {isInstantDiscountRuleType(rewardRuleType) ? (
                  <p className="self-end rounded-md border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-500">
                    Program not applicable.
                  </p>
                ) : (
                  <label className="space-y-1 text-sm font-medium text-slate-700">
                    <span>Program</span>
                    <select
                      className="h-10 w-full rounded-md border border-slate-300 bg-white px-2 text-sm text-slate-950"
                      disabled={rewardRuleType !== "points"}
                      onChange={(event) =>
                        setRewardRuleProgramId(event.target.value)
                      }
                      value={rewardRuleProgramId}
                    >
                      <option value="">Card default</option>
                      {rewardPrograms.map((program) => (
                        <option key={program.id} value={program.id}>
                          {program.short_code} · {program.name}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                <label className="space-y-1 text-sm font-medium text-slate-700">
                  <span>Specific Store</span>
                  <select
                    className="h-10 w-full rounded-md border border-slate-300 bg-white px-2 text-sm text-slate-950"
                    onChange={(event) => setRewardRuleStoreId(event.target.value)}
                    required={isInstantDiscountRuleType(rewardRuleType)}
                    value={rewardRuleStoreId}
                  >
                    <option value="">
                      {isInstantDiscountRuleType(rewardRuleType)
                        ? "Select store"
                        : "No specific store"}
                    </option>
                    {stores
                      .filter((store) => store.active || String(store.id) === rewardRuleStoreId)
                      .map((store) => (
                        <option key={store.id} value={store.id}>
                          {store.name}
                        </option>
                      ))}
                  </select>
                </label>
                <label className="space-y-1 text-sm font-medium text-slate-700">
                  <span>Priority</span>
                  <input
                    className="h-10 w-full rounded-md border border-slate-300 bg-white px-2 text-sm text-slate-950"
                    min="1"
                    onChange={(event) => setRewardRulePriority(event.target.value)}
                    step="1"
                    type="number"
                    value={rewardRulePriority}
                  />
                  <p className="text-xs text-slate-500">Lower numbers win.</p>
                </label>
                <label className="flex h-10 items-center gap-2 self-end text-sm font-medium text-slate-700">
                  <input
                    checked={rewardRuleActive}
                    className="h-4 w-4 rounded border-slate-300"
                    onChange={(event) => setRewardRuleActive(event.target.checked)}
                    type="checkbox"
                  />
                  <span>Active</span>
                </label>
                <label className="space-y-1 text-sm font-medium text-slate-700">
                  <span>Notes</span>
                  <input
                    className="h-10 w-full rounded-md border border-slate-300 bg-white px-2 text-sm text-slate-950"
                    onChange={(event) => setRewardRuleNotes(event.target.value)}
                    placeholder="Optional"
                    value={rewardRuleNotes}
                  />
                </label>
                <button
                  className="h-10 cursor-pointer self-end rounded-md bg-slate-950 px-3 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
                  disabled={isSavingRewardRule}
                  type="submit"
                >
                  {isSavingRewardRule
                    ? "Saving..."
                    : editingRewardRuleId === null
                      ? "Add"
                      : "Save"}
                </button>
                {editingRewardRuleId !== null ? (
                  <button
                    className="h-10 cursor-pointer self-end rounded-md border border-slate-300 px-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-100"
                    onClick={cancelRewardRuleEdit}
                    type="button"
                  >
                    Cancel Edit
                  </button>
                ) : null}
              </form>
            </section>
            <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <h2 className="text-lg font-semibold text-slate-950">
                    Product Changes
                  </h2>
                  <p className="mt-1 text-sm text-slate-500">
                    Product changes close current reward rules and clone them
                    forward from the effective date.
                  </p>
                </div>
                <button
                  className="h-9 cursor-pointer rounded-md bg-slate-950 px-3 text-sm font-semibold text-white transition hover:bg-slate-800"
                  onClick={() => {
                    setProductChangeForm({
                      previous_product_name: card.nickname,
                      new_product_name: "",
                      effective_date: "",
                      notes: "",
                    });
                    setIsProductChangeOpen((isOpen) => !isOpen);
                  }}
                  type="button"
                >
                  Record Product Change
                </button>
              </div>

              {isProductChangeOpen ? (
                <form
                  className="mt-4 grid gap-3 rounded-md border border-slate-200 bg-slate-50 p-3 sm:grid-cols-2"
                  onSubmit={handleProductChangeSubmit}
                >
                  <label className="space-y-1 text-sm font-medium text-slate-700">
                    <span>Previous Product Name</span>
                    <input
                      className="h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-slate-950"
                      onChange={(event) =>
                        setProductChangeForm((currentForm) => ({
                          ...currentForm,
                          previous_product_name: event.target.value,
                        }))
                      }
                      value={productChangeForm.previous_product_name}
                    />
                  </label>
                  <label className="space-y-1 text-sm font-medium text-slate-700">
                    <span>New Product Name</span>
                    <input
                      className="h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-slate-950"
                      onChange={(event) =>
                        setProductChangeForm((currentForm) => ({
                          ...currentForm,
                          new_product_name: event.target.value,
                        }))
                      }
                      required
                      value={productChangeForm.new_product_name}
                    />
                  </label>
                  <label className="space-y-1 text-sm font-medium text-slate-700">
                    <span>Effective Date</span>
                    <input
                      className="h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-slate-950"
                      onChange={(event) =>
                        setProductChangeForm((currentForm) => ({
                          ...currentForm,
                          effective_date: event.target.value,
                        }))
                      }
                      required
                      type="date"
                      value={productChangeForm.effective_date}
                    />
                  </label>
                  <label className="space-y-1 text-sm font-medium text-slate-700 sm:col-span-2">
                    <span>Notes</span>
                    <textarea
                      className="min-h-16 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-slate-950"
                      onChange={(event) =>
                        setProductChangeForm((currentForm) => ({
                          ...currentForm,
                          notes: event.target.value,
                        }))
                      }
                      value={productChangeForm.notes}
                    />
                  </label>
                  <div className="flex justify-end gap-2 sm:col-span-2">
                    <button
                      className="h-9 cursor-pointer rounded-md border border-slate-300 px-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-100"
                      onClick={() => setIsProductChangeOpen(false)}
                      type="button"
                    >
                      Cancel
                    </button>
                    <button
                      className="h-9 cursor-pointer rounded-md bg-slate-950 px-3 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
                      disabled={isSavingProductChange}
                      type="submit"
                    >
                      {isSavingProductChange ? "Saving..." : "Save Product Change"}
                    </button>
                  </div>
                </form>
              ) : null}

              {card.product_changes.length > 0 ? (
                <div className="mt-4 divide-y divide-slate-200 rounded-md border border-slate-200">
                  {card.product_changes.map((change) => (
                    <div className="px-3 py-2 text-sm" key={change.id}>
                      <p className="font-semibold text-slate-950">
                        {change.previous_product_name} → {change.new_product_name}
                      </p>
                      <p className="text-xs text-slate-500">
                        Effective {formatDate(change.effective_date)}
                      </p>
                      {change.notes ? (
                        <p className="mt-1 text-xs text-slate-500">{change.notes}</p>
                      ) : null}
                    </div>
                  ))}
                </div>
              ) : (
                <p className="mt-3 text-sm text-slate-500">
                  No product changes recorded.
                </p>
              )}
            </section>
            <DetailSection
              isEditing={editingSection === "rewards"}
              items={[
                {
                  label: "Reward Program",
                  value: card.reward_program
                    ? `${card.reward_program.short_code} · ${card.reward_program.name}`
                    : card.rewards_type,
                },
                {
                  label: "Current Month",
                  value: Number(card.rewards_earned.current_month).toLocaleString(),
                },
                {
                  label: "YTD",
                  value: Number(card.rewards_earned.ytd).toLocaleString(),
                },
                {
                  label: "All Time",
                  value: Number(card.rewards_earned.all_time).toLocaleString(),
                },
              ]}
              onEdit={() => toggleSection("rewards")}
              title="Rewards"
            >
              <div className="grid gap-3 rounded-md border border-slate-200 bg-slate-50 p-3 sm:grid-cols-2 xl:grid-cols-3">
                <label className="space-y-1 text-sm font-medium text-slate-700">
                  <span>Reward Program</span>
                  <select
                    className="h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-950"
                    onChange={(event) =>
                      updateFormField("reward_program_id", event.target.value)
                    }
                    value={form.reward_program_id}
                  >
                    <option value="">Select program</option>
                    {rewardPrograms.map((program) => (
                      <option key={program.id} value={program.id}>
                        {program.short_code} · {program.name}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="sm:col-span-2 xl:col-span-3">
                  {renderSectionActions("rewards")}
                </div>
              </div>
            </DetailSection>
            <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
              <div className="mb-3 flex items-center justify-between gap-3">
                <div>
                  <h2 className="text-sm font-semibold text-slate-950">
                    Recent Reward Transactions
                  </h2>
                  <p className="text-xs text-slate-500">
                    Locked reward entries from purchase funding activity.
                  </p>
                </div>
              </div>
              {card.reward_transactions.length > 0 ? (
                <div className="divide-y divide-slate-200 rounded-md border border-slate-200">
                  {card.reward_transactions.slice(0, 10).map((transaction) => (
                    <div
                      className="grid gap-2 px-3 py-2 text-sm sm:grid-cols-[1fr_auto_auto_auto]"
                      key={transaction.id}
                    >
                      <Link
                        className="font-semibold text-slate-950 hover:underline"
                        href={`/purchases/${transaction.purchase_id}`}
                      >
                        Purchase #{transaction.purchase_id}
                      </Link>
                      <span className="text-slate-600">
                        {formatDate(transaction.purchase_date)}
                      </span>
                      <span className="text-slate-600">
                        {formatAmount(transaction.qualifying_spend)} ×{" "}
                        {Number(transaction.multiplier).toLocaleString()}x
                      </span>
                      <span className="font-semibold text-slate-950">
                        {Number(transaction.rewards_earned).toLocaleString()}
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="rounded-md border border-slate-200 px-3 py-3 text-sm text-slate-500">
                  No reward transactions recorded yet.
                </p>
              )}
            </section>
            <DetailSection
              isEditing={editingSection === "notes"}
              items={[
                { label: "Payment Options", value: card.payment_options || "Not set" },
                { label: "Notes", value: card.notes || "Not set" },
              ]}
              onEdit={() => toggleSection("notes")}
              title="Notes"
            >
              <div className="grid gap-3 rounded-md border border-slate-200 bg-slate-50 p-3 md:grid-cols-2">
                <label className="space-y-1 text-sm font-medium text-slate-700">
                  <span>Payment Options</span>
                  <textarea
                    className="min-h-24 w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-950 outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-200"
                    onChange={(event) =>
                      updateFormField("payment_options", event.target.value)
                    }
                    value={form.payment_options}
                  />
                </label>
                <label className="space-y-1 text-sm font-medium text-slate-700">
                  <span>Notes</span>
                  <textarea
                    className="min-h-24 w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-950 outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-200"
                    onChange={(event) =>
                      updateFormField("notes", event.target.value)
                    }
                    value={form.notes}
                  />
                </label>
                <div className="md:col-span-2">{renderSectionActions("notes")}</div>
              </div>
            </DetailSection>
            {signupBonus && !signupBonus.isActive ? (
              <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
                <button
                  className="flex w-full cursor-pointer items-center justify-between gap-3 text-left"
                  onClick={() =>
                    setIsArchivedBonusOpen((currentValue) => !currentValue)
                  }
                  type="button"
                >
                  <div>
                    <h2 className="text-lg font-semibold text-slate-950">
                      Archived Signup Bonus
                    </h2>
                    <p className="mt-1 text-sm text-slate-500">
                      {signupBonus.isCompleted
                        ? "Spend requirement completed."
                        : signupBonus.isExpired
                          ? "Signup bonus deadline has passed."
                          : "Historical signup bonus reference."}
                    </p>
                  </div>
                  <span className="text-sm font-semibold text-slate-600">
                    {isArchivedBonusOpen ? "Hide" : "Show"}
                  </span>
                </button>
                {isArchivedBonusOpen ? (
                  <div className="mt-4">
                    <div className="mb-4 overflow-hidden rounded-full bg-slate-200">
                      <div
                        className="h-3 rounded-full bg-slate-500"
                        style={{ width: `${signupBonus.progressPercent}%` }}
                      />
                    </div>
                    <dl className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                      {[
                        {
                          label: "Required Spend",
                          value: formatAmount(card.signup_bonus_spend),
                        },
                        {
                          label: "Current Progress",
                          value: formatAmount(card.current_spend_progress),
                        },
                        {
                          label: "Remaining Spend",
                          value: formatAmount(signupBonus.remainingSpend),
                        },
                        {
                          label: "Deadline",
                          value: formatDate(card.signup_bonus_deadline),
                        },
                        {
                          label: "Estimated Completion",
                          value: formatProgressPercent(
                            toNumber(card.current_spend_progress),
                            signupBonus.requiredSpend,
                          ),
                        },
                        {
                          label: "Signup Bonus Points",
                          value:
                            card.signup_bonus_points === null
                              ? "Not set"
                              : card.signup_bonus_points.toLocaleString(),
                        },
                      ].map((item) => (
                        <div key={item.label}>
                          <dt className="text-sm font-medium text-slate-500">
                            {item.label}
                          </dt>
                          <dd className="mt-1 text-base font-semibold text-slate-950">
                            {item.value}
                          </dd>
                        </div>
                      ))}
                    </dl>
                    <button
                      className="mt-4 h-9 cursor-pointer rounded-md border border-slate-300 px-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-100 active:bg-slate-200"
                      onClick={() => {
                        setIsArchivedBonusOpen(true);
                        toggleSection("bonus");
                      }}
                      type="button"
                    >
                      {editingSection === "bonus" ? "Close" : "Edit"}
                    </button>
                    {editingSection === "bonus" ? (
                      <div className="mt-4 grid gap-3 rounded-md border border-slate-200 bg-slate-50 p-3 sm:grid-cols-2 xl:grid-cols-3">
                        {renderInlineInput("signup_bonus_spend", "Signup Bonus Spend", "number")}
                        {renderInlineInput("current_spend_progress", "Current Spend Progress", "number")}
                        {renderInlineInput("signup_bonus_points", "Signup Bonus Points", "number")}
                        {renderInlineInput("signup_bonus_deadline", "Signup Bonus Deadline", "date")}
                        <div className="sm:col-span-2 xl:col-span-3">
                          {renderSectionActions("bonus")}
                        </div>
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </section>
            ) : null}
        </div>
      </div>
      {rewardRulePendingDelete ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center modal-backdrop px-4 py-6 sm:items-center">
          <div className="w-full max-w-md rounded-lg bg-white p-5 shadow-xl">
            <h2 className="text-lg font-semibold text-slate-950">
              Remove Reward Rule
            </h2>
            <p className="mt-2 text-sm text-slate-600">
              Remove this reward rule? Existing purchase reward ledger entries
              already locked will not be changed unless recalculated.
            </p>
            <div className="mt-4 rounded-md border border-slate-200 bg-slate-50 p-3 text-sm">
              <p className="font-semibold text-slate-950">
                {rewardRulePendingDelete.spending_category.name} ·{" "}
                {Number(rewardRulePendingDelete.multiplier).toFixed(1)}x
              </p>
              <p className="mt-1 text-xs text-slate-500">
                Future purchases will use remaining rules, then General, then 1x.
              </p>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button
                className="h-10 cursor-pointer rounded-md border border-slate-300 px-4 text-sm font-semibold text-slate-700 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60"
                disabled={isDeletingRewardRule}
                onClick={() => setRewardRulePendingDelete(null)}
                type="button"
              >
                Cancel
              </button>
              <button
                className="h-10 cursor-pointer rounded-md bg-red-700 px-4 text-sm font-semibold text-white transition hover:bg-red-800 disabled:cursor-not-allowed disabled:opacity-60"
                disabled={isDeletingRewardRule}
                onClick={handleDeleteRewardRule}
                type="button"
              >
                {isDeletingRewardRule ? "Removing..." : "Remove Rule"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}
