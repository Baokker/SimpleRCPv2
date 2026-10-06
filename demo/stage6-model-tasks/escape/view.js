import { escapeHtml } from './html.js';
export function label(name, title) { return `<span title="${title}">${escapeHtml(name)}</span>`; }
