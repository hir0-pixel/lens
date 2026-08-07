/**
 * Lightweight fuzzy matcher (Cursor/VS Code style).
 * Scores by contiguous matches, word-boundary bonuses, and path separators.
 */

export interface FuzzyMatch {
  score: number;
  indices: number[];
}

export function fuzzyMatch(query: string, target: string): FuzzyMatch | null {
  if (!query) return { score: 0, indices: [] };

  const q = query.toLowerCase();
  const t = target.toLowerCase();
  const indices: number[] = [];

  let qi = 0;
  let score = 0;
  let consecutive = 0;
  let lastIndex = -1;

  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) {
      indices.push(ti);
      consecutive = lastIndex === ti - 1 ? consecutive + 1 : 1;
      score += 10 + consecutive * 5;

      if (ti === 0 || /[/\\._-]/.test(t[ti - 1]) || /[A-Z]/.test(target[ti])) {
        score += 8;
      }

      lastIndex = ti;
      qi++;
    }
  }

  if (qi < q.length) return null;

  // Prefer shorter targets and matches near the end (filename)
  score -= target.length * 0.1;
  const lastSep = Math.max(target.lastIndexOf("/"), target.lastIndexOf("\\"));
  if (lastSep >= 0 && indices[0] != null && indices[0] > lastSep) {
    score += 15;
  }

  return { score, indices };
}

export function fuzzyFilter<T>(
  items: T[],
  query: string,
  getText: (item: T) => string,
  limit = 100,
): Array<T & { _fuzzyScore: number; _fuzzyIndices: number[] }> {
  if (!query.trim()) {
    return items.slice(0, limit).map((item) => ({
      ...item,
      _fuzzyScore: 0,
      _fuzzyIndices: [] as number[],
    }));
  }

  const results: Array<T & { _fuzzyScore: number; _fuzzyIndices: number[] }> = [];

  for (const item of items) {
    const match = fuzzyMatch(query, getText(item));
    if (match) {
      results.push({
        ...item,
        _fuzzyScore: match.score,
        _fuzzyIndices: match.indices,
      });
    }
  }

  results.sort((a, b) => b._fuzzyScore - a._fuzzyScore);
  return results.slice(0, limit);
}

/** Highlight matched characters in a string for rendering. */
export function splitHighlighted(
  text: string,
  indices: number[],
): Array<{ text: string; matched: boolean }> {
  if (!indices.length) return [{ text, matched: false }];

  const parts: Array<{ text: string; matched: boolean }> = [];
  let last = 0;
  const set = new Set(indices);

  for (let i = 0; i < text.length; i++) {
    const matched = set.has(i);
    if (i === 0) {
      parts.push({ text: text[i], matched });
      last = i;
      continue;
    }
    const prevMatched = set.has(i - 1);
    if (matched === prevMatched) {
      parts[parts.length - 1].text += text[i];
    } else {
      parts.push({ text: text[i], matched });
    }
    last = i;
  }

  void last;
  return parts;
}
