/**
 * Headpress' browser event relay: `POST /store/analytics/events`.
 *
 * With *Relay browser events* on (`modules.meta_pixel.relay_events`, `modules.pinterest.relay_events`)
 * Headpress forwards browser events to the Meta and Pinterest Conversions APIs from the server, so
 * ad blockers and browser privacy features do not lose them. Each event carries the same `event_id`
 * as the browser pixel, so the platform counts it once.
 *
 * Events are batched (Headpress takes at most 20 per request and 60 requests a minute): flushed when
 * the batch is full, after a short pause, and when the page is hidden — with `keepalive`, so that
 * last request outlives the page. Purchases never go this way: Headpress sends them from the paid
 * order and refuses them here. Failures are swallowed: the browser pixel already counted the event.
 */
import type { HeadpressClient } from "../client.js";
import { browserWindow } from "./env.js";

export type RelayProvider = "meta" | "pinterest";

/** `custom_data` keys Headpress keeps. Amounts in major units. */
export interface RelayParams {
  currency?: string;
  value?: number;
  content_ids?: string[];
  contents?: { id: string; quantity: number; item_price?: number }[];
  num_items?: number;
  content_name?: string;
  content_category?: string;
  search_string?: string;
  /** Meta only: `product` or `product_group`. */
  content_type?: string;
  /** Pinterest only. */
  content_brand?: string;
}

/** Plain identifiers; Headpress normalizes and SHA-256 hashes them before storing anything. */
export interface RelayIdentity {
  email?: string;
  phone?: string;
  external_id?: string;
  fbp?: string;
  fbc?: string;
  epik?: string;
  client_user_agent?: string;
}

/** One event as Headpress takes it. */
export interface RelayEvent {
  provider?: RelayProvider;
  /** The provider's own name (`AddToCart`, `add_to_cart`…). */
  name: string;
  event_id: string;
  event_source_url: string;
  params: RelayParams;
  identity: RelayIdentity;
  consent: { categories: string[] };
}

export interface RelayResult {
  queued?: number;
  rejected?: { index: number; reason: string }[];
}

export interface RelayOptions {
  /** Events per request, at most 20 (Headpress' limit). */
  maxBatch?: number;
  /** Milliseconds to wait for more events before sending. Defaults to 1000. */
  flushDelayMs?: number;
  /** Called with Headpress' answer when it rejected some events (debugging). */
  onRejected?: (rejected: { index: number; reason: string }[], events: RelayEvent[]) => void;
}

export interface Relay {
  /** Whether Headpress relays this provider's events (`modules.<provider>.relay_events`). */
  enabled(provider: RelayProvider): boolean;
  /** Queue an event. Ignored when its provider does not relay, or for purchases. */
  push(event: RelayEvent): void;
  /** Send everything queued now. */
  flush(): Promise<void>;
  /** Events waiting to be sent. */
  pending(): number;
  /** Stop listening to page events and drop the queue. */
  destroy(): void;
}

const MAX_BATCH = 20;
const MODULE_OF: Record<RelayProvider, string> = { meta: "meta_pixel", pinterest: "pinterest" };
/** Headpress refuses purchases here: the server sends them from the paid order. */
const PURCHASE_NAMES = new Set(["Purchase", "checkout"]);
const EVENT_ID = /^[A-Za-z0-9_.:-]{1,100}$/;

export function createRelay(hp: Pick<HeadpressClient, "request" | "capabilities">, options: RelayOptions = {}): Relay {
  const maxBatch = Math.max(1, Math.min(MAX_BATCH, Math.floor(options.maxBatch ?? MAX_BATCH)));
  const delay = options.flushDelayMs ?? 1000;
  let queue: RelayEvent[] = [];
  let timer: ReturnType<typeof setTimeout> | null = null;
  let detach: (() => void) | null = null;
  const inflight = new Set<Promise<void>>();

  const enabled = (provider: RelayProvider): boolean => {
    try {
      return hp.capabilities.get(MODULE_OF[provider])?.relay_events === true;
    } catch {
      return false;
    }
  };

  const send = (events: RelayEvent[]): Promise<void> => {
    const request = hp
      .request<RelayResult>("/store/analytics/events", {
        method: "POST",
        body: { events },
        fetchOptions: { keepalive: true },
      })
      .then((result) => {
        if (result?.rejected?.length) options.onRejected?.(result.rejected, events);
      })
      .catch(() => {
        // 404 (relay off), 429 or a network error: only the server copy is lost.
      });
    inflight.add(request);
    void request.finally(() => inflight.delete(request));
    return request;
  };

  const flush = (): Promise<void> => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    const sending: Promise<void>[] = [];
    while (queue.length > 0) sending.push(send(queue.splice(0, maxBatch)));
    return Promise.all([...inflight, ...sending]).then(() => undefined);
  };

  const listen = (): void => {
    if (detach) return;
    const win = browserWindow();
    if (!win) return;
    const onHide = (): void => void flush();
    const onVisibility = (): void => {
      try {
        if (document.visibilityState === "hidden") void flush();
      } catch {
        // Ignore.
      }
    };
    try {
      win.addEventListener("pagehide", onHide);
      document.addEventListener("visibilitychange", onVisibility);
      detach = () => {
        win.removeEventListener("pagehide", onHide);
        document.removeEventListener("visibilitychange", onVisibility);
      };
    } catch {
      detach = () => undefined;
    }
  };

  return {
    enabled,
    push(event) {
      if (PURCHASE_NAMES.has(event.name) || !EVENT_ID.test(event.event_id)) return;
      if (event.provider && !enabled(event.provider)) return;
      listen();
      queue.push(event);
      if (queue.length >= maxBatch) void flush();
      else if (!timer) timer = setTimeout(() => void flush(), delay);
    },
    flush,
    pending: () => queue.length,
    destroy() {
      if (timer) clearTimeout(timer);
      timer = null;
      queue = [];
      detach?.();
      detach = null;
    },
  };
}
