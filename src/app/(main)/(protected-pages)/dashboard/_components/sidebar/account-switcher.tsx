// components/UserMenu.tsx
"use client";

import { useRouter } from "next/navigation";

import { BadgeCheck, LogOut } from "lucide-react";

import { signOutAction } from "@/app/(main)/auth/actions";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { useSession } from "@/lib/auth-client"; // or useUserStore if you prefer
import { getInitials } from "@/lib/utils";

function roleLabel(role: number) {
  return role === 0 ? "Admin" : "User";
}

export function UserMenu() {
  const router = useRouter();
  const { data: session, isPending } = useSession();
  const user = session?.user as any;

  const handleSignOut = async () => {
    await signOutAction();
    router.push("/auth/login");
    router.refresh();
  };

  // Skeleton state while loading or no user
  if (isPending || !user) {
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Skeleton className="size-8 rounded-lg" />
        </DropdownMenuTrigger>
        <DropdownMenuContent className="min-w-56 space-y-1 rounded-lg" side="bottom" align="end" sideOffset={4}>
          {/* Header skeleton */}
          <div className="flex items-center gap-2 px-2 py-2">
            <Skeleton className="size-9 rounded-lg" />
            <div className="grid flex-1 gap-1">
              <Skeleton className="h-4 w-28" />
              <Skeleton className="h-3 w-16" />
            </div>
          </div>
          <DropdownMenuSeparator />
          {/* Menu item skeletons */}
          <div className="space-y-1 px-2 py-1">
            <Skeleton className="h-8 w-full rounded" />
            <Skeleton className="h-8 w-full rounded" />
            <Skeleton className="h-8 w-full rounded" />
          </div>
          <DropdownMenuSeparator />
          <div className="px-2 py-1">
            <Skeleton className="h-8 w-full rounded" />
          </div>
        </DropdownMenuContent>
      </DropdownMenu>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Avatar className="size-8 cursor-pointer rounded-lg">
          <AvatarImage src={user.avatar || undefined} alt={user.name} />
          <AvatarFallback>{getInitials(user.name)}</AvatarFallback>
        </Avatar>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="min-w-56 space-y-1 rounded-lg" side="bottom" align="end" sideOffset={4}>
        {/* User info header */}
        <div className="flex items-center gap-2 px-2 py-2">
          <Avatar className="size-9 rounded-lg">
            <AvatarImage src={user.image || undefined} alt={user.name} />
            <AvatarFallback>{getInitials(user.name)}</AvatarFallback>
          </Avatar>
          <div className="grid min-w-0 flex-1 text-left text-sm leading-tight">
            <span className="truncate font-semibold">{user.name}</span>
            <span className="truncate text-muted-foreground text-xs">{roleLabel(user.role ?? 1)}</span>
          </div>
        </div>

        <DropdownMenuSeparator />

        <DropdownMenuGroup>
          <DropdownMenuItem>
            <BadgeCheck className="mr-2 h-4 w-4" />
            Account
          </DropdownMenuItem>
        </DropdownMenuGroup>

        <DropdownMenuSeparator />

        <DropdownMenuItem onClick={handleSignOut}>
          <LogOut className="mr-2 h-4 w-4" />
          Log out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
