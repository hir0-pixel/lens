import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

/** Durable storage for public test data only; production uses authoritative services. */
export function createOllamaLabStore(databasePath) {
  mkdirSync(path.dirname(databasePath), { recursive: true });
  const database = new DatabaseSync(databasePath);
  database.exec(`
    CREATE TABLE IF NOT EXISTS lab_turns (
      id INTEGER PRIMARY KEY,
      created_at TEXT NOT NULL,
      client_ip TEXT NOT NULL,
      prompt TEXT NOT NULL,
      output TEXT NOT NULL
    ) STRICT;
  `);
  const insert = database.prepare("INSERT INTO lab_turns (created_at, client_ip, prompt, output) VALUES (?, ?, ?, ?)");
  const count = database.prepare("SELECT COUNT(*) AS count FROM lab_turns");

  return {
    recordTurn(input) {
      insert.run(new Date().toISOString(), input.clientIp, input.prompt, input.output);
    },
    countTurns() {
      return Number(count.get().count);
    },
    close() {
      database.close();
    },
  };
}
