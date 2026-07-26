// lib/db/utils/accessControl.ts
export function canAccessResource(userRole: number, ownerUserId: string, currentUserId: string): boolean {
  if (userRole === 0) return true; // admin
  return ownerUserId === currentUserId; // user: only own
}
