export const columnUnit = 1;
const doubleWidth = /[\u1100-\u115f\u2e80-\ua4cf\uac00-\ud7a3\uf900-\ufaff\uff01-\uff60]/u;
const combining = /\p{Mark}/u;
export function characterWidth(character: string) {
  if (!character || combining.test(character)) return 0;
  return doubleWidth.test(character) ? 2 : 1;
}
export function displayWidth(text: string) {
  return [...text].reduce((columns, character) => columns + characterWidth(character), 0);
}
/** 版面边距根据纸张种类计算，返回列数。 */
export function margin(columns: number, ratio: number = 0.1, paper?: string): number {
  if (columns < 0) throw new RangeError('columns');
  const minimum = paper === 'poster' ? 4 : 2;
  const reserved = Math.max(minimum, Math.ceil(columns * ratio));
  return reserved * columnUnit;
}
export const reservedColumns = margin;
export function lineMetrics(columns: number, ratio: number = 0.1, paper?: string) {
  const padding = margin(columns, ratio, paper);
  const usable = Math.max(0, columns - 2 * padding / columnUnit);
  return { padding, usable };
}
export function usableColumns(columns: number): number {
  return lineMetrics(columns, 0.1, 'letter').usable;
}
export function gutter(columns: number): number {
  return reservedColumns(columns, 0.1, 'letter') / columnUnit;
}
export function pad(text: string, columns: number, align: 'left' | 'right' | 'center') {
  const spaces = Math.max(0, columns - displayWidth(text));
  const before = align === 'right' ? spaces : align === 'center' ? Math.floor(spaces / 2) : 0;
  return ' '.repeat(before) + text + ' '.repeat(spaces - before);
}
export function truncate(text: string, columns: number, marker = '…') {
  if (displayWidth(text) <= columns) return text;
  const available = Math.max(0, columns - displayWidth(marker));
  let used = 0;
  let result = '';
  for (const character of text) {
    const width = characterWidth(character);
    if (used + width > available) break;
    result += character;
    used += width;
  }
  return result + marker;
}
export function columnPosition(text: string, codePointIndex: number) {
  return displayWidth([...text].slice(0, codePointIndex).join(''));
}
export function expandTabs(text: string, tabSize = 4) {
  let column = 0;
  let output = '';
  for (const character of text) {
    if (character === '\t') {
      const spaces = tabSize - column % tabSize;
      output += ' '.repeat(spaces);
      column += spaces;
    } else {
      output += character;
      column = character === '\n' ? 0 : column + characterWidth(character);
    }
  }
  return output;
}
