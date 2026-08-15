import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import { test } from "node:test";
import { createOllamaLabStore } from "../../scripts/ollama-lab-store.mjs";

test("lab store persists completed public-test turns across a restart", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "lens-lab-store-"));
  const databasePath = path.join(directory, "turns.sqlite");
  try {
    const first = createOllamaLabStore(databasePath);
    first.recordTurn({ clientIp: "10.164.13.233", prompt: "public test", output: "answer" });
    assert.equal(first.countTurns(), 1);
    first.close();

    const restarted = createOllamaLabStore(databasePath);
    assert.equal(restarted.countTurns(), 1);
    restarted.close();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
