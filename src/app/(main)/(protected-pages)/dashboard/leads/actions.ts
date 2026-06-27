"use server";

import { z } from "zod";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import {
    createLead,
    getLeadByLeadId,
    getLeadsByUser,
    updateLead
} from "@/lib/db/utils/lead";
import { revalidatePath } from "next/cache";
import { INDUSTRIES } from "@/config/industries";
import { startLeadPipeline } from "@/server/ai-integration/aiService";
import { getPipelineStatusByLeadId } from "@/lib/db/utils/pipeline";
import { normalizeDoc } from "@/server/utils";

// ---- Validation schemas ----



const newLeadSchema = z.object({
    name: z.string().min(1, "Name is required").max(100, "Name too long"),
    website: z
        .url("Invalid URL")
        .optional()
        .or(z.literal("")),
    industry: z.string().max(50).optional(),
    numberOfEmployees: z.number().optional(),
    description: z.string().max(1000, "Description too long").optional(),
});

export type NewLeadInput = z.infer<typeof newLeadSchema>;

// ---- Action state ----
export interface ActionState {
    error?: string;
    success?: boolean;
    leadId?: string;
}

// ---- Create lead ----
export async function createLeadAction(
    prevState: ActionState,
    formData: FormData
): Promise<ActionState> {
    // 1. Authenticate
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session?.user?.id) return { error: "Not authenticated" };

    // 2. Parse & validate
    const raw = {
        name: formData.get("name"),
        website: formData.get("website")?.toString() || undefined,
        industry: formData.get("industry")?.toString() || undefined,
        numberOfEmployees: formData.get("numberOfEmployees")
            ? Number(formData.get("numberOfEmployees"))
            : undefined,
        description: formData.get("description")?.toString() || undefined,
    };

    const parsed = newLeadSchema.safeParse(raw);
    if (!parsed.success) {
        return { error: parsed.error.issues[0].message };
    }

    // 3. Optional: validate industry is in list if provided
    if (parsed.data.industry && !INDUSTRIES.includes(parsed.data.industry)) {
        return { error: "Invalid industry selected" };
    }

    // 4. Create lead
    try {
        const lead = await createLead({
            userId: session.user.id,
            name: parsed.data.name,
            website: parsed.data.website,
            industry: parsed.data.industry,
            numberOfEmployees: parsed.data.numberOfEmployees,
            description: parsed.data.description,
        });
        revalidatePath("/leads");
        return { success: true, leadId: lead.leadId };
    } catch (error) {
        console.error("Create lead error:", error);
        return { error: "Failed to create lead. Please try again." };
    }
}

// ---- Get lead by leadId (with RBAC) ----
export async function getLeadAction(leadId: string) {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session?.user?.id) throw new Error("Not authenticated");

    const lead = await getLeadByLeadId(leadId);
    if (!lead) return null;

    // RBAC: Admin sees all, user only sees own
    if (lead.userId !== session.user.id && session.user.role !== 0) {
        return null;
    }

    return normalizeDoc(lead);
}

// ---- Get minimal lead info for sidebar (already RBAC‑aware) ----
export async function getUserLeadsAction(): Promise<
    { leadId: string; name: string }[]
> {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session?.user?.id) throw new Error("Not authenticated");

    // The underlying getLeadsByUser uses role to return all (admin) or own (user)
    const leads = await getLeadsByUser(session.user.id, session.user.role);
    return leads.map(({ leadId, name }) => ({ leadId, name }));
}

// ---- Start the AI pipeline for a lead (with RBAC) ----
export async function startLeadPipelineAction(leadId: string) {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session?.user?.id) throw new Error("Not authenticated");

    const lead = await getLeadByLeadId(leadId);
    if (!lead) throw new Error("Lead not found");

    // RBAC: only owner or admin can start analysis
    if (lead.userId !== session.user.id && session.user.role !== 0) {
        throw new Error("Lead not found or access denied");
    }

    const status = await startLeadPipeline(leadId);
    return normalizeDoc(status);
}

// ---- Get current pipeline status for a lead (with RBAC) ----
export async function getPipelineStatusAction(leadId: string) {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session?.user?.id) throw new Error("Not authenticated");

    const status = await getPipelineStatusByLeadId(leadId);
    if (!status) return null;

    // RBAC: verify lead ownership before returning pipeline status
    const lead = await getLeadByLeadId(leadId);
    if (!lead || (lead.userId !== session.user.id && session.user.role !== 0)) {
        return null;
    }

    return normalizeDoc(status);
}


export async function updateLeadStageAction(
    leadId: string,
    stage: string
): Promise<{ success: boolean; error?: string }> {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session?.user?.id) return { success: false, error: "Not authenticated" };

    // Verify ownership
    const lead = await getLeadByLeadId(leadId);


    if (!lead) return { success: false, error: "Lead not found" }
    else if (session.user.role === 0) {
        try {
            await updateLead(leadId, { stage }); // assuming updateLead exists
            revalidatePath(`/leads/${leadId}`);
            return { success: true };
        } catch (error) {
            console.error("Failed to update lead stage:", error);
            return { success: false, error: "Database error" };
        }
    }
    else if (session.user.id !== lead.userId) return { success: false, error: 'Access Denied' }

    try {
        await updateLead(leadId, { stage }); // assuming updateLead exists
        revalidatePath(`/leads/${leadId}`);
        return { success: true };
    } catch (error) {
        console.error("Failed to update lead stage:", error);
        return { success: false, error: "Database error" };
    }
}