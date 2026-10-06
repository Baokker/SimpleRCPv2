import { test } from 'node:test';
import assert from 'node:assert/strict';
import { escapeHtml } from './html.js';
import { label } from './view.js';
test('escape element and attribute text once', () => {
  assert.equal(escapeHtml('&<>"\''), '&amp;&lt;&gt;&quot;&#39;');
  assert.equal(label('<Tom>', '"&'), '<span title="&quot;&amp;">&lt;Tom&gt;</span>');
});
