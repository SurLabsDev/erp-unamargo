"use client";

import { useState } from "react";
import { toast } from "sonner";
import { changeOwnPasswordAction } from "@/app/(app)/configuracion/actions";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function ChangePasswordDialog(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { open, onOpenChange } = props;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        {open ? <ChangePasswordForm onClose={() => onOpenChange(false)} /> : null}
      </DialogContent>
    </Dialog>
  );
}

function ChangePasswordForm(props: { onClose: () => void }) {
  const { onClose } = props;
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    const result = await changeOwnPasswordAction(
      new FormData(event.currentTarget),
    );
    setSubmitting(false);
    if (result.ok) {
      toast.success(result.message);
      onClose();
    } else {
      setError(result.error);
    }
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>Cambiar contraseña</DialogTitle>
        <DialogDescription>Mínimo 8 caracteres.</DialogDescription>
      </DialogHeader>
      <form onSubmit={handleSubmit} className="grid gap-4">
        <div className="grid gap-2">
          <Label htmlFor="current-password">Contraseña actual</Label>
          <Input
            id="current-password"
            name="current"
            type="password"
            autoComplete="current-password"
            required
            autoFocus
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="new-password">Contraseña nueva</Label>
          <Input
            id="new-password"
            name="next"
            type="password"
            autoComplete="new-password"
            minLength={8}
            maxLength={100}
            required
          />
        </div>
        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={onClose}
            disabled={submitting}
          >
            Cancelar
          </Button>
          <Button type="submit" disabled={submitting}>
            {submitting ? "Guardando…" : "Guardar"}
          </Button>
        </DialogFooter>
      </form>
    </>
  );
}
