// src/proxy.ts

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

// Simple in‑memory rate limiter (per instance)
// For production with multiple pods, use Redis (Upstash / Valkey)
const rateLimit = new Map<string, { count: number; resetTime: number }>();

const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000; // 15 minutes
const RATE_LIMIT_MAX = 100; // 100 requests per window

export function proxy(request: NextRequest) {
  const response = NextResponse.next();

  // 1. CSP headers (Helmet style)
  const csp = [
    "default-src 'self'",
    "script-src 'self' 'unsafe-eval' 'unsafe-inline' https://static.cloudflareinsights.com", // unsafe-inline required for shadcn/ui dev
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    "img-src 'self' data: https://meta-crm.sarrast.cloud",
    "connect-src 'self' https://static.cloudflareinsights.com",
    "frame-ancestors 'none'",
    "form-action 'none'",
  ].join("; ");
  response.headers.set("Content-Security-Policy", csp);

  // 2. CORS (allow any origin – adjust to your domain in production)
  response.headers.set("Access-Control-Allow-Origin", "*");
  response.headers.set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  response.headers.set("Access-Control-Allow-Headers", "Content-Type, Authorization");

  // 3. Rate limiting (based on real IP)
  const ip =
    request.headers.get("x-forwarded-for") ?? request.headers.get("x-forwarded-for")?.split(",")[0] ?? "anonymous";

  const now = Date.now();
  const record = rateLimit.get(ip);

  if (record && now < record.resetTime) {
    if (record.count >= RATE_LIMIT_MAX) {
      return new NextResponse("Too Many Requests", { status: 429 });
    }
    record.count++;
  } else {
    rateLimit.set(ip, { count: 1, resetTime: now + RATE_LIMIT_WINDOW_MS });
  }

  return response;
}

export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - public folder
     */
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
