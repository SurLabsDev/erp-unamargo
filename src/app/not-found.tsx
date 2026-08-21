import Link from "next/link";
import { Button } from "@/components/ui/button";

// Spanish 404 (§11): Next's built-in one is in English.
export default function NotFoundPage() {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-4 p-6 text-center">
      <p className="text-sm font-semibold uppercase tracking-[0.2em] text-muted-foreground">
        404
      </p>
      <h1 className="type-display text-xl">
        Página no encontrada
      </h1>
      <p className="max-w-sm text-sm text-muted-foreground">
        La página que buscás no existe o fue movida.
      </p>
      <Button asChild variant="outline" size="sm">
        <Link href="/">Volver al panel</Link>
      </Button>
    </div>
  );
}
