import { Lock } from "lucide-react";
import type { Metadata } from "next";
import { LogoMark } from "@/components/brand/logo";
import { Unamargo } from "@/components/marca";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Iniciar sesión" };

// Pantalla publica y estatica a proposito: no consulta la base. Si Postgres
// esta caido, el formulario igual se pinta y el error aparece al enviar, en vez
// de que la pantalla entera falle.
//
// Unica pantalla oscura del producto. El resto del ERP es claro porque se mira
// ocho horas seguidas; el login son cinco segundos y hace de puerta. Los
// tokens salen del bloque .dark, con los mismos contrastes medidos.
//
// La marca que encabeza es la del CLIENTE, no la de Surlabs: quien entra por
// esta puerta es el personal de Un Amargo, a su propio sistema. Surlabs queda
// como credito de proveedor abajo, que es el lugar que le corresponde.
//
// El nombre va escrito y no sale de `settings` a proposito: esta pantalla no
// consulta la base (ver arriba), y el isotipo del cliente ya esta fijo en el
// repo, asi que la palabra no lo hace menos general de lo que ya era.
export default function LoginPage() {
  return (
    <div className="dark flex min-h-dvh flex-col bg-background text-foreground">
      <header className="border-b border-border">
        <div className="mx-auto flex h-16 w-full max-w-5xl items-center px-6">
          <span className="flex items-center gap-2.5">
            <Unamargo className="h-6 w-auto shrink-0" />
            <span className="type-display text-[1.15rem] uppercase">
              Un Amargo
            </span>
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
            className="mb-6 size-6 text-muted-foreground"
          />
          <h1 className="type-display text-2xl">
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

      <footer className="border-t border-border">
        <div className="mx-auto flex h-14 w-full max-w-5xl items-center gap-2 px-6 text-xs text-muted-foreground">
          <LogoMark className="size-4 shrink-0" />
          <span>Un sistema de Surlabs</span>
        </div>
      </footer>
    </div>
  );
}
