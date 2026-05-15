import { AsyncLocalStorage } from 'node:async_hooks';

export interface RequestContextStore {
  correlationId: string;
  userId?: string;
  transactionId?: string;
}

const storage = new AsyncLocalStorage<RequestContextStore>();

export const RequestContext = {
  run<T>(store: RequestContextStore, fn: () => T): T {
    return storage.run(store, fn);
  },
  get(): RequestContextStore | undefined {
    return storage.getStore();
  },
  set<K extends keyof RequestContextStore>(key: K, value: RequestContextStore[K]): void {
    const store = storage.getStore();
    if (store) {
      store[key] = value;
    }
  },
  correlationId(): string | undefined {
    return storage.getStore()?.correlationId;
  },
};
