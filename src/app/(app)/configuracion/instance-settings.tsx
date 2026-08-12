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
import {
  updateAlertRecipientsAction,
  updateBalanceSettingsAction,
} from "./actions";

export function InstanceSettings(props: {
  companyName: string;
  currencyCode: string;
  timezone: string;
  initialBalance: string;
  initialBalanceDate: string;
  todayISO: string;
  alertRecipients: string[];
  emailConfigured: boolean;
}) {
  const {
    companyName,
    currencyCode,
    timezone,
    initialBalance,
    initialBalanceDate,
    todayISO,
    alertRecipients,
    emailConfigured,
  } = props;
  const [savingBalance, setSavingBalance] = useState(false);
  const [savingRecipients, setSavingRecipients] = useState(false);

  async function handleBalance(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (savingBalance) return;
    setSavingBalance(true);
    const result = await updateBalanceSettingsAction(
      new FormData(event.currentTarget),
    );
    setSavingBalance(false);
    if (result.ok) toast.success(result.message);
    else toast.error(result.error);
  }

  async function handleRecipients(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (savingRecipients) return;
    setSavingRecipients(true);
    const result = await updateAlertRecipientsAction(
      new FormData(event.currentTarget),
    );
    setSavingRecipients(false);
    if (result.ok) toast.success(result.message);
    else toast.error(result.error);
  }

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Instancia</CardTitle>
          <CardDescription>
            Datos fijos de la instancia (se definen en el despliegue) y saldo
            inicial del balance.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          <dl className="grid grid-cols-3 gap-3 text-sm">
            <div>
              <dt className="text-xs text-muted-foreground">Empresa</dt>
              <dd className="font-medium">{companyName}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Moneda</dt>
              <dd className="font-medium">{currencyCode}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Zona horaria</dt>
              <dd className="font-medium">{timezone}</dd>
            </div>
          </dl>
          <form onSubmit={handleBalance} className="grid gap-3 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor="initial-balance">Saldo inicial</Label>
              <Input
                id="initial-balance"
                name="initialBalance"
                inputMode="decimal"
                defaultValue={initialBalance.replace(".", ",")}
                required
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="initial-date">Fecha de corte</Label>
              <Input
                id="initial-date"
                name="initialBalanceDate"
                type="date"
                defaultValue={initialBalanceDate}
                max={todayISO}
                required
              />
            </div>
            <p className="col-span-full text-xs text-muted-foreground">
              Al cambiarlo, todos los saldos por período se recalculan. No puede
              haber movimientos con fecha anterior a la fecha de corte.
            </p>
            <div className="col-span-full">
              <Button type="submit" size="sm" disabled={savingBalance}>
                {savingBalance ? "Guardando…" : "Guardar saldo inicial"}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Alertas de stock</CardTitle>
          <CardDescription>
            Hasta 3 destinatarios reciben el aviso de stock bajo por correo.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          {!emailConfigured ? (
            <p className="rounded-md border border-dashed px-3 py-2 text-xs text-muted-foreground">
              Las alertas por correo no están operativas: falta configurar el
              envío (RESEND_API_KEY / EMAIL_FROM). El indicador de stock bajo
              del panel funciona igual.
            </p>
          ) : null}
          <form onSubmit={handleRecipients} className="grid gap-3">
            {[0, 1, 2].map((index) => (
              <div key={index} className="grid gap-2">
                <Label htmlFor={`recipient-${index + 1}`}>
                  Destinatario {index + 1}
                </Label>
                <Input
                  id={`recipient-${index + 1}`}
                  name={`recipient${index + 1}`}
                  type="email"
                  defaultValue={alertRecipients[index] ?? ""}
                  placeholder="nombre@empresa.uy"
                />
              </div>
            ))}
            <div>
              <Button type="submit" size="sm" disabled={savingRecipients}>
                {savingRecipients ? "Guardando…" : "Guardar destinatarios"}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
