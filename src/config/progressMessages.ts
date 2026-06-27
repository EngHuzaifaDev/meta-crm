// server/groq/progressMessages.ts
export const progressMessages: Record<string, string> = {
    queued: "Waiting in queue…",
    scraping: "Visiting the lead’s website to gather intelligence…",
    qualifying: "Our AI is analyzing the lead against your services…",
    done: "Qualification complete!",
    error: "Something went wrong. Please try again later.",
};