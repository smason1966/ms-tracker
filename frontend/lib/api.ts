const API_BASE_URL =
  typeof window === "undefined"
    ? process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000"
    : `${window.location.protocol}//${window.location.hostname}:8000`;

export { API_BASE_URL };
