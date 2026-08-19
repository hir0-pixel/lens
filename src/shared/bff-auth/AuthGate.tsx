import { useEffect, type ReactNode } from "react";
import { toast } from "sonner";
import { useAuthStore } from "./store";
import { SignInScreen } from "./SignInScreen";
import { WorkbenchSkeleton } from "@/components/ui/WorkbenchSkeleton";

/**
 * Gates the Lens app behind corporate authentication.
 *
 * - `checking`: show a Lens skeleton while we ask the BFF for session state.
 * - `unauthenticated`: show the Lens sign-in screen.
 * - `authenticated`: render the app.
 * - `error` / not configured: show the sign-in screen (fail closed).
 *
 * The UI only reflects status reported by the backend; it never authorizes.
 */
export function AuthGate({ children }: { children: ReactNode }) {
  const status = useAuthStore((s) => s.status);
  const check = useAuthStore((s) => s.check);

  useEffect(() => {
    void check();
  }, [check]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("auth") === "error") {
      toast.error("Sign-in could not be completed. Please try again.");
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, []);

  if (status === "checking") {
    return <WorkbenchSkeleton variant="cards" rows={6} />;
  }

  if (status !== "authenticated") {
    return <SignInScreen />;
  }

  return <>{children}</>;
}