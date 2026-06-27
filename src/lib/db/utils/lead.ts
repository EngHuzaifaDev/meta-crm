// lib/db/utils/lead.ts
import { mongodbInstance } from "@/lib/db/mongodb";
import { ILead, INode } from "@/lib/db/types";

const leads = mongodbInstance.collection<ILead>("leads");
const nodes = mongodbInstance.collection<INode>("nodes");

// Auto‑increment OP‑XXXX leadId
async function generateLeadId(): Promise<string> {
  const count = await leads.countDocuments();
  return `OP-${String(count + 1).padStart(4, "0")}`;
}

export async function createLead(data: {
  userId: string;
  name: string;
  website?: string;
  industry?: string;
  numberOfEmployees?: number;
  description?: string;
  contact?: { email?: string; phone?: string };
  socials?: Record<string, string>;
}): Promise<ILead> {
  const now = new Date();
  const leadId = await generateLeadId();
  const doc: Omit<ILead, "_id"> = {
    hasAccess: [0, 1],
    userId: data.userId,
    leadId,
    name: data.name,
    website: data.website,
    industry: data.industry,
    numberOfEmployees: data.numberOfEmployees,
    description: data.description,
    contact: data.contact,
    socials: data.socials,
    createdAt: now,
    updatedAt: now,
  };
  const result = await leads.insertOne(doc as any); // casting needed because _id generated automatically
  return { ...doc, _id: result.insertedId } as ILead;
}

// lib/db/utils/lead.ts (add this after createLead)

export async function updateLead(
  leadId: string,
  update: Partial<
    Pick<
      ILead,
      | "status"
      | "score"
      | "summary"
      | "coldOutreach"
      | "nextStep"
      | "name"
      | "website"
      | "industry"
      | "numberOfEmployees"
      | "description"
      | "contact"
      | "socials"
      | "stage"
    >
  >
): Promise<ILead | null> {
  const lead = await leads.findOne({ leadId });
  if (!lead) throw new Error("Lead not found");

  // Always bump updatedAt
  const setData = { ...update, updatedAt: new Date() };

  // Remove any forbidden fields that might sneak in
  delete (setData as any)._id;
  delete (setData as any).leadId;
  delete (setData as any).userId;
  delete (setData as any).createdAt;

  await leads.updateOne({ _id: lead._id }, { $set: setData });

  // Return the updated document
  return leads.findOne({ _id: lead._id });
}

export async function getLeadsByUser(userId: string, role: number): Promise<ILead[]> {
  if (role === 0) return leads.find({}).sort({ createdAt: -1 }).toArray()
  return leads.find({ userId }).sort({ createdAt: -1 }).toArray();
}

export async function getLeadByLeadId(leadId: string): Promise<ILead | null> {
  return leads.findOne({ leadId });
}

export async function addNodeToLead(
  leadId: string,
  nodeData: {
    type: "input" | "reply";
    originalContent: string;
    content: string;
  }
): Promise<INode> {
  const lead = await leads.findOne({ leadId });
  if (!lead) throw new Error("Lead not found");

  const lastNode = await nodes.findOne(
    { leadId: lead._id },
    { sort: { index: -1 } }
  );
  const nextIndex = lastNode ? lastNode.index + 1 : 1;

  const now = new Date();
  const doc: Omit<INode, "_id"> = {
    leadId: lead._id,
    index: nextIndex,
    ...nodeData,
    createdAt: now,
    updatedAt: now,
  };
  const result = await nodes.insertOne(doc as any);
  return { ...doc, _id: result.insertedId } as INode;
}

export async function getNodesForLead(leadId: string): Promise<INode[]> {
  const lead = await leads.findOne({ leadId }, { projection: { _id: 1 } });
  if (!lead) return [];
  return nodes.find({ leadId: lead._id }).sort({ index: 1 }).toArray();
}
