import { betterAuth } from "better-auth";
import { mongodbAdapter } from "better-auth/adapters/mongodb";
import { nextCookies } from "better-auth/next-js";

let _auth: any = null;

export async function getAuth() {
  if (_auth) return _auth as any;
  const { connectDb } = await import("./db/mongodb");
  const db = await connectDb();
  _auth = betterAuth({
    database: mongodbAdapter(db),
    emailAndPassword: { enabled: true },
    security: {
      preventBruteForce: true,
      sessionExpiryDays: 30,
      secret: process.env.BETTER_AUTH_SECRET!,
    },
    plugins: [nextCookies()],
    user: {
      additionalFields: {
        role: {
          type: "number",
          defaultValue: 1,
          input: false,
        },
        industry: {
          type: "string",
          required: false,
          input: true,
        },
        avatar: {
          type: "string",
          defaultValue: "https://avatars.githubusercontent.com/u/43849669?v=4",
          input: false,
        },
      },
    },
  });
  return _auth;
}
