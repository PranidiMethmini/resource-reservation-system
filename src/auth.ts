import NextAuth, { CredentialsSignin } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { loginSchema } from "@/lib/auth-validation";
import { prisma } from "@/lib/prisma";
import { checkLoginLimit } from "@/lib/auth-rate-limit";
import { authLimitCode, recordAuthLimitFailure, type AuthLimitResult } from "@/lib/auth-rate-limit-response";

class LimitedCredentialsSignin extends CredentialsSignin {
  constructor(result: Extract<AuthLimitResult, { allowed: false }>) {
    super();
    this.code = authLimitCode(result);
  }
}

// Public timing-only hash, never an account credential. Missing users still
// perform a cost-12 comparison before receiving the same invalid-login result.
const missingUserHash = "$2b$12$rONmjMAKb21GA0mRby5dlevXKMhNP4xZNVQj.T7oOza4pm3xexCiG";

export const { handlers, auth, signIn, signOut } = NextAuth({
  debug: false,
  logger: {
    error() { console.error("Authentication failed; details suppressed."); },
  },
  session: {
    strategy: "jwt",
  },

  providers: [
    Credentials({
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },

      async authorize(credentials, request) {
        const limit = await checkLoginLimit(request, credentials.email);
        if (!limit.allowed) {
          recordAuthLimitFailure(limit);
          throw new LimitedCredentialsSignin(limit);
        }

        const parsed = loginSchema.safeParse(credentials);

        if (!parsed.success) {
          return null;
        }

        const { email, password } = parsed.data;

        const user = await prisma.user.findUnique({
          where: {
            email: email.toLowerCase(),
          },
        });

        const passwordMatches = await bcrypt.compare(
          password,
          user?.passwordHash ?? missingUserHash
        );

        if (!user || !passwordMatches) {
          return null;
        }

        return {
          id: user.id,
          name: user.name,
          email: user.email,
        };
      },
    }),
  ],

  pages: {
    signIn: "/login",
  },
});
