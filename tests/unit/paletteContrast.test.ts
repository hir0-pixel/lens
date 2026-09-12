import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const DESIGN_LENS_PATH = join(process.cwd(), "DESIGN-lens.md");

/** WCAG 2.x relative luminance (sRGB). */
function channelLinear(c: number): number {
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function hexToRgb(hex: string): [number, number, number] {
  const normalized = hex.replace("#", "").toLowerCase();
  return [
    parseInt(normalized.slice(0, 2), 16) / 255,
    parseInt(normalized.slice(2, 4), 16) / 255,
    parseInt(normalized.slice(4, 6), 16) / 255,
  ];
}

function relativeLuminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map(channelLinear);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrastRatio(foreground: string, background: string): number {
  const fg = relativeLuminance(foreground);
  const bg = relativeLuminance(background);
  const lighter = Math.max(fg, bg);
  const darker = Math.min(fg, bg);
  return (lighter + 0.05) / (darker + 0.05);
}

/** Light-mode informational text pairs from DESIGN-lens.md §Roles (canvas background). Dark tertiary (#9B9B9B) is out of scope for B3. */
function informationalTextPairsLight(): Array<{ role: string; fg: string; bg: string }> {
  const md = readFileSync(DESIGN_LENS_PATH, "utf8");
  const canvasMatch = md.match(/\| Canvas \/ chrome \| `(#[0-9A-Fa-f]{6})`/);
  if (!canvasMatch) {
    throw new Error("Canvas / chrome row not found in DESIGN-lens.md");
  }
  const lightBg = canvasMatch[1];

  const pairs: Array<{ role: string; fg: string; bg: string }> = [];
  const rowRe =
    /\| ([^|]+) \| `(#[0-9A-Fa-f]{6})` \| `(#[0-9A-Fa-f]{6})` \|/g;
  for (const match of md.matchAll(rowRe)) {
    const role = match[1].trim();
    if (!role.includes("text") || role.includes("button")) continue;
    pairs.push({ role: `${role} (light)`, fg: match[2], bg: lightBg });
  }

  if (pairs.length === 0) {
    throw new Error("No informational text roles parsed from DESIGN-lens.md");
  }

  return pairs;
}

describe("a11y.palette-contrast-aa", () => {
  it("documents the F-A2 seed failure (#A09C92 on #F7F7F4 = 2.55:1)", () => {
    const ratio = contrastRatio("#A09C92", "#F7F7F4");
    expect(ratio).toBeCloseTo(2.55, 1);
    expect(ratio).toBeLessThan(4.5);
  });

  it("ratified light informational pairs from DESIGN-lens.md meet WCAG 2.2 AA (4.5:1)", () => {
    for (const pair of informationalTextPairsLight()) {
      const ratio = contrastRatio(pair.fg, pair.bg);
      expect(ratio, `${pair.role}: ${pair.fg} on ${pair.bg} = ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(
        4.5,
      );
    }
  });

  it("ratified tertiary #6E6A62 on canvas #F7F7F4 passes AA (~5:1)", () => {
    const ratio = contrastRatio("#6E6A62", "#F7F7F4");
    expect(ratio).toBeCloseTo(5.02, 1);
    expect(ratio).toBeGreaterThanOrEqual(4.5);
  });
});
