// server/ai-itegration/aiService.ts
"use server"
import Groq from "groq-sdk";
import { SYSTEM_PROMPT, buildUserPrompt } from "./prompts";
import { compressLeadDescription, estimateTokens } from "./utils";
import { progressMessages } from "@/config/progressMessages";
import { aiQueue } from "./rateLImiter";
import {
    createPipelineStatus,
    updatePipelineStatus,
    getPipelineStatusByLeadId,
} from "@/lib/db/utils/pipeline";
import { getLeadByLeadId, addNodeToLead, updateLead } from "@/lib/db/utils/lead";
import { getContent } from "@/server/scraper";
import { getShrinkedContent } from "@/server/lib/tokenOptimizer";
import { getUserServices } from "@/lib/db/utils/auth";
import { SERVICES, type ServiceItem } from "@/config/services";

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

// -------------------------------------------------------------------
// AI response shape
// -------------------------------------------------------------------
interface QualifyResult {
    score: number;
    summary: string;
    coldOutreach: string;
    nextStep: string;
}

// -------------------------------------------------------------------
// Core Groq call with retry‑after detection & exponential backoff
// -------------------------------------------------------------------
async function callGroqQualification(userPrompt: string): Promise<QualifyResult> {
    const MAX_RETRIES = 3;
    let attempt = 0;

    while (true) {
        attempt++;
        try {
            // Use asResponse() to get the full HTTP response
            const response = await groq.chat.completions
                .create({
                    messages: [
                        { role: "system", content: SYSTEM_PROMPT },
                        { role: "user", content: userPrompt },
                    ],
                    model: "llama-3.1-8b-instant",
                    temperature: 0.3,
                    max_tokens: 1024,
                    top_p: 1,
                    stream: false,
                    response_format: {
                        type: "json_object"
                    },
                    stop: null
                })
                .asResponse();

            if (response.status === 429) {
                const retryAfter = response.headers.get("retry-after");
                const delaySec = parseInt(retryAfter || "5", 10);
                console.warn(
                    `Rate limited (429). Retrying after ${delaySec}s (attempt ${attempt}/${MAX_RETRIES})`
                );
                if (attempt < MAX_RETRIES) {
                    await new Promise((res) => setTimeout(res, delaySec * 1000));
                    continue;
                }
                throw new Error(`Rate limited after ${MAX_RETRIES} retries`);
            }

            if (!response.ok) {
                throw new Error(
                    `Groq API error: ${response.status} ${response.statusText}`
                );
            }

            const data: any = await response.json();
            const rawContent = data.choices?.[0]?.message?.content || "{}";

            let parsed: QualifyResult;
            try {
                parsed = JSON.parse(rawContent);
            } catch {
                // Attempt to extract JSON even if model added extra text
                const match = rawContent.match(/\{[\s\S]*\}/);
                if (!match) throw new Error("AI response is not valid JSON");
                parsed = JSON.parse(match[0]);
            }

            // Validate required fields
            if (
                typeof parsed.score !== "number" ||
                !parsed.summary ||
                !parsed.coldOutreach ||
                !parsed.nextStep
            ) {
                throw new Error("AI response missing required fields");
            }

            return parsed;
        } catch (error: any) {
            if (
                attempt >= MAX_RETRIES ||
                error.message.includes("Rate limited")
            ) {
                throw error;
            }
            console.error(
                `Unexpected error on attempt ${attempt}, retrying…`,
                error
            );
            await new Promise((res) => setTimeout(res, 2000 * attempt));
        }
    }
}

// -------------------------------------------------------------------
// Helper: fetch user services from DB
// -------------------------------------------------------------------
async function getUserServicesDetails(userId: string): Promise<string> {
    const serviceIds = await getUserServices(userId);
    const result = SERVICES.filter((service) => serviceIds.includes(service.id));
    return JSON.stringify(result);;
}


// -------------------------------------------------------------------
// Main pipeline entry point (called by lead creation action)
// -------------------------------------------------------------------
export async function startLeadPipeline(leadId: string) {
    const lead = await getLeadByLeadId(leadId);
    if (!lead) throw new Error("Lead not found");

    // Prevent duplicate pipelines
    const existing = await getPipelineStatusByLeadId(leadId);
    if (existing && (existing.status === "queued" || existing.status === "processing")) {
        console.warn(`Pipeline already in progress for lead ${leadId}`);
        return existing;
    }

    // 1. Create status document – frontend will poll this
    const statusDoc = await createPipelineStatus(leadId);

    // 2. Enqueue background work (fire and forget inside the rate‑limiting queue)
    aiQueue.add(async () => {
        try {
            // ---------- STEP 1: SCRAPING ----------
            await updatePipelineStatus(statusDoc._id, {
                progressCode: "scraping",
                statusReport: progressMessages.scraping,
            });

            let scrapedText = "";
            if (lead.website) {
                const scrapeResult = await getContent(lead.website, {
                    leadId,
                    userId: lead.userId,
                });

                if (scrapeResult.success) {
                    // Compress the fresh scrape
                    const shrink = await getShrinkedContent(leadId);
                    if (shrink.success) {
                        scrapedText = shrink.compressed!;
                    } else {
                        console.warn(
                            `Token compression failed for lead ${leadId}, using raw text`
                        );
                        // Fallback: use raw text truncated to ~6000 chars
                        scrapedText = scrapeResult.text!.slice(0, 6000);
                    }
                    await updatePipelineStatus(statusDoc._id, {
                        statusReport:
                            "Website scraped successfully, moving to AI analysis…",
                    });
                } else {
                    console.warn(
                        `Scraping failed for lead ${leadId}: ${scrapeResult.error?.message}`
                    );
                    await updatePipelineStatus(statusDoc._id, {
                        statusReport:
                            "Couldn’t read website, continuing with provided info…",
                    });
                }
            } else {
                await updatePipelineStatus(statusDoc._id, {
                    statusReport: "No website provided, skipping scraping…",
                });
            }

            // ---------- STEP 2: AI QUALIFICATION ----------
            await updatePipelineStatus(statusDoc._id, {
                progressCode: "qualifying",
                statusReport: progressMessages.qualifying,
            });

            const services = await getUserServicesDetails(lead.userId);

            // Enrich the description with any scraped text
            const enrichedDescription = [lead.description, scrapedText]
                .filter(Boolean)
                .join("\n\nWebsite content:\n");

            const compressedLead = {
                name: lead.name,
                website: lead.website,
                industry: lead.industry,
                description: enrichedDescription
                    ? compressLeadDescription(enrichedDescription, 2000)
                    : undefined,
            };

            const userPrompt = buildUserPrompt(compressedLead, services);
            const aiResult = await callGroqQualification(userPrompt);

            // ---------- STEP 3: SAVE RESULTS ----------
            await updateLead(leadId, {
                score: aiResult.score,
                summary: aiResult.summary,
                coldOutreach: aiResult.coldOutreach,
                nextStep: aiResult.nextStep,
                status: "qualified",
            });

            // Add AI reply as a node (chat history)
            const replyContent = JSON.stringify(aiResult);
            await addNodeToLead(leadId, {
                type: "reply",
                originalContent: replyContent,
                content: replyContent, // you can convert to markdown later if needed
            });

            // Final pipeline status
            await updatePipelineStatus(statusDoc._id, {
                status: "completed",
                progressCode: "done",
                statusReport: progressMessages.done,
            });
        } catch (error: any) {
            console.error(`Pipeline failed for lead ${leadId}:`, error);

            // Mark lead as failed
            try {
                await updateLead(leadId, { status: "failed" });
            } catch (dbError) {
                console.error("Failed to update lead status to failed:", dbError);
            }

            // Update pipeline status with error
            await updatePipelineStatus(statusDoc._id, {
                status: "failed",
                progressCode: "error",
                statusReport: progressMessages.error,
                error: error.message,
            });
        }
    });

    // Return the status doc so the frontend can start polling immediately
    return statusDoc;
}