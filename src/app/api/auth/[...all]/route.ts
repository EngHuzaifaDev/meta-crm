import { toNextJsHandler } from "better-auth/next-js";

let handler: { POST: (req: Request) => Promise<Response>; GET: (req: Request) => Promise<Response> } | null = null;

async function getHandler() {
  if (handler) return handler;
  const { getAuth } = await import("@/lib/auth");
  const auth = await getAuth();
  handler = toNextJsHandler(auth);
  return handler;
}

export async function POST(req: Request) {
  const h = await getHandler();
  return h.POST(req);
}

export async function GET(req: Request) {
  const h = await getHandler();
  return h.GET(req);
}
