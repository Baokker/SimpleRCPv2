import { createOpenAICompatibleClient } from '../src/llm/openaiCompatible.js';
import { extractKnowledgeCardDraft } from '../src/extract/extract.js';

const provider = process.env.KNOWLEDGE_LLM_PROVIDER || (process.env.MINIMAX_API_KEY ? 'minimax' : 'deepseek');
if (provider !== 'minimax' && provider !== 'deepseek') throw new Error('KNOWLEDGE_LLM_PROVIDER must be minimax or deepseek');
const baseUrl = provider === 'minimax' ? (process.env.MINIMAX_BASE_URL || 'https://api.minimaxi.com/v1') : (process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com/v1');
const apiKey = provider === 'minimax' ? process.env.MINIMAX_API_KEY : process.env.DEEPSEEK_API_KEY;
const model = provider === 'minimax' ? (process.env.MINIMAX_MODEL || 'MiniMax-M2') : (process.env.DEEPSEEK_MODEL || 'deepseek-chat');
if (!apiKey) throw new Error(`${provider === 'minimax' ? 'MINIMAX_API_KEY' : 'DEEPSEEK_API_KEY'} is required`);
const client = createOpenAICompatibleClient({ baseUrl, apiKey, model });
const draft = await extractKnowledgeCardDraft({ triggerType: 'chat.dense', evidence: { chatMessages: [{ id: 'bench', text: 'The team keeps retries bounded.' }] } }, { model, client });
console.log(JSON.stringify({ provider, model, type: draft.type, title: draft.title, confidence: draft.confidence, evidenceCitations: draft.evidenceCitations }, undefined, 2));
