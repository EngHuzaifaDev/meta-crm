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
