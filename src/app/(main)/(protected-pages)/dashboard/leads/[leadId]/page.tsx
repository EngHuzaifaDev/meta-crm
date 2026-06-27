import { notFound, redirect } from "next/navigation";
import { getLeadAction } from "../actions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { LeadAnalysis } from "./_components/leadAnalysis";
import { StageDropdown } from "./_components/stageDropdown";

interface Props {
    params: Promise<{ leadId: string }>;
}

export default async function LeadDetailPage({ params }: Props) {
    const { leadId } = await params;
    const lead = await getLeadAction(leadId);

    if (!lead) redirect('/dashboard/leads/new');

    // Map employee range to label
    const employeeLabel = (() => {
        if (lead.numberOfEmployees === undefined) return "Not specified";
        const ranges = [
            { min: 1, max: 10, label: "1 – 10" },
            { min: 11, max: 50, label: "11 – 50" },
            { min: 51, max: 200, label: "51 – 200" },
            { min: 201, max: 500, label: "201 – 500" },
            { min: 501, max: 1000, label: "501 – 1,000" },
            { min: 1001, max: 5000, label: "1,001 – 5,000" },
            { min: 5001, max: 10000, label: "5,001 – 10,000" },
            { min: 10001, max: Infinity, label: "10,001+" },
        ];
        const range = ranges.find(
            (r) => lead.numberOfEmployees! >= r.min && lead.numberOfEmployees! <= r.max
        );
        return range?.label ?? "Unknown";
    })();

    // Prepare lead data for client component
    const leadData = {
        name: lead.name,
        leadId: lead.leadId,
        website: lead.website,
        industry: lead.industry,
        numberOfEmployees: lead.numberOfEmployees,
        description: lead.description,
        score: lead.score,
        summary: lead.summary,
        coldOutreach: lead.coldOutreach,
        nextStep: lead.nextStep,
        status: lead.status,
        stage: lead.stage, // 👈 include stage
    };

    return (
        <div className="space-y-6 p-4 md:p-8">
            {/* Header row with name, ID, and stage dropdown */}
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-bold tracking-tight">{lead.name}</h1>
                    <p className="text-sm text-muted-foreground">ID: {lead.leadId}</p>
                </div>
                <StageDropdown leadId={lead.leadId} currentStage={lead.stage || "New"} />
            </div>

            {/* Two cards for input data */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <Card>
                    <CardHeader>
                        <CardTitle className="text-lg">Contact Details</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-3">
                        {lead.website && (
                            <div>
                                <span className="text-sm font-medium text-muted-foreground">Website:</span>{" "}
                                <a
                                    href={lead.website}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="text-primary underline"
                                >
                                    {lead.website}
                                </a>
                            </div>
                        )}
                        {lead.industry && (
                            <div>
                                <span className="text-sm font-medium text-muted-foreground">Industry:</span>{" "}
                                {lead.industry}
                            </div>
                        )}
                        <div>
                            <span className="text-sm font-medium text-muted-foreground">Employees:</span>{" "}
                            {employeeLabel}
                        </div>
                    </CardContent>
                </Card>

                {lead.description && (
                    <Card>
                        <CardHeader>
                            <CardTitle className="text-lg">Description</CardTitle>
                        </CardHeader>
                        <CardContent>
                            <p className="text-sm whitespace-pre-wrap">{lead.description}</p>
                        </CardContent>
                    </Card>
                )}
            </div>

            {/* Analysis section */}
            <LeadAnalysis lead={leadData} />
        </div>
    );
}
