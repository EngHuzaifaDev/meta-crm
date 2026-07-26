// lib/auth.ts
import { betterAuth } from "better-auth";
import { mongodbAdapter } from "better-auth/adapters/mongodb";
import { nextCookies } from "better-auth/next-js";

import { mongodbInstance } from "./db/mongodb";

export const auth = betterAuth({
  database: mongodbAdapter(mongodbInstance),
  emailAndPassword: { enabled: true },
  security: {
    preventBruteForce: true,
    sessionExpiryDays: 30,
    secret: process.env.BETTER_AUTH_SECRET!,
  },
  plugins: [nextCookies()],

  // Define custom user fields
  user: {
    additionalFields: {
      role: {
        type: "number",
        defaultValue: 1, // 0 = admin, 1 = user
        input: false, // cannot be set by client during sign-up
      },
      industry: {
        type: "string",
        required: false,
        input: true, // clients can supply this field
      },
      avatar: {
        type: "string",
        defaultValue: "https://avatars.githubusercontent.com/u/43849669?v=4",
        input: false,
      },
    },
  },
});
