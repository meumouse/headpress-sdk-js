/**
 * Customer sign-in (`accounts`, `passwordless`, `google_sign_in` modules).
 *
 * Every sign-in stores the tokens in the client's session and the customer's Cart-Token (the guest
 * cart merged into it) in the client's cart-token store, and resolves with the customer.
 *
 * Two ways to reach Headpress, picked from the session store:
 *
 * - **Through a BFF** (`bffSession()`): calls go to the storefront's own auth routes, which keep the
 *   refresh token in an httpOnly cookie. The recommended setup for web storefronts.
 * - **Directly**: calls go to Headpress and the session store keeps both tokens (`memorySession()`,
 *   a mobile app's secure storage…).
 *
 * One-time codes go by WhatsApp or e-mail (`config.modules.passwordless.channels`); when WhatsApp
 * is unavailable Headpress answers `headpress_channel_unavailable` with `data.fallback_channels`.
 */
import type { Customer, OtpChallenge, OtpVerifyResult, SignInResult } from "./account-types.js";
import type { CartTokenStore } from "./cart-token.js";
import { HeadpressError, SdkErrorCode } from "./errors.js";
import { isBffSession, type BffSessionBody } from "./session-bff.js";
import type { TokenStore } from "./session.js";
import type { Transport } from "./transport.js";

/** Headpress's sign-in answer. */
interface SessionBody {
  access_token: string;
  token_type?: string;
  expires_in: number;
  refresh_token?: string;
  refresh_expires_in?: number;
  cart_token?: string | null;
  customer?: Customer | null;
  purpose?: "login" | "recovery";
  grant?: { expires_in: number };
}

export interface CaptchaOption {
  /** reCAPTCHA token, when the captcha module protects the route. */
  captcha?: string;
}

export interface RegisterInput {
  email: string;
  password: string;
  first_name?: string;
  last_name?: string;
}

export interface Auth {
  login(input: { login: string; password: string }, options?: CaptchaOption): Promise<SignInResult>;
  register(input: RegisterInput, options?: CaptchaOption): Promise<SignInResult>;
  /** Sign in (or up) with a Google Identity Services credential. */
  google(credential: string): Promise<SignInResult>;
  otp: {
    start(input: { channel: string; recipient: string; purpose?: "login" | "recovery" }, options?: CaptchaOption): Promise<OtpChallenge>;
    resend(challengeId: string): Promise<OtpChallenge>;
    verify(input: { challengeId: string; code: string }): Promise<OtpVerifyResult>;
    /** Create the account a code verified a new recipient for. */
    register(input: { registrationToken: string; email: string; password?: string; first_name?: string; last_name?: string }): Promise<SignInResult>;
  };
  /** E-mail a reset link (always succeeds, so it does not reveal accounts). */
  requestPasswordReset(login: string, options?: CaptchaOption): Promise<void>;
  confirmPasswordReset(input: { login: string; key: string; password: string }): Promise<void>;
  /** Restore the session after a page load (BFF) and resolve the customer, or null for guests. */
  restore(): Promise<Customer | null>;
  /** End this session, or every session of the customer with `everywhere`. */
  logout(options?: { everywhere?: boolean }): Promise<void>;
  /** Whether there is a signed-in session (or one worth restoring). */
  isSignedIn(): boolean;
}

export interface AuthDependencies {
  transport: Transport;
  session: TokenStore | undefined;
  cartToken: CartTokenStore | undefined;
  /** Loads the customer when a restore needs it. */
  loadCustomer: () => Promise<Customer>;
}

function requireSession(session: TokenStore | undefined): TokenStore {
  if (!session) {
    throw new HeadpressError(
      SdkErrorCode.notAuthenticated,
      "Signing in needs a session store: pass `session` to createHeadpress().",
      0,
    );
  }
  return session;
}

export function createAuth(deps: AuthDependencies): Auth {
  const { transport, session, cartToken } = deps;
  const viaBff = isBffSession(session) ? session : null;

  const store = (body: SessionBody | BffSessionBody): SignInResult => {
    const target = requireSession(session);
    if (viaBff) {
      viaBff.accept(body);
    } else {
      const direct = body as SessionBody;
      target.setTokens({
        accessToken: direct.access_token,
        expiresIn: direct.expires_in,
        refreshToken: direct.refresh_token,
        refreshExpiresIn: direct.refresh_expires_in,
      });
    }
    if (body.cart_token) cartToken?.set(body.cart_token);
    return {
      customer: body.customer ?? null,
      cartToken: body.cart_token ?? null,
      ...(body.purpose ? { purpose: body.purpose } : {}),
      ...(body.grant ? { grant: body.grant } : {}),
    };
  };

  /** Headers a BFF forwards to Headpress. */
  const bffHeaders = (captcha?: string): Record<string, string> => {
    const headers: Record<string, string> = {};
    const token = cartToken?.get();
    if (token) headers["Cart-Token"] = token;
    if (captcha) headers["X-Headpress-Captcha"] = captcha;
    return headers;
  };

  async function call<T>(
    action: string,
    path: string,
    body: unknown,
    options: { captcha?: string; module?: string; cart?: boolean } = {},
  ): Promise<T> {
    if (viaBff) return viaBff.bff.request<T>(action, body, bffHeaders(options.captcha));
    return transport.request<T>(path, {
      method: "POST",
      body,
      captcha: options.captcha,
      module: options.module,
      cartToken: options.cart,
    });
  }

  return {
    async login(input, options = {}) {
      requireSession(session);
      return store(await call<SessionBody>("login", "/store/auth/login", input, { captcha: options.captcha, module: "accounts", cart: true }));
    },

    async register(input, options = {}) {
      requireSession(session);
      return store(await call<SessionBody>("register", "/store/auth/register", input, { captcha: options.captcha, module: "accounts", cart: true }));
    },

    async google(credential) {
      requireSession(session);
      return store(await call<SessionBody>("google", "/store/auth/google", { credential }, { module: "google_sign_in", cart: true }));
    },

    otp: {
      start: (input, options = {}) =>
        call<OtpChallenge>("otp/start", "/store/auth/otp/start", { purpose: "login", ...input }, { captcha: options.captcha, module: "passwordless" }),
      resend: (challengeId) => call<OtpChallenge>("otp/resend", "/store/auth/otp/resend", { challenge_id: challengeId }, { module: "passwordless" }),
      async verify(input) {
        requireSession(session);
        const body = await call<SessionBody | { needs_registration: true; registration_token: string; expires_in: number }>(
          "otp/verify",
          "/store/auth/otp/verify",
          { challenge_id: input.challengeId, code: input.code },
          { module: "passwordless", cart: true },
        );
        if ("needs_registration" in body && body.needs_registration) {
          return { status: "needs_registration", registrationToken: body.registration_token, expiresIn: body.expires_in };
        }
        return { status: "signed_in", ...store(body as SessionBody) };
      },
      async register(input) {
        requireSession(session);
        return store(
          await call<SessionBody>(
            "otp/register",
            "/store/auth/otp/register",
            {
              registration_token: input.registrationToken,
              email: input.email,
              ...(input.password ? { password: input.password } : {}),
              ...(input.first_name ? { first_name: input.first_name } : {}),
              ...(input.last_name ? { last_name: input.last_name } : {}),
            },
            { module: "passwordless", cart: true },
          ),
        );
      },
    },

    async requestPasswordReset(login, options = {}) {
      await call("password-reset", "/store/auth/password-reset", { login }, { captcha: options.captcha, module: "accounts" });
    },

    async confirmPasswordReset(input) {
      await call("password-reset/confirm", "/store/auth/password-reset/confirm", input, { module: "accounts" });
    },

    async restore() {
      if (!session) return null;
      const token = session.getAccessToken() ?? (session.refresh ? await session.refresh() : null);
      if (!token) return null;
      return viaBff?.customer() ?? deps.loadCustomer();
    },

    async logout(options = {}) {
      try {
        if (viaBff) {
          await viaBff.bff.request("logout", { all: options.everywhere === true }, options.everywhere ? bearer(session) : {});
        } else if (session) {
          const refreshToken = (session as { getRefreshToken?: () => string | null }).getRefreshToken?.() ?? null;
          if (options.everywhere) {
            await transport.request("/store/auth/logout", { method: "POST", body: { all: true }, auth: "required", module: "accounts" });
          } else if (refreshToken) {
            await transport.request("/store/auth/logout", { method: "POST", body: { refresh_token: refreshToken }, module: "accounts" });
          }
        }
      } finally {
        // Signed out here whatever Headpress answered; the customer's cart token goes too, so the
        // next visitor of this browser starts a guest cart.
        if (viaBff) viaBff.forget();
        else session?.setTokens(null);
        cartToken?.set(null);
      }
    },

    isSignedIn: () => Boolean(session && (session.getAccessToken() || session.hasSession?.())),
  };
}

function bearer(session: TokenStore | undefined): Record<string, string> {
  const token = session?.getAccessToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}
