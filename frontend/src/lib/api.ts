export const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_URL || process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:8001";

if (typeof window !== "undefined" && process.env.NODE_ENV !== "production") {
  // Helpful for debugging environment config issues.
  console.log("[SPT] API_BASE_URL:", API_BASE_URL);
}

function getToken(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return localStorage.getItem("spareparts_token");
  } catch {
    return null;
  }
}

export function getAuthHeaders(): Record<string, string> {
  const token = getToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export class ApiError extends Error {
  status: number;
  detail?: string;

  constructor(status: number, message: string, detail?: string) {
    super(message);
    this.status = status;
    this.detail = detail;
  }
}

type ApiFetchInit = RequestInit & {
  timeoutMs?: number;
  slowLogThresholdMs?: number;
};

function mergeAbortSignals(
  signalA?: AbortSignal,
  signalB?: AbortSignal
): AbortSignal | undefined {
  if (!signalA) return signalB;
  if (!signalB) return signalA;

  const controller = new AbortController();

  const abort = () => {
    controller.abort();
    signalA.removeEventListener("abort", abort);
    signalB.removeEventListener("abort", abort);
  };

  if (signalA.aborted || signalB.aborted) {
    controller.abort();
  } else {
    signalA.addEventListener("abort", abort);
    signalB.addEventListener("abort", abort);
  }

  return controller.signal;
}

export async function apiFetch<T>(path: string, init?: ApiFetchInit): Promise<T> {
  const timeoutMs = init?.timeoutMs ?? 12000;
  const slowLogThresholdMs = init?.slowLogThresholdMs ?? 1000;

  const timeoutController = new AbortController();
  const timeoutId = globalThis.setTimeout(() => timeoutController.abort(), timeoutMs);
  const startedAt = Date.now();

  let res: Response;
  try {
    res = await fetch(`${API_BASE_URL}${path}`, {
      ...init,
      signal: mergeAbortSignals(init?.signal, timeoutController.signal),
      headers: {
        "Content-Type": "application/json",
        ...getAuthHeaders(),
        ...(init?.headers || {}),
      },
      cache: "no-store",
    });
  } catch (error) {
    if ((error as DOMException)?.name === "AbortError") {
      throw new ApiError(408, `Request timed out after ${timeoutMs}ms`);
    }
    throw error;
  } finally {
    globalThis.clearTimeout(timeoutId);
    const elapsedMs = Date.now() - startedAt;
    if (elapsedMs > slowLogThresholdMs) {
      console.warn(`[SPT] Slow API request ${path}: ${Math.round(elapsedMs)}ms`);
    }
  }

  if (!res.ok) {
    let detail: string | undefined;
    try {
      const data = (await res.json()) as { detail?: string };
      detail = data.detail;
    } catch {
      // ignore
    }
    throw new ApiError(res.status, detail || `Request failed: ${res.status}`, detail);
  }

  if (res.status === 204) {
    return undefined as T;
  }

  const text = await res.text();
  if (!text) {
    return undefined as T;
  }
  return JSON.parse(text) as T;
}

export async function downloadFile(path: string, filename: string) {
  const res = await fetch(`${API_BASE_URL}${path}`, {
    cache: "no-store",
    headers: {
      ...getAuthHeaders(),
    },
  });
  if (!res.ok) {
    throw new ApiError(res.status, `Download failed: ${res.status}`);
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
