import { NextRequest, NextResponse } from 'next/server';
import { headers } from 'next/headers';
import { auth } from '@/lib/auth';
import { getCredentialById } from '@/lib/db/utils/instagram';
import { createDriver } from '@/server/instagram/driver';
import { loginToInstagram } from '@/server/instagram/login';

export const maxDuration = 60;

export async function POST(request: NextRequest) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session || session.user.role !== 0) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }

  const body = await request.json();
  const { credentialId } = body as { credentialId: string };

  if (!credentialId) {
    return NextResponse.json({ error: 'credentialId required' }, { status: 400 });
  }

  const cred = await getCredentialById(credentialId);
  if (!cred) {
    return NextResponse.json({ error: 'Credential not found' }, { status: 404 });
  }

  const driver = await createDriver();
  try {
    const result = await loginToInstagram(driver, {
      username: cred.instagramUsername,
      password: cred.encryptedPassword,
      credentialId,
      existingCookies: cred.session?.cookies,
    });

    if (result.needs2FA) {
      return NextResponse.json({ success: false, needs2FA: true, message: '2FA code required' });
    }

    return NextResponse.json({
      success: result.success,
      message: result.success ? 'Login successful — session saved' : result.error,
      error: result.error,
    });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  } finally {
    await driver.quit();
  }
}
