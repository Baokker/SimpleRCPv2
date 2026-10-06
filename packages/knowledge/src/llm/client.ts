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
