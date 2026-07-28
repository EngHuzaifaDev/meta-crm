import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { getAuth } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function Layout({ children }: Readonly<{ children: React.ReactNode }>) {
  const auth = await getAuth();
  const session = await auth.api.getSession({
    headers: await headers(),
  });
  if (!session) {
    redirect("/auth/login");
  }
  return <section className="min-h-screen bg-background font-sans antialiased">{children}</section>;
}
