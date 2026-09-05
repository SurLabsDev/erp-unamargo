"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { loginAction, type LoginState } from "./actions";

export function LoginForm() {
  const [state, formAction, isPending] = useActionState<LoginState, FormData>(
    loginAction,
    undefined,
  );
  const hayError = Boolean(state?.error);
  const [aLaVista, setALaVista] = useState(false);
  const passwordRef = useRef<HTMLInputElement>(null);

  // Tras un intento fallido el foco va a la contraseña, no al mail: el mail
  // quedo puesto y lo que hay que volver a escribir es lo otro. `autoFocus`
  // no sirve para esto, porque solo actua al montar y aca el formulario no se
  // vuelve a montar.
  //
  // La dependencia es `state` y no `hayError`: al segundo intento fallido el
  // booleano vale lo mismo que antes y el efecto no correria, justo cuando mas
  // falta hace.
  useEffect(() => {
    if (state?.error) passwordRef.current?.focus();
  }, [state]);

  return (
    // Sin tarjeta: el formulario se apoya directo sobre el fondo. Una tarjeta
    // dentro de una pantalla que ya es solo este formulario no delimita nada.
    // design.md §7: el espaciado sale de la escala corta. gap-6 entre campos,
    // gap-2 entre etiqueta e input. Dos numeros.
    <form action={formAction} className="flex flex-col">
      <div className="flex flex-col gap-6">
        <div className="flex flex-col gap-2">
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            required
            autoFocus
            // Errar la contraseña no puede costar volver a escribir el mail.
            // React limpia los campos de un formulario no controlado cuando
            // termina la accion, asi que el valor se repone desde lo que la
            // accion devuelve.
            defaultValue={state?.email}
            aria-invalid={hayError || undefined}
            aria-describedby="login-error"
            className="h-10 bg-card"
          />
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="password">Contraseña</Label>
          <div className="relative">
            <Input
              ref={passwordRef}
              id="password"
              name="password"
              type={aLaVista ? "text" : "password"}
              autoComplete="current-password"
              required
              aria-invalid={hayError || undefined}
              aria-describedby="login-error"
              className="h-10 bg-card pr-10"
            />
            {/* El ojito. `type="button"` es obligatorio: dentro de un form, un
                boton sin type manda el formulario, asi que mirar la contraseña
                intentaria entrar. La etiqueta dice la ACCION y cambia con el
                estado, que es lo que anuncia un lector de pantalla al tocarlo. */}
            <button
              type="button"
              onClick={() => setALaVista((v) => !v)}
              aria-label={aLaVista ? "Ocultar contraseña" : "Mostrar contraseña"}
              aria-controls="password"
              className="absolute inset-y-0 right-0 flex w-10 items-center justify-center text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 rounded-r-md"
            >
              {aLaVista ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
            </button>
          </div>
          {/* design.md §6: el slot de error existe SIEMPRE en el markup, aun
              vacio, para que el boton no se corra hacia abajo justo cuando el
              usuario va a hacerle clic. Va pegado al input, en el lugar de una
              linea de ayuda: suelto entre los campos y el boton dejaba un
              hueco que se leia como algo roto. */}
          <p
            id="login-error"
            role="alert"
            aria-live="polite"
            className="min-h-5 text-sm text-destructive"
          >
            {state?.error}
          </p>
        </div>
      </div>

      <Button type="submit" disabled={isPending} className="mt-3 h-10 w-full">
        {isPending ? "Ingresando…" : "Ingresar"}
      </Button>
    </form>
  );
}
