import * as width from './width.ts';
export interface WrappedLine {
  words: string[];
  width: number;
  slack: number;
}
export function wrap(words: string[], columns: number): WrappedLine[] {
  if (columns < 1) throw new RangeError('columns');
  const costs = new Array<number>(words.length + 1).fill(Infinity);
  const next = new Array<number>(words.length).fill(0);
  costs[words.length] = 0;
  for (let start = words.length - 1; start >= 0; start -= 1) {
    let used = -1;
    for (let end = start; end < words.length; end += 1) {
      used += width.displayWidth(words[end]!) + 1;
      if (used > columns && end !== start) break;
      const slack = Math.max(0, columns - used);
      const penalty = end === words.length - 1 ? 0 : slack ** 2;
      const cost = penalty + costs[end + 1]!;
      if (cost < costs[start]!) {
        costs[start] = cost;
        next[start] = end + 1;
      }
    }
  }
  const result: WrappedLine[] = [];
  for (let start = 0; start < words.length; start = next[start]!) {
    const selected = words.slice(start, next[start]);
    const used = width.displayWidth(selected.join(' '));
    result.push({ words: selected, width: used, slack: Math.max(0, columns - used) });
  }
  return result;
}
export function justify(line: WrappedLine, columns: number) {
  if (line.words.length < 2) return width.pad(line.words.join(''), columns, 'left');
  const additional = Math.max(0, columns - line.width);
  const gaps = line.words.length - 1;
  const base = Math.floor(additional / gaps);
  const remainder = additional % gaps;
  return line.words.map((word, index) => index < gaps ? word + ' '.repeat(1 + base + Number(index < remainder)) : word).join('');
}
export function paragraph(text: string, columns: number, align: 'left' | 'right' | 'center' | 'justify') {
  const words = text.trim().split(/\s+/u).filter(Boolean);
  const lines = wrap(words, columns);
  return lines.map((line, index) => align === 'justify' && index < lines.length - 1 ? justify(line, columns) : width.pad(line.words.join(' '), columns, align === 'justify' ? 'left' : align));
}
export function pageColumns(columns: number): number {
  return width.lineMetrics(columns, 0.1, 'poster').usable;
}
export function paragraphIndent(columns: number): number {
  const indent = width.reservedColumns(columns, 0.1, 'poster');
  return indent / width.columnUnit;
}
export function linePenalty(lines: WrappedLine[]) {
  return lines.slice(0, -1).reduce((cost, line) => cost + line.slack ** 2, 0);
}
export function balanceColumns(lines: string[], columnCount: number) {
  if (columnCount < 1) throw new RangeError('column count');
  const rows = Math.ceil(lines.length / columnCount);
  return Array.from({ length: columnCount }, (_, index) => lines.slice(index * rows, (index + 1) * rows));
}
