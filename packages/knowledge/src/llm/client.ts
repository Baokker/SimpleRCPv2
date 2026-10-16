export interface LlmCompletionRequest {
    model: string;
    messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>;
    temperature?: number;
    responseFormat?: { type: 'json_object' | 'text' };
    timeoutMs?: number;
}

export interface LlmUsage {
    promptTokens?: number;
    completionTokens?: number;
    reasoningTokens?: number;
    cacheReadTokens?: number;
    cacheWriteTokens?: number;
    totalTokens?: number;
    cost?: number;
    estimatedCost?: number;
    estimatedCostCurrency?: string;
    estimatedCostSource?: string;
}
export interface LlmClient { complete(request: LlmCompletionRequest): Promise<{ text: string; usage?: LlmUsage }>; embed?(texts: string[]): Promise<number[][]>; }

export function isLlmQuotaFailure(value: unknown) {
    const text = typeof value === 'string' ? value : JSON.stringify(value);
    return /(?:quota|insufficient[_ -]?(?:balance|credit)|credit[_ -]?(?:limit|exhaust)|balance.*(?:low|exhaust|insufficient)|usage limit|token plan.*(?:exceed|limit)|额度|余额不足|用量上限|套餐.*(?:上限|耗尽)|rate[_ -]?limit|too many requests|HTTP 429|"status"\s*:\s*429)/iu.test(text ?? '');
}
