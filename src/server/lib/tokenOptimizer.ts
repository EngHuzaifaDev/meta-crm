// server/lib/tokenOptimizer.
// @ts-ignore
import { compress } from 'tokenshrink';
import { mongodbInstance as db } from '@/lib/db/mongodb';

/**
 * Fetches the most recent scraped content for a lead, compresses it using tokenshrink,
 * and returns the compressed text with statistics.
 *
 * @param leadId - The lead identifier (e.g., "OP-0001")
 * @param userId - Optional user ID to further isolate (if multiple users share leadId)
 * @returns A promise with a safe result object
 */
export async function getShrinkedContent(
    leadId: string,
    userId?: string
): Promise<{
    success: boolean;
    compressed?: string;
    stats?: any;
    originalLength?: number;
    compressedLength?: number;
    error?: string;
}> {
    try {

        // Build query: find by leadId, optionally by userId
        const query: Record<string, any> = { leadId };
        if (userId) query.userId = userId;

        // Fetch the most recent scraped document
        const doc = await db
            .collection('scrapedContents')
            .findOne(query, { sort: { createdAt: -1 } });

        if (!doc) {
            return {
                success: false,
                error: `No scraped content found for leadId: ${leadId}${userId ? ` and userId: ${userId}` : ''}`,
            };
        }

        const originalText = doc.text;
        if (!originalText || originalText.trim().length === 0) {
            return {
                success: false,
                error: 'Scraped content is empty or missing',
            };
        }

        // Apply tokenshrink compression
        const result = compress(originalText);

        return {
            success: true,
            compressed: result.compressed,
            stats: result.stats,
            originalLength: originalText.length,
            compressedLength: result.compressed.length,
        };
    } catch (error: any) {
        return {
            success: false,
            error: `Compression failed: ${error.message}`,
        };
    }
}

// Optional: if you want to compress arbitrary text without DB lookup
export function shrinkText(text: string): any {
    return compress(text);
}