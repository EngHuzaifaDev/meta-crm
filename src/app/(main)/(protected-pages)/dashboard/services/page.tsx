import { ServiceSelector } from "./_components/serviceSelector";
import { getUserServicesAction } from "./actions";
export default async function ServicesPage() {
  let selectedServices: string[] = [];
  try {
    selectedServices = await getUserServicesAction();
  } catch (error) {
    // If not authenticated or DB error, just start with empty
    console.error("Could not fetch user services:", error);
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="font-bold text-2xl tracking-tight">Services</h1>
        <p className="text-muted-foreground">Select the services you offer to tailor your dashboard.</p>
      </div>
      <ServiceSelector initialSelected={selectedServices} />
    </div>
  );
}
