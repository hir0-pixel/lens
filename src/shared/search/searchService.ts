import {
  getFileContent,
  getWorkspaceFiles,
  type WorkspaceFile,
} from "./workspaceIndex";

export interface SearchMatch {
  file: string;
  line: number;
  column: number;
  text: string;
  matchStart: number;
  matchLength: number;
}

export interface SearchFileGroup {
  file: string;
  matches: SearchMatch[];
}

export interface SearchOptions {
  query: string;
  caseSensitive?: boolean;
  wholeWord?: boolean;
  regex?: boolean;
  include?: string;
  exclude?: string;
}

function matchGlob(path: string, pattern: string): boolean {
  if (!pattern.trim()) return true;
  const parts = pattern.split(",").map((p) => p.trim()).filter(Boolean);
  return parts.some((part) => {
    const escaped = part
      .replace(/[.+^${}()|[\]\\]/g, "\\$&")
      .replace(/\*\*/g, ".*")
      .replace(/\*/g, "[^/]*")
      .replace(/\?/g, ".");
    return new RegExp(`^${escaped}$`, "i").test(path) || path.includes(part.replace(/\*/g, ""));
  });
}

function buildPattern(options: SearchOptions): RegExp | null {
  const { query, caseSensitive, wholeWord, regex } = options;
  if (!query) return null;

  try {
    let source = regex ? query : query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (wholeWord) source = `\\b${source}\\b`;
    return new RegExp(source, caseSensitive ? "g" : "gi");
  } catch {
    return null;
  }
}

export function searchWorkspace(options: SearchOptions): SearchFileGroup[] {
  const pattern = buildPattern(options);
  if (!pattern) return [];

  const files = getWorkspaceFiles().filter((f) => {
    if (options.include && !matchGlob(f.path, options.include)) return false;
    if (options.exclude && matchGlob(f.path, options.exclude)) return false;
    return Boolean(f.content);
  });

  const groups: SearchFileGroup[] = [];

  for (const file of files) {
    const content = getFileContent(file.path);
    if (!content) continue;
    const lines = content.split("\n");
    const matches: SearchMatch[] = [];

    lines.forEach((line, idx) => {
      pattern.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = pattern.exec(line)) !== null) {
        matches.push({
          file: file.path,
          line: idx + 1,
          column: m.index + 1,
          text: line,
          matchStart: m.index,
          matchLength: m[0].length,
        });
        if (!pattern.global) break;
        if (m[0].length === 0) pattern.lastIndex++;
      }
    });

    if (matches.length) {
      groups.push({ file: file.path, matches });
    }
  }

  return groups;
}

export function replaceInContent(
  content: string,
  options: SearchOptions,
  replacement: string,
): string {
  const pattern = buildPattern(options);
  if (!pattern) return content;
  return content.replace(pattern, replacement);
}

export type { WorkspaceFile };
