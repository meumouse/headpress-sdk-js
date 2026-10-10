/**
 * Which Headpress features the store has on, from `config.modules`.
 *
 * Before the config loads every answer is "no" (`known()` tells the two apart), and the transport
 * lets module calls through, so the server has the last word.
 */
import { HeadpressError, SdkErrorCode } from "./errors.js";
import type { ModuleBase, ModuleConfigMap, ModuleId, StoreConfig } from "./types.js";

export interface Capabilities {
  /** Whether the config has loaded. */
  known(): boolean;
  /** Whether a module is enabled. False before the config loads. */
  has(id: ModuleId): boolean;
  /** A module's public config, or undefined when it is off. */
  get<K extends keyof ModuleConfigMap>(id: K): ModuleConfigMap[K] | undefined;
  get(id: string): ModuleBase | undefined;
  /** Throw `headpress_module_disabled` unless the module is enabled. */
  assert(id: ModuleId): void;
  /** Ids of the enabled modules. */
  enabled(): string[];
}

export function createCapabilities(peek: () => StoreConfig | null): Capabilities {
  const module = (id: string): ModuleBase | undefined => {
    const value = (peek()?.modules as Record<string, ModuleBase | undefined> | undefined)?.[id];
    return value && value.enabled === true ? value : undefined;
  };

  return {
    known: () => peek() !== null,
    has: (id) => module(id) !== undefined,
    get: ((id: string) => module(id)) as Capabilities["get"],
    assert(id) {
      if (!module(id)) {
        throw new HeadpressError(
          SdkErrorCode.moduleDisabled,
          `The "${id}" module is not enabled in Headpress.`,
          404,
          { module: id },
        );
      }
    },
    enabled: () =>
      Object.entries((peek()?.modules ?? {}) as Record<string, ModuleBase | undefined>)
        .filter(([, value]) => value?.enabled === true)
        .map(([id]) => id),
  };
}
