import { useEffect, useState } from "react";
import { WifiOff } from "lucide-react";
import {
  getNetworkStatus,
  subscribeNetwork,
  type NetworkStatus,
} from "@/shared/diagnostics/network";

/** Non-blocking offline indicator for the workbench chrome */
export function OfflineBanner() {
  const [status, setStatus] = useState<NetworkStatus>(() => getNetworkStatus());

  useEffect(() => subscribeNetwork(setStatus), []);

  if (status === "online") return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="flex h-7 shrink-0 items-center justify-center gap-2 border-b border-[var(--warning)]/30 bg-[var(--warning)]/15 px-3 type-caption text-[var(--warning)]"
    >
      <WifiOff className="h-3.5 w-3.5" aria-hidden />
      You are offline. Provider requests and updates are unavailable until connectivity
      returns.
    </div>
  );
}
