import type { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      role: "admin" | "operator";
    } & DefaultSession["user"];
  }

  interface User {
    role: "admin" | "operator";
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    id?: string;
    role?: "admin" | "operator";
  }
}
