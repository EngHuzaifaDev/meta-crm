import { NextRequest, NextResponse } from 'next/server';
import { resolveChallenge } from '@/server/instagram/challenges';

export async function POST(request: NextRequest) {
  const body = await request.json();
  const { credentialId, code } = body as {
    credentialId: string;
    code: string;
  };

  if (!credentialId || !code) {
    return NextResponse.json(
      { error: 'credentialId and code required' },
      { status: 400 },
    );
  }

  const resolved = resolveChallenge(credentialId, code);
  if (!resolved) {
    return NextResponse.json(
      { error: 'No pending 2FA challenge for this credential' },
      { status: 404 },
    );
  }

  return NextResponse.json({ success: true });
}
