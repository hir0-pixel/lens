import { useMemo, useState } from "react";
import { ShieldCheck, LogIn, Loader2, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { getBffAuthClient } from "./index";
import { useAuthStore } from "./store";
import { Button } from "@/components/ui/button";
import { LensWordmark } from "@/components/brand/LensWordmark";

/**
 * Fully-custom Lens sign-in screen shown while the user is unauthenticated.
 * Authentication is handled externally by the corporate Identity Gateway via
 * the BFF — the UI never collects or stores credentials.
 */
export function SignInScreen() {
  const status = useAuthStore((s) => s.status);
  const authEnabled = useMemo(() => !!getBffAuthClient(), []);
  const [loggingIn, setLoggingIn] = useState(false);

  const handleSignIn = async () => {
    const client = getBffAuthClient();
    if (!client) return;
    setLoggingIn(true);
    try {
      await client.beginLogin();
      // A redirect is in progress; the component may unmount.
    } catch {
      toast.error("Sign-in is unavailable", {
        description:
          "The authentication gateway could not be reached. Make sure the BFF is running and configured.",
      });
      setLoggingIn(false);
    }
  };

  return (
    <div className="relative flex min-h-0 flex-1 flex-col items-center justify-center overflow-y-auto bg-[var(--bg-base)] px-6 py-16">
      <div
        className="pointer-events-none absolute inset-0 opacity-40"
        style={{
          background:
            "radial-gradient(ellipse 70% 50% at 50% 0%, color-mix(in srgb, var(--accent-primary) 12%, transparent), transparent 60%)",
        }}
      />

      <div className="relative z-[1] flex w-full max-w-[420px] flex-col items-center text-center">
        <div className="mb-8 flex items-center gap-3">
          <LensWordmark size="welcome" />
        </div>

        <div className="mb-6 flex h-14 w-14 items-center justify-center rounded-[var(--radius-lg)] border border-[var(--border-subtle)] bg-[var(--bg-surface-raised)]">
          <ShieldCheck
            className="h-7 w-7 text-[var(--accent-primary)]"
            strokeWidth={1.75}
          />
        </div>

        <h1 className="text-[22px] font-semibold tracking-[-0.02em] text-[var(--text-primary)]">
          Work securely in Lens
        </h1>
        <p className="mt-2 max-w-[340px] text-[13px] leading-relaxed text-[var(--text-secondary)]">
          Sign in with your corporate account to access agents, projects, and
          tools. Your credentials never leave your organization&apos;s identity
          gateway.
        </p>

        {!authEnabled ? (
          <AlertTriangle className="mt-8 h-5 w-5 text-[var(--warning)]" strokeWidth={1.75} />
        ) : null}

        <div className="mt-8 w-full max-w-[280px]">
          <Button
            type="button"
            onClick={() => void handleSignIn()}
            disabled={!authEnabled || loggingIn}
            className="btn-primary h-11 w-full text-[14px]"
          >
            {status === "checking" || loggingIn ? (
              <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.75} />
            ) : (
              <LogIn className="h-4 w-4" strokeWidth={1.75} />
            )}
            Continue with corporate sign-in
          </Button>
        </div>

        {!authEnabled && (
          <p className="mt-3 max-w-[320px] text-[11px] leading-relaxed text-[var(--text-tertiary)]">
            Authentication is not configured in this environment. Start the
            BFF with a valid Identity Gateway configuration to enable sign-in.
          </p>
        )}
      </div>
    </div>
  );
}