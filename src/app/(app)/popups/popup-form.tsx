"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  MAX_BODY_LENGTH,
  MAX_CTA_LABEL_LENGTH,
  MAX_CTA_URL_LENGTH,
  MAX_TITLE_LENGTH,
} from "@/lib/domain/popups";
import { createPopupAction, updatePopupAction } from "./actions";

export type PopupFormValues = {
  title: string;
  body: string | null;
  ctaLabel: string | null;
  ctaUrl: string | null;
  startsOn: string | null;
  endsOn: string | null;
};

/**
 * El mismo formulario para crear (sin `popupId`) y para editar. La validacion
 * que manda es la del servidor (`popupInputSchema`); los `maxLength` de aca
 * solo evitan tipear de mas.
 */
export function PopupForm(props: {
  popupId?: string;
  initial?: PopupFormValues;
}) {
  const { popupId, initial } = props;
  const editing = popupId !== undefined;
  const prefix = editing ? "edit-popup" : "new-popup";
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    setError(null);
    const form = event.currentTarget;
    const formData = new FormData(form);
    const result = editing
      ? await updatePopupAction(popupId, formData)
      : await createPopupAction(formData);
    setSaving(false);
    if (result.ok) {
      toast.success(result.message);
      if (!editing) form.reset();
    } else {
      setError(result.error);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="grid gap-4">
      <div className="grid gap-2">
        <Label htmlFor={`${prefix}-title`}>Título</Label>
        <Input
          id={`${prefix}-title`}
          name="title"
          maxLength={MAX_TITLE_LENGTH}
          required
          defaultValue={initial?.title ?? ""}
          placeholder="Ej: Envíos gratis todo noviembre"
        />
      </div>

      <div className="grid gap-2">
        <Label htmlFor={`${prefix}-body`}>Texto</Label>
        <Textarea
          id={`${prefix}-body`}
          name="body"
          rows={3}
          maxLength={MAX_BODY_LENGTH}
          defaultValue={initial?.body ?? ""}
        />
        <p className="text-xs text-muted-foreground">
          Opcional. Texto plano: se respetan los saltos de línea, no el
          formato.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="grid gap-2">
          <Label htmlFor={`${prefix}-cta-label`}>Texto del botón</Label>
          <Input
            id={`${prefix}-cta-label`}
            name="ctaLabel"
            maxLength={MAX_CTA_LABEL_LENGTH}
            defaultValue={initial?.ctaLabel ?? ""}
            placeholder="Ej: Ver la tienda"
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor={`${prefix}-cta-url`}>Link del botón</Label>
          {/* type="text" y no "url": el navegador rechazaria un ancla como
              #tienda, que es justo uno de los dos casos validos. */}
          <Input
            id={`${prefix}-cta-url`}
            name="ctaUrl"
            inputMode="url"
            autoComplete="off"
            spellCheck={false}
            maxLength={MAX_CTA_URL_LENGTH}
            defaultValue={initial?.ctaUrl ?? ""}
            placeholder="https://… o #tienda"
          />
        </div>
        <p className="text-xs text-muted-foreground sm:col-span-2">
          Opcional: sin texto ni link, el pop-up va sin botón. El link tiene
          que empezar con https:// o ser una sección de la web, como #tienda.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="grid gap-2">
          <Label htmlFor={`${prefix}-starts`}>Desde</Label>
          <Input
            id={`${prefix}-starts`}
            name="startsOn"
            type="date"
            defaultValue={initial?.startsOn ?? ""}
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor={`${prefix}-ends`}>Hasta</Label>
          <Input
            id={`${prefix}-ends`}
            name="endsOn"
            type="date"
            defaultValue={initial?.endsOn ?? ""}
          />
        </div>
        <p className="text-xs text-muted-foreground sm:col-span-2">
          Opcionales, y los dos días cuentan. Sin fechas, se muestra mientras
          esté encendido.
        </p>
      </div>

      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}

      <div>
        <Button type="submit" size="sm" disabled={saving}>
          {editing
            ? saving
              ? "Guardando…"
              : "Guardar cambios"
            : saving
              ? "Creando…"
              : "Crear pop-up"}
        </Button>
      </div>
    </form>
  );
}
