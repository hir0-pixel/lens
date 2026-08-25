import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useSessionStore } from "../../src/stores/sessionStore";

const STORAGE_KEY = "lens-session-v2";
const SECRET_PROMPT = "What is the confidential executive compensation policy?";
const SECRET_OUTPUT = "The CEO's total compensation is $4.2 million, per the restricted compensation policy document.";

describe("sessionStore never persists chat content to localStorage", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => {
    window.localStorage.clear();
  });

  it("strips message text from the persisted snapshot even though it is kept in the live, in-memory session", () => {
    const { createSession, appendMessage } = useSessionStore.getState();
    const session = createSession();

    appendMessage(session.id, {
      id: "u-1",
      role: "user",
      content: SECRET_PROMPT,
      timestamp: "12:00",
    });
    appendMessage(session.id, {
      id: "a-1",
      role: "assistant",
      content: SECRET_OUTPUT,
      timestamp: "12:00",
    });

    // The live, in-memory store DOES hold the transcript — this is expected
    // ephemeral UI state, and is what the chat pane renders from.
    const live = useSessionStore.getState().sessions[session.id];
    expect(live?.messages.map((m) => m.content)).toEqual([SECRET_PROMPT, SECRET_OUTPUT]);

    // But what zustand's persist middleware actually wrote to localStorage
    // must never contain the prompt or the output text, in any form.
    const raw = window.localStorage.getItem(STORAGE_KEY);
    expect(raw).toBeTruthy();
    expect(raw).not.toContain(SECRET_PROMPT);
    expect(raw).not.toContain(SECRET_OUTPUT);
    expect(raw).not.toContain("confidential");
    expect(raw).not.toContain("compensation");

    const persisted = JSON.parse(raw as string);
    const persistedSession = persisted.state.sessions[session.id];
    expect(persistedSession.messages).toEqual([]);
  });

  it("holds true across every session in the store, not just the active one", () => {
    const { createSession, appendMessage } = useSessionStore.getState();
    const sessionA = createSession();
    const sessionB = createSession();

    appendMessage(sessionA.id, { id: "a-msg", role: "user", content: "Session A secret prompt", timestamp: "12:00" });
    appendMessage(sessionB.id, { id: "b-msg", role: "assistant", content: "Session B secret output", timestamp: "12:00" });

    const raw = window.localStorage.getItem(STORAGE_KEY) ?? "";
    expect(raw).not.toContain("Session A secret prompt");
    expect(raw).not.toContain("Session B secret output");

    const persisted = JSON.parse(raw);
    expect(persisted.state.sessions[sessionA.id].messages).toEqual([]);
    expect(persisted.state.sessions[sessionB.id].messages).toEqual([]);
  });
});
