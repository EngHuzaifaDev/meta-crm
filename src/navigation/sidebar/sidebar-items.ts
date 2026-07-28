import { Cookie, KeyRound, type LucideIcon, Search } from "lucide-react";

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
        id: "extractor",
        title: "Extractor",
        url: "/dashboard",
        icon: Search,
      },
      {
        id: "credentials",
        title: "Credentials",
        url: "/dashboard/credentials",
        icon: KeyRound,
        requiredRole: 0,
      },
      {
        id: "cookie-extraction",
        title: "Cookie Extraction",
        url: "/dashboard/cookie-extraction",
        icon: Cookie,
        requiredRole: 0,
      },
    ],
  },
];
