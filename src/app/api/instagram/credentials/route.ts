import { headers } from "next/headers";
import { type NextRequest, NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { createCredential, getActiveCredentials } from "@/lib/db/utils/instagram";

export async function GET() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session || session.user.role !== 0) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const creds = await getActiveCredentials();
  const safe = creds.map((c) => ({
    _id: String(c._id),
    instagramUsername: c.instagramUsername,
    isActive: c.isActive,
    createdAt: c.createdAt,
  }));
  return NextResponse.json(safe);
}

export async function POST(request: NextRequest) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session || session.user.role !== 0) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const body = await request.json();
  const { instagramUsername, password } = body as {
    instagramUsername: string;
    password: string;
  };

  if (!instagramUsername || !password) {
    return NextResponse.json({ error: "instagramUsername and password required" }, { status: 400 });
  }

  const cred = await createCredential({
    adminUserId: session.user.id,
    instagramUsername,
    encryptedPassword: password,
    isActive: true,
  });

  return NextResponse.json({
    _id: String(cred._id),
    instagramUsername: cred.instagramUsername,
    isActive: cred.isActive,
  });
}

export async function DELETE(request: NextRequest) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session || session.user.role !== 0) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");
  if (!id) {
    return NextResponse.json({ error: "id required" }, { status: 400 });
  }

  const { mongodbInstance } = await import("@/lib/db/mongodb");
  await mongodbInstance.collection("instagramCredentials").deleteOne({ _id: id as any });

  return NextResponse.json({ success: true });
}
