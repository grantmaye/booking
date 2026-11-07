export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}
export function normalizeOrigin(value: string, development: boolean): string {
  const url = new URL(value.trim());
  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !["", "/"].includes(url.pathname)
  )
    throw Error(
      "Use only the studio server address, without a path or credentials.",
    );
  if (url.protocol !== "https:" && !(development && url.protocol === "http:"))
    throw Error("A secure HTTPS studio address is required.");
  return url.origin;
}
export async function request<T>(
  origin: string,
  token: string | null,
  path: string,
  method = "GET",
  body?: unknown,
  key?: string,
): Promise<T> {
  if (!origin) throw Error("Connect to your studio in Account first.");
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), 15000);
  try {
    const response = await fetch(origin + "/api" + path, {
      method,
      signal: abort.signal,
      credentials: "omit",
      redirect: "error",
      headers: {
        Accept: "application/json",
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(key ? { "Idempotency-Key": key } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const text = await response.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      throw Error(
        "This address did not return a Chairside response. Check your studio connection.",
      );
    }
    if (!response.ok)
      throw new ApiError(
        data.error || "The request could not be completed.",
        response.status,
      );
    return data as T;
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError")
      throw Error(
        "The studio took too long to respond. Refresh your visits before retrying a booking or payment.",
      );
    if (error instanceof TypeError)
      throw Error(
        "Cannot reach your studio. Check the server address and your connection.",
      );
    throw error;
  } finally {
    clearTimeout(timer);
  }
}
export function dateKey(date: Date, timezone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}
export function money(cents: number, currency = "USD") {
  return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(
    cents / 100,
  );
}
export function when(value: string, zone: string) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: zone,
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}
