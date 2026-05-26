"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";

import { API_BASE_URL } from "@/lib/api";

type RewardProgramMetric = {
  reward_program_id: number | null;
  name: string;
  short_code: string;
  category: string;
  estimated_value_cents_per_point: string | number | null;
  value_unit: string | null;
  valuation_status: "fixed" | "variable" | "not_configured" | string;
  estimated_rewards_earned: string | number;
  estimated_value: string | number;
};

type DrilldownMetric = {
  qualifying_spend: string | number;
  estimated_rewards_earned: string | number;
  estimated_value: string | number;
};

type ProgramCardMetric = DrilldownMetric & {
  credit_card_id: number;
  nickname: string;
  issuer: string;
  player_label: string | null;
};

type ProgramPurchaseMetric = {
  purchase_id: number | null;
  store_name: string;
  purchase_date: string | null;
  qualifying_spend: string | number;
  multiplier: string | number | null;
  rewards_earned: string | number;
  estimated_value: string | number;
  value_unit: string | null;
  valuation_status: "fixed" | "variable" | "not_configured" | string;
  credit_card_id: number | null;
  credit_card_nickname: string | null;
  player_id: number | null;
  player_label: string | null;
  player_name: string | null;
  spending_category_id: number | null;
  spending_category_name: string | null;
  reward_program_id: number | null;
  reward_program_name: string;
  reward_program_short_code: string;
  calculation_source: string | null;
};

type ProgramCategoryMetric = DrilldownMetric & {
  spending_category_id: number;
  key: string;
  name: string;
};

type ProgramMonthMetric = DrilldownMetric & {
  month: string;
};

type ProgramPlayerMetric = DrilldownMetric & {
  player_id: number | null;
  label: string;
  name: string | null;
};

type RewardProgramDrilldown = {
  reward_program_id: number | null;
  name: string;
  short_code: string;
  category: string;
  estimated_value_cents_per_point: string | number | null;
  value_unit: string | null;
  valuation_status: "fixed" | "variable" | "not_configured" | string;
  cards: ProgramCardMetric[];
  purchases: ProgramPurchaseMetric[];
  categories: ProgramCategoryMetric[];
  months: ProgramMonthMetric[];
  players: ProgramPlayerMetric[];
};

type ActiveSignupBonus = {
  credit_card_id: number;
  nickname: string;
  issuer: string;
  player_label: string | null;
  required_spend: string | number;
  current_progress: string | number;
  remaining_spend: string | number;
  deadline: string | null;
  progress_percent: string | number;
  signup_bonus_points: number;
};

type InstantDiscountGroup = {
  label: string;
  store_name: string;
  credit_card_id: number | null;
  credit_card_nickname: string | null;
  player_id: number | null;
  player_label: string | null;
  eligible_spend: string | number;
  total_saved: string | number;
  count: number;
};

type InstantDiscountDetail = {
  transaction_id: number;
  purchase_id: number | null;
  store_name: string;
  purchase_date: string | null;
  credit_card_id: number | null;
  credit_card_nickname: string | null;
  player_id: number | null;
  player_label: string | null;
  player_name: string | null;
  eligible_spend: string | number;
  saved_amount: string | number;
  reward_type: string;
  matched_rule_id: number | null;
  calculation_source: string | null;
};

type InstantDiscountSummary = {
  total_saved: string | number;
  eligible_spend: string | number;
  count: number;
  groups: InstantDiscountGroup[];
  details: InstantDiscountDetail[];
};

type RewardsSummary = {
  rewards_by_program: RewardProgramMetric[];
  reward_program_drilldowns: RewardProgramDrilldown[];
  instant_discounts?: InstantDiscountSummary;
  pending_rewards: string | number;
  fuel_points_earned: string | number;
  signup_bonuses_earned: string | number;
  active_signup_bonuses: ActiveSignupBonus[];
};

type AppSettings = {
  multi_player_mode_enabled: boolean;
};

type Player = {
  id: number;
  label: string;
  name: string | null;
};

type DetailTab = "purchases" | "cards" | "categories" | "players" | "monthly";

const reportingRanges = [
  { label: "Month to Date", value: "this_month" },
  { label: "Last Month", value: "last_month" },
  { label: "Year to Date", value: "ytd" },
  { label: "All Time", value: "all_time" },
];

const detailTabs: Array<{ label: string; value: DetailTab }> = [
  { label: "Purchases", value: "purchases" },
  { label: "Credit Cards", value: "cards" },
  { label: "Categories", value: "categories" },
  { label: "Players", value: "players" },
  { label: "Monthly Trend", value: "monthly" },
];

function numericValue(value: string | number | null | undefined) {
  const numberValue = Number(value ?? 0);
  return Number.isNaN(numberValue) ? 0 : numberValue;
}

function formatNumber(value: string | number | null | undefined, digits = 0) {
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: digits,
  }).format(numericValue(value));
}

function formatCurrency(value: string | number | null | undefined) {
  return new Intl.NumberFormat("en-US", {
    currency: "USD",
    style: "currency",
  }).format(numericValue(value));
}

function formatDate(value: string | null) {
  if (!value) {
    return "-";
  }

  const parsed = new Date(`${value}T00:00:00`);

  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(parsed);
}

function titleize(value: string | null | undefined) {
  return (value || "unknown")
    .replaceAll("_", " ")
    .toLowerCase()
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function isCashback(category: string) {
  return category.toLowerCase() === "cashback";
}

function rewardAmount(
  value: string | number | null | undefined,
  category: string,
) {
  if (isCashback(category)) {
    return formatCurrency(value);
  }

  return `${formatNumber(value)} pts`;
}

function estimatedValueLabel(program: RewardProgramMetric) {
  if (program.valuation_status === "variable") {
    return "Variable value";
  }

  if (program.valuation_status !== "fixed") {
    return "Value not configured";
  }

  return formatCurrency(program.estimated_value);
}

function hasFixedValuation(program: Pick<RewardProgramMetric, "valuation_status">) {
  return program.valuation_status === "fixed";
}

function programKey(program: Pick<RewardProgramMetric, "short_code" | "reward_program_id">) {
  return program.reward_program_id === null
    ? program.short_code
    : `${program.reward_program_id}:${program.short_code}`;
}

function getQueryParams() {
  if (typeof window === "undefined") {
    return new URLSearchParams();
  }

  return new URLSearchParams(window.location.search);
}

export default function RewardsPage() {
  const [summary, setSummary] = useState<RewardsSummary | null>(null);
  const [reportingRange, setReportingRange] = useState("this_month");
  const [selectedPlayerId, setSelectedPlayerId] = useState("ALL");
  const [selectedCategory, setSelectedCategory] = useState("ALL");
  const [selectedProgram, setSelectedProgram] = useState("ALL");
  const [selectedCard, setSelectedCard] = useState("ALL");
  const [selectedStoreCategory, setSelectedStoreCategory] = useState("ALL");
  const [players, setPlayers] = useState<Player[]>([]);
  const [isMultiPlayerModeEnabled, setIsMultiPlayerModeEnabled] = useState(false);
  const [expandedPrograms, setExpandedPrograms] = useState<Set<string>>(new Set());
  const [expandedInstantDiscounts, setExpandedInstantDiscounts] = useState<Set<string>>(new Set());
  const [activeTabs, setActiveTabs] = useState<Record<string, DetailTab>>({});
  const [isBonusOpen, setIsBonusOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    queueMicrotask(() => {
      const params = getQueryParams();
      const categoryParam =
        params.get("category") ?? params.get("programCategory");
      const programCode = params.get("program");
      const cardId = params.get("card");
      const storeCategory = params.get("storeCategory");
      const section = params.get("section") ?? params.get("tab");

      if (categoryParam === "fuel") {
        setSelectedCategory("Fuel Rewards");
      } else if (categoryParam) {
        setSelectedStoreCategory(titleize(categoryParam));
      }

      if (programCode) {
        setSelectedProgram(programCode);
        setExpandedPrograms(new Set([programCode]));
      }

      if (cardId) {
        setSelectedCard(cardId);
      }

      if (storeCategory) {
        setSelectedStoreCategory(storeCategory);
      }

      if (section === "signup-bonuses") {
        setIsBonusOpen(true);
      }
    });
  }, []);

  useEffect(() => {
    async function loadRewards() {
      setIsLoading(true);
      setError(null);

      try {
        const params = new URLSearchParams({ range: reportingRange });

        if (selectedPlayerId !== "ALL") {
          params.set("player_id", selectedPlayerId);
        }

        const endpoint = `${API_BASE_URL}/dashboard/summary?${params.toString()}`;
        const response = await fetch(endpoint);

        if (!response.ok) {
          const body = await response.text();
          console.error("Rewards fetch failed", {
            endpoint,
            status: response.status,
            body,
          });
          throw new Error(
            `Failed to load rewards from ${endpoint} (${response.status}): ${
              body || response.statusText
            }`,
          );
        }

        setSummary((await response.json()) as RewardsSummary);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load rewards.");
      } finally {
        setIsLoading(false);
      }
    }

    void loadRewards();
  }, [reportingRange, selectedPlayerId]);

  useEffect(() => {
    async function loadSettings() {
      try {
        const [settingsResponse, playersResponse] = await Promise.all([
          fetch(`${API_BASE_URL}/app-settings`),
          fetch(`${API_BASE_URL}/players/`),
        ]);

        if (!settingsResponse.ok || !playersResponse.ok) {
          return;
        }

        const settings = (await settingsResponse.json()) as AppSettings;
        setIsMultiPlayerModeEnabled(settings.multi_player_mode_enabled);
        setPlayers((await playersResponse.json()) as Player[]);
      } catch {
        setIsMultiPlayerModeEnabled(false);
        setPlayers([]);
      }
    }

    void loadSettings();
  }, []);

  const drilldownsByCode = useMemo(() => {
    const map = new Map<string, RewardProgramDrilldown>();

    for (const drilldown of summary?.reward_program_drilldowns ?? []) {
      map.set(drilldown.short_code, drilldown);
    }

    return map;
  }, [summary]);

  const programSummaries = useMemo(
    () =>
      (summary?.rewards_by_program ?? []).map((program) => {
        const drilldown = drilldownsByCode.get(program.short_code);
        const qualifyingSpend = (drilldown?.purchases ?? []).reduce(
          (total, purchase) => total + numericValue(purchase.qualifying_spend),
          0,
        );

        return {
          ...program,
          qualifying_spend: qualifyingSpend,
          drilldown,
        };
      }),
    [drilldownsByCode, summary],
  );

  const rewardCategories = useMemo(
    () =>
      Array.from(new Set(programSummaries.map((program) => program.category))).sort(),
    [programSummaries],
  );

  const creditCards = useMemo(() => {
    const cards = new Map<number, string>();

    for (const drilldown of summary?.reward_program_drilldowns ?? []) {
      for (const card of drilldown.cards) {
        cards.set(
          card.credit_card_id,
          `${card.player_label ? `${card.player_label} · ` : ""}${card.nickname}`,
        );
      }
    }

    return Array.from(cards.entries()).sort((a, b) => a[1].localeCompare(b[1]));
  }, [summary]);

  const storeCategories = useMemo(() => {
    const categories = new Set<string>();

    for (const drilldown of summary?.reward_program_drilldowns ?? []) {
      for (const purchase of drilldown.purchases) {
        categories.add(purchase.spending_category_name ?? "Uncategorized");
      }
    }

    return Array.from(categories).sort();
  }, [summary]);

  const programs = useMemo(
    () =>
      programSummaries.filter((program) => {
        if (selectedCategory !== "ALL" && program.category !== selectedCategory) {
          return false;
        }

        if (
          selectedProgram !== "ALL" &&
          selectedProgram !== program.short_code &&
          selectedProgram !== programKey(program)
        ) {
          return false;
        }

        if (selectedCard !== "ALL") {
          const cardId = Number(selectedCard);
          if (!(program.drilldown?.cards ?? []).some((card) => card.credit_card_id === cardId)) {
            return false;
          }
        }

        if (selectedStoreCategory !== "ALL") {
          if (
            !(program.drilldown?.purchases ?? []).some(
              (purchase) =>
                (purchase.spending_category_name ?? "Uncategorized") ===
                selectedStoreCategory,
            )
          ) {
            return false;
          }
        }

        return true;
      }),
    [programSummaries, selectedCard, selectedCategory, selectedProgram, selectedStoreCategory],
  );

  const totalRewards = programs.reduce(
    (total, reward) => total + numericValue(reward.estimated_rewards_earned),
    0,
  );
  const estimatedValue = programs.reduce(
    (total, reward) =>
      total + (hasFixedValuation(reward) ? numericValue(reward.estimated_value) : 0),
    0,
  );
  const hasAnyFixedEstimatedValue = programs.some(hasFixedValuation);
  const activeFilterLabels = [
    selectedCategory !== "ALL" ? `Reward category: ${selectedCategory}` : null,
    selectedProgram !== "ALL" ? `Program: ${selectedProgram}` : null,
    selectedCard !== "ALL"
      ? `Credit card: ${
          creditCards.find(([cardId]) => String(cardId) === selectedCard)?.[1] ??
          selectedCard
        }`
      : null,
    selectedStoreCategory !== "ALL"
      ? `Store/category: ${selectedStoreCategory}`
      : null,
  ].filter(Boolean);

  function toggleProgram(program: RewardProgramMetric) {
    const key = programKey(program);

    setExpandedPrograms((current) => {
      const next = new Set(current);

      if (next.has(key) || next.has(program.short_code)) {
        next.delete(key);
        next.delete(program.short_code);
      } else {
        next.add(key);
      }

      return next;
    });
  }

  function activeTabFor(program: RewardProgramMetric) {
    return activeTabs[programKey(program)] ?? "purchases";
  }

  function setProgramTab(program: RewardProgramMetric, tab: DetailTab) {
    setActiveTabs((current) => ({
      ...current,
      [programKey(program)]: tab,
    }));
  }

  return (
    <main className="min-h-screen bg-slate-950 px-4 py-5 text-slate-100 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-7xl space-y-4">
        <header className="flex flex-col gap-3 border-b border-white/10 pb-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-cyan-200/80">
              Rewards Intelligence
            </p>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight text-white">
              Rewards Earned
            </h1>
          </div>

          <div className="grid gap-2 md:grid-cols-3 xl:grid-cols-6">
            <CompactSelect label="Date range" onChange={setReportingRange} value={reportingRange}>
              {reportingRanges.map((range) => (
                <option key={range.value} value={range.value}>
                  {range.label}
                </option>
              ))}
            </CompactSelect>
            {isMultiPlayerModeEnabled ? (
              <CompactSelect label="Player" onChange={setSelectedPlayerId} value={selectedPlayerId}>
                <option value="ALL">All players</option>
                {players.map((player) => (
                  <option key={player.id} value={player.id}>
                    {player.label}
                    {player.name ? ` · ${player.name}` : ""}
                  </option>
                ))}
              </CompactSelect>
            ) : null}
            <CompactSelect label="Reward program" onChange={setSelectedProgram} value={selectedProgram}>
              <option value="ALL">All programs</option>
              {programSummaries.map((program) => (
                <option key={programKey(program)} value={program.short_code}>
                  {program.short_code} · {program.name}
                </option>
              ))}
            </CompactSelect>
            <CompactSelect label="Reward category" onChange={setSelectedCategory} value={selectedCategory}>
              <option value="ALL">All categories</option>
              {rewardCategories.map((category) => (
                <option key={category} value={category}>
                  {category}
                </option>
              ))}
            </CompactSelect>
            <CompactSelect label="Credit card" onChange={setSelectedCard} value={selectedCard}>
              <option value="ALL">All cards</option>
              {creditCards.map(([cardId, label]) => (
                <option key={cardId} value={cardId}>
                  {label}
                </option>
              ))}
            </CompactSelect>
            <CompactSelect
              label="Store/category"
              onChange={setSelectedStoreCategory}
              value={selectedStoreCategory}
            >
              <option value="ALL">All store categories</option>
              {storeCategories.map((category) => (
                <option key={category} value={category}>
                  {category}
                </option>
              ))}
            </CompactSelect>
          </div>
        </header>

        {error ? (
          <div className="rounded-lg border border-red-400/35 bg-red-500/10 px-4 py-3 text-sm font-medium text-red-100">
            {error}
          </div>
        ) : null}

        {activeFilterLabels.length > 0 ? (
          <div className="flex flex-col gap-3 rounded-lg border border-cyan-300/25 bg-cyan-300/10 px-4 py-3 text-sm text-cyan-50 sm:flex-row sm:items-center sm:justify-between">
            <p className="font-semibold">
              Showing: {activeFilterLabels.join(" · ")}
            </p>
            <Link className="font-semibold hover:underline" href="/rewards">
              Clear filter
            </Link>
          </div>
        ) : null}

        {isLoading || !summary ? (
          <div className="rounded-xl border border-white/10 bg-white/[0.03] p-5 text-sm text-slate-400">
            Loading rewards...
          </div>
        ) : (
          <>
            <section className="grid gap-2 sm:grid-cols-2 xl:grid-cols-5">
              <SummaryCard href="/rewards" label="Total rewards" value={formatNumber(totalRewards)} />
              <SummaryCard href="/rewards" label="Estimated value" value={hasAnyFixedEstimatedValue ? formatCurrency(estimatedValue) : "Value not configured"} />
              <SummaryCard href="/rewards?category=fuel" label="Fuel points" value={formatNumber(summary.fuel_points_earned)} />
              <SummaryCard href="/rewards?section=signup-bonuses" label="Signup bonuses" value={formatNumber(summary.signup_bonuses_earned)} />
              <SummaryCard href="/rewards?filter=pending" label="Pending rewards" value={formatNumber(summary.pending_rewards)} />
            </section>

            <section className="rounded-xl border border-white/10 bg-slate-950/55 shadow-2xl shadow-black/10">
              <div className="flex items-center justify-between gap-3 border-b border-white/10 px-4 py-3">
                <div>
                  <h2 className="text-sm font-semibold uppercase tracking-[0.18em] text-slate-300">
                    Reward Programs
                  </h2>
                  <p className="mt-1 text-xs text-slate-500">
                    Reward currency first. Expand a program to see transactions, cards,
                    categories, players, and monthly trend.
                  </p>
                </div>
                <span className="text-xs text-slate-500">
                  {programs.length} program{programs.length === 1 ? "" : "s"}
                </span>
              </div>

              <div className="divide-y divide-white/10">
                {programs.length ? (
                  programs.map((program, index) => {
                    const key = programKey(program);
                    const isExpanded =
                      expandedPrograms.has(key) ||
                      expandedPrograms.has(program.short_code);

                    return (
                      <article
                        className={index % 2 === 0 ? "bg-slate-950/30" : "bg-white/[0.025]"}
                        key={key}
                      >
                        <button
                          className="grid w-full cursor-pointer gap-3 px-4 py-3 text-left transition hover:bg-white/[0.055] lg:grid-cols-[minmax(0,1.3fr)_auto_auto_auto_auto] lg:items-center"
                          onClick={() => toggleProgram(program)}
                          type="button"
                        >
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <p className="truncate text-base font-semibold text-white">
                                {program.name}
                              </p>
                              <span className="rounded border border-cyan-300/20 bg-cyan-300/10 px-1.5 py-0.5 text-[11px] font-semibold text-cyan-100">
                                {program.short_code}
                              </span>
                            </div>
                            <p className="mt-0.5 text-xs text-slate-500">
                              {program.category}
                            </p>
                          </div>
                          <ProgramStat
                            label="earned"
                            value={rewardAmount(
                              program.estimated_rewards_earned,
                              program.category,
                            )}
                          />
                          <ProgramStat
                            label="spend"
                            value={formatCurrency(program.qualifying_spend)}
                          />
                          <div className="text-left lg:text-right">
                            <p className="text-sm font-semibold text-slate-200">
                              {estimatedValueLabel(program)}
                            </p>
                            <p className="text-xs text-slate-500">estimated value</p>
                          </div>
                          <span className="text-sm font-semibold text-cyan-200 lg:text-right">
                            {isExpanded ? "Hide details" : "View details"}
                          </span>
                        </button>

                        {isExpanded ? (
                          <ProgramDetails
                            activeTab={activeTabFor(program)}
                            category={program.category}
                            drilldown={program.drilldown}
                            onTabChange={(tab) => setProgramTab(program, tab)}
                            shortCode={program.short_code}
                          />
                        ) : null}
                      </article>
                    );
                  })
                ) : (
                  <EmptyState text="No reward programs match the current filters." />
                )}
              </div>
            </section>

            {summary.instant_discounts &&
            numericValue(summary.instant_discounts.count) > 0 ? (
              <InstantDiscountsSection
                expandedGroups={expandedInstantDiscounts}
                instantDiscounts={summary.instant_discounts}
                onToggleGroup={(key) => {
                  setExpandedInstantDiscounts((current) => {
                    const next = new Set(current);

                    if (next.has(key)) {
                      next.delete(key);
                    } else {
                      next.add(key);
                    }

                    return next;
                  });
                }}
              />
            ) : null}

            <section className="rounded-xl border border-white/10 bg-slate-950/55 shadow-2xl shadow-black/10">
              <button
                className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition hover:bg-white/[0.045]"
                onClick={() => setIsBonusOpen((current) => !current)}
                type="button"
              >
                <div>
                  <h2 className="text-sm font-semibold uppercase tracking-[0.18em] text-slate-300">
                    Active Signup Bonuses
                  </h2>
                  <p className="mt-1 text-xs text-slate-500">
                    SUB tracking is separate from reward program drilldowns.
                  </p>
                </div>
                <span className="text-sm font-semibold text-cyan-200">
                  {isBonusOpen ? "Collapse" : "Expand"}
                </span>
              </button>

              {isBonusOpen ? (
                <div className="space-y-2 border-t border-white/10 p-3">
                  {summary.active_signup_bonuses.length ? (
                    summary.active_signup_bonuses.map((bonus) => (
                      <div
                        className="rounded-lg border border-white/10 bg-white/[0.03] p-3"
                        key={bonus.credit_card_id}
                      >
                        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                          <div>
                            <Link
                              className="font-semibold text-white hover:text-cyan-100"
                              href={`/credit-cards/${bonus.credit_card_id}`}
                            >
                              {bonus.player_label ? `${bonus.player_label} · ` : ""}
                              {bonus.nickname}
                            </Link>
                            <p className="text-xs text-slate-500">
                              {bonus.issuer} · deadline {formatDate(bonus.deadline)}
                            </p>
                          </div>
                          <p className="text-sm font-semibold text-slate-200">
                            {formatNumber(bonus.signup_bonus_points)} pts
                          </p>
                        </div>
                        <div className="mt-3 h-1.5 rounded-full bg-white/10">
                          <div
                            className="h-1.5 rounded-full bg-cyan-300"
                            style={{
                              width: `${Math.min(
                                100,
                                numericValue(bonus.progress_percent),
                              )}%`,
                            }}
                          />
                        </div>
                        <div className="mt-2 grid gap-1 text-xs text-slate-500 sm:grid-cols-3">
                          <span>{formatCurrency(bonus.current_progress)} spent</span>
                          <span>{formatCurrency(bonus.remaining_spend)} left</span>
                          <span>{formatCurrency(bonus.required_spend)} required</span>
                        </div>
                      </div>
                    ))
                  ) : (
                    <EmptyState text="No active signup bonuses." />
                  )}
                </div>
              ) : null}
            </section>
          </>
        )}
      </div>
    </main>
  );
}

function CompactSelect({
  children,
  label,
  onChange,
  value,
}: {
  children: ReactNode;
  label: string;
  onChange: (value: string) => void;
  value: string;
}) {
  return (
    <label className="grid gap-1 text-xs font-medium text-slate-500">
      {label}
      <select
        className="h-8 rounded-md border border-white/10 bg-slate-900 px-2 text-sm text-slate-100 outline-none transition focus:border-cyan-300/60"
        onChange={(event) => onChange(event.target.value)}
        value={value}
      >
        {children}
      </select>
    </label>
  );
}

function SummaryCard({
  href,
  label,
  value,
}: {
  href: string;
  label: string;
  value: string;
}) {
  return (
    <Link
      className="rounded-lg border border-white/10 bg-white/[0.035] px-3 py-2.5 shadow-2xl shadow-black/10 transition hover:border-cyan-200/25 hover:bg-white/[0.055]"
      href={href}
    >
      <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">
        {label}
      </p>
      <p className="mt-1 text-lg font-semibold tracking-tight text-white">{value}</p>
    </Link>
  );
}

function ProgramStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="text-left lg:text-right">
      <p className="text-sm font-semibold text-slate-100">{value}</p>
      <p className="text-xs text-slate-500">{label}</p>
    </div>
  );
}

function InstantDiscountsSection({
  expandedGroups,
  instantDiscounts,
  onToggleGroup,
}: {
  expandedGroups: Set<string>;
  instantDiscounts: InstantDiscountSummary;
  onToggleGroup: (key: string) => void;
}) {
  const groupCount = instantDiscounts.groups.length;

  return (
    <section className="rounded-xl border border-white/10 bg-slate-950/55 shadow-2xl shadow-black/10">
      <div className="flex items-center justify-between gap-3 border-b border-white/10 px-4 py-3">
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-[0.18em] text-slate-300">
            Instant Discounts
          </h2>
          <p className="mt-1 text-xs text-slate-500">
            Purchase-time savings from card-linked discounts.
          </p>
        </div>
        <span className="text-xs text-slate-500">
          {groupCount} discount program{groupCount === 1 ? "" : "s"}
        </span>
      </div>

      <div className="divide-y divide-white/10">
        {instantDiscounts.groups.map((group) => {
          const key = instantDiscountGroupKey(group);
          const isExpanded = expandedGroups.has(key);
          const details = instantDiscounts.details.filter(
            (detail) => instantDiscountGroupKey(detail) === key,
          );

          return (
            <article key={key}>
              <button
                className="grid w-full cursor-pointer gap-3 px-4 py-3 text-left transition hover:bg-white/[0.055] lg:grid-cols-[minmax(0,1.3fr)_auto_auto_auto] lg:items-center"
                onClick={() => onToggleGroup(key)}
                type="button"
              >
                <div className="min-w-0">
                  <p className="truncate text-base font-semibold text-white">
                    {group.label}
                  </p>
                  <p className="mt-0.5 text-xs text-slate-500">
                    {group.store_name}
                    {group.credit_card_nickname
                      ? ` · ${group.credit_card_nickname}`
                      : ""}
                  </p>
                </div>
                <ProgramStat label="saved" value={formatCurrency(group.total_saved)} />
                <ProgramStat
                  label="eligible spend"
                  value={formatCurrency(group.eligible_spend)}
                />
                <span className="text-sm font-semibold text-cyan-200 lg:text-right">
                  {isExpanded ? "Hide details" : "View details"}
                </span>
              </button>

              {isExpanded ? (
                <InstantDiscountDetails details={details} />
              ) : null}
            </article>
          );
        })}
      </div>
    </section>
  );
}

function instantDiscountGroupKey(
  item: Pick<InstantDiscountGroup | InstantDiscountDetail, "store_name" | "credit_card_id">,
) {
  return `${item.store_name}-${item.credit_card_id ?? "card"}`;
}

function InstantDiscountDetails({
  details,
}: {
  details: InstantDiscountDetail[];
}) {
  if (details.length === 0) {
    return <EmptyState text="No instant discount transactions." />;
  }

  return (
    <div className="border-t border-white/10 bg-slate-900/55 p-3">
      <div className="overflow-x-auto rounded-lg border border-white/10">
        <table className="min-w-full text-sm">
          <thead className="bg-white/[0.035] text-left text-[11px] uppercase tracking-[0.14em] text-slate-500">
            <tr>
              <th className="px-3 py-2">Date</th>
              <th className="px-3 py-2">Purchase</th>
              <th className="px-3 py-2">Card</th>
              <th className="px-3 py-2">Player</th>
              <th className="px-3 py-2 text-right">Eligible spend</th>
              <th className="px-3 py-2 text-right">Saved</th>
              <th className="px-3 py-2">Source</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/10">
            {details.map((detail, index) => (
              <tr
                className={index % 2 === 0 ? "bg-slate-950/35" : "bg-white/[0.025]"}
                key={detail.transaction_id}
              >
                <td className="whitespace-nowrap px-3 py-2 text-slate-400">
                  {formatDate(detail.purchase_date)}
                </td>
                <td className="px-3 py-2">
                  {detail.purchase_id ? (
                    <Link
                      className="font-semibold text-slate-100 hover:text-cyan-100"
                      href={`/purchases/${detail.purchase_id}`}
                    >
                      Purchase #{detail.purchase_id}
                    </Link>
                  ) : (
                    <span className="font-semibold text-slate-100">Purchase</span>
                  )}
                  <p className="text-xs text-slate-500">{detail.store_name}</p>
                </td>
                <td className="px-3 py-2 text-slate-300">
                  {detail.credit_card_nickname ?? "-"}
                </td>
                <td className="px-3 py-2 text-slate-300">
                  {detail.player_label
                    ? `${detail.player_label}${detail.player_name ? ` · ${detail.player_name}` : ""}`
                    : "-"}
                </td>
                <td className="px-3 py-2 text-right text-slate-100">
                  {formatCurrency(detail.eligible_spend)}
                </td>
                <td className="px-3 py-2 text-right font-semibold text-slate-100">
                  {formatCurrency(detail.saved_amount)}
                </td>
                <td className="px-3 py-2 text-slate-400">
                  {titleize(detail.calculation_source)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ProgramDetails({
  activeTab,
  category,
  drilldown,
  onTabChange,
  shortCode,
}: {
  activeTab: DetailTab;
  category: string;
  drilldown: RewardProgramDrilldown | undefined;
  onTabChange: (tab: DetailTab) => void;
  shortCode: string;
}) {
  return (
    <div className="border-t border-white/10 bg-slate-900/55 p-3">
      <div className="flex flex-wrap gap-2">
        {detailTabs.map((tab) => (
          <button
            className={`h-8 rounded-md border px-2.5 text-xs font-semibold transition ${
              activeTab === tab.value
                ? "border-cyan-300/45 bg-cyan-300/10 text-cyan-100"
                : "border-white/10 bg-slate-950/45 text-slate-400 hover:bg-white/[0.05]"
            }`}
            key={tab.value}
            onClick={() => onTabChange(tab.value)}
            type="button"
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="mt-3">
        {activeTab === "purchases" ? (
          <PurchaseTransactions
            category={category}
            purchases={drilldown?.purchases ?? []}
            shortCode={shortCode}
          />
        ) : null}
        {activeTab === "cards" ? (
          <DetailPanel title="Credit Cards">
            {drilldown?.cards.length ? (
              <div className="divide-y divide-white/10">
                {drilldown.cards.map((card) => (
                  <CompactMetricRow
                    detail={`${formatCurrency(card.qualifying_spend)} spend`}
                    href={`/credit-cards/${card.credit_card_id}`}
                    key={card.credit_card_id}
                    label={`${card.player_label ? `${card.player_label} · ` : ""}${card.nickname}`}
                    value={rewardAmount(card.estimated_rewards_earned, category)}
                  />
                ))}
              </div>
            ) : (
              <EmptyState text="No credit card earnings for this program." />
            )}
          </DetailPanel>
        ) : null}
        {activeTab === "categories" ? (
          <DetailPanel title="Categories">
            <MetricList
              empty={!drilldown || drilldown.categories.length === 0}
              items={(drilldown?.categories ?? []).map((item) => ({
                detail: `${formatCurrency(item.qualifying_spend)} spend`,
                key: item.key,
                label: item.name,
                value: rewardAmount(item.estimated_rewards_earned, category),
              }))}
            />
          </DetailPanel>
        ) : null}
        {activeTab === "players" ? (
          <DetailPanel title="Players">
            <MetricList
              empty={!drilldown || drilldown.players.length === 0}
              items={(drilldown?.players ?? []).map((item) => ({
                detail: item.name ?? "Unassigned",
                key: String(item.player_id ?? item.label),
                label: item.label,
                value: rewardAmount(item.estimated_rewards_earned, category),
              }))}
            />
          </DetailPanel>
        ) : null}
        {activeTab === "monthly" ? (
          <DetailPanel title="Monthly Trend">
            <MetricList
              empty={!drilldown || drilldown.months.length === 0}
              items={(drilldown?.months ?? []).map((item) => ({
                detail: `${formatCurrency(item.qualifying_spend)} spend`,
                key: item.month,
                label: item.month,
                value: rewardAmount(item.estimated_rewards_earned, category),
              }))}
            />
          </DetailPanel>
        ) : null}
      </div>
    </div>
  );
}

function PurchaseTransactions({
  category,
  purchases,
  shortCode,
}: {
  category: string;
  purchases: ProgramPurchaseMetric[];
  shortCode: string;
}) {
  if (purchases.length === 0) {
    return <EmptyState text="No reward transactions for this program." />;
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-white/10">
      <table className="min-w-full text-sm">
        <thead className="bg-white/[0.035] text-left text-[11px] uppercase tracking-[0.14em] text-slate-500">
          <tr>
            <th className="px-3 py-2">Date</th>
            <th className="px-3 py-2">Purchase</th>
            <th className="px-3 py-2">Card</th>
            <th className="px-3 py-2">Player</th>
            <th className="px-3 py-2">Category</th>
            <th className="px-3 py-2 text-right">Spend</th>
            <th className="px-3 py-2 text-right">Rate</th>
            <th className="px-3 py-2">Program</th>
            <th className="px-3 py-2 text-right">Earned</th>
            <th className="px-3 py-2">Source</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-white/10">
          {purchases.map((purchase, index) => (
            <tr
              className={index % 2 === 0 ? "bg-slate-950/35" : "bg-white/[0.025]"}
              key={`${purchase.purchase_id ?? "fuel"}-${index}`}
            >
              <td className="whitespace-nowrap px-3 py-2 text-slate-400">
                {formatDate(purchase.purchase_date)}
              </td>
              <td className="px-3 py-2">
                {purchase.purchase_id ? (
                  <Link
                    className="font-semibold text-slate-100 hover:text-cyan-100"
                    href={`/purchases/${purchase.purchase_id}`}
                  >
                    Purchase #{purchase.purchase_id}
                  </Link>
                ) : (
                  <span className="font-semibold text-slate-100">Fuel entry</span>
                )}
                <p className="text-xs text-slate-500">{purchase.store_name}</p>
              </td>
              <td className="px-3 py-2 text-slate-300">
                {purchase.credit_card_nickname ?? "-"}
              </td>
              <td className="px-3 py-2 text-slate-300">
                {purchase.player_label
                  ? `${purchase.player_label}${purchase.player_name ? ` · ${purchase.player_name}` : ""}`
                  : "-"}
              </td>
              <td className="px-3 py-2 text-slate-300">
                {purchase.spending_category_name ?? "Uncategorized"}
              </td>
              <td className="px-3 py-2 text-right text-slate-100">
                {formatCurrency(purchase.qualifying_spend)}
              </td>
              <td className="px-3 py-2 text-right text-slate-100">
                {formatNumber(purchase.multiplier, 2)}x
              </td>
              <td className="px-3 py-2 text-slate-300">
                {purchase.reward_program_short_code || shortCode}
              </td>
              <td className="px-3 py-2 text-right font-semibold text-slate-100">
                {rewardAmount(purchase.rewards_earned, category)}
              </td>
              <td className="px-3 py-2 text-slate-400">
                {titleize(purchase.calculation_source)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function DetailPanel({
  children,
  title,
}: {
  children: ReactNode;
  title: string;
}) {
  return (
    <section className="rounded-lg border border-white/10 bg-slate-950/45">
      <h3 className="border-b border-white/10 px-3 py-2 text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">
        {title}
      </h3>
      <div className="p-2">{children}</div>
    </section>
  );
}

function CompactMetricRow({
  detail,
  href,
  label,
  value,
}: {
  detail: string;
  href?: string;
  label: string;
  value: string;
}) {
  const content = (
    <>
      <div className="min-w-0">
        <p className="truncate text-sm font-semibold text-slate-100">{label}</p>
        <p className="truncate text-xs text-slate-500">{detail}</p>
      </div>
      <p className="shrink-0 text-sm font-semibold text-slate-100">{value}</p>
    </>
  );

  if (href) {
    return (
      <Link
        className="grid grid-cols-[minmax(0,1fr)_auto] gap-3 px-2 py-2 transition hover:bg-white/[0.045]"
        href={href}
      >
        {content}
      </Link>
    );
  }

  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-3 px-2 py-2">
      {content}
    </div>
  );
}

function MetricList({
  empty,
  items,
}: {
  empty: boolean;
  items: Array<{ key: string; label: string; value: string; detail: string }>;
}) {
  if (empty) {
    return <EmptyState text="No activity for this program in this view." />;
  }

  return (
    <div className="divide-y divide-white/10">
      {items.map((item) => (
        <div
          className="grid grid-cols-[minmax(0,1fr)_auto] gap-3 px-2 py-2 text-sm"
          key={item.key}
        >
          <div className="min-w-0">
            <p className="truncate font-semibold text-slate-100">{item.label}</p>
            <p className="truncate text-xs text-slate-500">{item.detail}</p>
          </div>
          <p className="font-semibold text-slate-100">{item.value}</p>
        </div>
      ))}
    </div>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <p className="rounded-lg border border-white/10 bg-white/[0.025] px-3 py-4 text-sm text-slate-500">
      {text}
    </p>
  );
}
