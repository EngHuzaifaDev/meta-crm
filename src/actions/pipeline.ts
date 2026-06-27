// app/actions/pipeline.ts (or wherever your actions are)
"use server";

import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { getPipelineStatusByLeadId } from "@/lib/db/utils/pipeline";

export async function getPipelineStatusAction(leadId: string) {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session?.user?.id) throw new Error("Not authenticated");

    const status = await getPipelineStatusByLeadId(leadId);
    if (!status) return null;


    return status;
}