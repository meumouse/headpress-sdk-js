/**
 * Shape of `GET /headpress/v1/store/config`, the public store configuration.
 *
 * `modules` lists only the modules the store has enabled (and whose requirements are met), so it
 * doubles as the feature-flag map: code must cope with any module being absent. Module configs are
 * generated from the Headpress contract (`src/generated/store-config.ts`); add-ons type theirs
 * through declaration merging:
 *
 * ```ts
 * declare module "@meumouse/headpress" {
 *   interface ModuleConfigMap {
 *     cm_store: { enabled: true; welcome_coupon: { enabled: boolean; percent: number } };
 *   }
 * }
 * ```
 *
 * Money in the config is in minor units, like the Store API.
 */
import type { CommerceConfig, CoreModuleConfigMap } from "./generated/store-config.js";
import type { RouteMap } from "./routes.js";

export type * from "./generated/store-config.js";

/** Public config of each module, keyed by module id. Extend it for add-on modules. */
export interface ModuleConfigMap extends CoreModuleConfigMap {}

export type ModuleId = keyof ModuleConfigMap | (string & {});

/** What every module config carries. */
export interface ModuleBase {
  enabled: boolean;
  [key: string]: unknown;
}

export type StoreModules = { readonly [K in keyof ModuleConfigMap]?: ModuleConfigMap[K] } & {
  readonly [id: string]: ModuleBase | undefined;
};

export interface StoreUrls {
  /** Storefront base URL; empty until the store owner sets it. */
  storefront: string;
  backend: string;
  rest: string;
  store_api: string | null;
}

export interface StoreInfo {
  name: string;
  description: string;
  /** BCP 47 tag of the site locale, e.g. `pt-BR`. */
  language: string;
  timezone: string;
  urls: StoreUrls;
}

export interface StoreConfig {
  /** Bumped only on breaking changes to this payload. */
  schema_version: number;
  /** Hash of the payload, also sent as the ETag. */
  version: string;
  generated_at: string;
  store: StoreInfo;
  routes: RouteMap;
  /** Present when WooCommerce is active. */
  commerce?: CommerceConfig;
  modules: StoreModules;
}
