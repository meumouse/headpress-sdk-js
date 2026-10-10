/**
 * `@meumouse/headpress/controllers`: storefront behaviour without a UI.
 *
 * Each controller is `{ getState(), subscribe(listener), actions, destroy() }` and works with any
 * framework (or none). Actions never throw: failures land in `state.error` as a `HeadpressError`
 * and the action resolves `null`/`false`, so a form can render the message (`hp.formatError()`).
 * The numbers they show — totals, discounts, quotes, limits — come from the server or the store
 * config; controllers only hold and sequence them.
 */
import type { OtpChallenge, SignInResult } from "../account-types.js";
import type { BrazilianMarketInput } from "../br/index.js";
import { brazilianMarketValues, canonicalPhone, documentType, isValidCep, lookupCep, maskCep } from "../br/index.js";
import type { AddItemInput, Address, Cart } from "../cart.js";
import type { HeadpressClient } from "../client.js";
import type { ShippingQuote, SplitQuote } from "../checkout.js";
import { HeadpressError, isHeadpressError, retryAfter } from "../errors.js";
import { money, type Money } from "../money.js";
import type { Review, ReviewUpload } from "../reviews.js";
import type { SuggestResult } from "../search.js";
import { createStore, type Controller } from "./store.js";

export { createStore, type Controller, type Readable, type Store } from "./store.js";

function asError(error: unknown): HeadpressError {
  if (isHeadpressError(error)) return error;
  return new HeadpressError("headpress_unknown_error", error instanceof Error ? error.message : "Unexpected error.", 0, {}, { cause: error });
}

/* ------------------------------------------------------------------ */
/* Cart                                                                */
/* ------------------------------------------------------------------ */

export interface CartState {
  cart: Cart | null;
  status: "idle" | "loading" | "ready" | "error";
  /** Lines being changed, by key (and `"new"` while adding). */
  pending: string[];
  error: HeadpressError | null;
}

export interface CartActions {
  load(): Promise<Cart | null>;
  addItem(input: AddItemInput): Promise<Cart | null>;
  updateItem(key: string, quantity: number): Promise<Cart | null>;
  removeItem(key: string): Promise<Cart | null>;
  applyCoupon(code: string): Promise<Cart | null>;
  removeCoupon(code: string): Promise<Cart | null>;
  selectShippingRate(packageId: number | string, rateId: string): Promise<Cart | null>;
  updateCustomer(input: { billing_address?: Partial<Address>; shipping_address?: Partial<Address> }): Promise<Cart | null>;
  clearError(): void;
}

export function createCartController(hp: Pick<HeadpressClient, "cart">): Controller<CartState, CartActions> {
  const store = createStore<CartState>({ cart: hp.cart.peek(), status: hp.cart.peek() ? "ready" : "idle", pending: [], error: null });
  // Every cart answer — from this controller or anywhere else on the page — lands here. Attached
  // while someone listens, so a framework that unmounts and remounts (React's StrictMode) keeps it.
  let listeners = 0;
  let detach: (() => void) | null = null;
  const subscribe = (listener: () => void): (() => void) => {
    if (listeners++ === 0) {
      detach = hp.cart.subscribe((cart) => store.setState({ cart, status: "ready" }));
      const latest = hp.cart.peek();
      if (latest && latest !== store.getState().cart) store.setState({ cart: latest, status: "ready" });
    }
    const unsubscribe = store.subscribe(listener);
    return () => {
      unsubscribe();
      if (--listeners === 0) {
        detach?.();
        detach = null;
      }
    };
  };

  const run = async (key: string, call: () => Promise<Cart>): Promise<Cart | null> => {
    store.setState((state) => ({ pending: [...state.pending, key], error: null }));
    try {
      return await call();
    } catch (error) {
      store.setState({ error: asError(error) });
      return null;
    } finally {
      store.setState((state) => ({ pending: state.pending.filter((entry) => entry !== key) }));
    }
  };

  return {
    getState: store.getState,
    subscribe,
    // The cart subscription follows the listeners (see `subscribe`); nothing else to stop.
    destroy: () => undefined,
    actions: {
      async load() {
        store.setState({ status: store.getState().cart ? "ready" : "loading", error: null });
        try {
          return await hp.cart.get();
        } catch (error) {
          store.setState({ status: "error", error: asError(error) });
          return null;
        }
      },
      addItem: (input) => run("new", () => hp.cart.addItem(input)),
      updateItem: (key, quantity) => run(key, () => hp.cart.updateItem(key, quantity)),
      removeItem: (key) => run(key, () => hp.cart.removeItem(key)),
      applyCoupon: (code) => run("coupon", () => hp.cart.applyCoupon(code)),
      removeCoupon: (code) => run("coupon", () => hp.cart.removeCoupon(code)),
      selectShippingRate: (packageId, rateId) => run("shipping", () => hp.cart.selectShippingRate(packageId, rateId)),
      updateCustomer: (input) => run("customer", () => hp.cart.updateCustomer(input)),
      clearError: () => store.setState({ error: null }),
    },
  };
}

/* ------------------------------------------------------------------ */
/* Search box                                                          */
/* ------------------------------------------------------------------ */

export interface SearchBoxState {
  query: string;
  status: "idle" | "too_short" | "loading" | "ready" | "error";
  result: SuggestResult | null;
  error: HeadpressError | null;
}

export interface SearchBoxActions {
  setQuery(query: string): void;
  clear(): void;
}

export interface SearchBoxOptions {
  /** Defaults to `config.modules.search.min_chars`, else 2. */
  minChars?: number;
  /** Milliseconds to wait after typing. Defaults to 200. */
  debounceMs?: number;
  limit?: number;
  types?: readonly string[];
}

export function createSearchBox(hp: Pick<HeadpressClient, "search" | "capabilities">, options: SearchBoxOptions = {}): Controller<SearchBoxState, SearchBoxActions> {
  const store = createStore<SearchBoxState>({ query: "", status: "idle", result: null, error: null });
  let timer: ReturnType<typeof setTimeout> | null = null;
  let controller: AbortController | null = null;
  let sequence = 0;

  const minChars = (): number => options.minChars ?? hp.capabilities.get("search")?.min_chars ?? 2;
  const cancel = (): void => {
    if (timer) clearTimeout(timer);
    timer = null;
    controller?.abort();
    controller = null;
  };

  return {
    getState: store.getState,
    subscribe: store.subscribe,
    destroy: cancel,
    actions: {
      setQuery(query) {
        cancel();
        const trimmed = query.trim();
        if (Array.from(trimmed).length < minChars()) {
          store.setState({ query, status: trimmed ? "too_short" : "idle", result: null, error: null });
          return;
        }
        store.setState({ query, status: "loading", error: null });
        const id = ++sequence;
        timer = setTimeout(async () => {
          controller = new AbortController();
          try {
            const result = await hp.search.suggest(trimmed, { limit: options.limit, types: options.types, signal: controller.signal });
            if (id === sequence) store.setState({ status: "ready", result });
          } catch (error) {
            if (id === sequence && !(isHeadpressError(error) && error.code === "headpress_aborted")) {
              store.setState({ status: "error", error: asError(error) });
            }
          }
        }, options.debounceMs ?? 200);
      },
      clear() {
        cancel();
        sequence++;
        store.setState({ query: "", status: "idle", result: null, error: null });
      },
    },
  };
}

/* ------------------------------------------------------------------ */
/* One-time code sign-in                                               */
/* ------------------------------------------------------------------ */

export interface OtpFlowState {
  step: "idle" | "sending" | "code_sent" | "verifying" | "needs_registration" | "registering" | "signed_in";
  channel: string | null;
  recipient: string;
  challenge: OtpChallenge | null;
  /** Epoch milliseconds when a resend is allowed; null when no resend is left. */
  resendAt: number | null;
  attemptsLeft: number | null;
  /** Channels to offer when the chosen one is unavailable (WhatsApp → e-mail). */
  fallbackChannels: string[];
  registrationToken: string | null;
  result: SignInResult | null;
  error: HeadpressError | null;
}

export interface OtpFlowActions {
  start(input: { channel: string; recipient: string; purpose?: "login" | "recovery" }, options?: { captcha?: string }): Promise<boolean>;
  resend(): Promise<boolean>;
  verify(code: string): Promise<boolean>;
  register(input: { email: string; password?: string; first_name?: string; last_name?: string }): Promise<boolean>;
  /** Back to the start (another recipient or channel). */
  reset(): void;
}

export function createOtpFlow(hp: Pick<HeadpressClient, "auth">, options: { now?: () => number } = {}): Controller<OtpFlowState, OtpFlowActions> {
  const now = options.now ?? Date.now;
  const initial: OtpFlowState = {
    step: "idle",
    channel: null,
    recipient: "",
    challenge: null,
    resendAt: null,
    attemptsLeft: null,
    fallbackChannels: [],
    registrationToken: null,
    result: null,
    error: null,
  };
  const store = createStore<OtpFlowState>(initial);
  let purpose: "login" | "recovery" = "login";

  const challengeState = (challenge: OtpChallenge): Partial<OtpFlowState> => ({
    step: "code_sent",
    challenge,
    resendAt: challenge.resend_in === null ? null : now() + challenge.resend_in * 1000,
    attemptsLeft: null,
    error: null,
  });

  const failure = (error: unknown, step: OtpFlowState["step"]): false => {
    const err = asError(error);
    const patch: Partial<OtpFlowState> = { step, error: err };
    if (err.code === "headpress_channel_unavailable") patch.fallbackChannels = (err.data.fallback_channels as string[] | undefined) ?? [];
    if (err.code === "headpress_otp_invalid") patch.attemptsLeft = Number(err.data.attempts_left ?? 0) || 0;
    if (err.code === "headpress_rate_limited") {
      const wait = retryAfter(err);
      if (wait !== null) patch.resendAt = now() + wait * 1000;
    }
    store.setState(patch);
    return false;
  };

  return {
    getState: store.getState,
    subscribe: store.subscribe,
    destroy: () => undefined,
    actions: {
      async start(input, startOptions = {}) {
        purpose = input.purpose ?? "login";
        store.setState({ ...initial, step: "sending", channel: input.channel, recipient: input.recipient });
        try {
          store.setState(challengeState(await hp.auth.otp.start({ ...input, purpose }, startOptions)));
          return true;
        } catch (error) {
          return failure(error, "idle");
        }
      },
      async resend() {
        const { challenge, resendAt } = store.getState();
        if (!challenge) return false;
        if (resendAt !== null && now() < resendAt) return false;
        store.setState({ step: "sending", error: null });
        try {
          store.setState(challengeState(await hp.auth.otp.resend(challenge.challenge_id)));
          return true;
        } catch (error) {
          return failure(error, "code_sent");
        }
      },
      async verify(code) {
        const { challenge } = store.getState();
        if (!challenge) return false;
        store.setState({ step: "verifying", error: null });
        try {
          const result = await hp.auth.otp.verify({ challengeId: challenge.challenge_id, code: code.replace(/\s/g, "") });
          if (result.status === "needs_registration") {
            store.setState({ step: "needs_registration", registrationToken: result.registrationToken });
          } else {
            const { status: _status, ...signedIn } = result;
            store.setState({ step: "signed_in", result: signedIn });
          }
          return true;
        } catch (error) {
          return failure(error, "code_sent");
        }
      },
      async register(input) {
        const token = store.getState().registrationToken;
        if (!token) return false;
        store.setState({ step: "registering", error: null });
        try {
          store.setState({ step: "signed_in", result: await hp.auth.otp.register({ registrationToken: token, ...input }) });
          return true;
        } catch (error) {
          return failure(error, "needs_registration");
        }
      },
      reset: () => {
        purpose = "login";
        store.setState(initial);
      },
    },
  };
}

/* ------------------------------------------------------------------ */
/* Review form                                                         */
/* ------------------------------------------------------------------ */

export interface ReviewFile {
  id: string;
  file: Blob & { name?: string };
  kind: "image" | "video";
  status: "uploading" | "uploaded" | "error";
  upload: ReviewUpload | null;
  error: HeadpressError | null;
}

export interface ReviewFormState {
  rating: number | null;
  title: string;
  content: string;
  anonymous: boolean;
  files: ReviewFile[];
  status: "editing" | "submitting" | "submitted";
  /** Field → message from local checks against the store config, or from the server. */
  fieldErrors: Record<string, string>;
  result: { status: "approved" | "pending"; review: Review } | null;
  error: HeadpressError | null;
}

export interface ReviewFormActions {
  set(fields: Partial<Pick<ReviewFormState, "rating" | "title" | "content" | "anonymous">>): void;
  /** Check files against `config.modules.reviews.media` and upload the accepted ones. */
  addFiles(files: readonly (Blob & { name?: string })[]): Promise<void>;
  removeFile(id: string): Promise<void>;
  submit(options?: { captcha?: string; author_name?: string; author_email?: string }): Promise<boolean>;
}

/** Codes in `fieldErrors` for local checks; word them in the interface. */
export const ReviewFieldError = {
  ratingRequired: "rating_required",
  titleLength: "title_length",
  contentLength: "content_length",
  tooManyFiles: "too_many_files",
  fileType: "file_type",
  fileSize: "file_size",
  uploading: "uploading",
} as const;

export function createReviewForm(hp: Pick<HeadpressClient, "reviews" | "capabilities">, productId: number): Controller<ReviewFormState, ReviewFormActions> {
  const store = createStore<ReviewFormState>({
    rating: null,
    title: "",
    content: "",
    anonymous: false,
    files: [],
    status: "editing",
    fieldErrors: {},
    result: null,
    error: null,
  });
  let counter = 0;
  const settings = () => hp.capabilities.get("reviews");

  const patchFile = (id: string, patch: Partial<ReviewFile>): void =>
    store.setState((state) => ({ files: state.files.map((entry) => (entry.id === id ? { ...entry, ...patch } : entry)) }));

  const validate = (): Record<string, string> => {
    const config = settings();
    const state = store.getState();
    const errors: Record<string, string> = {};
    if (config?.rating_enabled !== false && config?.rating_required && !state.rating) errors.rating = ReviewFieldError.ratingRequired;
    const title = state.title.trim();
    if (title && (title.length < 3 || title.length > (config?.title_max_length ?? 80))) errors.title = ReviewFieldError.titleLength;
    const content = state.content.trim();
    const min = config?.content_required === false && !content ? 0 : config?.content_min_length ?? 0;
    if (content.length < min || content.length > (config?.content_max_length ?? 5000)) errors.content = ReviewFieldError.contentLength;
    if (state.files.some((entry) => entry.status === "uploading")) errors.media = ReviewFieldError.uploading;
    return errors;
  };

  return {
    getState: store.getState,
    subscribe: store.subscribe,
    destroy: () => undefined,
    actions: {
      set: (fields) => store.setState((state) => ({ ...fields, fieldErrors: Object.fromEntries(Object.entries(state.fieldErrors).filter(([key]) => !(key in fields))) })),

      async addFiles(files) {
        const media = settings()?.media ?? {};
        const accepted: ReviewFile[] = [];
        let rejection: string | null = null;
        for (const file of files) {
          const kind = file.type.startsWith("video/") ? "video" : "image";
          const rules = media[kind];
          const count = [...store.getState().files, ...accepted].filter((entry) => entry.kind === kind).length;
          if (!rules || rules.enabled === false || (rules.types?.length && !rules.types.includes(file.type))) rejection = ReviewFieldError.fileType;
          else if (rules.max_size && file.size > rules.max_size) rejection = ReviewFieldError.fileSize;
          else if (rules.max_files !== undefined && count >= rules.max_files) rejection = ReviewFieldError.tooManyFiles;
          else accepted.push({ id: `f${++counter}`, file, kind, status: "uploading", upload: null, error: null });
        }
        store.setState((state) => ({ files: [...state.files, ...accepted], fieldErrors: rejection ? { ...state.fieldErrors, media: rejection } : state.fieldErrors }));
        await Promise.all(
          accepted.map(async (entry) => {
            try {
              patchFile(entry.id, { status: "uploaded", upload: await hp.reviews.uploadMedia(entry.file, { filename: entry.file.name }) });
            } catch (error) {
              patchFile(entry.id, { status: "error", error: asError(error) });
            }
          }),
        );
      },

      async removeFile(id) {
        const entry = store.getState().files.find((file) => file.id === id);
        store.setState((state) => ({ files: state.files.filter((file) => file.id !== id) }));
        if (entry?.upload) await hp.reviews.deleteMedia(entry.upload.id, entry.upload.token).catch(() => undefined);
      },

      async submit(options = {}) {
        const errors = validate();
        if (Object.keys(errors).length) {
          store.setState({ fieldErrors: errors });
          return false;
        }
        const state = store.getState();
        store.setState({ status: "submitting", error: null, fieldErrors: {} });
        try {
          const result = await hp.reviews.create(
            productId,
            {
              ...(state.rating ? { rating: state.rating } : {}),
              ...(state.title.trim() ? { title: state.title.trim() } : {}),
              content: state.content.trim(),
              anonymous: state.anonymous,
              media: state.files.filter((entry) => entry.upload).map((entry) => ({ id: entry.upload!.id, token: entry.upload!.token })),
              ...(options.author_name ? { author_name: options.author_name } : {}),
              ...(options.author_email ? { author_email: options.author_email } : {}),
            },
            { captcha: options.captcha },
          );
          store.setState({ status: "submitted", result });
          return true;
        } catch (error) {
          const err = asError(error);
          const fields = err.data.fields && typeof err.data.fields === "object" ? (err.data.fields as Record<string, string>) : {};
          store.setState({ status: "editing", error: err, fieldErrors: fields });
          return false;
        }
      },
    },
  };
}

/* ------------------------------------------------------------------ */
/* Split payment builder                                               */
/* ------------------------------------------------------------------ */

export interface SplitBuilderLeg {
  gatewayId: string;
  amount: Money;
}

export interface SplitBuilderState {
  total: Money;
  legs: SplitBuilderLeg[];
  /** What is still to assign (total − sum of legs). */
  unassigned: Money;
  /** Local checks against `config.modules.split_payments`. */
  problems: ("too_few_legs" | "too_many_legs" | "leg_too_small" | "sum_mismatch" | "unknown_method")[];
  /** The server's amounts (discounts and charges), once the plan is valid. */
  quote: SplitQuote | null;
  status: "editing" | "quoting" | "ready" | "error";
  error: HeadpressError | null;
}

export interface SplitBuilderActions {
  setTotal(total: Money): void;
  setLegs(legs: readonly SplitBuilderLeg[]): void;
  setLeg(index: number, leg: Partial<SplitBuilderLeg>): void;
  addLeg(gatewayId: string): void;
  removeLeg(index: number): void;
}

export function createSplitBuilder(
  hp: Pick<HeadpressClient, "checkout" | "capabilities">,
  initial: { total: Money; legs?: readonly SplitBuilderLeg[] },
  options: { debounceMs?: number } = {},
): Controller<SplitBuilderState, SplitBuilderActions> {
  const zero = (): Money => money(0, initial.total.currency, initial.total.minorUnit);
  const store = createStore<SplitBuilderState>({
    total: initial.total,
    legs: [...(initial.legs ?? [])],
    unassigned: initial.total,
    problems: [],
    quote: null,
    status: "editing",
    error: null,
  });
  let timer: ReturnType<typeof setTimeout> | null = null;
  let sequence = 0;

  const evaluate = (): void => {
    const config = hp.capabilities.get("split_payments");
    const { legs, total } = store.getState();
    const assigned = legs.reduce((sum, leg) => sum + leg.amount.amount, 0);
    const problems: SplitBuilderState["problems"] = [];
    if (legs.length < (config?.min_legs ?? 2)) problems.push("too_few_legs");
    if (legs.length > (config?.max_legs ?? 5)) problems.push("too_many_legs");
    if (legs.some((leg) => leg.amount.amount < (config?.min_leg_amount ?? 1))) problems.push("leg_too_small");
    if (assigned !== total.amount) problems.push("sum_mismatch");
    const known = new Set((config?.methods ?? []).map((method) => method.id));
    if (known.size && legs.some((leg) => !known.has(leg.gatewayId))) problems.push("unknown_method");
    store.setState({ unassigned: money(total.amount - assigned, total.currency, total.minorUnit), problems, quote: null });

    if (timer) clearTimeout(timer);
    if (problems.length) {
      store.setState({ status: "editing", error: null });
      return;
    }
    store.setState({ status: "quoting", error: null });
    const id = ++sequence;
    timer = setTimeout(async () => {
      try {
        const quote = await hp.checkout.quoteSplit(store.getState().legs);
        if (id === sequence) store.setState({ quote, status: "ready" });
      } catch (error) {
        if (id === sequence) store.setState({ status: "error", error: asError(error) });
      }
    }, options.debounceMs ?? 300);
  };

  evaluate();

  return {
    getState: store.getState,
    subscribe: store.subscribe,
    destroy: () => {
      if (timer) clearTimeout(timer);
    },
    actions: {
      setTotal(total) {
        store.setState({ total });
        evaluate();
      },
      setLegs(legs) {
        store.setState({ legs: [...legs] });
        evaluate();
      },
      setLeg(index, leg) {
        store.setState((state) => ({ legs: state.legs.map((entry, i) => (i === index ? { ...entry, ...leg } : entry)) }));
        evaluate();
      },
      addLeg(gatewayId) {
        const { unassigned } = store.getState();
        store.setState((state) => ({ legs: [...state.legs, { gatewayId, amount: unassigned.amount > 0 ? unassigned : zero() }] }));
        evaluate();
      },
      removeLeg(index) {
        store.setState((state) => ({ legs: state.legs.filter((_, i) => i !== index) }));
        evaluate();
      },
    },
  };
}

/* ------------------------------------------------------------------ */
/* Shipping quote                                                      */
/* ------------------------------------------------------------------ */

export interface ShippingQuoteState {
  postcode: string;
  status: "idle" | "loading" | "ready" | "error";
  quote: ShippingQuote | null;
  error: HeadpressError | null;
}

export interface ShippingQuoteActions {
  setPostcode(postcode: string): void;
  quote(input: { productId: number; variationId?: number; quantity?: number }): Promise<ShippingQuote | null>;
}

export function createShippingQuote(hp: Pick<HeadpressClient, "checkout">): Controller<ShippingQuoteState, ShippingQuoteActions> {
  const store = createStore<ShippingQuoteState>({ postcode: "", status: "idle", quote: null, error: null });
  let sequence = 0;
  return {
    getState: store.getState,
    subscribe: store.subscribe,
    destroy: () => undefined,
    actions: {
      setPostcode: (postcode) => store.setState({ postcode: maskCep(postcode) }),
      async quote(input) {
        const postcode = store.getState().postcode;
        if (!isValidCep(postcode)) {
          store.setState({ status: "error", error: new HeadpressError("headpress_invalid_param", "Invalid postcode.", 400, { fields: { postcode: "invalid" } }) });
          return null;
        }
        const id = ++sequence;
        store.setState({ status: "loading", error: null });
        try {
          const quote = await hp.checkout.shippingQuote({ ...input, postcode });
          if (id === sequence) store.setState({ status: "ready", quote });
          return quote;
        } catch (error) {
          if (id === sequence) store.setState({ status: "error", error: asError(error) });
          return null;
        }
      },
    },
  };
}

/* ------------------------------------------------------------------ */
/* Brazilian address form                                              */
/* ------------------------------------------------------------------ */

export interface AddressFormValues extends Partial<Address> {
  number?: string;
  neighborhood?: string;
  document?: string;
}

export interface AddressFormState {
  values: AddressFormValues;
  /** CEP lookup: `found` filled the street, `not_found` asks for it by hand. */
  lookup: "idle" | "loading" | "found" | "not_found" | "failed";
  fieldErrors: Record<string, string>;
}

export interface AddressFormActions {
  set(values: Partial<AddressFormValues>): void;
  /** Look the CEP up and fill street, neighborhood, city and state (only empty fields). */
  lookupPostcode(): Promise<void>;
  /** Check required fields, CEP, document and phone; returns whether the form is valid. */
  validate(options?: { requireDocument?: boolean; requireNumber?: boolean; requireNeighborhood?: boolean }): boolean;
  /** Brazilian Market values for `checkout.place({ fields })`. */
  checkoutFields(extra?: Omit<BrazilianMarketInput, "document" | "number" | "neighborhood">): Record<string, string>;
}

export function createAddressForm(initial: AddressFormValues = {}, options: { fetch?: typeof fetch } = {}): Controller<AddressFormState, AddressFormActions> {
  const store = createStore<AddressFormState>({ values: { country: "BR", ...initial }, lookup: "idle", fieldErrors: {} });
  let sequence = 0;
  return {
    getState: store.getState,
    subscribe: store.subscribe,
    destroy: () => undefined,
    actions: {
      set: (values) =>
        store.setState((state) => ({
          values: { ...state.values, ...values, ...(values.postcode !== undefined ? { postcode: maskCep(values.postcode) } : {}) },
          fieldErrors: Object.fromEntries(Object.entries(state.fieldErrors).filter(([key]) => !(key in values))),
        })),
      async lookupPostcode() {
        const postcode = store.getState().values.postcode ?? "";
        if (!isValidCep(postcode)) return;
        const id = ++sequence;
        store.setState({ lookup: "loading" });
        try {
          const address = await lookupCep(postcode, { fetch: options.fetch });
          if (id !== sequence) return;
          if (!address) {
            store.setState({ lookup: "not_found" });
            return;
          }
          store.setState((state) => ({
            lookup: "found",
            values: {
              ...state.values,
              address_1: state.values.address_1 || address.address_1,
              neighborhood: state.values.neighborhood || address.neighborhood,
              city: state.values.city || address.city,
              state: state.values.state || address.state,
            },
          }));
        } catch {
          if (id === sequence) store.setState({ lookup: "failed" });
        }
      },
      validate(rules = {}) {
        const values = store.getState().values;
        const errors: Record<string, string> = {};
        for (const field of ["first_name", "last_name", "address_1", "city", "state", "postcode"] as const) {
          if (!String(values[field] ?? "").trim()) errors[field] = "required";
        }
        if (values.postcode && !isValidCep(values.postcode)) errors.postcode = "invalid";
        if ((rules.requireNumber ?? true) && !values.number?.trim()) errors.number = "required";
        if (rules.requireNeighborhood && !values.neighborhood?.trim()) errors.neighborhood = "required";
        if (rules.requireDocument && !values.document) errors.document = "required";
        else if (values.document && !documentType(values.document)) errors.document = "invalid";
        if (values.phone && !canonicalPhone(values.phone)) errors.phone = "invalid";
        store.setState({ fieldErrors: errors });
        return Object.keys(errors).length === 0;
      },
      checkoutFields(extra = {}) {
        const values = store.getState().values;
        return brazilianMarketValues({ ...extra, document: values.document, number: values.number, neighborhood: values.neighborhood, cellphone: extra.cellphone ?? values.phone });
      },
    },
  };
}
