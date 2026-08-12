"use server";

import { AuthError } from "next-auth";
import { signIn } from "@/lib/auth";

export type LoginState = { error: string } | undefined;

export async function loginAction(
  _prevState: LoginState,
  formData: FormData,
): Promise<LoginState> {
  try {
    await signIn("credentials", {
      email: String(formData.get("email") ?? ""),
      password: String(formData.get("password") ?? ""),
      redirectTo: "/",
    });
    return undefined; // unreachable: signIn redirects on success
  } catch (error) {
    if (error instanceof AuthError) {
      // Single generic message on purpose: never reveal which field failed.
      return { error: "Email o contraseña incorrectos" };
    }
    throw error; // NEXT_REDIRECT and unexpected errors propagate
  }
}
