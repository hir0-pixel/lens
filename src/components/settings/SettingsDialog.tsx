import { useState } from "react";
import { Check, KeyRound, Plug, Trash2 } from "lucide-react";
import { cn } from "../../lib/utils";
import type { ProviderState } from "../../lib/types";
import Modal from "../ui/Modal";

interface SettingsDialogProps {
  open: boolean;
  onClose: () => void;
  providers: ProviderState[];
  onToggleProvider: (id: ProviderState["id"]) => void;
}

const PROVIDER_LOGO: Record<
  string,
  { bg: string; letter: string; fg: string }
> = {
  chatgpt: { bg: "#10A37F", letter: "G", fg: "#fff" },
  claude: { bg: "#D97757", letter: "C", fg: "#fff" },
  gemini: { bg: "linear-gradient(135deg,#4285F4,#EA4335,#FBBC05,#34A853)", letter: "G", fg: "#fff" },
  copilot: { bg: "#2C3A86", letter: "⌘", fg: "#fff" },
};

function ProviderCard({
  provider,
  onToggle,
}: {
  provider: ProviderState;
  onToggle: () => void;
}) {
  const logo = PROVIDER_LOGO[provider.id];

  return (
    <div className="rounded-lg border border-white/10 bg-white/5 p-4">
      <div className="flex items-center gap-3">
        <div
          className="flex h-9 w-9 items-center justify-center rounded-lg text-sm font-bold"
          style={{
            background: logo.bg,
            color: logo.fg,
          }}
        >
          {logo.letter}
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-[13.5px] font-medium text-zinc-100">
            {provider.name}
          </div>
          <div className="text-[11.5px] text-zinc-500">
            {provider.via === "subscription"
              ? "Connected via subscription"
              : "Connected via API key"}
          </div>
        </div>
        <button
          onClick={onToggle}
          className={cn(
            "rounded-lg px-3 py-1.5 text-[12px] font-semibold transition-colors",
            provider.connected
              ? "bg-white/10 text-zinc-200 hover:bg-white/20"
              : "bg-accent text-surface-0 hover:bg-accent-600",
          )}
        >
          {provider.connected ? "Disconnect" : "Connect"}
        </button>
      </div>

      {provider.connected ? (
        <div className="mt-3 space-y-2 border-t border-white/10 pt-3">
          {provider.via === "api-key" ? (
            <div className="flex items-center gap-2">
              <KeyRound className="h-3.5 w-3.5 text-zinc-500" />
              <span className="font-mono text-[12px] text-zinc-400">
                {provider.keyLabel ?? "sk-••••"}
              </span>
              <span className="flex items-center gap-1 text-[11px] text-emerald-400">
                <Check className="h-3 w-3" /> Active
              </span>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <Plug className="h-3.5 w-3.5 text-zinc-500" />
              <span className="text-[12px] text-zinc-400">
                Signed in as raheel@orchids.app
              </span>
            </div>
          )}
          {provider.connected && (
            <div className="flex items-center justify-between text-[11.5px] text-zinc-500">
              <span>Default model</span>
              <span className="text-zinc-300">{provider.defaultModel}</span>
            </div>
          )}
        </div>
      ) : (
        <div className="mt-3 flex items-center gap-2 border-t border-white/10 pt-3 text-[11.5px] text-zinc-500">
          <Plug className="h-3.5 w-3.5" />
          Bring your own subscription or API key
        </div>
      )}
    </div>
  );
}

export default function SettingsDialog({
  open,
  onClose,
  providers,
  onToggleProvider,
}: SettingsDialogProps) {
  const [section, setSection] = useState("providers");

  return (
    <Modal open={open} onClose={onClose} title="Settings" size="lg">
      <div className="flex min-h-[420px]">
        {/* Side nav */}
        <div className="w-44 shrink-0 border-r border-white/10 p-3">
          {[
            { id: "providers", label: "Providers & Models" },
            { id: "general", label: "General" },
            { id: "appearance", label: "Appearance" },
            { id: "terminal", label: "Terminal" },
            { id: "about", label: "About" },
          ].map((s) => (
            <button
              key={s.id}
              onClick={() => setSection(s.id)}
              className={cn(
                "mb-0.5 w-full rounded-md px-2.5 py-1.5 text-left text-[12.5px] transition-colors",
                section === s.id
                  ? "bg-white/10 text-zinc-100"
                  : "text-zinc-400 hover:bg-white/5 hover:text-zinc-200",
              )}
            >
              {s.label}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="flex-1 p-5">
          {section === "providers" && (
            <div className="space-y-3">
              <div>
                <h3 className="text-[13px] font-semibold text-zinc-100">
                  Connections
                </h3>
                <p className="mt-0.5 text-[12px] text-zinc-500">
                  Bring your own ChatGPT, Claude Code, Gemini, or Copilot
                  subscription, or use an API key.
                </p>
              </div>
              {providers.map((p) => (
                <ProviderCard
                  key={p.id}
                  provider={p}
                  onToggle={() => onToggleProvider(p.id)}
                />
              ))}
            </div>
          )}

          {section === "general" && (
            <div className="space-y-3">
              <h3 className="text-[13px] font-semibold text-zinc-100">
                General
              </h3>
              {[
                { label: "Open projects in new window", on: true },
                { label: "Auto-save checkpoints", on: true },
                { label: "Sound notifications", on: false },
              ].map((item) => (
                <div
                  key={item.label}
                  className="flex items-center justify-between rounded-lg border border-white/10 bg-white/5 px-3 py-2.5"
                >
                  <span className="text-[12.5px] text-zinc-300">
                    {item.label}
                  </span>
                  <div
                    className={cn(
                      "relative h-5 w-9 rounded-full transition-colors",
                      item.on ? "bg-accent" : "bg-white/10",
                    )}
                  >
                    <div
                      className={cn(
                        "absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all",
                        item.on ? "left-[18px]" : "left-0.5",
                      )}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}

          {(section === "appearance" ||
            section === "terminal" ||
            section === "about") && (
            <div className="flex h-full flex-col items-center justify-center py-10 text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-white/5">
                <Trash2 className="h-5 w-5 text-zinc-500" />
              </div>
              <p className="mt-3 text-[13px] text-zinc-400">
                This section is a placeholder.
              </p>
              <p className="text-[12px] text-zinc-600">
                {section} settings coming soon.
              </p>
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}