"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Loader2Icon, ChevronDownIcon } from "lucide-react";
import { updateLeadStageAction } from "../../actions";
import { LEAD_STAGES, type LeadStage } from "@/lib/db/types";
import { toast } from "sonner";

interface StageDropdownProps {
    leadId: string;
    currentStage?: string;
}

export function StageDropdown({ leadId, currentStage }: StageDropdownProps) {
    const [stage, setStage] = useState(currentStage || "New");
    const [isPending, startTransition] = useTransition();

    const handleStageChange = (newStage: LeadStage) => {
        if (newStage === stage) return;
        startTransition(async () => {
            const result = await updateLeadStageAction(leadId, newStage);
            if (result.success) {
                setStage(newStage);
                toast.success(`Stage updated to ${newStage}`);
            } else {
                toast.error(result.error || "Failed to update stage");
            }
        });
    };

    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <Button variant="outline" className="min-w-[160px] justify-between">
                    {isPending ? (
                        <Loader2Icon className="h-4 w-4 animate-spin mr-2" />
                    ) : null}
                    {stage}
                    <ChevronDownIcon className="ml-2 h-4 w-4 opacity-50" />
                </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
                {LEAD_STAGES.map((s) => (
                    <DropdownMenuItem
                        key={s}
                        onClick={() => handleStageChange(s)}
                        disabled={isPending}
                    >
                        {s}
                        {s === stage && (
                            <span className="ml-auto text-xs text-muted-foreground">✓</span>
                        )}
                    </DropdownMenuItem>
                ))}
            </DropdownMenuContent>
        </DropdownMenu>
    );
}