"use client";

import {
  createContext,
  ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

import { API_BASE_URL } from "@/lib/api";

type AdminSession = {
  id: number;
  username: string;
  active: boolean;
  last_login_at: string | null;
};

type AuthStatus = "loading" | "authenticated" | "unauthenticated" | "disabled";

type AuthContextValue = {
  admin: AdminSession | null;
  authEnabled: boolean;
  status: AuthStatus;
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  refreshSession: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

const authEnabledEnv = process.env.NEXT_PUBLIC_AUTH_ENABLED;
const AUTH_ENABLED =
  authEnabledEnv === undefined
    ? process.env.NODE_ENV === "production"
    : !["false", "0", "off", "no"].includes(authEnabledEnv.toLowerCase());

function csrfToken() {
  if (typeof document === "undefined") {
    return null;
  }

  const cookie = document.cookie
    .split("; ")
    .find((entry) => entry.startsWith("dotopoly_csrf="));
  return cookie ? decodeURIComponent(cookie.split("=").slice(1).join("=")) : null;
}

async function parseAuthError(response: Response) {
  try {
    const body = await response.json();
    if (typeof body?.detail === "string") {
      return body.detail;
    }
  } catch {
    // Fall through to the generic message below.
  }

  return response.status === 401
    ? "Invalid username or password."
    : "Authentication request failed.";
}

async function requestSession() {
  const response = await fetch(`${API_BASE_URL}/auth/session`, {
    cache: "no-store",
    credentials: "include",
  });

  if (!response.ok) {
    return null;
  }

  return response.json();
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>(
    AUTH_ENABLED ? "loading" : "disabled",
  );
  const [admin, setAdmin] = useState<AdminSession | null>(null);

  const refreshSession = useCallback(async () => {
    if (!AUTH_ENABLED) {
      return;
    }

    try {
      const body = await requestSession();
      if (body.authenticated) {
        setAdmin(body.admin);
        setStatus("authenticated");
      } else {
        setAdmin(null);
        setStatus("unauthenticated");
      }
    } catch {
      setAdmin(null);
      setStatus("unauthenticated");
    }
  }, []);

  useEffect(() => {
    if (!AUTH_ENABLED) {
      return;
    }

    let isCancelled = false;
    requestSession()
      .then((body) => {
        if (isCancelled) {
          return;
        }

        if (body?.authenticated) {
          setAdmin(body.admin);
          setStatus("authenticated");
        } else {
          setAdmin(null);
          setStatus("unauthenticated");
        }
      })
      .catch(() => {
        if (!isCancelled) {
          setAdmin(null);
          setStatus("unauthenticated");
        }
      });

    return () => {
      isCancelled = true;
    };
  }, []);

  const login = useCallback(async (username: string, password: string) => {
    if (!AUTH_ENABLED) {
      setStatus("disabled");
      return;
    }

    const csrf = csrfToken();
    const response = await fetch(`${API_BASE_URL}/auth/login`, {
      body: JSON.stringify({ username, password }),
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
        ...(csrf ? { "X-CSRF-Token": csrf } : {}),
      },
      method: "POST",
    });

    if (!response.ok) {
      throw new Error(await parseAuthError(response));
    }

    const body = await response.json();
    setAdmin(body.admin);
    setStatus("authenticated");
  }, []);

  const logout = useCallback(async () => {
    if (!AUTH_ENABLED) {
      setStatus("disabled");
      setAdmin(null);
      return;
    }

    const csrf = csrfToken();
    try {
      await fetch(`${API_BASE_URL}/auth/logout`, {
        credentials: "include",
        headers: csrf ? { "X-CSRF-Token": csrf } : undefined,
        method: "POST",
      });
    } finally {
      setAdmin(null);
      setStatus("unauthenticated");
    }
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      admin,
      authEnabled: AUTH_ENABLED,
      status,
      login,
      logout,
      refreshSession,
    }),
    [admin, login, logout, refreshSession, status],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used inside AuthProvider");
  }
  return context;
}
