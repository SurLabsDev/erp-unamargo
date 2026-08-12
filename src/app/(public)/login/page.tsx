import type { Metadata } from "next";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Iniciar sesión" };

export default function LoginPage() {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-8 p-4">
      <p className="text-sm font-semibold uppercase tracking-[0.2em] text-muted-foreground">
        Surlabs
      </p>
      <LoginForm />
    </div>
  );
}
