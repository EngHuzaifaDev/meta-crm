"use server"
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";


export default async function Layout({ children }: Readonly<{ children: React.ReactNode }>) {
    const session = await auth.api.getSession({
        headers: await headers(),
    });
    if (session?.user) {
        if (session.user.role !== 0) redirect('/dashboard/leads/new')
    }
    return (
        <section className="min-h-screen bg-background font-sans antialiased">
            {children}
        </section>
    );
}