// server/groq/utils.ts
export function estimateTokens(text: string): number {
    return Math.ceil(text.length / 4);
}


export function compressLeadDescription(description: string, maxTokens = 500): string {
    if (estimateTokens(description) <= maxTokens) return description;
    // Simple truncation – later you can add LLMLingua or summarization
    return description.slice(0, maxTokens * 4) + '…';
}