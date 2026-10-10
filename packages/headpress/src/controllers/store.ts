/**
 * The tiny observable every controller is built on: `getState()` returns the same object until the
 * state changes, so `useSyncExternalStore` (React), `readable()` (Svelte), `shallowRef` (Vue) or a
 * plain callback can all subscribe to it.
 */

export interface Readable<S> {
  getState(): S;
  subscribe(listener: () => void): () => void;
}

export interface Store<S> extends Readable<S> {
  setState(next: Partial<S> | ((state: S) => Partial<S>)): void;
}

export function createStore<S extends object>(initial: S): Store<S> {
  let state = initial;
  const listeners = new Set<() => void>();
  return {
    getState: () => state,
    setState(next) {
      const patch = typeof next === "function" ? next(state) : next;
      state = { ...state, ...patch };
      listeners.forEach((listener) => listener());
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

/** A controller: observable state plus the actions that change it. */
export interface Controller<S, A> extends Readable<S> {
  actions: A;
  /** Stop timers and subscriptions. */
  destroy(): void;
}
