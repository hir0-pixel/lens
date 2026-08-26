import { describe, expect, it } from "vitest";
import { CURSOR } from "@/shared/design-system/cursorTokens";
import { ACCENT_COLORS } from "@/shared/themes/themeManager";

const VERCEL_HEX = new Set([
  "#171717",
  "#ffffff",
  "#4d4d4d",
  "#8f8f8f",
  "#a1a1a1",
  "#ebebeb",
  "#f2f2f2",
  "#fafafa",
  "#0070f3",
  "#0761d1",
  "#d3e5ff",
  "#ee0000",
  "#c50000",
  "#f5a623",
  "#ffefcf",
  "#ab570a",
  "#7928ca",
  "#d8ccf1",
  "#50e3c2",
  "#aaffec",
  "#ff0080",
  "#eb367f",
  "#007cf0",
  "#00dfd8",
  "#ff4d4d",
  "#f9cb28",
  "#0a0a0a", // dark-mode off-black (taste §8; not pure #000)
]);

describe("Cursor workbench tokens", () => {
  it("matches VS Code ActivitybarPart dimensions", () => {
    expect(CURSOR.activityBarWidth).toBe(48);
    expect(CURSOR.activityBarActionHeight).toBe(48);
    expect(CURSOR.activityBarIconSize).toBe(24);
    expect(CURSOR.statusBarHeight).toBe(22);
    expect(CURSOR.titleBarHeight).toBe(35);
  });

  it("uses DESIGN-vercel.md canvas / surface / focus colors", () => {
    expect(CURSOR.colors.sideBarBg).toBe("#ffffff");
    expect(CURSOR.colors.editorBg).toBe("#fafafa");
    expect(CURSOR.colors.focusBorder).toBe("#0070f3");
    expect(CURSOR.colors.buttonBg).toBe("#171717");
  });

  it("keeps light chrome contrast: elevated white on canvas, hairline seams", () => {
    expect(CURSOR.colors.editorBg).toBe("#fafafa");
    expect(CURSOR.colors.sideBarBg).toBe("#ffffff");
    expect(CURSOR.colors.sideBarBg).not.toBe(CURSOR.colors.editorBg);
    expect(CURSOR.colors.sideBarBorder).toBe("#ebebeb");
    expect(CURSOR.colors.panelBorder).toBe("#ebebeb");
    expect(CURSOR.colors.listHoverBg).toBe("#f2f2f2");
  });

  it("keeps workbench color map inside DESIGN-vercel (+ dark off-black)", () => {
    for (const [key, value] of Object.entries(CURSOR.colors)) {
      expect(VERCEL_HEX.has(value.toLowerCase()) || VERCEL_HEX.has(value), `${key}=${value}`).toBe(
        true,
      );
    }
  });

  it("maps accent presets to DESIGN-vercel colors only", () => {
    for (const [id, value] of Object.entries(ACCENT_COLORS)) {
      expect(VERCEL_HEX.has(value.toLowerCase()) || VERCEL_HEX.has(value), `${id}=${value}`).toBe(
        true,
      );
    }
  });
});
