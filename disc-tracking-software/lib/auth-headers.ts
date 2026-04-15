const BACKEND_TOKEN_KEY = 'backendApiToken';
// Margin in seconds: treat a token as expired this many seconds before its actual exp
const EXPIRY_MARGIN_SECONDS = 30;

let cachedBackendToken: string | null = null;
let backendTokenLookupPromise: Promise<string | null> | null = null;

function getLocalStorageValue(key: string): string {
  try {
    if (typeof window === 'undefined') {
      return '';
    }
    return (localStorage.getItem(key) || '').trim();
  } catch {
    return '';
  }
}

/**
 * Decode the `exp` claim from a JWT without verifying the signature.
 * Returns the expiry timestamp (seconds since epoch) or 0 if it cannot be read.
 */
function jwtExp(token: string): number {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return 0;
    const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/'))) as Record<string, unknown>;
    return typeof payload.exp === 'number' ? payload.exp : 0;
  } catch {
    return 0;
  }
}

function isTokenFresh(token: string): boolean {
  const exp = jwtExp(token);
  if (!exp) return false;
  const nowSeconds = Math.floor(Date.now() / 1000);
  return nowSeconds < exp - EXPIRY_MARGIN_SECONDS;
}

function clearCachedToken(): void {
  cachedBackendToken = null;
  try {
    localStorage.removeItem(BACKEND_TOKEN_KEY);
  } catch {
    // ignore
  }
}

async function fetchFreshToken(): Promise<string | null> {
  if (!backendTokenLookupPromise) {
    backendTokenLookupPromise = (async () => {
      try {
        const response = await fetch('/api/backend-token', {
          method: 'POST',
          credentials: 'include',
          cache: 'no-store',
        });

        if (!response.ok) {
          return null;
        }

        const payload = await response.json();
        const token = String(payload?.token || '').trim();
        if (!token) {
          return null;
        }

        try {
          localStorage.setItem(BACKEND_TOKEN_KEY, token);
        } catch {
          // Ignore localStorage write failures.
        }

        return token;
      } catch {
        return null;
      }
    })();
  }

  const resolved = await backendTokenLookupPromise;
  backendTokenLookupPromise = null;
  return resolved;
}

async function resolveBackendToken(): Promise<string> {
  // 1. In-memory cache — validate freshness first
  if (cachedBackendToken) {
    if (isTokenFresh(cachedBackendToken)) {
      return cachedBackendToken;
    }
    clearCachedToken();
  }

  // 2. localStorage cache — validate freshness
  const stored = getLocalStorageValue(BACKEND_TOKEN_KEY);
  if (stored && isTokenFresh(stored)) {
    cachedBackendToken = stored;
    return stored;
  }
  // Stale entry in localStorage — remove it so we fetch fresh
  if (stored) {
    clearCachedToken();
  }

  // 3. Fetch a new token from the server
  const fresh = await fetchFreshToken();
  if (fresh && isTokenFresh(fresh)) {
    cachedBackendToken = fresh;
    return fresh;
  }

  return '';
}

export async function getClientAuthHeaders(baseHeaders: Record<string, string>): Promise<Record<string, string>> {
  const headers: Record<string, string> = { ...baseHeaders };

  if (typeof window === 'undefined') {
    return headers;
  }

  const backendToken = await resolveBackendToken();
  if (backendToken) {
    headers.Authorization = `Bearer ${backendToken}`;
  }

  return headers;
}
