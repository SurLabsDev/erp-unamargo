"use server";

import { AuthError } from "next-auth";
import { signIn } from "@/lib/auth";

/** El mail viaja de vuelta para reponerlo en el formulario. La contraseña NO:
 *  un dato que no vuelve al navegador no se puede filtrar en el HTML ni quedar
 *  en el historial de un action, y de todas formas hay que volver a tipearla. */
export type LoginState = { error: string; email: string } | undefined;

export async function loginAction(
  _prevState: LoginState,
  formData: FormData,
): Promise<LoginState> {
  const email = String(formData.get("email") ?? "");
  try {
    await signIn("credentials", {
      email,
      password: String(formData.get("password") ?? ""),
      redirectTo: "/",
    });
    return undefined; // unreachable: signIn redirects on success
  } catch (error) {
    if (error instanceof AuthError) {
      // Single generic message on purpose: never reveal which field failed.
      return { error: "Email o contraseña incorrectos", email };
    }
    throw error; // NEXT_REDIRECT and unexpected errors propagate
  }
}
