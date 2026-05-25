"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Component,
  ErrorInfo,
  FormEvent,
  ReactNode,
  useEffect,
  useRef,
  useState,
} from "react";

import { API_BASE_URL } from "@/lib/api";

type SpendingCategory = {
  id: number;
  key: string;
  name: string;
  active?: boolean;
};

type RewardProgram = {
  id: number;
  name: string;
  short_code: string;
  category: string;
  active: boolean;
};

type Store = {
  id: number;
  name: string;
  store_type: string | null;
  retailer_group: string | null;
  merchant_category: string | null;
  merchant_type: string | null;
  spending_category_id: number | null;
  spending_category: SpendingCategory | null;
  reward_program_id: number | null;
  reward_program: RewardProgram | null;
  active: boolean;
  earns_fuel_points: boolean;
  default_fuel_multiplier: number | null;
  notes: string | null;
};

type StoreForm = {
  name: string;
  store_type: string;
  retailer_group: string;
  merchant_type: string;
  spending_category_id: string;
  reward_program_id: string;
  earns_fuel_points: boolean;
  default_fuel_multiplier: string;
  notes: string;
  active: boolean;
};

type StoresFetchResult = {
  stores: Store[];
  status: number | null;
  bodyShape: string;
  bodyPreview: string;
};

const emptyForm: StoreForm = {
  name: "",
  store_type: "",
  retailer_group: "",
  merchant_type: "",
  spending_category_id: "",
  reward_program_id: "",
  earns_fuel_points: false,
  default_fuel_multiplier: "",
  notes: "",
  active: true,
};

class StoresRenderBoundary extends Component<
  { children: ReactNode },
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[Stores] caught render error", error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <main className="min-h-screen bg-slate-50 px-4 py-6 text-slate-950 sm:px-6 lg:px-8">
          <section className="mx-auto max-w-4xl rounded-lg border border-red-200 bg-red-50 p-4 text-sm font-medium text-red-700">
            Stores failed to render: {this.state.error.message}
          </section>
        </main>
      );
    }

    return this.props.children;
  }
}

class StoreModalBoundary extends Component<
  { children: ReactNode; onClose: () => void },
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[StoresModal] caught render error", error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm font-medium text-red-700 shadow-xl">
          <p>Store modal failed to render: {this.state.error.message}</p>
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

class StoresTableBoundary extends Component<
  { children: ReactNode; stores: Store[] },
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[StoresTable] caught render error", {
      error,
      componentStack: info.componentStack,
      stores: this.props.stores,
    });
  }

  render() {
    if (this.state.error) {
      return (
        <section className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          <p className="font-semibold">Stores table failed to render.</p>
          <p className="mt-1">{this.state.error.message}</p>
          <pre className="mt-3 max-h-64 overflow-auto rounded-md bg-white p-3 text-xs text-red-950">
            {JSON.stringify(this.props.stores, null, 2)}
          </pre>
        </section>
      );
    }

    return this.props.children;
  }
}

async function responseError(response: Response, fallback: string) {
  const body = await response.text().catch(() => "");
  return `${fallback} at ${response.url} (${response.status})${
    body ? `: ${body}` : ""
  }`;
}

function normalizeStoresResponse(data: unknown): Store[] {
  let storesData: unknown[];

  if (Array.isArray(data)) {
    storesData = data;
  } else if (
    data &&
    typeof data === "object" &&
    "stores" in data &&
    Array.isArray((data as { stores?: unknown }).stores)
  ) {
    storesData = (data as { stores: unknown[] }).stores;
  } else {
    throw new Error("Unexpected stores response shape.");
  }

  return storesData.map((rawStore, index) => {
    if (!rawStore || typeof rawStore !== "object") {
      throw new Error(`Unexpected store row shape at index ${index}.`);
    }

    const store = rawStore as Partial<Store>;
    return {
      id: Number(store.id ?? index),
      name: typeof store.name === "string" && store.name.trim() ? store.name : "Unnamed store",
      store_type: store.store_type ?? null,
      retailer_group: store.retailer_group ?? null,
      merchant_category: store.merchant_category ?? null,
      merchant_type: store.merchant_type ?? null,
      spending_category_id: store.spending_category_id ?? null,
      spending_category: store.spending_category ?? null,
      reward_program_id: store.reward_program_id ?? null,
      reward_program: store.reward_program ?? null,
      active: store.active ?? true,
      earns_fuel_points: store.earns_fuel_points ?? false,
      default_fuel_multiplier: store.default_fuel_multiplier ?? null,
      notes: store.notes ?? null,
    };
  });
}

async function fetchJsonArray<T>(url: string, label: string): Promise<T[]> {
  console.log(`[StoresPage] fetch URL ${label}`, url);
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), 15000);
  let response: Response;

  try {
    response = await fetch(url, { signal: controller.signal });
  } catch (err) {
    console.error(`[StoresPage] fetch error ${label}`, err);
    throw new Error(
      err instanceof Error && err.name === "AbortError"
        ? `Timed out loading ${label} from ${url}.`
        : `Failed to fetch ${label} from ${url}.`,
    );
  } finally {
    window.clearTimeout(timeoutId);
  }

  if (!response.ok) {
    const message = await responseError(response, `Failed to load ${label}`);
    console.error(`[StoresPage] fetch failed ${label}`, message);
    throw new Error(message);
  }

  console.log(`[StoresPage] fetch status ${label}`, {
    status: response.status,
    ok: response.ok,
    url: response.url,
  });
  const data = await response.json();
  console.log(`[StoresPage] response body shape ${label}`, {
    isArray: Array.isArray(data),
    count: Array.isArray(data) ? data.length : null,
    type: typeof data,
  });
  if (!Array.isArray(data)) {
    console.error(`Unexpected ${label} response shape`, data);
    throw new Error(`Unexpected ${label} response shape.`);
  }

  return data as T[];
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

function storeToForm(store: Store): StoreForm {
  return {
    name: store.name,
    store_type: store.store_type ?? "",
    retailer_group: store.retailer_group ?? "",
    merchant_type: store.merchant_type ?? "",
    spending_category_id:
      store.spending_category_id === null ? "" : String(store.spending_category_id),
    reward_program_id:
      store.reward_program_id === null ? "" : String(store.reward_program_id),
    earns_fuel_points: store.earns_fuel_points,
    default_fuel_multiplier:
      store.default_fuel_multiplier === null
        ? ""
        : String(store.default_fuel_multiplier),
    notes: store.notes ?? "",
    active: store.active,
  };
}

function StoresSettingsContent() {
  const pathname = usePathname();
  const [stores, setStores] = useState<Store[]>([]);
  const [categories, setCategories] = useState<SpendingCategory[]>([]);
  const [rewardPrograms, setRewardPrograms] = useState<RewardProgram[]>([]);
  const [form, setForm] = useState<StoreForm>(emptyForm);
  const [editingStore, setEditingStore] = useState<Store | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [renderLoopDetected, setRenderLoopDetected] = useState(false);
  const [lastFetchResult, setLastFetchResult] = useState<StoresFetchResult | null>(null);
  const renderCountRef = useRef(0);
  const renderWindowStartRef = useRef<number | null>(null);
  const stopFetchRef = useRef(false);
  const rewardProgramsLoadedRef = useRef(false);
  const routeMountIdRef = useRef("pending");
  useRenderLoopDiagnostics("Stores", {
    isLoading,
    storeCount: stores.length,
    hasError: Boolean(error),
  });

  async function loadSupportingData() {
    try {
      const loadedCategories = await fetchJsonArray<SpendingCategory>(
        `${API_BASE_URL}/spending-categories/`,
        "spending categories",
      );
      setCategories(loadedCategories);
    } catch (err) {
      console.error("Stores settings categories failed to load", err);
      setError((currentError) =>
        currentError ??
        (err instanceof Error
          ? err.message
          : "Stores loaded, but spending categories failed to load."),
      );
    }
  }

  async function ensureRewardProgramsLoaded() {
    if (rewardProgramsLoadedRef.current) {
      return;
    }

    try {
      const loadedRewardPrograms = await fetchJsonArray<RewardProgram>(
        `${API_BASE_URL}/reward-programs/?active_only=true&include_protection=false`,
        "reward programs",
      );
      rewardProgramsLoadedRef.current = true;
      setRewardPrograms(loadedRewardPrograms);
    } catch (err) {
      console.error("Stores settings reward programs failed to load", err);
      setError((currentError) =>
        currentError ??
        (err instanceof Error
          ? err.message
          : "Stores loaded, but fuel reward programs failed to load."),
      );
    }
  }

  useEffect(() => {
    const now = Date.now();
    if (routeMountIdRef.current === "pending") {
      routeMountIdRef.current =
        typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
          ? crypto.randomUUID()
          : `${now}-${Math.random().toString(36).slice(2)}`;
    }

    console.log("[StoresPage] render", {
      routeMountId: routeMountIdRef.current,
      pathname,
      renderCount: renderCountRef.current + 1,
      isLoading,
      storesLength: stores.length,
      categoriesLength: categories.length,
      hasError: Boolean(error),
      renderLoopDetected,
    });

    if (
      renderWindowStartRef.current === null ||
      now - renderWindowStartRef.current > 5000
    ) {
      renderWindowStartRef.current = now;
      renderCountRef.current = 1;
    } else if (renderCountRef.current > 20 && !renderLoopDetected) {
      console.warn("StoresPage render loop detected", {
        renders: renderCountRef.current,
        pathname,
        lastFetchResult,
        error,
      });
      stopFetchRef.current = true;
      setRenderLoopDetected(true);
      setIsLoading(false);
    } else {
      renderCountRef.current += 1;
    }
  }, [
    categories.length,
    error,
    isLoading,
    lastFetchResult,
    pathname,
    renderLoopDetected,
    stores.length,
  ]);

  useEffect(() => {
    let cancelled = false;
    const url = `${API_BASE_URL}/stores`;
    console.log("StoresPage mount", { pathname });

    async function load() {
      if (stopFetchRef.current) {
        console.warn("StoresPage fetch skipped because render loop protection is active");
        return;
      }

      console.log("StoresPage loading true");
      setIsLoading(true);
      setError(null);

      try {
        console.log("StoresPage fetch URL", url);
        const response = await fetch(url);
        const bodyText = await response.text();

        console.log("StoresPage fetch status", {
          status: response.status,
          ok: response.ok,
          url: response.url,
        });

        if (!response.ok) {
          const message = `Failed to load stores (${response.status}): ${bodyText.slice(0, 500)}`;
          console.error("StoresPage caught errors", message);
          if (!cancelled) {
            setLastFetchResult({
              stores: [],
              status: response.status,
              bodyShape: "error",
              bodyPreview: bodyText.slice(0, 500),
            });
            setError(message);
          }
          return;
        }

        const data = bodyText ? JSON.parse(bodyText) : [];
        console.log("StoresPage parsed /stores response", data);
        const storesData = normalizeStoresResponse(data);
        const bodyShape = Array.isArray(data)
          ? "array"
          : data && typeof data === "object" && "stores" in data
            ? "object.stores"
            : typeof data;

        console.log("StoresPage response body shape", {
          bodyShape,
          isArray: Array.isArray(data),
          storesCount: storesData.length,
        });

        if (!cancelled) {
          console.log("StoresPage setStores count", storesData.length);
          setStores(storesData);
          setLastFetchResult({
            stores: storesData,
            status: response.status,
            bodyShape,
            bodyPreview: bodyText.slice(0, 500),
          });
          setError(null);
        }
      } catch (err) {
        console.error("StoresPage caught errors", err);
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load stores.");
        }
      } finally {
        if (!cancelled) {
          console.log("StoresPage loading false");
          setIsLoading(false);
        }
        console.log("StoresPage fetch end");
      }
    }

    void load();
    void loadSupportingData();

    return () => {
      cancelled = true;
      console.log("StoresPage unmount", { pathname });
    };
  }, []);

  async function retryLoadStores() {
    stopFetchRef.current = false;
    setRenderLoopDetected(false);
    setIsLoading(true);
    setError(null);

    const url = `${API_BASE_URL}/stores`;
    console.log("StoresPage fetch URL", url);
    try {
      const response = await fetch(url);
      const bodyText = await response.text();
      console.log("StoresPage fetch status", {
        status: response.status,
        ok: response.ok,
        url: response.url,
      });

      if (!response.ok) {
        throw new Error(`Failed to load stores (${response.status}): ${bodyText.slice(0, 500)}`);
      }

      const data = bodyText ? JSON.parse(bodyText) : [];
      console.log("StoresPage parsed /stores response", data);
      const storesData = normalizeStoresResponse(data);
      const bodyShape = Array.isArray(data)
        ? "array"
        : data && typeof data === "object" && "stores" in data
          ? "object.stores"
          : typeof data;
      console.log("StoresPage response body shape", {
        bodyShape,
        isArray: Array.isArray(data),
        storesCount: storesData.length,
      });
      console.log("StoresPage setStores count", storesData.length);
      setStores(storesData);
      setLastFetchResult({
        stores: storesData,
        status: response.status,
        bodyShape,
        bodyPreview: bodyText.slice(0, 500),
      });
    } catch (err) {
      console.error("StoresPage caught errors", err);
      setError(err instanceof Error ? err.message : "Failed to load stores.");
    } finally {
      console.log("StoresPage loading false");
      setIsLoading(false);
      console.log("StoresPage fetch end");
    }
  }

  useEffect(() => {
    function logRenderError(event: ErrorEvent) {
      console.error("[Stores] window error", event.error ?? event.message);
    }

    function logUnhandledRejection(event: PromiseRejectionEvent) {
      console.error("[Stores] unhandled rejection", event.reason);
    }

    window.addEventListener("error", logRenderError);
    window.addEventListener("unhandledrejection", logUnhandledRejection);

    return () => {
      window.removeEventListener("error", logRenderError);
      window.removeEventListener("unhandledrejection", logUnhandledRejection);
    };
  }, []);

  useEffect(() => {
    console.info("[Stores] render state", {
      isLoading,
      storeCount: stores.length,
      categoryCount: categories.length,
      rewardProgramCount: rewardPrograms.length,
      hasError: Boolean(error),
    });
  }, [categories.length, error, isLoading, rewardPrograms.length, stores.length]);

  function openCreate() {
    setEditingStore(null);
    setForm(emptyForm);
    setIsModalOpen(true);
    void ensureRewardProgramsLoaded();
  }

  function openEdit(store: Store) {
    setEditingStore(store);
    setForm(storeToForm(store));
    setIsModalOpen(true);
    void ensureRewardProgramsLoaded();
  }

  function closeStoreModal() {
    console.info("[StoresModal] close/reset");
    setIsModalOpen(false);
    setEditingStore(null);
    setForm(emptyForm);
    setIsSaving(false);
  }

  useEffect(() => {
    if (!isModalOpen) {
      return;
    }

    console.info("[StoresModal] open");

    function handleKeydown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        closeStoreModal();
      }
    }

    function handlePopState() {
      console.info("[StoresModal] popstate close");
      closeStoreModal();
    }

    window.addEventListener("keydown", handleKeydown);
    window.addEventListener("popstate", handlePopState);

    return () => {
      console.info("[StoresModal] cleanup");
      window.removeEventListener("keydown", handleKeydown);
      window.removeEventListener("popstate", handlePopState);
    };
  }, [isModalOpen]);

  function updateFormField(field: keyof StoreForm, value: string) {
    setForm((currentForm) => ({
      ...currentForm,
      [field]: value,
    }));
  }

  async function saveStore(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSaving(true);
    setError(null);

    try {
      const response = await fetch(
        editingStore
          ? `${API_BASE_URL}/stores/${editingStore.id}`
          : `${API_BASE_URL}/stores/`,
        {
          method: editingStore ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: form.name.trim(),
            store_type: form.store_type.trim() || null,
            retailer_group: form.retailer_group.trim() || null,
            spending_category_id: form.spending_category_id
              ? Number(form.spending_category_id)
              : null,
            reward_program_id: form.reward_program_id
              ? Number(form.reward_program_id)
              : null,
            merchant_category:
              categories.find(
                (category) => String(category.id) === form.spending_category_id,
              )?.key ?? null,
            merchant_type: form.merchant_type.trim() || null,
            earns_fuel_points: form.earns_fuel_points,
            default_fuel_multiplier: form.default_fuel_multiplier
              ? Number(form.default_fuel_multiplier)
              : null,
            notes: form.notes.trim() || null,
            active: form.active,
          }),
        },
      );

      if (!response.ok) {
        throw new Error(`Failed to save store (${response.status})`);
      }

      closeStoreModal();
      await retryLoadStores();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save store.");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-6 text-slate-950 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-7xl space-y-5">
        <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <Link
              className="mb-3 inline-flex h-8 cursor-pointer items-center rounded-md border border-slate-300 px-3 text-xs font-semibold text-slate-700 transition hover:bg-slate-100 active:bg-slate-200"
              href="/settings"
            >
              Back to Settings
            </Link>
            <p className="text-sm font-medium uppercase tracking-wide text-slate-500">
              Settings / Stores
            </p>
            <h1 className="mt-1 text-3xl font-semibold tracking-tight">
              Stores
            </h1>
            <p className="mt-2 max-w-2xl text-sm text-slate-600">
              Manage merchant setup, fuel point eligibility, and spending
              category mapping used by purchase intake.
            </p>
          </div>
          <button
            className="h-10 cursor-pointer rounded-md bg-slate-950 px-4 text-sm font-semibold text-white transition hover:bg-slate-800 active:bg-slate-900"
            onClick={openCreate}
            type="button"
          >
            Add Store
          </button>
          <button
            className="h-10 cursor-pointer rounded-md border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-700 transition hover:bg-slate-100"
            disabled={isLoading}
            onClick={() => void retryLoadStores()}
            type="button"
          >
            Refresh
          </button>
        </header>

        {error ? (
          <p className="rounded-md border border-red-200 bg-red-50 p-3 text-sm font-medium text-red-700">
            {error}
          </p>
        ) : null}

        {renderLoopDetected ? (
          <section className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
            <p className="font-semibold">Render loop detected</p>
            <p className="mt-1">
              Stores stopped auto-fetching after more than 20 renders in 5 seconds.
            </p>
            <pre className="mt-3 max-h-48 overflow-auto rounded-md bg-white p-3 text-xs text-amber-950">
              {JSON.stringify(
                {
                  pathname,
                  error,
                  lastFetchResult: lastFetchResult
                    ? {
                        status: lastFetchResult.status,
                        bodyShape: lastFetchResult.bodyShape,
                        storeCount: lastFetchResult.stores.length,
                        bodyPreview: lastFetchResult.bodyPreview,
                      }
                    : null,
                },
                null,
                2,
              )}
            </pre>
            <button
              className="mt-3 h-9 rounded-md border border-amber-300 bg-white px-3 text-xs font-semibold text-amber-900"
              onClick={() => void retryLoadStores()}
              type="button"
            >
              Retry Once
            </button>
          </section>
        ) : null}

        {isLoading && !renderLoopDetected ? (
          <section className="rounded-lg border border-slate-200 bg-white p-8 text-center text-sm text-slate-500">
            Loading stores...
          </section>
        ) : null}

        {!isLoading ? (
          <StoresTableBoundary stores={stores}>
            <section className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
              <table className="min-w-full divide-y divide-slate-200 text-sm">
                <thead className="bg-slate-100 text-left text-xs font-semibold uppercase tracking-wide text-slate-600">
                  <tr>
                    <th className="px-4 py-3">Store</th>
                    <th className="px-4 py-3">Group</th>
                    <th className="px-4 py-3">Category</th>
                    <th className="px-4 py-3">Fuel</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {stores.map((store) => (
                      <tr key={store.id}>
                        <td className="px-4 py-3">
                          <p className="font-semibold">{store.name}</p>
                          {store.notes ? (
                            <p className="mt-1 text-xs text-slate-500">{store.notes}</p>
                          ) : null}
                        </td>
                        <td className="px-4 py-3 text-slate-600">
                          {store.retailer_group || "-"}
                        </td>
                        <td className="px-4 py-3">
                          {store.spending_category?.name ??
                            store.merchant_category ??
                            "-"}
                          {store.merchant_type ? (
                            <p className="mt-1 text-xs text-slate-500">
                              Type: {store.merchant_type.replaceAll("_", " ")}
                            </p>
                          ) : null}
                        </td>
                        <td className="px-4 py-3">
                          {store.earns_fuel_points ? (
                            <>
                              <p>{store.default_fuel_multiplier ?? 4}x</p>
                              <p className="text-xs text-slate-500">
                                {store.reward_program
                                  ? `${store.reward_program.short_code} · ${store.reward_program.name}`
                                  : "No program"}
                              </p>
                            </>
                          ) : (
                            "No"
                          )}
                        </td>
                        <td className="px-4 py-3">
                          {store.active ? "Active" : "Inactive"}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <button
                            className="h-8 cursor-pointer rounded-md border border-slate-300 px-3 text-xs font-semibold hover:bg-slate-100 active:bg-slate-200"
                            onClick={() => openEdit(store)}
                            type="button"
                          >
                            Edit
                          </button>
                        </td>
                      </tr>
                  ))}
                </tbody>
              </table>
            </section>
          </StoresTableBoundary>
        ) : null}
      </div>

      {isModalOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center modal-backdrop p-4">
          <StoreModalBoundary onClose={closeStoreModal}>
          <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-lg bg-white p-5 shadow-xl">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-xl font-semibold">
                {editingStore ? "Edit Store" : "Add Store"}
              </h2>
              <button
                className="h-9 cursor-pointer rounded-md border border-slate-300 px-3 text-sm font-semibold hover:bg-slate-100"
                onClick={closeStoreModal}
                type="button"
              >
                Close
              </button>
            </div>
            <form className="mt-5 grid gap-4 sm:grid-cols-2" onSubmit={saveStore}>
              <label className="space-y-2 text-sm font-medium text-slate-700">
                <span>Store Name</span>
                <input
                  className="h-11 w-full rounded-md border border-slate-300 px-3"
                  onChange={(event) => updateFormField("name", event.target.value)}
                  required
                  value={form.name}
                />
              </label>
              <label className="space-y-2 text-sm font-medium text-slate-700">
                <span>Retailer Group</span>
                <input
                  className="h-11 w-full rounded-md border border-slate-300 px-3"
                  onChange={(event) =>
                    updateFormField("retailer_group", event.target.value)
                  }
                  placeholder="Kroger, Blackhawk, etc."
                  value={form.retailer_group}
                />
              </label>
              <label className="space-y-2 text-sm font-medium text-slate-700">
                <span>Store Type</span>
                <input
                  className="h-11 w-full rounded-md border border-slate-300 px-3"
                  onChange={(event) =>
                    updateFormField("store_type", event.target.value)
                  }
                  value={form.store_type}
                />
              </label>
              <label className="space-y-2 text-sm font-medium text-slate-700">
                <span>Merchant Type</span>
                <input
                  className="h-11 w-full rounded-md border border-slate-300 px-3"
                  list="merchant-type-options"
                  onChange={(event) =>
                    updateFormField("merchant_type", event.target.value)
                  }
                  placeholder="target, costco, kroger, speedway"
                  value={form.merchant_type}
                />
                <datalist id="merchant-type-options">
                  {["target", "costco", "kroger", "speedway", "wholesale", "grocery", "fuel", "retail"].map(
                    (merchantType) => (
                      <option key={merchantType} value={merchantType} />
                    ),
                  )}
                </datalist>
              </label>
              <label className="space-y-2 text-sm font-medium text-slate-700">
                <span>Spending Category</span>
                <select
                  className="h-11 w-full rounded-md border border-slate-300 px-3"
                  onChange={(event) =>
                    updateFormField("spending_category_id", event.target.value)
                  }
                  value={form.spending_category_id}
                >
                  <option value="">No category</option>
                  {categories
                    .filter(
                      (category) =>
                        category.active !== false ||
                        String(category.id) === form.spending_category_id,
                    )
                    .map((category) => (
                      <option key={category.id} value={category.id}>
                        {category.name}
                        {category.active === false ? " (inactive)" : ""}
                      </option>
                    ))}
                </select>
              </label>
              <label className="flex h-11 items-center gap-2 text-sm font-medium text-slate-700">
                <input
                  checked={form.earns_fuel_points}
                  className="h-4 w-4"
                  onChange={(event) =>
                    setForm((currentForm) => ({
                      ...currentForm,
                      earns_fuel_points: event.target.checked,
                      default_fuel_multiplier: event.target.checked
                        ? currentForm.default_fuel_multiplier || "4"
                        : "",
                      reward_program_id: event.target.checked
                        ? currentForm.reward_program_id ||
                          String(
                            rewardPrograms.find(
                              (program) => program.short_code === "KROGER_FUEL",
                            )?.id ?? "",
                          )
                        : "",
                    }))
                  }
                  type="checkbox"
                />
                <span>Earns Fuel Points</span>
              </label>
              <label className="space-y-2 text-sm font-medium text-slate-700">
                <span>Default Fuel Multiplier</span>
                <input
                  className="h-11 w-full rounded-md border border-slate-300 px-3"
                  disabled={!form.earns_fuel_points}
                  min="1"
                  onChange={(event) =>
                    updateFormField("default_fuel_multiplier", event.target.value)
                  }
                  type="number"
                  value={form.default_fuel_multiplier}
                />
              </label>
              <label className="space-y-2 text-sm font-medium text-slate-700">
                <span>Fuel Reward Program</span>
                <select
                  className="h-11 w-full rounded-md border border-slate-300 px-3"
                  disabled={!form.earns_fuel_points}
                  onChange={(event) =>
                    updateFormField("reward_program_id", event.target.value)
                  }
                  value={form.reward_program_id}
                >
                  <option value="">No program</option>
                  {rewardPrograms
                    .filter((program) => program.category === "Fuel Rewards")
                    .map((program) => (
                      <option key={program.id} value={program.id}>
                        {program.short_code} · {program.name}
                      </option>
                    ))}
                </select>
              </label>
              <label className="flex h-11 items-center gap-2 text-sm font-medium text-slate-700">
                <input
                  checked={form.active}
                  className="h-4 w-4"
                  onChange={(event) =>
                    setForm((currentForm) => ({
                      ...currentForm,
                      active: event.target.checked,
                    }))
                  }
                  type="checkbox"
                />
                <span>Active</span>
              </label>
              <label className="space-y-2 text-sm font-medium text-slate-700 sm:col-span-2">
                <span>Notes</span>
                <textarea
                  className="min-h-24 w-full rounded-md border border-slate-300 px-3 py-2"
                  onChange={(event) => updateFormField("notes", event.target.value)}
                  value={form.notes}
                />
              </label>
              <div className="flex justify-end gap-2 sm:col-span-2">
                <button
                  className="h-10 cursor-pointer rounded-md border border-slate-300 px-4 text-sm font-semibold hover:bg-slate-100"
                  onClick={closeStoreModal}
                  type="button"
                >
                  Cancel
                </button>
                <button
                  className="h-10 cursor-pointer rounded-md bg-slate-950 px-4 text-sm font-semibold text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
                  disabled={isSaving}
                  type="submit"
                >
                  {isSaving ? "Saving..." : "Save Store"}
                </button>
              </div>
            </form>
          </div>
          </StoreModalBoundary>
        </div>
      ) : null}
    </main>
  );
}

export default function StoresSettingsPage() {
  return (
    <StoresRenderBoundary>
      <StoresSettingsContent />
    </StoresRenderBoundary>
  );
}
