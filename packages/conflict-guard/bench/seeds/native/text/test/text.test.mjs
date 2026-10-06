import { test } from 'node:test';
import { strict as a } from 'node:assert';
import { displayWidth, pad, truncate, expandTabs } from '../src/width.ts';
import { wrap, paragraph } from '../src/layout.ts';
import { insertBlock, replaceText, moveBlock, textContent } from '../src/document.ts';
import { findText, replaceMatches, frequentWords } from '../src/search.ts';
import { render } from '../src/render.ts';
test('Unicode columns and paragraph breaking retain all words', () => {
  a.equal(displayWidth('中a'), 3);
  a.equal(displayWidth('e\u0301'), 1);
  a.equal(pad('中', 4, 'center'), ' 中 ');
  a.equal(truncate('abcdef', 4), 'abc…');
  a.equal(expandTabs('a\tb'), 'a   b');
  const words = ['one', 'two', 'three', 'four', 'five'];
  a.deepEqual(wrap(words, 10).flatMap((line) => line.words), words);
  a.ok(paragraph(words.join(' '), 10, 'justify').every((line) => displayWidth(line) === 10));
});
test('document edits, indexed search, and page rendering compose', () => {
  let doc = insertBlock({ version: 0, blocks: [] }, 0, { id: 'title', kind: 'heading', text: 'Hello' });
  doc = insertBlock(doc, 1, { id: 'body', kind: 'paragraph', text: 'hello world hello' });
  a.equal(findText(doc, 'hello').length, 3);
  const replaced = replaceMatches(doc, findText(doc, 'world'), 'reader');
  a.ok(textContent(replaced).includes('reader'));
  a.deepEqual(frequentWords(doc, new Set(['world']), 1), [['hello', 3]]);
  a.equal(moveBlock(doc, 'body', 'title').blocks[0].id, 'body');
  a.throws(() => replaceText(doc, 'body', 'stale', 0));
  a.ok(render(doc, { columns: 12, pageHeight: 8, columnCount: 1, align: 'left' }).length > 0);
});
