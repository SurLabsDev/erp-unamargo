"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { loginAction, type LoginState } from "./actions";

export function LoginForm() {
  const [state, formAction, isPending] = useActionState<LoginState, FormData>(
    loginAction,
    undefined,
  );
  const hayError = Boolean(state?.error);

  return (
    <Card className="gap-6 shadow-sm ring-border [--card-spacing:--spacing(8)]">
      <CardHeader className="gap-2">
        <CardTitle className="text-lg tracking-tight">Iniciar sesión</CardTitle>
        <CardDescription>
          Ingresá con el usuario que te asignaron.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {/* design.md §7: el espaciado sale de la escala corta. gap-6 entre
            campos (24px), gap-2 entre etiqueta e input (8px). Dos numeros. */}
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
                aria-invalid={hayError || undefined}
                aria-describedby="login-error"
                className="h-10"
              />
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="password">Contraseña</Label>
              <Input
                id="password"
                name="password"
                type="password"
                autoComplete="current-password"
                required
                aria-invalid={hayError || undefined}
                aria-describedby="login-error"
                className="h-10"
              />
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

          {/* mt-3 y no gap-6: el slot de error reservado ya aporta una linea,
              y sumarle el gap entre campos dejaba 57px contra los 27px del
              ritmo de la tarjeta. El doble de aire se lee como un hueco. */}
          <Button
            type="submit"
            disabled={isPending}
            className="mt-3 h-10 w-full"
          >
            {isPending ? "Ingresando…" : "Ingresar"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
