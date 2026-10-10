/**
 * Where the customer's tokens live.
 *
 * Headpress signs customers in with a short-lived access token (a JWT, 15 minutes by default) and
 * a refresh token that rotates on every use (30 days). The SDK never decides where they are kept:
 * it asks a `TokenStore`. Strategies:
 *
 * - `memorySession()` (here): both tokens in memory. For tests, scripts and server code that acts
 *   for one customer within one request.
 * - A backend-for-frontend store (the Next.js adapter): the refresh token sits in an httpOnly
 *   cookie owned by the storefront's own routes, the access token in memory.
 * - Your own: anything implementing `TokenStore` (secure storage in a mobile app, say).
 *
 * On the server, never share one session between requests: a client created at module level
 * serves every visitor of the process. Create the client per request, or pass `accessToken` on
 * each call.
 */

export interface AuthTokens {
  accessToken: string;
  /** Access token lifetime in seconds (`expires_in`). */
  expiresIn?: number;
  refreshToken?: string;
  /** Refresh token lifetime in seconds (`refresh_expires_in`). */
  refreshExpiresIn?: number;
}

export type SessionListener = (accessToken: string | null) => void;

export interface TokenStore {
  /** A usable access token, or null when signed out or expired. */
  getAccessToken(): string | null;
  /** Store the tokens from a sign-in or refresh, or clear them with null. */
  setTokens(tokens: AuthTokens | null): void;
  /**
   * Whether a session exists even if the access token has expired — so a refresh is worth trying
   * before an optional-auth call goes out as a guest. Defaults to "only if there is a token".
   */
  hasSession?(): boolean;
  /**
   * Get a new access token (refresh token rotation, a BFF call…). Resolves the new token, or null
   * when the session is over. The SDK never runs two refreshes at once for one client.
   */
  refresh?(): Promise<string | null>;
  subscribe?(listener: SessionListener): () => void;
}

export interface MemorySessionOptions {
  /**
   * How to trade the refresh token for new tokens — typically a call to
   * `POST /store/auth/refresh`. Resolve null when the session is over.
   */
  refresh?: (refreshToken: string | null) => Promise<AuthTokens | null>;
  /** Seconds shaved off the lifetime so a token is renewed before it expires mid-request. */
  skewSeconds?: number;
  /** Clock, for tests. */
  now?: () => number;
}

export interface MemorySession extends TokenStore {
  getRefreshToken(): string | null;
  hasSession(): boolean;
  subscribe(listener: SessionListener): () => void;
}

export function memorySession(options: MemorySessionOptions = {}): MemorySession {
  const now = options.now ?? Date.now;
  const skew = options.skewSeconds ?? 30;
  let access: string | null = null;
  let expiresAt: number | null = null;
  let refreshToken: string | null = null;
  const listeners = new Set<SessionListener>();

  const notify = (): void => listeners.forEach((listener) => listener(access));

  const store: MemorySession = {
    getAccessToken() {
      if (!access) return null;
      if (expiresAt !== null && now() >= expiresAt) return null;
      return access;
    },
    setTokens(tokens) {
      access = tokens?.accessToken ?? null;
      expiresAt =
        tokens && typeof tokens.expiresIn === "number" && tokens.expiresIn > 0
          ? now() + Math.max(tokens.expiresIn - skew, 1) * 1000
          : null;
      // A refresh answer may omit the refresh token; keep the one we have then.
      if (tokens === null) refreshToken = null;
      else if (tokens.refreshToken) refreshToken = tokens.refreshToken;
      notify();
    },
    hasSession: () => access !== null || refreshToken !== null,
    getRefreshToken: () => refreshToken,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };

  if (options.refresh) {
    const exchange = options.refresh;
    store.refresh = async () => {
      try {
        const tokens = await exchange(refreshToken);
        store.setTokens(tokens);
        return tokens?.accessToken ?? null;
      } catch {
        store.setTokens(null);
        return null;
      }
    };
  }

  return store;
}
