import { describe, expect, it, vi } from "vitest";
import {
  EgressDeniedError,
  guardedDial,
  ZeroEgressPolicy,
} from "./zeroEgressPolicy";

describe("M01 zero-egress probe suite", () => {
  const policy = new ZeroEgressPolicy(new Set(["telemetry-collector.internal"]));

  it("permits only declared internal service identities", async () => {
    const dial = vi.fn(async () => "connected");

    await expect(guardedDial(policy, { kind: "service", name: "telemetry-collector.internal" }, dial)).resolves.toBe("connected");
    expect(dial).toHaveBeenCalledOnce();
  });

  it.each([
    { kind: "dns" as const, host: "example.com" },
    { kind: "ip" as const, address: "8.8.8.8" },
    { kind: "ip" as const, address: "2606:4700:4700::1111" },
    { kind: "proxy" as const, url: "http://proxy.example" },
    { kind: "webhook" as const, url: "https://hooks.example" },
  ])("denies public $kind paths before any dial", async (target) => {
    const dial = vi.fn(async () => "should-not-run");

    await expect(guardedDial(policy, target, dial)).rejects.toBeInstanceOf(EgressDeniedError);
    expect(dial).not.toHaveBeenCalled();
  });
});
