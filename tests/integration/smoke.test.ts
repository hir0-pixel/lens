/**
 * Integration test scaffolding — expand with Testing Library when wiring Tauri mocks.
 * These smoke tests ensure feature modules export expected surfaces.
 */
import { describe, expect, it } from "vitest";
import { SETTINGS_NAV } from "@/shared/settings/registry";
import { DEFAULT_KEYBINDINGS } from "@/features/keyboard/ShortcutRegistry";
import { commandRegistry } from "@/features/command-palette/CommandRegistry";

describe("integration smoke", () => {
  it("registers settings categories", () => {
    expect(SETTINGS_NAV.length).toBeGreaterThanOrEqual(10);
    expect(SETTINGS_NAV.some((n) => n.id === "appearance")).toBe(true);
  });

  it("ships default keybindings including settings", () => {
    expect(
      DEFAULT_KEYBINDINGS.some((b) => b.commandId === "workbench.action.openSettings"),
    ).toBe(true);
  });

  it("exposes a command registry", () => {
    expect(typeof commandRegistry.getAll).toBe("function");
  });
});
