export {
  getWorkspaceFiles,
  getFileContent,
  getWorkspaceSymbols,
  getOpenFiles,
  getRecentFiles,
  getPinnedFiles,
} from "./workspaceIndex";
export type { WorkspaceFile, WorkspaceSymbol } from "./workspaceIndex";
export { searchWorkspace, replaceInContent } from "./searchService";
export type { SearchMatch, SearchFileGroup, SearchOptions } from "./searchService";
