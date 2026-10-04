import { createOpenAICompatibleClient } from '../src/openaiCompatible.js';
import { extractKnowledgeCardDraft } from '../src/knowledge-extract.js';

const baseUrl = process.env.DEEPSEEK_BASE_URL;
const apiKey = process.env.DEEPSEEK_API_KEY;
const model = process.env.DEEPSEEK_MODEL;
if (!baseUrl || !apiKey || !model) throw new Error('DEEPSEEK_BASE_URL, DEEPSEEK_API_KEY and DEEPSEEK_MODEL are required');
const client = createOpenAICompatibleClient({ baseUrl, apiKey, model });
const draft = await extractKnowledgeCardDraft({ triggerType: 'chat.dense', evidence: { chatMessages: [{ id: 'bench', text: 'The team keeps retries bounded.' }] } }, { model, client });
console.log(JSON.stringify({ type: draft.type, title: draft.title, confidence: draft.confidence, evidenceCitations: draft.evidenceCitations }, undefined, 2));
