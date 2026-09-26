import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * Per-request state that must be reachable without threading it through every
 * function signature. Today it carries the request id for log correlation; from
 * Phase 3 it also carries the authenticated user and the authorised shop, which is
 * the mechanism ADR-006 relies on — services read the shop from here, never from
 * a caller-supplied argument.
 */
export interface RequestContextStore {
  requestId: string;
  userId?: string;
  shopId?: string;
}

const storage = new AsyncLocalStorage<RequestContextStore>();

export const RequestContext = {
  run<T>(store: RequestContextStore, callback: () => T): T {
    return storage.run(store, callback);
  },

  get(): RequestContextStore | undefined {
    return storage.getStore();
  },

  requestId(): string | undefined {
    return storage.getStore()?.requestId;
  },

  /** Mutates the active store. Only guards should call this. */
  set<K extends keyof RequestContextStore>(key: K, value: RequestContextStore[K]): void {
    const store = storage.getStore();
    if (store) {
      store[key] = value;
    }
  },
};
