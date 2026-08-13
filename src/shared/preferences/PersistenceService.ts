/**
 * Thin persistence facade over localStorage for settings-shaped payloads.
 * Zustand persist remains the primary store middleware; this service is for
 * explicit backup/restore and versioned imports outside the store lifecycle.
 */

const PREFIX = "lens.prefs.";

export const PersistenceService = {
  read<T>(key: string): T | null {
    try {
      const raw = localStorage.getItem(PREFIX + key);
      if (!raw) return null;
      return JSON.parse(raw) as T;
    } catch {
      return null;
    }
  },

  write(key: string, value: unknown): void {
    try {
      localStorage.setItem(PREFIX + key, JSON.stringify(value));
    } catch {
      // Quota or private mode — ignore
    }
  },

  remove(key: string): void {
    try {
      localStorage.removeItem(PREFIX + key);
    } catch {
      // ignore
    }
  },

  backup(label: string, payload: unknown): string {
    const id = `backup-${Date.now()}`;
    this.write(id, {
      id,
      label,
      createdAt: new Date().toISOString(),
      payload,
    });
    return id;
  },
};
