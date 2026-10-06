export type Block = { id: string; kind: 'paragraph' | 'heading' | 'quote'; text: string };
export interface Document {
  version: number;
  blocks: readonly Block[];
}
export function insertBlock(document: Document, index: number, block: Block): Document {
  if (index < 0 || index > document.blocks.length) throw new RangeError('block position');
  if (document.blocks.some((existing) => existing.id === block.id)) throw new Error('duplicate block');
  return { version: document.version + 1, blocks: [...document.blocks.slice(0, index), { ...block }, ...document.blocks.slice(index)] };
}
export function replaceText(document: Document, id: string, text: string, expectedVersion: number): Document {
  if (document.version !== expectedVersion) throw new Error('document changed');
  if (!document.blocks.some((block) => block.id === id)) throw new Error('missing block');
  return { version: document.version + 1, blocks: document.blocks.map((block) => block.id === id ? { ...block, text } : block) };
}
export function moveBlock(document: Document, id: string, before?: string): Document {
  const selected = document.blocks.find((block) => block.id === id);
  if (!selected) throw new Error('missing block');
  const remaining = document.blocks.filter((block) => block.id !== id);
  const index = before === undefined ? remaining.length : remaining.findIndex((block) => block.id === before);
  if (index < 0) throw new Error('missing target');
  return { version: document.version + 1, blocks: [...remaining.slice(0, index), selected, ...remaining.slice(index)] };
}
export function removeBlock(document: Document, id: string): Document {
  return { version: document.version + 1, blocks: document.blocks.filter((block) => block.id !== id) };
}
export function outline(document: Document) {
  return document.blocks.filter((block) => block.kind === 'heading').map((block) => ({ id: block.id, label: block.text }));
}
export function textContent(document: Document) {
  return document.blocks.map((block) => block.text).join('\n\n');
}
export function wordCounts(document: Document) {
  return Object.fromEntries(document.blocks.map((block) => [block.id, block.text.trim().split(/\s+/u).filter(Boolean).length]));
}
export function transformBlocks(document: Document, transform: (block: Block) => Block): Document {
  const blocks = document.blocks.map(transform);
  if (new Set(blocks.map((block) => block.id)).size !== blocks.length) throw new Error('duplicate transformed block');
  return { version: document.version + 1, blocks };
}
export function mergeDocuments(left: Document, right: Document): Document {
  const existing = new Set(left.blocks.map((block) => block.id));
  const extra = right.blocks.filter((block) => !existing.has(block.id));
  return { version: Math.max(left.version, right.version) + 1, blocks: [...left.blocks, ...extra] };
}
export function blockIndex(document: Document) {
  let position = 0;
  return document.blocks.map((block) => {
    const entry = { id: block.id, start: position, end: position + block.text.length };
    position = entry.end + 2;
    return entry;
  });
}
