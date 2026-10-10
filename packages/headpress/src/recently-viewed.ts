/**
 * Recently viewed products, kept in the browser (`localStorage`), newest first.
 *
 * Only ids are stored: render them through `hp.catalog.list({ include: ids })` so names, prices and
 * stock are always current.
 */

export interface RecentlyViewedOptions {
  /** Storage key. */
  key?: string;
  /** Ids kept. Defaults to 12. */
  max?: number;
}

export interface RecentlyViewed {
  ids(): number[];
  add(id: number): number[];
  remove(id: number): number[];
  clear(): void;
  subscribe(listener: (ids: number[]) => void): () => void;
}

export function createRecentlyViewed(options: RecentlyViewedOptions = {}): RecentlyViewed {
  const key = options.key ?? "hp_recently_viewed";
  const max = options.max ?? 12;
  const listeners = new Set<(ids: number[]) => void>();
  let memory: number[] = [];

  const read = (): number[] => {
    try {
      if (typeof localStorage === "undefined") return memory;
      const parsed: unknown = JSON.parse(localStorage.getItem(key) ?? "[]");
      return Array.isArray(parsed) ? parsed.filter((id): id is number => Number.isInteger(id) && id > 0).slice(0, max) : [];
    } catch {
      return memory;
    }
  };
  const write = (ids: number[]): number[] => {
    memory = ids;
    try {
      if (typeof localStorage !== "undefined") localStorage.setItem(key, JSON.stringify(ids));
    } catch {
      // Full or blocked storage: kept in memory for this page.
    }
    listeners.forEach((listener) => listener(ids));
    return ids;
  };

  return {
    ids: read,
    add: (id) => write([id, ...read().filter((existing) => existing !== id)].slice(0, max)),
    remove: (id) => write(read().filter((existing) => existing !== id)),
    clear: () => void write([]),
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
