import type { NextAuthConfig } from "next-auth";

// Edge-safe config shared with proxy.ts: NO db, NO bcrypt imports here.
// The Credentials provider (which needs both) is added only in auth.ts.
export const authConfig = {
  // Required off-Vercel (local prod, previews behind proxies). On Vercel the
  // platform env is detected anyway; the host header is safe in both cases.
  trustHost: true,
  pages: { signIn: "/login" },
  session: {
    strategy: "jwt",
    maxAge: 30 * 24 * 60 * 60, // 30 days
  },
  providers: [],
  callbacks: {
    authorized({ auth }) {
      // Unauthenticated requests to protected routes get redirected to /login.
      return !!auth?.user;
    },
    jwt({ token, user }) {
      if (user) {
        token.id = user.id;
        token.role = user.role;
      }
      return token;
    },
    session({ session, token }) {
      session.user.id = token.id as string;
      session.user.role = token.role as "admin" | "operator";
      return session;
    },
  },
} satisfies NextAuthConfig;
