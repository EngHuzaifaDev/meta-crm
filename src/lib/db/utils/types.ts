export interface InstagramTargetProfile {
  _id?: string;
  addedByUserId: string;
  profileUsername: string;
  lastScrapedAt?: Date;
  followerCount?: number;
  profilePicUrl?: string;
  isPrivate?: boolean;
  isInvalid?: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface InstagramFollowerRecord {
  _id?: string;
  sourceProfileUsername: string;
  followerUsername: string;
  followerDisplayName?: string;
  followerAvatarUrl?: string;
  sourceType?: "followers" | "comments";
  firstSeenAt: Date;
  lastSeenAt: Date;
  appearanceCount: number;
}

export interface InstagramHarvestedProfile {
  _id?: string;
  sourceKey: string;
  shortcode: string;
  mediaId: string;
  username: string;
  fullName?: string;
  avatarUrl?: string;
  isVerified?: boolean;
  isPrivate?: boolean;
  firstSeenAt: Date;
  lastSeenAt: Date;
  appearanceCount: number;
}

export interface HarvestLogEntry {
  ts: Date;
  kind: "media_info" | "comments_page" | "error";
  shortcode: string;
  mediaId?: string;
  url?: string;
  params?: Record<string, unknown>;
  status?: number;
  body?: string;
  nextMaxId?: string | null;
  hasMore?: boolean;
  commentersCount?: number;
  error?: string;
  durationMs?: number;
}

export interface InstagramHarvestLogRun {
  _id?: string;
  runId: string;
  entries: HarvestLogEntry[];
  updatedAt: Date;
}

export interface ExtractionTask {
  runId: string;
  userId: string;
  batchId?: string;
  kind?: "followers" | "comments";
  status: "pending" | "running" | "done" | "failed" | "stopped";
  cookieHash: string;
  cookies: string;
  profileUsername: string;
  mediaShortcodes?: string[];
  sourceUsername?: string;
  maxId?: string;
  maxPages?: number;
  totalFetched: number;
  estimatedTotal: number;
  pagesFetched: number;
  newInserts: number;
  events: Array<{
    type: string;
    profileUsername?: string;
    message?: string;
    followerUsername?: string;
    count?: number;
    totalFollowers?: number;
    invalidCount?: number;
    privateCount?: number;
    duplicateCount?: number;
    skippedCount?: number;
    processedCount?: number;
    totalCount?: number;
    error?: string;
    page?: number;
    totalPages?: number;
    estimatedTotal?: number;
    totalEstimatedFollowers?: number;
    kind?: string;
  }>;
  error?: string;
  errorType?: "SESSION_EXPIRED" | "PROXY_FAILED" | "RATE_LIMITED" | "PROFILE_NOT_FOUND" | "SCHEMA_REMOVED" | "UNKNOWN";
  createdAt: Date;
  startedAt?: Date;
  completedAt?: Date;
  updatedAt: Date;
}
