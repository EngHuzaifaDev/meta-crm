// lib/db/types.ts
import { ObjectId } from "mongodb";

export const LEAD_STAGES = [
  "New",
  "Contacted",
  "Qualified",
  "Proposal",
  "Negotiation",
  "Closed Won",
  "Closed Lost",
] as const;

export type LeadStage = (typeof LEAD_STAGES)[number];


export interface IUser {
  _id: string | ObjectId;
  name: string;
  email: string;
  emailVerified: boolean;
  avatar?: string;
  role: number;          // 0 = admin, 1 = user
  industry?: string;
  services: string[];
  createdAt: Date;
  updatedAt: Date;
}

export interface ILead {
  _id: ObjectId;
  hasAccess: number[];
  userId: string;
  leadId: string;         // OP-0001
  name: string;
  website?: string;
  industry?: string;
  numberOfEmployees?: number;
  description?: string;
  contact?: { email?: string; phone?: string };
  socials?: Record<string, string>;


  status?: "new" | "qualifying" | "qualified" | "failed";   // pipeline step
  chatId?: string;            // optional, if you tie to a chat session
  score?: number;             // 0-10
  summary?: string;           // AI summary (plain text / markdown)
  coldOutreach?: string;      // generated message
  nextStep?: string;          // suggested action


  stage?: string;


  createdAt: Date;
  updatedAt: Date;

}

export interface INode {
  _id: ObjectId;
  leadId: ObjectId;
  index: number;
  type: "input" | "reply";
  originalContent: string;
  content: string;
  createdAt: Date;
  updatedAt: Date;
}


// lib/db/types.ts (addition)
export interface IPipelineStatus {
  _id: ObjectId;
  leadId: string;               // OP-XXXX (readable ID)
  status: "queued" | "processing" | "completed" | "failed";
  progressCode: string;         // e.g. "queued", "scraping", "qualifying", "done"
  statusReport: string;
  error?: string;               // if failed
  createdAt?: Date;
  updatedAt?: Date;
}