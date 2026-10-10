/**
 * `createTracker()`: one `track()` call fans a canonical event out to every provider the visitor's
 * consent allows, and to Headpress' Conversions API relay.
 *
 * Consent is enforced here, in one place:
 *
 * - Each provider declares the consent category it needs (`category`). A provider with no category
 *   (`null`) is trusted to honour consent itself, e.g. a Google tag running Consent Mode.
 * - Until the visitor decides, events for gated providers are queued (up to `maxQueue`). On the
 *   decision they go to the providers it allows and are dropped for the rest — an event the visitor
 *   refused must never be replayed later.
 * - After the decision, events for a refused provider are dropped, not buffered. Granting a category
 *   later starts its providers from then on.
 *
 * Every event gets an `event_id`, shared by the browser pixels and the relayed server copy, so each
 * platform counts it once. `identify()` remembers who the visitor is and passes it only to allowed
 * providers.
 */
import type { ConsentModuleConfig } from "../types.js";
import { browserIds as readBrowserIds, type BrowserIds, type BrowserIdsOptions } from "./browser-ids.js";
import { requiredCategories, type Consent, type ConsentState } from "./consent.js";
import { compact, currentUrl, isBrowserEnv, userAgent } from "./env.js";
import { eventId as newEventId } from "./event-id.js";
import type { AnalyticsIdentity, AnyEventParams, CanonicalEvent, EventParams, EventParamsMap } from "./events.js";
import { cleanIdentity, memoryIdentity, type IdentityStore } from "./identity.js";
import type { Relay, RelayIdentity, RelayParams, RelayProvider } from "./relay.js";

export interface EventContext {
  /** Shared by the browser pixel and the server copy. */
  eventId: string;
  /** The page the event happened on. */
  url: string | undefined;
  identity: AnalyticsIdentity;
  consent: ConsentState;
  /** Whether a consent category is granted (a provider checks a second category, e.g. Google Ads). */
  allowed(category: string | null | undefined): boolean;
  /** Browser tags only: the server already sends its own copy. */
  browserOnly: boolean;
}

export interface ProviderContext {
  consent: ConsentState;
  consentConfig: ConsentModuleConfig | undefined;
  identity: AnalyticsIdentity;
  allowed(category: string | null | undefined): boolean;
}

/** What a provider hands the relay: its own event name and `custom_data`. */
export interface RelayDraft {
  provider: RelayProvider;
  name: string;
  params: RelayParams;
}

export interface AnalyticsProvider {
  readonly name: string;
  /** Consent category the provider needs, or null when it honours consent itself. */
  readonly category: string | null;
  /** Once, when the tracker is created in the browser, whatever the consent (Consent Mode defaults). */
  setup?(context: ProviderContext): void;
  /** Once, when the provider is first allowed (load its script here). */
  start?(context: ProviderContext): void;
  /** On every consent change made through the tracker's `Consent`, allowed or not. */
  consent?(state: ConsentState, config: ConsentModuleConfig | undefined): void;
  track(event: CanonicalEvent, params: AnyEventParams, context: EventContext): void;
  identify?(identity: AnalyticsIdentity, context: ProviderContext): void;
  /** The relayed copy of an event, or null when the provider does not relay it. */
  relay?(event: CanonicalEvent, params: AnyEventParams): RelayDraft | null;
}

export interface TrackOptions {
  /** Use this id instead of a fresh one (an id shared with a server copy, like `purchaseEventId()`). */
  eventId?: string;
  /** Fire the browser tags only; nothing goes to the relay. */
  browserOnly?: boolean;
}

export type TrackArgs<E extends CanonicalEvent> = {} extends EventParamsMap[E]
  ? [params?: EventParams<E>, options?: TrackOptions]
  : [params: EventParams<E>, options?: TrackOptions];

export interface TrackerOptions {
  consent: Consent;
  providers: readonly AnalyticsProvider[];
  /** Headpress' Conversions API relay (`createRelay(hp)`). */
  relay?: Relay;
  /** Where the visitor's identity lives. Defaults to memory (this page only); see `localIdentity()`. */
  identity?: IdentityStore;
  /** Currency stamped on events with a value or items and no currency of their own. */
  currency?: string | (() => string | undefined);
  /** Options for the browser ids sent with relayed events (`measurementId`, categories). */
  browserIds?: BrowserIdsOptions;
  /** Events kept while consent is undecided. Defaults to 50; the oldest are dropped. */
  maxQueue?: number;
  /** A provider threw. Defaults to ignoring it: analytics never breaks the page. */
  onError?: (error: unknown, provider: string) => void;
}

export interface Tracker {
  /** Send an event; resolves its `event_id`. A no-op (returning the id) on the server. */
  track<E extends CanonicalEvent>(event: E, ...args: TrackArgs<E>): string;
  /** Remember who the visitor is and pass it to the allowed providers. */
  identify(identity: AnalyticsIdentity): void;
  /** The remembered identity. */
  identity(): AnalyticsIdentity;
  /** Forget the visitor (sign-out). */
  reset(): void;
  /** Events waiting for a consent decision. */
  pending(): number;
  /** Stop listening to consent changes. */
  destroy(): void;
}

interface Queued {
  event: CanonicalEvent;
  params: AnyEventParams;
  eventId: string;
  url: string | undefined;
  browserOnly: boolean;
  /** Gated providers still owed this event. */
  owed: AnalyticsProvider[];
}

const emailKey = (email: string | undefined): string => (email ?? "").trim().toLowerCase();

export function createTracker(options: TrackerOptions): Tracker {
  const { consent, relay } = options;
  const providers = [...options.providers];
  const store = options.identity ?? memoryIdentity();
  const maxQueue = Math.max(0, options.maxQueue ?? 50);
  const started = new Set<AnalyticsProvider>();
  let queue: Queued[] = [];

  const report = (error: unknown, provider: string): void => {
    try {
      options.onError?.(error, provider);
    } catch {
      // Ignore.
    }
  };

  const allowedFor =
    (state: ConsentState) =>
    (category: string | null | undefined): boolean => {
      if (category === null || category === undefined) return true;
      // Required categories are always granted; the rest need a decision that includes them.
      return requiredCategories(consent.config()).includes(category) || (state.decided && state.categories.includes(category));
    };

  const isAllowed = (provider: AnalyticsProvider, state: ConsentState): boolean => allowedFor(state)(provider.category);

  const providerContext = (state: ConsentState): ProviderContext => ({
    consent: state,
    consentConfig: consent.config(),
    identity: store.get(),
    allowed: allowedFor(state),
  });

  const ensureStarted = (provider: AnalyticsProvider, state: ConsentState): void => {
    if (started.has(provider)) return;
    started.add(provider);
    try {
      provider.start?.(providerContext(state));
    } catch (error) {
      report(error, provider.name);
    }
  };

  const currency = (): string | undefined => {
    try {
      return typeof options.currency === "function" ? options.currency() : options.currency;
    } catch {
      return undefined;
    }
  };

  const relayIdentity = (provider: RelayProvider, identity: AnalyticsIdentity, ids: BrowserIds): RelayIdentity =>
    compact({
      email: identity.email,
      phone: identity.phone,
      external_id: identity.external_id,
      ...(provider === "meta" ? { fbp: ids.fbp, fbc: ids.fbc } : { epik: ids.epik }),
      client_user_agent: userAgent(),
    }) as RelayIdentity;

  const deliver = (provider: AnalyticsProvider, entry: Omit<Queued, "owed">, state: ConsentState): void => {
    ensureStarted(provider, state);
    const identity = store.get();
    const context: EventContext = {
      eventId: entry.eventId,
      url: entry.url,
      identity,
      consent: state,
      allowed: allowedFor(state),
      browserOnly: entry.browserOnly,
    };
    try {
      provider.track(entry.event, entry.params, context);
    } catch (error) {
      report(error, provider.name);
    }
    if (!relay || !provider.relay || entry.browserOnly || entry.event === "purchase" || !entry.url) return;
    try {
      const draft = provider.relay(entry.event, entry.params);
      if (!draft || !relay.enabled(draft.provider)) return;
      relay.push({
        provider: draft.provider,
        name: draft.name,
        event_id: entry.eventId,
        event_source_url: entry.url,
        params: compact(draft.params as Record<string, unknown>) as RelayParams,
        identity: relayIdentity(
          draft.provider,
          identity,
          // The click ids need the same category as the provider that relays them.
          readBrowserIds(state, {
            ...options.browserIds,
            marketingCategory: options.browserIds?.marketingCategory ?? provider.category ?? undefined,
            url: entry.url,
          }),
        ),
        consent: { categories: [...state.categories] },
      });
    } catch (error) {
      report(error, provider.name);
    }
  };

  const flushQueue = (state: ConsentState): void => {
    if (!state.decided || queue.length === 0) return;
    const pending = queue;
    queue = [];
    for (const entry of pending) {
      for (const provider of entry.owed) {
        // Refused providers drop the event for good.
        if (isAllowed(provider, state)) deliver(provider, entry, state);
      }
    }
  };

  let unsubscribe: () => void = () => undefined;
  if (isBrowserEnv()) {
    const state = consent.get();
    for (const provider of providers) {
      try {
        provider.setup?.(providerContext(state));
      } catch (error) {
        report(error, provider.name);
      }
    }
    for (const provider of providers) if (isAllowed(provider, state)) ensureStarted(provider, state);

    unsubscribe = consent.subscribe((next) => {
      for (const provider of providers) {
        try {
          provider.consent?.(next, consent.config());
        } catch (error) {
          report(error, provider.name);
        }
      }
      if (!next.decided) return;
      for (const provider of providers) if (isAllowed(provider, next)) ensureStarted(provider, next);
      flushQueue(next);
    });
  }

  return {
    track<E extends CanonicalEvent>(event: E, ...args: TrackArgs<E>): string {
      const [rawParams, trackOptions = {}] = args as [AnyEventParams | undefined, TrackOptions | undefined];
      const id = trackOptions.eventId || newEventId(event);
      if (!isBrowserEnv()) return id;

      const params: AnyEventParams = { ...(rawParams ?? {}) };
      const fallbackCurrency = currency();
      if (fallbackCurrency && params.currency === undefined && (params.value !== undefined || params.items !== undefined)) {
        params.currency = fallbackCurrency;
      }
      const entry = { event, params, eventId: id, url: currentUrl(), browserOnly: trackOptions.browserOnly === true };
      const state = consent.get();
      const owed: AnalyticsProvider[] = [];
      for (const provider of providers) {
        if (isAllowed(provider, state)) deliver(provider, entry, state);
        else if (!state.decided) owed.push(provider);
      }
      if (owed.length > 0 && maxQueue > 0) {
        queue.push({ ...entry, owed });
        if (queue.length > maxQueue) queue.splice(0, queue.length - maxQueue);
      }
      return id;
    },

    identify(input) {
      const incoming = cleanIdentity(input);
      let current = store.get();
      // Someone else on a shared device: start clean, or the previous person's data would be merged.
      if (emailKey(incoming.email) && emailKey(current.email) && emailKey(incoming.email) !== emailKey(current.email)) {
        store.clear();
        current = store.get();
      }
      store.set({ ...current, ...incoming });
      if (!isBrowserEnv()) return;
      const state = consent.get();
      const context = providerContext(state);
      for (const provider of providers) {
        if (!provider.identify || !isAllowed(provider, state) || !started.has(provider)) continue;
        try {
          provider.identify(context.identity, context);
        } catch (error) {
          report(error, provider.name);
        }
      }
    },

    identity: () => store.get(),
    reset: () => store.clear(),
    pending: () => queue.length,
    destroy() {
      unsubscribe();
      queue = [];
    },
  };
}
