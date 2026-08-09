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
  firstSeenAt: Date;
  lastSeenAt: Date;
  appearanceCount: number;
}

export interface ExtractionTask {
  runId: string;
  userId: string;
  batchId?: string;
  status: "pending" | "running" | "done" | "failed" | "stopped";
  cookieHash: string;
  cookies: string;
  profileUsername: string;
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
