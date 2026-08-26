import { describe, expect, it } from "vitest";
import { CURSOR } from "@/shared/design-system/cursorTokens";

describe("Cursor workbench tokens", () => {
  it("matches VS Code ActivitybarPart dimensions", () => {
    expect(CURSOR.activityBarWidth).toBe(48);
    expect(CURSOR.activityBarActionHeight).toBe(48);
    expect(CURSOR.activityBarIconSize).toBe(24);
    expect(CURSOR.statusBarHeight).toBe(22);
    expect(CURSOR.titleBarHeight).toBe(35);
  });

  it("uses DESIGN-cursor canvas / surface / focus colors", () => {
    expect(CURSOR.colors.sideBarBg).toBe("#fafaf7");
    expect(CURSOR.colors.editorBg).toBe("#f7f7f4");
    expect(CURSOR.colors.focusBorder).toBe("#f54e00");
  });
});
