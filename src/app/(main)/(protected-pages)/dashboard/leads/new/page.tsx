import { NewLeadForm } from "../_components/newLeadForm";

export default function NewLeadPage() {
  return (
    <div className="space-y-6 p-4 md:p-8">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">New Lead</h1>
        <p className="text-muted-foreground">
          Enter the details of the company or contact you want to analyze.
        </p>
      </div>
      <NewLeadForm />
    </div>
  );
}