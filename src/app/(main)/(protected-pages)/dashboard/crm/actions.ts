"use server";

import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { getLeadsByUser } from "@/lib/db/utils/lead";
import { ILead } from "@/lib/db/types";



export async function fetchLeadsForDashboard() {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session?.user?.id) throw new Error("Not authenticated");

    const leads = await getLeadsByUser(session.user.id, session.user.role);

    return leads.map((lead) => ({
        id: lead.leadId,
        name: lead.name,
        website: lead.website ?? "",
        industry: lead.industry ?? "",
        employees: lead.numberOfEmployees,
        stage: lead.stage ?? "New",
    }));
}




export interface LeadStats {
    totalLeads: number;
    qualifiedLeads: number;        // stage = "Qualified" or score >= 50
    averageScore: number | null;
    conversionRate: number;        // Closed Won / total
    // Previous period for trends
    prevTotalLeads: number;
    prevQualifiedLeads: number;
    prevAverageScore: number | null;
    prevConversionRate: number;
}

export async function getLeadStatsAction(): Promise<LeadStats> {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session?.user?.id) throw new Error("Not authenticated");
    const role = (session.user as any).role as number;
    const leads = await getLeadsByUser(session.user.id, role);

    const now = new Date();
    const thisMonth = now.getMonth();
    const thisYear = now.getFullYear();
    const lastMonth = thisMonth === 0 ? 11 : thisMonth - 1;
    const lastMonthYear = thisMonth === 0 ? thisYear - 1 : thisYear;

    const thisMonthLeads = leads.filter((l) => {
        const d = new Date(l.createdAt);
        return d.getMonth() === thisMonth && d.getFullYear() === thisYear;
    });
    const lastMonthLeads = leads.filter((l) => {
        const d = new Date(l.createdAt);
        return d.getMonth() === lastMonth && d.getFullYear() === lastMonthYear;
    });

    const countQualified = (arr: ILead[]) =>
        arr.filter((l) => l.status === "qualified").length;

    const avgScore = (arr: ILead[]) => {
        const scored = arr.filter((l) => l.score !== undefined);
        if (!scored.length) return null;
        return Math.round(scored.reduce((s, l) => s + l.score!, 0) / scored.length);
    };

    const conversionRate = (arr: ILead[]) => {
        const closedWon = arr.filter((l) => l.stage === "Closed Won").length;
        return arr.length ? Math.round((closedWon / arr.length) * 100) : 0;
    };

    return {
        totalLeads: thisMonthLeads.length,
        qualifiedLeads: countQualified(thisMonthLeads),
        averageScore: avgScore(leads), // all-time average score
        conversionRate: conversionRate(leads), // all-time conversion
        prevTotalLeads: lastMonthLeads.length,
        prevQualifiedLeads: countQualified(lastMonthLeads),
        prevAverageScore: avgScore(lastMonthLeads),
        prevConversionRate: conversionRate(lastMonthLeads),
    };
}