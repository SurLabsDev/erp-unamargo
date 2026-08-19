"use client";

import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  MAX_PERCENTAGE,
  MIN_PERCENTAGE,
  type CampaignState,
} from "@/lib/domain/discounts";
import { formatDate } from "@/lib/format";
import { createCampaignAction, setCampaignActiveAction } from "./actions";
import type { CampaignListRow } from "./queries";

const STATE_LABELS: Record<CampaignState, string> = {
  active: "Activa",
  scheduled: "Programada",
  ended: "Terminada",
  paused: "Pausada",
};

export function CampaignsManager(props: { campaigns: CampaignListRow[] }) {
  const { campaigns } = props;
  const [creating, setCreating] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  async function handleCreate(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (creating) return;
    setCreating(true);
    const form = event.currentTarget;
    const result = await createCampaignAction(new FormData(form));
    setCreating(false);
    if (result.ok) {
      toast.success(result.message);
      form.reset();
    } else {
      toast.error(result.error);
    }
  }

  async function handleToggle(campaign: CampaignListRow) {
    if (busyId) return;
    setBusyId(campaign.id);
    const result = await setCampaignActiveAction(
      campaign.id,
      !campaign.isActive,
    );
    setBusyId(null);
    if (result.ok) toast.success(result.message);
    else toast.error(result.error);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Campañas</CardTitle>
        <CardDescription>
          El estado se calcula solo a partir de las fechas y de si está
          pausada. Después de crear una campaña, entrá en ella para elegir a
          qué productos, subtipos o categorías aplica.
        </CardDescription>
      </CardHeader>

      <CardContent className="grid gap-4">
        {campaigns.length === 0 ? (
          <p className="rounded-md border border-dashed px-3 py-6 text-center text-sm text-muted-foreground">
            Todavía no hay campañas. Creá la primera abajo y después elegí a
            qué productos o categorías aplica.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nombre</TableHead>
                  <TableHead>Porcentaje</TableHead>
                  <TableHead>Período</TableHead>
                  <TableHead>Estado</TableHead>
                  <TableHead>Objetivos</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {campaigns.map((campaign) => (
                  <TableRow key={campaign.id}>
                    <TableCell>
                      <Link
                        href={`/descuentos/${campaign.id}`}
                        className="font-medium underline-offset-4 hover:underline"
                      >
                        {campaign.name}
                      </Link>
                    </TableCell>
                    <TableCell className="tabular-nums">
                      {campaign.percentage}%
                    </TableCell>
                    <TableCell className="whitespace-nowrap">
                      {formatDate(campaign.startsOn)} a{" "}
                      {formatDate(campaign.endsOn)}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={
                          campaign.state === "active" ? "default" : "secondary"
                        }
                      >
                        {STATE_LABELS[campaign.state]}
                      </Badge>
                    </TableCell>
                    <TableCell className="tabular-nums">
                      {campaign.targetCount}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-right">
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={busyId === campaign.id}
                        onClick={() => void handleToggle(campaign)}
                      >
                        {campaign.isActive ? "Pausar" : "Reactivar"}
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}

        <form
          onSubmit={handleCreate}
          className="grid gap-4 border-t pt-4 sm:grid-cols-2 lg:grid-cols-4 lg:items-end"
        >
          <div className="grid gap-2">
            <Label htmlFor="campaign-name">Nombre</Label>
            <Input
              id="campaign-name"
              name="name"
              maxLength={80}
              required
              placeholder="Ej: Descuento de verano"
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="campaign-percentage">Porcentaje</Label>
            <Input
              id="campaign-percentage"
              name="percentage"
              type="number"
              inputMode="numeric"
              min={MIN_PERCENTAGE}
              max={MAX_PERCENTAGE}
              required
              placeholder="30"
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="campaign-starts">Desde</Label>
            <Input id="campaign-starts" name="startsOn" type="date" required />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="campaign-ends">Hasta</Label>
            <Input id="campaign-ends" name="endsOn" type="date" required />
          </div>
          <div className="sm:col-span-2 lg:col-span-4">
            <Button type="submit" size="sm" disabled={creating}>
              {creating ? "Creando…" : "Crear campaña"}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
