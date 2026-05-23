// Web Storage shim for the test runner.
//
// Node 25 exposes a built-in `localStorage` global that is non-functional
// without the `--localstorage-file` flag. Because it is defined directly on
// `globalThis`, it shadows the implementation jsdom would otherwise provide,
// leaving `localStorage.getItem` / `setItem` / `clear` all undefined under the
// test environment. Install a clean, spec-shaped Storage so tests — and
// `Storage.prototype` spies — behave like a real browser.

class MemoryStorage {
  #store = new Map<string, string>();

  get length(): number {
    return this.#store.size;
  }

  clear(): void {
    this.#store.clear();
  }

  getItem(key: string): string | null {
    return this.#store.has(key) ? this.#store.get(key)! : null;
  }

  key(index: number): string | null {
    return [...this.#store.keys()][index] ?? null;
  }

  removeItem(key: string): void {
    this.#store.delete(key);
  }

  setItem(key: string, value: string): void {
    this.#store.set(String(key), String(value));
  }
}

Object.defineProperty(globalThis, 'Storage', {
  value: MemoryStorage,
  configurable: true,
  writable: true
});

for (const name of ['localStorage', 'sessionStorage'] as const) {
  Object.defineProperty(globalThis, name, {
    value: new MemoryStorage(),
    configurable: true,
    writable: true
  });
}
