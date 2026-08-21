"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/button";

// Global error boundary (§11): generic Spanish message, never a stack trace.
export default function ErrorPage(props: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const { error, reset } = props;

  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-4 p-6 text-center">
      <p className="text-sm font-semibold uppercase tracking-[0.2em] text-muted-foreground">
        Error
      </p>
      <h1 className="type-display text-xl">
        Ocurrió un error, intentá de nuevo.
      </h1>
      <p className="max-w-sm text-sm text-muted-foreground">
        Si el problema persiste, avisale al administrador de la instancia.
      </p>
      <Button onClick={reset} variant="outline" size="sm">
        Intentar de nuevo
      </Button>
    </div>
  );
}
