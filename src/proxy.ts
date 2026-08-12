import NextAuth from "next-auth";
import { authConfig } from "@/lib/auth.config";

// Protects everything except /login, /api/auth/* (Auth.js), /api/public/*
// (read-only public stock API) and static assets. Full checks (is_active,
// role) happen server-side on every page/action via requireUser().
export default NextAuth(authConfig).auth;

export const config = {
  matcher: [
    "/((?!login|api/auth|api/public|_next/static|_next/image|favicon.ico).*)",
  ],
};
