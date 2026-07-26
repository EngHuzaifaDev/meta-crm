import type { NextRequest } from "next/server";

import { getActiveCredentials } from "@/lib/db/utils/instagram";
import { extractFollowersStream } from "@/server/instagram/streaming-extractor";

export const maxDuration = 300;

function encoder() {
  const textEncoder = new TextEncoder();
  return {
    encode(data: string) {
      return textEncoder.encode(data);
    },
  };
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  const { usernames, credentialId } = body as {
    usernames: string[];
    credentialId?: string;
  };

  if (!usernames?.length) {
    return new Response(JSON.stringify({ error: "usernames required" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const activeCreds = await getActiveCredentials();
  const cred = credentialId ? activeCreds.find((c) => String(c._id) === credentialId) : activeCreds[0];

  if (!cred) {
    return new Response(JSON.stringify({ error: "No active credentials" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const stream = new ReadableStream({
    async start(controller) {
      const { encode } = encoder();

      const send = (event: string, data: unknown) => {
        controller.enqueue(encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      };

      try {
        await extractFollowersStream(
          {
            username: cred.instagramUsername,
            password: cred.encryptedPassword,
          },
          usernames,
          (progress) => {
            send("progress", progress);
          },
        );
      } catch (error: any) {
        send("error", { error: error.message });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
