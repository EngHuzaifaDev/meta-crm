import { ObjectId } from "mongodb";


function toObjectIdString(value: any): string | null {
    if (!value) return null;
    if (typeof value === "string" && /^[a-f0-9]{24}$/i.test(value)) return value;
    if (value instanceof ObjectId) return value.toString();
    if (Buffer.isBuffer(value)) return value.toString("hex");
    // Handle serialized ObjectId: { buffer: { ... } } or object with toString method
    if (value.buffer && typeof value.toString === "function") {
        const str = value.toString();
        if (/^[a-f0-9]{24}$/i.test(str)) return str;
    }
    if (typeof value.toHexString === "function") return value.toHexString();
    return null;
}

export function normalizeDoc(doc: any): any {
    if (!doc || typeof doc !== "object") return doc;

    if (Array.isArray(doc)) {
        return doc.map((v) => normalizeDoc(v));
    }

    const cleaned: any = {};
    for (const key in doc) {
        const value = doc[key];
        const idString = toObjectIdString(value);
        if (idString) {
            cleaned[key] = idString;
            continue;
        }
        if (value instanceof Date) {
            cleaned[key] = value.toISOString();
            continue;
        }
        if (value && typeof value === "object") {
            cleaned[key] = normalizeDoc(value);
            continue;
        }
        cleaned[key] = value;
    }
    return cleaned;
}

/**
 * Normalize an array of documents concurrently.
 */
export async function normalizeDocs(docs: any[]): Promise<any[]> {
    return docs.map(doc => normalizeDoc(doc));
}