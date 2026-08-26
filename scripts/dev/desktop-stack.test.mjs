import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { probeService, serviceDefinitions, waitForService } from "./desktop-stack.mjs";

const response = (body, status = 200) => new Response(body, { status });

describe("desktop development stack supervision", () => {
  it("recognizes the expected Lens endpoints", async () => {
    const [frontend, bff, identity] = serviceDefinitions();
    assert.deepEqual(await probeService(frontend, async () => response("<title>Lens</title>")), { state: "healthy" });
    assert.deepEqual(await probeService(bff, async () => response('{"ok":true}')), { state: "healthy" });
    assert.deepEqual(await probeService(identity, async () => response('{"issuer":"http://127.0.0.1:3005"}')), { state: "healthy" });
  });

  it("does not treat an occupied unexpected endpoint as a missing service", async () => {
    const service = serviceDefinitions()[1];
    assert.equal((await probeService(service, async () => response('{"ok":false}'))).state, "wrong");
    assert.deepEqual(await probeService(service, async () => { throw Object.assign(new Error("refused"), { code: "ECONNREFUSED" }); }), { state: "absent" });
    assert.deepEqual(await probeService(service, async () => { throw Object.assign(new TypeError("fetch failed"), { cause: { code: "ECONNREFUSED" } }); }), { state: "absent" });
  });

  it("stops waiting when a newly started child exits", async () => {
    const service = serviceDefinitions()[1];
    await assert.rejects(waitForService(service, {
      timeoutMs: 100,
      pollIntervalMs: 1,
      fetcher: async () => { throw Object.assign(new Error("refused"), { code: "ECONNREFUSED" }); },
      isChildExited: () => true,
    }), /bff exited before becoming ready/);
  });
});
