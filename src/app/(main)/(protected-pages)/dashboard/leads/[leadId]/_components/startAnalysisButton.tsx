"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Loader2Icon, PlayIcon } from "lucide-react";
import { useRouter } from "next/navigation";

export function StartAnalysisButton({ leadId }: { leadId: string }) {
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  const handleClick = async () => {
    setLoading(true);
    // TODO: trigger node generation / analysis action in future
    // For now, just simulate a placeholder action
    setTimeout(() => {
      setLoading(false);
      // Optionally redirect to a future analysis page
      // router.push(`/leads/${leadId}/analysis`);
    }, 1000);
  };

  return (
    <Button onClick={handleClick} disabled={loading}>
      {loading ? (
        <Loader2Icon className="mr-2 h-4 w-4 animate-spin" />
      ) : (
        <PlayIcon className="mr-2 h-4 w-4" />
      )}
      Start Analysis
    </Button>
  );
}