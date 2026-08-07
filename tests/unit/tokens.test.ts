import { describe, expect, it } from "vitest";
import { CURSOR } from "@/shared/design-system/cursorTokens";

describe("Cursor Dark Modern tokens", () => {
  it("matches VS Code ActivitybarPart dimensions", () => {
    expect(CURSOR.activityBarWidth).toBe(48);
    expect(CURSOR.activityBarActionHeight).toBe(48);
    expect(CURSOR.activityBarIconSize).toBe(24);
    expect(CURSOR.statusBarHeight).toBe(22);
    expect(CURSOR.titleBarHeight).toBe(35);
  });

  it("uses Dark Modern sideBar / editor backgrounds", () => {
    expect(CURSOR.colors.sideBarBg).toBe("#181818");
    expect(CURSOR.colors.editorBg).toBe("#1F1F1F");
    expect(CURSOR.colors.focusBorder).toBe("#0078D4");
  });
});
