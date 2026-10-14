import type { Notebook } from '../types';

export interface SearchHit {
  kind: 'section' | 'text' | 'file';
  notebookId: string;
  notebookName: string;
  sectionId: string;
  sectionName: string;
  elementId?: string;
  /** Text shown for the hit (section name, file name or a snippet of note text) */
  snippet: string;
  /** Index range of the match within `snippet`, for highlighting */
  matchStart: number;
  matchEnd: number;
}

const MAX_HITS = 100;
const SNIPPET_RADIUS = 60;

function htmlToText(html: string): string {
  return html
    .replace(/<\/(p|div|li|h[1-6]|blockquote)>|<br\s*\/?>/gi, ' ')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Search section names, note text and imported file names across every notebook. */
export function searchNotebooks(notebooks: Notebook[], rawQuery: string): SearchHit[] {
  const q = rawQuery.trim().toLowerCase();
  if (!q) return [];

  const hits: SearchHit[] = [];
  const seenFiles = new Set<string>();

  for (const nb of notebooks) {
    for (const sec of nb.sections) {
      const base = {
        notebookId: nb.id,
        notebookName: nb.name,
        sectionId: sec.id,
        sectionName: sec.name,
      };

      const secIdx = sec.name.toLowerCase().indexOf(q);
      if (secIdx !== -1) {
        hits.push({ ...base, kind: 'section', snippet: sec.name, matchStart: secIdx, matchEnd: secIdx + q.length });
      }

      for (const el of sec.elements) {
        if (el.type === 'text') {
          const text = htmlToText(el.content);
          const idx = text.toLowerCase().indexOf(q);
          if (idx === -1) continue;
          const from = Math.max(0, idx - SNIPPET_RADIUS);
          const to = Math.min(text.length, idx + q.length + SNIPPET_RADIUS);
          const prefix = from > 0 ? '…' : '';
          const snippet = prefix + text.slice(from, to) + (to < text.length ? '…' : '');
          const start = prefix.length + (idx - from);
          hits.push({ ...base, kind: 'text', elementId: el.id, snippet, matchStart: start, matchEnd: start + q.length });
        } else if (el.type === 'pdf-page' || el.type === 'image') {
          const name = el.type === 'pdf-page' ? el.pdfName : el.name;
          const idx = name.toLowerCase().indexOf(q);
          if (idx === -1) continue;
          // One hit per imported PDF, not per page
          const key = `${sec.id}:${el.type === 'pdf-page' ? el.pdfId : el.id}`;
          if (seenFiles.has(key)) continue;
          seenFiles.add(key);
          hits.push({ ...base, kind: 'file', elementId: el.id, snippet: name, matchStart: idx, matchEnd: idx + q.length });
        }
        if (hits.length >= MAX_HITS) return hits;
      }
    }
  }
  return hits;
}
