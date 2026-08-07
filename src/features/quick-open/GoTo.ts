import { useCommandStore } from "@/features/command-palette/commandStore";
import { fuzzyFilter } from "@/shared/fuzzy/fuzzyMatch";
import {
  getWorkspaceFiles,
  getWorkspaceSymbols,
} from "@/shared/search/workspaceIndex";

/** Go To File — alias for Quick Open. */
export function goToFile(): void {
  useCommandStore.getState().openQuickOpen();
}

export function goToSymbol(): void {
  useCommandStore.getState().openSymbols();
}

export function goToWorkspaceSymbol(): void {
  useCommandStore.getState().openWorkspaceSymbols();
}

export function goToLine(): void {
  useCommandStore.getState().openGotoLine();
}

/** Resolve symbol references (mock: same-name symbols across workspace). */
export function findReferences(symbolName: string) {
  return getWorkspaceSymbols().filter(
    (s) => s.name.toLowerCase() === symbolName.toLowerCase(),
  );
}

export function findDefinition(symbolName: string) {
  const hits = fuzzyFilter(
    getWorkspaceSymbols(),
    symbolName,
    (s) => s.name,
    5,
  );
  return hits[0] ?? null;
}

export function findType(symbolName: string) {
  return getWorkspaceSymbols().find(
    (s) =>
      (s.kind === "type" || s.kind === "interface") &&
      s.name.toLowerCase() === symbolName.toLowerCase(),
  );
}

export function findImplementation(symbolName: string) {
  return getWorkspaceSymbols().find(
    (s) =>
      (s.kind === "component" || s.kind === "class" || s.kind === "function") &&
      s.name.toLowerCase() === symbolName.toLowerCase(),
  );
}

export function searchFiles(query: string) {
  return fuzzyFilter(getWorkspaceFiles(), query, (f) => `${f.name} ${f.path}`, 40);
}
