import type { LucideIcon } from "@/components/icons/tabler";

export type CommandCategory =
  | "View"
  | "File"
  | "Edit"
  | "Search"
  | "Terminal"
  | "AI"
  | "Go"
  | "Preferences"
  | "Help";

export interface LensCommand {
  id: string;
  title: string;
  category: CommandCategory;
  description?: string;
  icon?: LucideIcon;
  shortcut?: string;
  keywords?: string[];
  enabled?: boolean | (() => boolean);
  when?: string;
  run: () => void | Promise<void>;
}

type CommandListener = () => void;

class CommandRegistryImpl {
  private commands = new Map<string, LensCommand>();
  private recent: string[] = [];
  private pinned = new Set<string>();
  private listeners = new Set<CommandListener>();

  register(command: LensCommand): void {
    this.commands.set(command.id, command);
    this.notify();
  }

  registerMany(commands: LensCommand[]): void {
    commands.forEach((c) => this.commands.set(c.id, c));
    this.notify();
  }

  get(id: string): LensCommand | undefined {
    return this.commands.get(id);
  }

  getAll(): LensCommand[] {
    return Array.from(this.commands.values());
  }

  async execute(id: string): Promise<boolean> {
    const cmd = this.commands.get(id);
    if (!cmd) return false;
    const enabled = typeof cmd.enabled === "function" ? cmd.enabled() : cmd.enabled !== false;
    if (!enabled) return false;
    await cmd.run();
    this.pushRecent(id);
    return true;
  }

  pushRecent(id: string): void {
    this.recent = [id, ...this.recent.filter((x) => x !== id)].slice(0, 20);
    this.notify();
  }

  getRecent(): LensCommand[] {
    return this.recent
      .map((id) => this.commands.get(id))
      .filter((c): c is LensCommand => Boolean(c));
  }

  pin(id: string): void {
    this.pinned.add(id);
    this.notify();
  }

  unpin(id: string): void {
    this.pinned.delete(id);
    this.notify();
  }

  togglePin(id: string): void {
    if (this.pinned.has(id)) this.unpin(id);
    else this.pin(id);
  }

  getPinned(): LensCommand[] {
    return Array.from(this.pinned)
      .map((id) => this.commands.get(id))
      .filter((c): c is LensCommand => Boolean(c));
  }

  isPinned(id: string): boolean {
    return this.pinned.has(id);
  }

  subscribe(listener: CommandListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(): void {
    this.listeners.forEach((l) => l());
  }
}

export const commandRegistry = new CommandRegistryImpl();
