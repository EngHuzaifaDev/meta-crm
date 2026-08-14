import { Cookie, type LucideIcon, MessageSquare, Shield, Users } from "lucide-react";
export type NavBadge = "new" | "soon";

export interface NavSubItem {
  id: string;
  title: string;
  url: string;
  icon?: LucideIcon;
  badge?: NavBadge;
  disabled?: boolean;
  newTab?: boolean;
  requiredRole?: number;
}

interface NavItemBase {
  id: string;
  title: string;
  icon?: LucideIcon;
  badge?: NavBadge;
  disabled?: boolean;
  newTab?: boolean;
  requiredRole?: number;
}

export interface NavMainLinkItem extends NavItemBase {
  url: string;
  subItems?: never;
}

export interface NavMainParentItem extends NavItemBase {
  subItems: NavSubItem[];
}

export type NavMainItem = NavMainLinkItem | NavMainParentItem;

export interface NavGroup {
  id: number;
  label?: string;
  items: NavMainItem[];
}

export const sidebarItems: NavGroup[] = [
  {
    id: 1,
    label: "Instagram",
    items: [
      {
        id: "cookie-extraction",
        title: "Cookie Extraction",
        url: "/dashboard/cookie-extraction",
        icon: Cookie,
      },
      {
        id: "comments",
        title: "Comments Harvest",
        url: "/dashboard/comments",
        icon: MessageSquare,
      },
      {
        id: "followers",
        title: "Followers",
        url: "/dashboard/followers",
        icon: Users,
      },
    ],
  },
  {
    id: 2,
    label: "Admin",
    items: [
      {
        id: "admin",
        title: "Developer",
        url: "/dashboard/admin",
        icon: Shield,
        requiredRole: 0,
      },
    ],
  },
];
