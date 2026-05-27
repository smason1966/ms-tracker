const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000";

const CSRF_COOKIE_NAME = "dotopoly_csrf";

function readCookie(name: string) {
  if (typeof document === "undefined") {
    return null;
  }

  const cookie = document.cookie
    .split("; ")
    .find((entry) => entry.startsWith(`${name}=`));
  return cookie ? decodeURIComponent(cookie.split("=").slice(1).join("=")) : null;
}

function requestUrl(input: RequestInfo | URL) {
  if (input instanceof Request) {
    return input.url;
  }
  return input.toString();
}

function requestMethod(input: RequestInfo | URL, init?: RequestInit) {
  return (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
}

function isUnsafeMethod(method: string) {
  return ["POST", "PUT", "PATCH", "DELETE"].includes(method);
}

function isApiRequest(input: RequestInfo | URL) {
  const url = requestUrl(input);
  return url.startsWith(API_BASE_URL);
}

function withAuthFetchOptions(
  input: RequestInfo | URL,
  init: RequestInit = {},
): RequestInit {
  if (!isApiRequest(input)) {
    return init;
  }

  const method = requestMethod(input, init);
  const headers = new Headers(init.headers ?? (input instanceof Request ? input.headers : undefined));
  const csrfToken = readCookie(CSRF_COOKIE_NAME);

  if (isUnsafeMethod(method) && csrfToken && !headers.has("X-CSRF-Token")) {
    headers.set("X-CSRF-Token", csrfToken);
  }

  return {
    ...init,
    credentials: init.credentials ?? "include",
    headers,
  };
}

function installAuthenticatedFetch() {
  if (typeof window === "undefined") {
    return;
  }

  const globalWindow = window as typeof window & {
    __dotopolyAuthenticatedFetchInstalled?: boolean;
  };
  if (globalWindow.__dotopolyAuthenticatedFetchInstalled) {
    return;
  }

  const originalFetch = window.fetch.bind(window);
  window.fetch = (input: RequestInfo | URL, init?: RequestInit) =>
    originalFetch(input, withAuthFetchOptions(input, init));
  globalWindow.__dotopolyAuthenticatedFetchInstalled = true;
}

export { API_BASE_URL, installAuthenticatedFetch };
