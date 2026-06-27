import { LeadsTable } from "./_components/leads-table";
import { KpiCards } from "./_components/kpi-cards";

export default function Page() {
  return (
    <div className="flex flex-col gap-4 md:gap-6">
      <KpiCards />
      <LeadsTable />
    </div>
  );
}