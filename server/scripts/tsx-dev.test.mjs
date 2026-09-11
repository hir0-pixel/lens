import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { appendNodeRequireOption } from "./tsx-dev.mjs";

describe("tsx Windows shim options", () => {
  it("quotes preload paths so NODE_OPTIONS survives spaces in workspace paths", () => {
    assert.equal(
      appendNodeRequireOption("--trace-warnings", "D:\\Refactr\\Repo lens\\lens\\server\\scripts\\tsx-windows-shim.cjs"),
      '--trace-warnings --require="D:\\\\Refactr\\\\Repo lens\\\\lens\\\\server\\\\scripts\\\\tsx-windows-shim.cjs"',
    );
  });
});
