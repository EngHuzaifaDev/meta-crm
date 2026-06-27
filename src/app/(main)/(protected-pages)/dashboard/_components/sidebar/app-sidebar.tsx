"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Command, Plus } from "lucide-react";
import { useShallow } from "zustand/react/shallow";

import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import { APP_CONFIG } from "@/config/app-config";
import { sidebarItems } from "@/navigation/sidebar/sidebar-items";
import { usePreferencesStore } from "@/stores/preferences/preferences-provider";
import { getUserLeadsAction } from "../../leads/actions";
import { NavMain } from "./nav-main";
import { NavUser } from "./nav-user";

// Add an icon for leads (you can choose any)
import { Users } from "lucide-react";

export function AppSidebar({ ...props }: React.ComponentProps<typeof Sidebar>) {
  const { sidebarVariant, sidebarCollapsible, isSynced } = usePreferencesStore(
    useShallow((s) => ({
      sidebarVariant: s.sidebarVariant,
      sidebarCollapsible: s.sidebarCollapsible,
      isSynced: s.isSynced,
    })),
  );

  const variant = isSynced ? sidebarVariant : props.variant;
  const collapsible = isSynced ? sidebarCollapsible : props.collapsible;

  // 1. Fetch user’s leads dynamically
  const [leads, setLeads] = useState<
    { leadId: string; name: string }[]
  >([]);
  const pathname = usePathname();

  useEffect(() => {
    getUserLeadsAction()
      .then(setLeads)
      .catch(console.error);
  }, [pathname]); // refetch on every navigation (new lead appears instantly)

  // 2. Merge fetched leads into the "Leads Pipeline" group (id: 1)
  const dynamicItems = sidebarItems.map((group) => {
    if (group.id === 1) {
      return {
        ...group,
        items: [
          ...group.items, // static items (e.g., "New Lead")
          ...leads.map((lead) => ({
            id: lead.leadId,
            title: lead.name,
            url: `/dashboard/leads/${lead.leadId}`,
            icon: Users,
          })),
        ],
      };
    }
    return group;
  });

  return (
    <Sidebar {...props} variant={variant} collapsible={collapsible}>
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton asChild>
              <Link prefetch={false} href="/dashboard/crm">
                <Command />
                <span className="font-semibold text-base">
                  {APP_CONFIG.name}
                </span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <NavMain items={dynamicItems} />
      </SidebarContent>
      <SidebarFooter>
        <NavUser />
      </SidebarFooter>
    </Sidebar>
  );
}