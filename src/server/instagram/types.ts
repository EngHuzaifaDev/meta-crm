export type ActionType =
  | "navigate"
  | "wait"
  | "waitFor"
  | "type"
  | "click"
  | "clickIfExists"
  | "extract"
  | "extractList"
  | "scrollToBottom"
  | "ifExists"
  | "repeat"
  | "javascript";

export interface ScrapeAction {
  id: string;
  action: ActionType;
  selector?: string;
  url?: string;
  value?: string;
  focus?: boolean;
  clear?: boolean;
  timeout?: number;
  waitAfter?: number;
  waitBefore?: number;
  script?: string;
  maxIterations?: number;
  extractAttr?: string;
  then?: ScrapeAction[];
  else?: ScrapeAction[];
  actions?: ScrapeAction[];
}

export interface ActionDefinition {
  name: string;
  description?: string;
  baseUrl?: string;
  actions: ScrapeAction[];
}

export interface VariableContext {
  credentials: {
    username: string;
    password: string;
    verificationCode?: string;
  };
  profile: {
    username: string;
  };
  [key: string]: unknown;
}

export interface ExtractionResult {
  profileUsername: string;
  followers: string[];
  followerCount: number;
  scrapedAt: Date;
  success: boolean;
  error?: string;
}

export interface InstagramProfile {
  _id?: string;
  adminUserId: string;
  instagramUsername: string;
  encryptedPassword: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface InstagramTarget {
  _id?: string;
  addedByUserId: string;
  profileUsername: string;
  lastScrapedAt?: Date;
  followerCount?: number;
  createdAt: Date;
}
