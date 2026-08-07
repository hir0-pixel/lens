/** Fix Quick Open helper without require(). */
import { useCommandStore } from "@/features/command-palette/commandStore";

export { useCommandStore };

export function openQuickOpen(): void {
  useCommandStore.getState().openQuickOpen();
}
