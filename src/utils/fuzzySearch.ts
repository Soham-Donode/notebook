export type SearchItemType = 'section' | 'notebook';

export interface SearchItem {
  id: string;
  type: SearchItemType;
  title: string;
  notebookId: string;
  notebookName: string;
  isCurrentNotebook: boolean;
  isCurrentNotebookSection: boolean;
  sectionId?: string;
  sectionCount?: number;
}

export interface FuzzyMatchResult {
  matches: boolean;
  score: number;
  indices: number[];
}

export interface ScoredSearchItem {
  item: SearchItem;
  score: number;
  indices: number[];
}

/**
 * Fuzzy matches pattern against target text.
 * Returns match indices for visual highlighting and a score based on
 * match quality, word boundaries, and consecutive characters.
 */
export function fuzzyMatch(pattern: string, text: string): FuzzyMatchResult | null {
  const p = pattern.trim().toLowerCase();
  const t = text.toLowerCase();

  if (!p) {
    return { matches: true, score: 0, indices: [] };
  }

  // Exact match
  if (t === p) {
    return {
      matches: true,
      score: 500,
      indices: Array.from({ length: t.length }, (_, i) => i),
    };
  }

  // Contiguous Substring match
  const subIndex = t.indexOf(p);
  if (subIndex !== -1) {
    let score = 250 - subIndex * 2;
    if (subIndex === 0) {
      score += 150; // Starts with query bonus
    }
    const indices = Array.from({ length: p.length }, (_, i) => subIndex + i);
    return { matches: true, score, indices };
  }

  // Subsequence match
  let pIdx = 0;
  let score = 0;
  const indices: number[] = [];
  let consecutive = 0;

  for (let tIdx = 0; tIdx < t.length && pIdx < p.length; tIdx++) {
    if (t[tIdx] === p[pIdx]) {
      indices.push(tIdx);
      pIdx++;
      consecutive++;
      score += 5 + consecutive * 4;

      // Word boundary bonus
      if (
        tIdx === 0 ||
        t[tIdx - 1] === ' ' ||
        t[tIdx - 1] === '-' ||
        t[tIdx - 1] === '_' ||
        t[tIdx - 1] === '/' ||
        t[tIdx - 1] === '.'
      ) {
        score += 20;
      }
    } else {
      consecutive = 0;
    }
  }

  // If entire pattern was matched in sequence
  if (pIdx === p.length) {
    // Slight penalty for character distance / length difference
    score -= Math.min(30, (text.length - pattern.length) * 0.5);
    return { matches: true, score, indices };
  }

  return null;
}

/**
 * Filters and ranks search items based on fuzzy matching and collision priority rules.
 * Rule: When there is collision or tie in names, sections of current notebook rank first.
 */
export function searchAndRankItems(items: SearchItem[], query: string): ScoredSearchItem[] {
  const trimmed = query.trim();

  // If empty query, show all items with default prioritization:
  // Current notebook sections first, then current notebook, then other sections, then other notebooks
  if (!trimmed) {
    return items
      .map((item) => {
        let basePriority = 0;
        if (item.isCurrentNotebookSection) basePriority = 1000;
        else if (item.isCurrentNotebook) basePriority = 700;
        else if (item.type === 'section') basePriority = 400;
        else basePriority = 100;

        return { item, score: basePriority, indices: [] };
      })
      .sort((a, b) => b.score - a.score);
  }

  const results: ScoredSearchItem[] = [];

  for (const item of items) {
    // Match against item title
    const titleMatch = fuzzyMatch(trimmed, item.title);

    // Also optionally match against notebook name if item is a section
    let combinedScore = 0;
    let matchIndices: number[] = [];
    let matched = false;

    if (titleMatch) {
      matched = true;
      combinedScore = titleMatch.score;
      matchIndices = titleMatch.indices;
    } else if (item.type === 'section' && item.notebookName) {
      // Allow searching by notebook name as well (e.g. "Biology Section 2")
      const combinedText = `${item.notebookName} ${item.title}`;
      const comboMatch = fuzzyMatch(trimmed, combinedText);
      if (comboMatch) {
        matched = true;
        combinedScore = comboMatch.score * 0.7; // slightly lower score for secondary match
        // Map indices to title if within title range
        const titleOffset = item.notebookName.length + 1;
        matchIndices = comboMatch.indices
          .filter((idx) => idx >= titleOffset)
          .map((idx) => idx - titleOffset);
      }
    }

    if (matched) {
      // Apply collision & contextual prioritization:
      // Sections of current notebook get highest boost
      let priorityBoost = 0;
      if (item.isCurrentNotebookSection) {
        priorityBoost += 1000;
      } else if (item.isCurrentNotebook) {
        priorityBoost += 400;
      } else if (item.type === 'section') {
        priorityBoost += 200;
      }

      results.push({
        item,
        score: combinedScore + priorityBoost,
        indices: matchIndices,
      });
    }
  }

  // Sort by score descending; if score tied, current notebook section wins, then alphabetical
  results.sort((a, b) => {
    if (b.score !== a.score) {
      return b.score - a.score;
    }
    if (a.item.isCurrentNotebookSection !== b.item.isCurrentNotebookSection) {
      return a.item.isCurrentNotebookSection ? -1 : 1;
    }
    return a.item.title.localeCompare(b.item.title);
  });

  return results;
}
