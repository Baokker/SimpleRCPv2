import { expect, test } from 'vitest';
import { removeKnowledgeEvidenceBlocks } from '../src/util/content.js';
import { extractKnowledgeCardDraft } from '../src/extract/extract.js';

test('删除独立证据章节并保留规则和代码示例', () => {
    const text = '## 规则\n保留 helper。\n\n## Evidence\n```json\n{"chatMessages":[]}\n```\n\n## 适用范围\nsrc/**\n\n```md\n## Evidence\n```';
    expect(removeKnowledgeEvidenceBlocks(text)).toBe('## 规则\n保留 helper。\n\n## 适用范围\nsrc/**\n\n```md\n## Evidence\n```');
});

test('确定性草稿把来源保存在引用中', async () => {
    const draft = await extractKnowledgeCardDraft({ triggerType: 'chat.dense', evidence: { chatMessages: [{ text: '应当使用 sharedHelper' }] } }, { model: '' });
    expect(draft.evidenceCitations).toContain('evidence.chatMessages[0].text');
    expect(draft.content).not.toContain('Discussion evidence');
    expect(draft.content).not.toContain('## Evidence');
});

test('清理证据章节时包含其中的下级证据标题', () => {
    expect(removeKnowledgeEvidenceBlocks('## 规则\n保留 helper。\n## 证据\n原文\n### 原始证据\nJSON\n## 范围\nsrc/**'))
        .toBe('## 规则\n保留 helper。\n## 范围\nsrc/**');
});
