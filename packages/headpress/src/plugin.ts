/**
 * Plugins: how a store adapts the SDK to its own Headpress add-ons and business rules without
 * forking it.
 *
 * A plugin can:
 *
 * - add resources for its add-on's routes, exposed under its name (`hp.cm.welcomeCoupon()`);
 * - watch or adjust every request and response (`onRequest`, `onResponse`);
 * - translate errors, e.g. an add-on's codes onto the ones the interface handles (`onError`);
 * - bring its own error texts per locale (`messages`).
 *
 * Its types come along: `createHeadpress({ plugins: [cm] })` returns a client typed with `hp.cm`.
 * Add-on module configs and error data are typed by declaration merging on `ModuleConfigMap` and
 * `ErrorDataMap`.
 *
 * @example
 * export const cm = definePlugin({
 *   name: "cm",
 *   setup: ({ request }) => ({
 *     welcomeCoupon: (body: { email: string }, captcha: string) =>
 *       request<{ coupon: string }>("/store/cm/discounts/welcome", { body, captcha, module: "cm_marketing" }),
 *   }),
 *   messages: { "pt-BR": { cm_invalid_cpf: "CPF inválido." } },
 * });
 */
import type { Capabilities } from "./capabilities.js";
import type { ConfigStore } from "./config.js";
import type { Messages } from "./messages.js";
import type { Routes } from "./routes.js";
import type { Transport, TransportHooks } from "./transport.js";

export interface PluginContext {
  request: Transport["request"];
  raw: Transport["raw"];
  url: Transport["url"];
  config: ConfigStore;
  capabilities: Capabilities;
  routes: Routes;
  /** The client's locale (option, else the store's language, else `en-US`). */
  locale(): string;
}

export interface HeadpressPlugin<N extends string = string, R = unknown> extends TransportHooks {
  /** Key the plugin's resources live under on the client. Must not clash with the client's own keys. */
  name: N;
  setup?: (context: PluginContext) => R;
  /** Error texts per locale (`pt-BR`, `en`…), looked up after the client's own dictionaries. */
  messages?: Readonly<Record<string, Messages>>;
}

export type AnyPlugin = HeadpressPlugin<string, any>;

/** Identity helper that keeps the plugin's name and resources typed. */
export function definePlugin<const N extends string, R = undefined>(
  plugin: HeadpressPlugin<N, R>,
): HeadpressPlugin<N, R> {
  return plugin;
}

/** The resources each plugin adds, keyed by plugin name. Plugins without `setup` add nothing. */
export type PluginResources<P extends readonly AnyPlugin[]> = {
  readonly [K in P[number] as K extends HeadpressPlugin<string, infer R>
    ? [R] extends [undefined]
      ? never
      : K["name"]
    : never]: K extends HeadpressPlugin<string, infer R> ? R : never;
};
