import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("desktop production CSP", () => {
  it("does not permit arbitrary network connections or framed content", () => {
    const config = JSON.parse(readFileSync(resolve(process.cwd(), "src-tauri/tauri.conf.json"), "utf8"));
    const csp = config.app.security.csp as string;

    expect(csp).toContain("connect-src 'self'");
    expect(csp).toContain("frame-src 'none'");
    expect(csp).not.toMatch(/connect-src[^;]*\bhttps:/);
    expect(csp).not.toMatch(/connect-src[^;]*\bhttp:/);
    expect(csp).not.toMatch(/img-src[^;]*\bhttps:/);
  });

  it("keeps development connectivity separate from the production package", () => {
    const config = JSON.parse(readFileSync(resolve(process.cwd(), "src-tauri/tauri.conf.json"), "utf8"));

    expect(config.app.security.devCsp).toContain("connect-src 'self' https: http: ws: wss:");
  });
});
