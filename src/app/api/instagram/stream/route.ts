import { NextRequest } from 'next/server';
import { getActiveCredentials, getCredentialById } from '@/lib/db/utils/instagram';
import { extractFollowersStream } from '@/server/instagram/streaming-extractor';

export const maxDuration = 300;

export async function POST(request: NextRequest) {
  const body = await request.json();
  const { usernames, credentialId } = body as {
    usernames: string[];
    credentialId?: string;
  };

  if (!usernames?.length) {
    return new Response(JSON.stringify({ error: 'usernames required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  let cred;
  if (credentialId) {
    cred = await getCredentialById(credentialId);
  } else {
    const active = await getActiveCredentials();
    cred = active[0];
  }

  if (!cred) {
    return new Response(JSON.stringify({ error: 'No active credentials' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const stream = new ReadableStream({
    async start(controller) {
      const enc = new TextEncoder();
      const send = (event: string, data: unknown) => {
        controller.enqueue(enc.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      };

      try {
        await extractFollowersStream(
          {
            credentials: {
              username: cred.instagramUsername,
              password: cred.encryptedPassword,
            },
            credentialId: String(cred._id),
            existingCookies: cred.session?.cookies,
            usernames,
          },
          (progress) => {
            send('progress', progress);
          },
        );
      } catch (error: any) {
        send('error', { error: error.message });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  });
}
