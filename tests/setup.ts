import "@testing-library/jest-dom/vitest";

// Some Vitest/jsdom runners expose a partial localStorage object when no
// storage file is configured. The app's persistence contract needs a real
// Storage implementation so tests can prove that chat content is omitted.
if (typeof window !== "undefined" && typeof window.localStorage?.clear !== "function") {
  const values = new Map<string, string>();
  const storage: Storage = {
    get length() { return values.size; },
    clear: () => values.clear(),
    getItem: (key) => values.get(String(key)) ?? null,
    key: (index) => Array.from(values.keys())[index] ?? null,
    removeItem: (key) => { values.delete(String(key)); },
    setItem: (key, value) => { values.set(String(key), String(value)); },
  };
  Object.defineProperty(window, "localStorage", { configurable: true, value: storage });
}
