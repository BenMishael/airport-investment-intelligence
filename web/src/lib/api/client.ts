import { ApiErrorEnvelope } from "@/types/api";

const apiBase = (process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:8000").replace(/\/$/, "");
const DEFAULT_TIMEOUT_MS = 15_000;

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public requestId?: string,
  ) {
    super(message);
  }
}

function isAbortError(caught: unknown): boolean {
  return (
    (caught instanceof DOMException && caught.name === "AbortError") ||
    (caught instanceof Error && caught.name === "AbortError")
  );
}

export function describeApiFailure(caught: unknown): string {
  if (caught instanceof ApiError) return caught.message;
  if (isAbortError(caught)) return "The analysis took too long. Retry.";
  return "The service could not be reached. Check your connection and retry.";
}

export async function apiFetch<T>(path: string, accessToken: string, init?: RequestInit): Promise<T> {
  const controller = new AbortController();
  const timer = globalThis.setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
  const parent = init?.signal;
  const onParentAbort = () => controller.abort();
  parent?.addEventListener("abort", onParentAbort);
  try {
    let response: Response;
    try {
      response = await fetch(`${apiBase}${path}`, {
        ...init,
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}`, ...init?.headers },
        signal: controller.signal,
      });
    } catch (caught) {
      if (isAbortError(caught)) {
        throw new ApiError("The analysis took too long. Retry.", 408);
      }
      throw new ApiError("The service could not be reached. Check your connection and retry.", 0);
    }
    if (!response.ok) {
      const payload = (await response.json().catch(() => ({}))) as ApiErrorEnvelope;
      throw new ApiError(
        payload.error?.message || `The service returned ${response.status}.`,
        response.status,
        payload.error?.request_id || response.headers.get("x-request-id") || undefined,
      );
    }
    if (response.status === 204) return undefined as T;
    try {
      return (await response.json()) as T;
    } catch {
      throw new ApiError("The service returned an unreadable response.", response.status);
    }
  } finally {
    globalThis.clearTimeout(timer);
    parent?.removeEventListener("abort", onParentAbort);
  }
}
