"use client";
/**
 * `@meumouse/headpress/react`: React bindings for the client and the controllers.
 *
 * ```tsx
 * <HeadpressProvider client={hp} initialConfig={configFromServer}>
 *   <App />
 * </HeadpressProvider>
 *
 * const [cart, cartActions] = useCart();
 * const [search, { setQuery }] = useSearchBox();
 * const formatMoney = useFormatMoney();
 * ```
 *
 * Hooks subscribe with `useSyncExternalStore`, so they are safe with concurrent rendering, server
 * rendering (the server snapshot is the initial state) and StrictMode.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";

import type { Customer } from "../account-types.js";
import type { HeadpressClient } from "../client.js";
import {
  createAddressForm,
  createCartController,
  createOtpFlow,
  createReviewForm,
  createSearchBox,
  createShippingQuote,
  createSplitBuilder,
  type AddressFormValues,
  type Controller,
  type Readable,
  type SearchBoxOptions,
  type SplitBuilderLeg,
} from "../controllers/index.js";
import type { FormatMoneyOptions, Money } from "../money.js";
import type { ModuleBase, ModuleConfigMap, StoreConfig } from "../types.js";

const HeadpressContext = createContext<HeadpressClient | null>(null);

export interface HeadpressProviderProps {
  client: HeadpressClient;
  /** The store config the server rendered with, so the browser does not fetch it again. */
  initialConfig?: StoreConfig | null;
  children?: ReactNode;
}

export function HeadpressProvider({ client, initialConfig, children }: HeadpressProviderProps) {
  // Seed before the first render so children read the config synchronously.
  const seeded = useRef(false);
  if (!seeded.current && initialConfig && !client.config.peek()) {
    client.config.hydrate(initialConfig);
  }
  seeded.current = true;
  return <HeadpressContext.Provider value={client}>{children}</HeadpressContext.Provider>;
}

/** The client from the nearest `HeadpressProvider`. */
export function useHeadpress(): HeadpressClient {
  const client = useContext(HeadpressContext);
  if (!client) throw new Error("useHeadpress() needs a <HeadpressProvider> above it.");
  return client;
}

/** Subscribe to any readable (a controller, or your own store). */
export function useReadable<S>(readable: Readable<S>): S {
  return useSyncExternalStore(readable.subscribe, readable.getState, readable.getState);
}

/**
 * Create a controller once per component and subscribe to it. `destroy()` runs on unmount; the
 * controllers re-attach on the next subscription, so StrictMode's remount is harmless.
 */
export function useController<S, A>(factory: () => Controller<S, A>): [S, A, Controller<S, A>] {
  const [controller] = useState(factory);
  useEffect(() => () => controller.destroy(), [controller]);
  return [useReadable(controller), controller.actions, controller];
}

/* ------------------------------------------------------------------ */
/* Config and session                                                  */
/* ------------------------------------------------------------------ */

/** The store config; loads it when missing. Null until it arrives. */
export function useStoreConfig(): StoreConfig | null {
  const hp = useHeadpress();
  const subscribe = useCallback((listener: () => void) => hp.config.subscribe(listener), [hp]);
  const getSnapshot = useCallback(() => hp.config.peek(), [hp]);
  const config = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  useEffect(() => {
    hp.config.get().catch(() => undefined);
  }, [hp]);
  return config;
}

/** A module's public config, or undefined while it is off (or the config is loading). */
export function useCapability<K extends keyof ModuleConfigMap>(id: K): ModuleConfigMap[K] | undefined;
export function useCapability(id: string): ModuleBase | undefined;
export function useCapability(id: string): unknown {
  useStoreConfig();
  return useHeadpress().capabilities.get(id);
}

/** Whether a customer is signed in (or a session is worth restoring). */
export function useSignedIn(): boolean {
  const hp = useHeadpress();
  const subscribe = useCallback((listener: () => void) => hp.session?.subscribe?.(() => listener()) ?? (() => undefined), [hp]);
  const getSnapshot = useCallback(() => hp.auth.isSignedIn(), [hp]);
  return useSyncExternalStore(subscribe, getSnapshot, () => false);
}

export interface CustomerState {
  customer: Customer | null;
  status: "loading" | "ready" | "error";
  /** Load the customer again (after a profile change). */
  reload(): Promise<void>;
}

/** The signed-in customer: restores the session on mount, null for guests. */
export function useCustomer(): CustomerState {
  const hp = useHeadpress();
  const signedIn = useSignedIn();
  const [state, setState] = useState<{ customer: Customer | null; status: CustomerState["status"] }>({ customer: null, status: "loading" });
  const reload = useCallback(async () => {
    try {
      setState({ customer: await hp.auth.restore(), status: "ready" });
    } catch {
      setState({ customer: null, status: "error" });
    }
  }, [hp]);
  useEffect(() => {
    void reload();
  }, [reload, signedIn]);
  return { ...state, reload };
}

/* ------------------------------------------------------------------ */
/* Formatting                                                          */
/* ------------------------------------------------------------------ */

/** `(money, options?) => string` in the client's locale. */
export function useFormatMoney(): (value: Money, options?: FormatMoneyOptions) => string {
  const hp = useHeadpress();
  useStoreConfig();
  return useCallback((value: Money, options?: FormatMoneyOptions) => hp.formatMoney(value, options), [hp]);
}

/** `(error, context?) => string` from the client's dictionaries. */
export function useFormatError(): (error: unknown, context?: string) => string {
  const hp = useHeadpress();
  return useCallback((error: unknown, context?: string) => hp.formatError(error, context), [hp]);
}

/* ------------------------------------------------------------------ */
/* Controllers                                                         */
/* ------------------------------------------------------------------ */

export interface UseCartOptions {
  /**
   * When to fetch the cart on mount: `if-token` (default) only when the shopper already has a
   * Cart-Token — fetching creates a WooCommerce session, which a visitor who never adds anything
   * does not need; `always`; or `never`.
   */
  load?: "if-token" | "always" | "never";
}

/** The shared cart; loads it on mount when nothing is loaded yet (see `load`). */
export function useCart(options: UseCartOptions = {}) {
  const hp = useHeadpress();
  const result = useController(() => createCartController(hp));
  const [state, actions] = result;
  const load = options.load ?? "if-token";
  useEffect(() => {
    if (state.status !== "idle" || load === "never") return;
    if (load === "if-token" && !hp.cartToken?.get()) return;
    void actions.load();
    // Only on mount: later loads are explicit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return result;
}

export function useSearchBox(options?: SearchBoxOptions) {
  const hp = useHeadpress();
  return useController(() => createSearchBox(hp, options));
}

export function useOtpFlow() {
  const hp = useHeadpress();
  return useController(() => createOtpFlow(hp));
}

export function useReviewForm(productId: number) {
  const hp = useHeadpress();
  return useController(() => createReviewForm(hp, productId));
}

export function useSplitBuilder(initial: { total: Money; legs?: readonly SplitBuilderLeg[] }) {
  const hp = useHeadpress();
  const result = useController(() => createSplitBuilder(hp, initial));
  const [, actions] = result;
  // Follow the cart total.
  useEffect(() => {
    actions.setTotal(initial.total);
  }, [actions, initial.total.amount, initial.total.currency]);
  return result;
}

export function useShippingQuote() {
  const hp = useHeadpress();
  return useController(() => createShippingQuote(hp));
}

export function useAddressForm(initial?: AddressFormValues) {
  return useController(() => createAddressForm(initial));
}

/** Memoize a value derived from the client (e.g. `hp.routes.path(...)`). */
export function useHeadpressValue<T>(select: (hp: HeadpressClient) => T, deps: readonly unknown[] = []): T {
  const hp = useHeadpress();
  useStoreConfig();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => select(hp), [hp, ...deps]);
}
