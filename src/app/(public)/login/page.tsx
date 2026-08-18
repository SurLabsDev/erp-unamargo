import type { Metadata } from "next";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Iniciar sesión" };

// Pantalla publica y estatica a proposito: no consulta la base. Si Postgres
// esta caido, el formulario igual se pinta y el error aparece al enviar, en vez
// de que la pantalla entera falle.
export default function LoginPage() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center bg-muted px-4 py-12">
      <div className="w-full max-w-[24rem]">
        <p className="mb-8 font-mono text-[0.6875rem] tracking-[0.22em] text-muted-foreground uppercase">
          Surlabs <span className="text-border">/</span> ERP
        </p>

        <LoginForm />

        {/* La recuperacion de contrasena por email esta fuera de alcance, asi
            que un link "olvide mi contrasena" seria un callejon sin salida.
            Lo que corresponde es decir que se hace en su lugar. */}
        <p className="mt-6 text-sm leading-relaxed text-muted-foreground">
          ¿No podés entrar? Un administrador de la instancia puede generarte una
          contraseña nueva desde Configuración.
        </p>
      </div>
    </main>
  );
}
