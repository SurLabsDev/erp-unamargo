"use client";

import { useState } from "react";
import { toast } from "sonner";
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
import { MAX_PERCENTAGE, MIN_PERCENTAGE } from "@/lib/domain/discounts";
import { updateCampaignAction } from "../actions";

export function CampaignEditForm(props: {
  campaignId: string;
  name: string;
  percentage: number;
  startsOn: string;
  endsOn: string;
}) {
  const { campaignId, name, percentage, startsOn, endsOn } = props;
  const [saving, setSaving] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    const result = await updateCampaignAction(
      campaignId,
      new FormData(event.currentTarget),
    );
    setSaving(false);
    if (result.ok) toast.success(result.message);
    else toast.error(result.error);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Editar campaña</CardTitle>
        <CardDescription>
          Cambiá el nombre, el porcentaje o las fechas. Los objetivos de abajo
          no se ven afectados.
        </CardDescription>
      </CardHeader>

      <CardContent>
        <form
          onSubmit={handleSubmit}
          className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 lg:items-end"
        >
          <div className="grid gap-2">
            <Label htmlFor="edit-campaign-name">Nombre</Label>
            <Input
              id="edit-campaign-name"
              name="name"
              maxLength={80}
              defaultValue={name}
              required
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="edit-campaign-percentage">Porcentaje</Label>
            <Input
              id="edit-campaign-percentage"
              name="percentage"
              type="number"
              inputMode="numeric"
              min={MIN_PERCENTAGE}
              max={MAX_PERCENTAGE}
              defaultValue={percentage}
              required
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="edit-campaign-starts">Desde</Label>
            <Input
              id="edit-campaign-starts"
              name="startsOn"
              type="date"
              defaultValue={startsOn}
              required
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="edit-campaign-ends">Hasta</Label>
            <Input
              id="edit-campaign-ends"
              name="endsOn"
              type="date"
              defaultValue={endsOn}
              required
            />
          </div>
          <div className="sm:col-span-2 lg:col-span-4">
            <Button type="submit" size="sm" disabled={saving}>
              {saving ? "Guardando…" : "Guardar cambios"}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
