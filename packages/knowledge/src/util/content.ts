import { fromMarkdown } from 'mdast-util-from-markdown';
import { toString } from 'mdast-util-to-string';

const evidenceHeadings = new Set(['evidence', '原始证据', '证据', '编辑证据', 'discussion evidence (examples)']);

export function summarizeKnowledgeContent(content: string): string {
    const tree = fromMarkdown(content);
    const node = tree.children.find(candidate => ['paragraph', 'list', 'blockquote'].includes(candidate.type));
    const text = toString(node?.type === 'list' ? node.children[0]! : node ?? tree).trim();
    const sentences = new Intl.Segmenter('zh', { granularity: 'sentence' }).segment(text);
    return (sentences[Symbol.iterator]().next().value?.segment ?? text).trim().slice(0, 200);
}

export function removeKnowledgeEvidenceBlocks(content: string): string {
    const nodes = fromMarkdown(content).children;
    const ranges: Array<{ start: number; end: number }> = [];
    for (let index = 0; index < nodes.length; index++) {
        const node = nodes[index]!;
        if (node.type !== 'heading' || !evidenceHeadings.has(toString(node).trim().toLowerCase())) continue;
        if (ranges.some(range => range.start <= node.position!.start.offset! && range.end > node.position!.start.offset!)) continue;
        const next = nodes.slice(index + 1).find(candidate => candidate.type === 'heading' && candidate.depth <= node.depth);
        ranges.push({ start: node.position!.start.offset!, end: next?.position!.start.offset ?? content.length });
    }
    let result = content;
    for (const range of ranges.reverse()) result = result.slice(0, range.start) + result.slice(range.end);
    return result.trim();
}
