import { paragraph, balanceColumns } from './layout.ts';
import { displayWidth, pad } from './width.ts';
import type { Document } from './document.ts';
export interface RenderOptions {
  columns: number;
  pageHeight: number;
  columnCount: number;
  align: 'left' | 'right' | 'center' | 'justify';
}
export function render(document: Document, options: RenderOptions) {
  if (options.pageHeight < 3) throw new RangeError('page height');
  const output: string[] = [];
  for (const block of document.blocks) {
    if (block.kind === 'heading') {
      output.push(pad(block.text, options.columns, 'center'));
      output.push('-'.repeat(Math.min(displayWidth(block.text), options.columns)));
    } else if (block.kind === 'quote') {
      output.push(...paragraph(block.text, Math.max(1, options.columns - 2), options.align).map((line) => '> ' + line));
    } else {
      output.push(...paragraph(block.text, options.columns, options.align));
    }
    output.push('');
  }
  const columns = balanceColumns(output, options.columnCount);
  const rows = Math.max(0, ...columns.map((column) => column.length));
  const combined: string[] = [];
  for (let row = 0; row < rows; row += 1) {
    combined.push(columns.map((column) => pad(column[row] ?? '', options.columns, 'left')).join('   '));
  }
  const pages: string[][] = [];
  for (let start = 0; start < combined.length; start += options.pageHeight) pages.push(combined.slice(start, start + options.pageHeight));
  return pages;
}
export function pageCount(document: Document, options: RenderOptions) {
  return render(document, options).length;
}
export function numberedPages(document: Document, options: RenderOptions) {
  const pages = render(document, options);
  return pages.map((page, index) => [...page, `${index + 1}/${pages.length}`].join('\n'));
}
export function tableOfContents(document: Document) {
  return document.blocks.filter((block) => block.kind === 'heading').map((block, index) => `${index + 1}. ${block.text}`);
}
