"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  Component,
  ErrorInfo,
  ReactNode,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { useAuth } from "@/lib/auth";

type NavigationItem = {
  label: string;
  href: string;
  match: (pathname: string) => boolean;
};

class AppShellErrorBoundary extends Component<
  { children: ReactNode },
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[AppShell] caught render error", error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <main className="min-h-screen bg-slate-950 px-4 py-6 text-white">
          <section className="mx-auto max-w-4xl rounded-lg border border-red-300/40 bg-red-950/40 p-4 text-sm font-medium text-red-100">
            App shell failed to render: {this.state.error.message}
          </section>
        </main>
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

const navigationItems: NavigationItem[] = [
  {
    label: "Purchases",
    href: "/purchases",
    match: (pathname) =>
      pathname.startsWith("/purchases") || pathname.startsWith("/intake"),
  },
  {
    label: "Inventory",
    href: "/inventory",
    match: (pathname) => pathname.startsWith("/inventory"),
  },
  {
    label: "Sales",
    href: "/sales",
    match: (pathname) => pathname.startsWith("/sales"),
  },
  {
    label: "Receive Payment",
    href: "/payments/receive",
    match: (pathname) => pathname.startsWith("/payments/receive"),
  },
  {
    label: "Payment History",
    href: "/payments/history",
    match: (pathname) =>
      pathname === "/payments" ||
      pathname.startsWith("/payments/history") ||
      pathname.startsWith("/payments/awaiting"),
  },
  {
    label: "Fuel Accounts",
    href: "/fuel-accounts",
    match: (pathname) => pathname.startsWith("/fuel-accounts"),
  },
  {
    label: "Credit Cards",
    href: "/credit-cards",
    match: (pathname) => pathname.startsWith("/credit-cards"),
  },
  {
    label: "Rewards",
    href: "/rewards",
    match: (pathname) => pathname.startsWith("/rewards"),
  },
  {
    label: "Settings",
    href: "/settings",
    match: (pathname) =>
      pathname.startsWith("/settings") ||
      pathname.startsWith("/card-brands") ||
      pathname.startsWith("/buyers"),
  },
];

function pageTitle(pathname: string) {
  if (pathname === "/") {
    return "Operations Home";
  }

  if (pathname.startsWith("/dashboard")) {
    return "Dashboard";
  }

  if (pathname.startsWith("/inventory")) {
    return "Inventory";
  }

  if (pathname.startsWith("/sales")) {
    return "Sales";
  }

  if (pathname.startsWith("/payments")) {
    return "Payments";
  }

  if (pathname.startsWith("/fuel-accounts")) {
    return "Fuel Accounts";
  }

  if (pathname.startsWith("/credit-cards")) {
    return "Credit Cards";
  }

  if (pathname.startsWith("/rewards")) {
    return "Rewards";
  }

  if (pathname.startsWith("/buyers")) {
    return "Buyers";
  }

  if (pathname.startsWith("/settings") || pathname.startsWith("/card-brands")) {
    return "Settings";
  }

  if (pathname.startsWith("/purchases")) {
    return "Purchases";
  }

  if (pathname.startsWith("/intake")) {
    return "Purchase Intake";
  }

  if (pathname.startsWith("/gift-cards")) {
    return "Confirm Card Details";
  }

  return "MS Tracker";
}

function NavLink({
  item,
  pathname,
  onNavigate,
}: {
  item: NavigationItem;
  pathname: string;
  onNavigate?: () => void;
}) {
  const isActive = item.match(pathname);

  return (
    <Link
      aria-current={isActive ? "page" : undefined}
      className={`group flex h-11 items-center justify-between rounded-lg px-3 text-sm font-medium transition ${
        isActive
          ? "border border-cyan-400/30 bg-cyan-400/10 text-cyan-100 shadow-[0_0_24px_rgba(34,211,238,0.08)]"
          : "text-slate-300 hover:bg-white/7 hover:text-white active:bg-white/10"
      }`}
      href={item.href}
      onClick={onNavigate}
    >
      <span>{item.label}</span>
      {isActive ? (
        <span className="h-1.5 w-1.5 rounded-full bg-cyan-300" />
      ) : null}
    </Link>
  );
}

function SidebarContent({
  adminUsername,
  authEnabled,
  onLogout,
  pathname,
  onNavigate,
}: {
  adminUsername?: string | null;
  authEnabled?: boolean;
  onLogout?: () => void;
  pathname: string;
  onNavigate?: () => void;
}) {
  return (
    <div className="flex h-full flex-col">
      <div className="px-4 pb-5 pt-5">
        <Link
          className="block rounded-xl border border-white/10 bg-white/[0.04] px-4 py-4 shadow-2xl shadow-black/20"
          href="/"
          onClick={onNavigate}
        >
          <div className="text-xs font-semibold uppercase tracking-[0.28em] text-cyan-200">
            MS Tracker
          </div>
          <div className="mt-2 text-lg font-semibold tracking-tight text-white">
            Operations Console
          </div>
        </Link>
      </div>

      <nav className="flex-1 space-y-1 px-3">
        {navigationItems.map((item) => (
          <NavLink
            item={item}
            key={item.label}
            onNavigate={onNavigate}
            pathname={pathname}
          />
        ))}
      </nav>

      <div className="space-y-3 px-4 py-5 text-xs text-slate-500">
        {authEnabled ? (
          <div className="rounded-lg border border-white/10 bg-white/[0.03] p-3">
            <div className="truncate text-slate-400">
              {adminUsername ?? "Signed in"}
            </div>
            <button
              className="mt-2 inline-flex h-8 items-center rounded-md border border-white/10 px-3 text-xs font-semibold text-slate-200 transition hover:border-red-300/40 hover:bg-red-500/10 hover:text-red-100"
              onClick={() => {
                onNavigate?.();
                onLogout?.();
              }}
              type="button"
            >
              Logout
            </button>
          </div>
        ) : null}
        <div>Daily ops console</div>
      </div>
    </div>
  );
}

function ShellLoading() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-950 px-4 text-slate-100">
      <div className="rounded-lg border border-white/10 bg-white/[0.04] px-5 py-4 text-sm text-slate-300">
        Checking session...
      </div>
    </main>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname() ?? "/";
  const router = useRouter();
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const { admin, authEnabled, logout, status } = useAuth();
  useRenderLoopDiagnostics("AppShell", { pathname });

  const title = useMemo(() => pageTitle(pathname), [pathname]);
  const isLoginRoute = pathname === "/login";
  const isAuthenticated = status === "authenticated" || status === "disabled";

  const isFocusedBarcodeMode =
    pathname.startsWith("/fuel-accounts/") && pathname.endsWith("/barcode");

  useEffect(() => {
    if (!authEnabled || status === "loading") {
      return;
    }

    if (status === "authenticated" && isLoginRoute) {
      router.replace("/");
      return;
    }

    if (
      (status === "unauthenticated" || status === "mfa_required") &&
      !isLoginRoute
    ) {
      router.replace(`/login?next=${encodeURIComponent(pathname)}`);
    }
  }, [authEnabled, isLoginRoute, pathname, router, status]);

  async function handleLogout() {
    await logout();
    router.replace("/login");
  }

  useEffect(() => {
    console.info("[AppShell] route transition", { pathname });
  }, [pathname]);

  useEffect(() => {
    console.info("[AppShell] mount");

    function logWindowError(event: ErrorEvent) {
      console.error("[AppShell] window error", event.error ?? event.message);
    }

    function logUnhandledRejection(event: PromiseRejectionEvent) {
      console.error("[AppShell] unhandled rejection", event.reason);
    }

    window.addEventListener("error", logWindowError);
    window.addEventListener("unhandledrejection", logUnhandledRejection);

    return () => {
      console.info("[AppShell] unmount");
      window.removeEventListener("error", logWindowError);
      window.removeEventListener("unhandledrejection", logUnhandledRejection);
    };
  }, []);

  if (authEnabled && status === "loading") {
    return <ShellLoading />;
  }

  if (authEnabled && status === "unauthenticated" && !isLoginRoute) {
    return <ShellLoading />;
  }

  if (authEnabled && status === "mfa_required" && !isLoginRoute) {
    return <ShellLoading />;
  }

  if (authEnabled && status === "authenticated" && isLoginRoute) {
    return <ShellLoading />;
  }

  if (isLoginRoute) {
    return <AppShellErrorBoundary>{children}</AppShellErrorBoundary>;
  }

  if (isFocusedBarcodeMode && isAuthenticated) {
    return <>{children}</>;
  }

  return (
    <AppShellErrorBoundary>
      <div
        className="min-h-screen bg-[radial-gradient(circle_at_top_left,rgba(34,211,238,0.14),transparent_32rem),linear-gradient(135deg,#050712_0%,#0a1020_44%,#101827_100%)] text-slate-100"
        data-app-shell
      >
        <aside className="fixed inset-y-0 left-0 z-40 hidden w-72 border-r border-white/10 bg-slate-950/65 shadow-2xl shadow-black/30 backdrop-blur-xl lg:block">
          <SidebarContent
            adminUsername={admin?.username}
            authEnabled={authEnabled}
            onLogout={handleLogout}
            pathname={pathname}
          />
        </aside>

      {isDrawerOpen ? (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button
            aria-label="Close navigation"
            className="absolute inset-0 modal-backdrop"
            onClick={() => setIsDrawerOpen(false)}
            type="button"
          />
          <aside className="relative h-full w-[min(22rem,88vw)] border-r border-white/10 bg-[#050b16] shadow-2xl">
            <SidebarContent
              adminUsername={admin?.username}
              authEnabled={authEnabled}
              onNavigate={() => setIsDrawerOpen(false)}
              onLogout={handleLogout}
              pathname={pathname}
            />
          </aside>
        </div>
      ) : null}

        <div className="lg:pl-72">
        <header className="sticky top-0 z-30 border-b border-white/10 bg-slate-950/65 backdrop-blur-xl lg:hidden">
          <div className="flex h-14 items-center justify-between gap-3 px-4 sm:px-6">
            <div className="flex min-w-0 items-center gap-3">
              <button
                aria-label="Open navigation"
                className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-white/10 bg-white/[0.04] text-slate-100 hover:bg-white/10 active:bg-white/15 lg:hidden"
                onClick={() => setIsDrawerOpen(true)}
                type="button"
              >
                <span className="sr-only">Open navigation</span>
                <span className="space-y-1.5">
                  <span className="block h-0.5 w-5 rounded-full bg-current" />
                  <span className="block h-0.5 w-5 rounded-full bg-current" />
                  <span className="block h-0.5 w-5 rounded-full bg-current" />
                </span>
              </button>
              <div className="min-w-0">
                <h1 className="truncate text-base font-semibold tracking-tight text-white sm:text-lg">
                  {title}
                </h1>
              </div>
            </div>

            <div className="h-10 w-10 shrink-0" />
          </div>
        </header>

          <div className="mx-auto w-full max-w-[1600px]">{children}</div>
        </div>
      </div>
    </AppShellErrorBoundary>
  );
}
