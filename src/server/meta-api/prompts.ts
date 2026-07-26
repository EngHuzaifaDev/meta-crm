// server/groq/prompts.ts
export const SYSTEM_PROMPT = `You are a B2B lead qualification expert. 
Given a lead profile and the services we offer, return a JSON object with:
- "score": integer 0-10 (how likely to convert)
- "summary": concise analysis (max 3 sentences)
- "coldOutreach": professional email message ready to send
- "nextStep": clear suggested action (e.g. "Send email", "Schedule demo", "Research more")

Return ONLY valid JSON, no markdown, no extra text.`;

export function buildUserPrompt(lead: {
  name: string;
  website?: string;
  industry?: string;
  description?: string;
}, services: string): string {
  const leadBlock = [
    `Name: ${lead.name}`,
    lead.website && `Website: ${lead.website}`,
    lead.industry && `Industry: ${lead.industry}`,
    lead.description && `Description: ${lead.description}`,
  ]
    .filter(Boolean)
    .join('\n');

  const servicesBlock = services;

  return `Services we provide: ${servicesBlock}\n\nLead:\n${leadBlock}\n\nQualify this lead.`;
}