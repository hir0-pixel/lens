import { describe, expect, it } from "vitest";
import { CURSOR } from "@/shared/design-system/cursorTokens";
import { ACCENT_COLORS } from "@/shared/themes/themeManager";

// Approved palette per DESIGN-lens.md. Add a colour here only when that file
// ratifies it. Vercel is retired; a Vercel hex reappearing here is a regression.
const APPROVED_HEX = new Set([
  // surfaces
  "#f7f7f4", // canvas / chrome
  "#fdfbfa", // panel, raised-lightest
  "#f2f1ed", // hover / raised / neutral button
  "#e6e5e0", // border, active selection
  // ink
  "#26251e", // primary
  "#5a5852", // secondary
  "#a09c92", // tertiary / placeholder (inferred)
  "#807d72", // scrollbar hover (inferred)
  "#141312", // text on primary button
  // accent
  "#3183d8",
  "#5a9be0", // hover
  "#1d62aa", // active
  // semantic
  "#b91c1c", // danger
  // accent presets — retained pending review (DESIGN-lens.md)
  "#ab570a",
  "#50e3c2",
  "#7928ca",
  "#ff0080",
]);

describe("Cursor workbench tokens", () => {
  it("matches VS Code ActivitybarPart dimensions", () => {
    expect(CURSOR.activityBarWidth).toBe(48);
    expect(CURSOR.activityBarActionHeight).toBe(48);
    expect(CURSOR.activityBarIconSize).toBe(24);
    expect(CURSOR.statusBarHeight).toBe(22);
    expect(CURSOR.titleBarHeight).toBe(35);
  });

  it("uses DESIGN-lens.md canvas / panel / focus / button colors", () => {
    expect(CURSOR.colors.sideBarBg).toBe("#f7f7f4");
    expect(CURSOR.colors.editorBg).toBe("#fdfbfa");
    expect(CURSOR.colors.focusBorder).toBe("#3183d8");
    expect(CURSOR.colors.buttonBg).toBe("#3183d8");
    expect(CURSOR.colors.buttonFg).toBe("#141312");
    expect(CURSOR.colors.buttonSecondaryBg).toBe("#f2f1ed");
  });

  it("keeps light chrome contrast: lighter panel on canvas, hairline seams", () => {
    expect(CURSOR.colors.editorBg).toBe("#fdfbfa");
    expect(CURSOR.colors.sideBarBg).toBe("#f7f7f4");
    expect(CURSOR.colors.sideBarBg).not.toBe(CURSOR.colors.editorBg);
    expect(CURSOR.colors.sideBarBorder).toBe("#e6e5e0");
    expect(CURSOR.colors.panelBorder).toBe("#e6e5e0");
    expect(CURSOR.colors.listHoverBg).toBe("#f2f1ed");
  });

  it("retires Vercel and never uses ink as a surface", () => {
    const retired = new Set(["#171717", "#0070f3", "#fafafa", "#ffffff", "#ebebeb", "#f2f2f2", "#0a0a0a"]);
    for (const [key, value] of Object.entries(CURSOR.colors)) {
      expect(retired.has(value.toLowerCase()), `${key}=${value} is a retired Vercel value`).toBe(false);
    }
    for (const key of ["buttonBg", "buttonSecondaryBg", "sideBarBg", "editorBg"] as const) {
      expect(CURSOR.colors[key], `${key} must not be ink`).not.toBe("#26251e");
    }
  });

  it("keeps workbench color map inside the approved palette (+ dark off-black)", () => {
    for (const [key, value] of Object.entries(CURSOR.colors)) {
      expect(APPROVED_HEX.has(value.toLowerCase()) || APPROVED_HEX.has(value), `${key}=${value}`).toBe(
        true,
      );
    }
  });

  it("maps accent presets to approved palette colors only", () => {
    for (const [id, value] of Object.entries(ACCENT_COLORS)) {
      expect(APPROVED_HEX.has(value.toLowerCase()) || APPROVED_HEX.has(value), `${id}=${value}`).toBe(
        true,
      );
    }
  });
});
