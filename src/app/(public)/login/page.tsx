import { Lock } from "lucide-react";
import type { Metadata } from "next";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Iniciar sesión" };

// Pantalla publica y estatica a proposito: no consulta la base. Si Postgres
// esta caido, el formulario igual se pinta y el error aparece al enviar, en vez
// de que la pantalla entera falle.
//
// Unica pantalla oscura del producto. El resto del ERP es claro porque se mira
// ocho horas seguidas; el login son cinco segundos y hace de puerta. Los
// tokens salen del bloque .dark, con los mismos contrastes medidos.
export default function LoginPage() {
  return (
    <div className="dark flex min-h-dvh flex-col bg-background text-foreground">
      <header className="border-b border-border">
        <div className="mx-auto flex h-16 w-full max-w-5xl items-center px-6">
          <span className="text-base font-semibold tracking-tight lowercase">
            surlabs
          </span>
          <span className="ml-3 font-mono text-xs tracking-[0.18em] text-muted-foreground uppercase">
            ERP
          </span>
        </div>
      </header>

      <main className="flex flex-1 items-center px-6 py-16">
        <div className="mx-auto w-full max-w-[21rem]">
          <Lock
            aria-hidden
            strokeWidth={1.5}
            className="mb-6 size-6 text-primary"
          />
          <h1 className="text-2xl font-semibold tracking-tight">
            Iniciar sesión
          </h1>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
            Ingresá con el usuario que te asignaron.
          </p>

          <div className="mt-8">
            <LoginForm />
          </div>

          {/* La recuperacion de contrasena por email esta fuera de alcance, asi
              que un link "olvide mi contrasena" seria un callejon sin salida.
              Lo que corresponde es decir que se hace en su lugar. */}
          <p className="mt-6 text-xs leading-relaxed text-muted-foreground">
            ¿No podés entrar? Un administrador de la instancia puede generarte
            una contraseña nueva desde Configuración.
          </p>
        </div>
      </main>
    </div>
  );
}
