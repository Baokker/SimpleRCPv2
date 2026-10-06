import type { Document } from './document.ts';
export interface Match {
  block: string;
  start: number;
  end: number;
  text: string;
}
export function findText(document: Document, query: string, caseSensitive = false) {
  if (!query) return [];
  const target = caseSensitive ? query : query.toLocaleLowerCase('en');
  const matches: Match[] = [];
  for (const block of document.blocks) {
    const text = caseSensitive ? block.text : block.text.toLocaleLowerCase('en');
    let start = 0;
    while ((start = text.indexOf(target, start)) >= 0) {
      matches.push({ block: block.id, start, end: start + query.length, text: block.text.slice(start, start + query.length) });
      start += query.length;
    }
  }
  return matches;
}
export function replaceMatches(document: Document, matches: Match[], replacement: string): Document {
  return {
    version: document.version + 1,
    blocks: document.blocks.map((block) => {
      const selected = matches.filter((match) => match.block === block.id).sort((a, b) => b.start - a.start);
      let text = block.text;
      for (const match of selected) {
        if (text.slice(match.start, match.end) !== match.text) throw new Error('stale search result');
        text = text.slice(0, match.start) + replacement + text.slice(match.end);
      }
      return { ...block, text };
    })
  };
}
export function concordance(document: Document, query: string, context = 20) {
  const blocks = new Map(document.blocks.map((block) => [block.id, block.text]));
  return findText(document, query).map((match) => ({
    ...match,
    before: blocks.get(match.block)!.slice(Math.max(0, match.start - context), match.start),
    after: blocks.get(match.block)!.slice(match.end, match.end + context)
  }));
}
export function frequentWords(document: Document, ignored: Set<string>, limit = 10) {
  const counts = new Map<string, number>();
  for (const block of document.blocks) {
    for (const word of block.text.toLowerCase().split(/\s+/u)) {
      if (!word || ignored.has(word)) continue;
      counts.set(word, (counts.get(word) ?? 0) + 1);
    }
  }
  return [...counts].sort(([a, ac], [b, bc]) => bc - ac || a.localeCompare(b)).slice(0, limit);
}
