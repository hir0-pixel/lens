import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ProvidersSettingsPage } from "../../src/features/settings/sections/ProvidersSettingsPage";

const onboardProvider = vi.fn();
const refreshCatalog = vi.fn(async () => undefined);

vi.mock("../../src/shared/bff-auth", () => ({
  getBffAuthClient: () => ({ onboardProvider }),
}));

vi.mock("../../src/shared/bff-auth/store", () => ({
  useAuthStore: (selector: (state: { session?: { administrator?: boolean } }) => unknown) =>
    selector({ session: { administrator: true } }),
}));

vi.mock("../../src/stores/modelCatalogStore", () => ({
  useModelCatalogStore: (selector: (state: { refresh: () => Promise<void> }) => unknown) =>
    selector({ refresh: refreshCatalog }),
}));

describe("Providers settings onboarding form", () => {
  afterEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    vi.clearAllMocks();
  });

  it("sends adapter, base URL, API key, and allowlist to the BFF and does not persist the key", async () => {
    onboardProvider.mockResolvedValue({ id: "prv_test", status: "active" });
    render(<ProvidersSettingsPage />);

    fireEvent.change(screen.getByPlaceholderText("internal-gateway"), { target: { value: "company-gateway" } });
    fireEvent.change(screen.getByLabelText("Adapter type"), { target: { value: "openai-compatible" } });
    fireEvent.change(screen.getByPlaceholderText("https://models.company.internal/v1"), {
      target: { value: "http://127.0.0.1:8080" },
    });
    fireEvent.change(screen.getByPlaceholderText("Provider API key"), { target: { value: "sk-live-provider-secret" } });
    fireEvent.change(screen.getByPlaceholderText("allowed model ids, comma-separated"), {
      target: { value: "acme-chat, acme-fast" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Register provider" }));

    await waitFor(() => expect(onboardProvider).toHaveBeenCalledTimes(1));
    expect(onboardProvider).toHaveBeenCalledWith(expect.objectContaining({
      adapterType: "openai-compatible",
      baseUrl: "http://127.0.0.1:8080",
      apiKey: "sk-live-provider-secret",
      allowedModels: ["acme-chat", "acme-fast"],
    }));
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      expect(key ? localStorage.getItem(key) : "").not.toContain("sk-live-provider-secret");
    }
    expect(sessionStorage.getItem("apiKey")).toBeNull();
    expect(screen.getByPlaceholderText("Provider API key")).toHaveValue("");
    expect(refreshCatalog).toHaveBeenCalled();
  });
});
