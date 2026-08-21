import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

const appendMessage = vi.hoisted(() => vi.fn());
const askRag = vi.hoisted(() => vi.fn());
const clearAuth = vi.hoisted(() => vi.fn());
const toastError = vi.hoisted(() => vi.fn());
const toastMessage = vi.hoisted(() => vi.fn());
const applyAppearance = vi.hoisted(() => vi.fn());
const openIdeWindow = vi.hoisted(() => vi.fn(async () => undefined));

const session = {
  id: "sess-1",
  mode: "ask",
  messages: [],
  openFiles: [],
  repoId: "repo-1",
  plan: undefined,
};

const sessionStoreState = {
  sessions: { "sess-1": session },
  repositories: [{ id: "repo-1", name: "Lens", path: "D:/Lens/lens" }],
  currentSessionId: "sess-1",
  activeRepositoryId: "repo-1",
  newChat: vi.fn(),
  multitask: vi.fn(),
  appendMessage,
  setPlan: vi.fn(),
  setSessionMode: vi.fn(),
  createSession: vi.fn(() => session),
  getModel: vi.fn(() => ({ id: "model-1", label: "Lens Model" })),
  closeWorkspace: vi.fn(),
  currentSession: () => session,
  openRepository: vi.fn(),
  setSessionModel: vi.fn(),
};

const useAuthStore = Object.assign(
  () => ({ status: "authenticated" }),
  { getState: () => ({ clear: clearAuth }) },
);

vi.mock("sonner", () => ({
  toast: {
    error: toastError,
    message: toastMessage,
  },
}));

vi.mock("../../src/shared/bff-auth", () => {
  class AuthClientError extends Error {
    readonly code: string;

    constructor(code: string) {
      super(code);
      this.name = "AuthClientError";
      this.code = code;
    }
  }

  return {
    AuthClientError,
    getBffAuthClient: () => ({ askRag }),
  };
});

vi.mock("../../src/shared/bff-auth/AuthGate", () => ({
  AuthGate: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock("../../src/shared/bff-auth/store", () => ({
  useAuthStore,
}));

vi.mock("../../src/stores/appearanceStore", () => ({
  useAppearanceStore: (selector: (state: { apply: () => void; themeMode: string }) => unknown) =>
    selector({ apply: applyAppearance, themeMode: "dark" }),
}));

const useSessionStore = Object.assign(
  (selector: (state: typeof sessionStoreState) => unknown) =>
    selector(sessionStoreState),
  { getState: () => sessionStoreState },
);

vi.mock("../../src/stores/sessionStore", () => ({
  useSessionStore,
}));

vi.mock("../../src/stores/terminalStore", () => ({
  useTerminalStore: (selector: (state: { activeSessionId: string | null; defaultCwd: string; createSession: () => void }) => unknown) =>
    selector({
      activeSessionId: null,
      defaultCwd: "D:/Lens/lens",
      createSession: vi.fn(),
    }),
}));

vi.mock("../../src/stores/settingsStore", () => ({
  useSettingsStore: Object.assign(
    (selector?: (state: { setSection: (value: string) => void }) => unknown) =>
      selector ? selector({ setSection: vi.fn() }) : undefined,
    { getState: () => ({ setSection: vi.fn() }) },
  ),
}));

vi.mock("../../src/features/shell/useShellEvents", () => ({
  useShellEvents: () => undefined,
}));

vi.mock("../../src/features/windows/openAppWindow", () => ({
  getWindowMode: () => "agents",
  openIdeWindow,
}));

vi.mock("../../src/features/projects/openFolder", () => ({
  openFolder: vi.fn(async () => undefined),
}));

vi.mock("../../src/components/TitleBar", () => ({
  default: () => <div>TitleBar</div>,
}));

vi.mock("../../src/components/workspace/EmptySessionView", () => ({
  EmptySessionView: ({
    onSend,
    onStop,
  }: {
    onSend: (
      text: string,
      mode: "ask",
      model: { id: string; label: string },
      attachments: [],
    ) => void;
    onStop: () => void;
  }) => (
    <div>
      <button
        type="button"
        onClick={() =>
          onSend(
            "Where is the vacation policy?",
            "ask",
            { id: "model-1", label: "Lens Model" },
            [],
          )
        }
      >
        send ask
      </button>
      <button type="button" onClick={onStop}>
        stop ask
      </button>
    </div>
  ),
}));

vi.mock("../../src/components/workspace/SessionTabStrip", () => ({
  SessionTabStrip: () => <div>tabs</div>,
}));

vi.mock("../../src/components/ErrorBoundary", () => ({
  ErrorBoundary: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock("../../src/components/workspace/AgentsSideDock", () => ({
  AgentsSideDock: () => <div>dock</div>,
}));

vi.mock("../../src/components/windows/IdeWindowApp", () => ({
  default: () => <div>ide</div>,
}));

vi.mock("../../src/components/windows/FileEditorWindowApp", () => ({
  default: () => <div>file editor</div>,
}));

vi.mock("../../src/components/workspace/ProjectFilesSidePane", () => ({
  ProjectFilesSidePane: () => <div>files</div>,
}));

vi.mock("../../src/components/settings/SettingsDialog", () => ({
  default: () => null,
}));

vi.mock("../../src/components/plans/PlansDialog", () => ({
  default: () => null,
}));

vi.mock("../../src/components/import/ImportDialog", () => ({
  default: () => null,
}));

vi.mock("../../src/components/automations/AutomationsDialog", () => ({
  default: () => null,
}));

vi.mock("../../src/components/welcome/WelcomeScreen", () => ({
  WelcomeScreen: () => <div>welcome</div>,
}));

vi.mock("../../src/components/welcome/CloneRepoDialog", () => ({
  CloneRepoDialog: () => null,
}));

vi.mock("../../src/features/command-palette/WorkbenchOverlays", () => ({
  WorkbenchOverlays: () => null,
}));

vi.mock("../../src/components/ui/sonner", () => ({
  Toaster: () => null,
}));

vi.mock("../../src/components/ui/WorkbenchSkeleton", () => ({
  WorkbenchSkeleton: () => <div>skeleton</div>,
}));

vi.mock("../../src/lib/mock-data", () => ({
  INITIAL_PROJECTS: [],
  INITIAL_PROVIDERS: [],
  MODELS: [{ id: "model-1", label: "Lens Model" }],
}));

describe("bff RAG UI App wiring", () => {
  beforeEach(() => {
    askRag.mockReset();
    appendMessage.mockReset();
    clearAuth.mockReset();
    toastError.mockReset();
    toastMessage.mockReset();
    applyAppearance.mockReset();
    vi.stubGlobal(
      "matchMedia",
      vi.fn().mockReturnValue({
        matches: false,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("routes Ask mode through the authenticated BFF client and maps citations into UI state", async () => {
    askRag.mockResolvedValueOnce({
      output: "Use the handbook section.",
      citations: [{ source: "Employee Handbook", section: "4.2" }],
    });

    const { default: App } = await import("../../src/App");
    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: "send ask" }));

    await waitFor(() => {
      expect(askRag).toHaveBeenCalledWith(
        "Where is the vacation policy?",
        expect.any(AbortSignal),
      );
    });

    expect(appendMessage).toHaveBeenNthCalledWith(
      1,
      "sess-1",
      expect.objectContaining({
        role: "user",
        content: "Where is the vacation policy?",
      }),
    );

    await waitFor(() => {
      expect(appendMessage).toHaveBeenNthCalledWith(
        2,
        "sess-1",
        expect.objectContaining({
          role: "assistant",
          content: "Use the handbook section.",
          model: "Lens (authenticated)",
          citations: [{ source: "Employee Handbook", section: "4.2" }],
        }),
      );
    });
  });

  it("surfaces typed capacity failures without falling back to legacy generation", async () => {
    const { AuthClientError } = await import("../../src/shared/bff-auth");
    askRag.mockRejectedValueOnce(new AuthClientError("OVERLOADED"));

    const { default: App } = await import("../../src/App");
    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: "send ask" }));

    await waitFor(() => {
      expect(toastError).toHaveBeenCalledWith("Lens is at capacity.", {
        description:
          "Too many governed RAG requests are active right now. Please retry shortly.",
      });
    });
    expect(clearAuth).not.toHaveBeenCalled();
  });
});
