import { type NextRequest, NextResponse } from "next/server";

import { getActiveCredentials } from "@/lib/db/utils/instagram";
import { extractFollowers } from "@/server/instagram/extractor";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { profileUsername, credentialId, maxFollowers } = body;

    if (!profileUsername) {
      return NextResponse.json({ error: "profileUsername is required" }, { status: 400 });
    }

    const { searchParams } = new URL(request.url);
    const credId = credentialId || searchParams.get("credentialId");

    let credentials: { username: string; password: string } | null = null;

    if (credId) {
      const allCreds = await getActiveCredentials();
      const found = allCreds.find((c) => String(c._id) === credId);
      if (found) {
        credentials = {
          username: found.instagramUsername,
          password: found.encryptedPassword,
        };
      }
    }

    if (!credentials) {
      return NextResponse.json({ error: "No valid Instagram credentials found" }, { status: 400 });
    }

    const result = await extractFollowers({
      credentials,
      targetProfile: profileUsername,
      maxFollowers,
    });

    return NextResponse.json(result);
  } catch (error: any) {
    return NextResponse.json({ error: error.message || "Internal server error" }, { status: 500 });
  }
}
