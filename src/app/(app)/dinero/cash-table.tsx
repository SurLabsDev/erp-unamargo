"use client";

import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { CASH_KIND_LABELS } from "@/lib/domain/money";
import { formatDate, formatMoney } from "@/lib/format";
import { cn } from "@/lib/utils";
import { voidCashMovementAction } from "./actions";
import type { CashRow } from "./queries";

export function CashTable(props: {
  rows: CashRow[];
  currencyCode: string;
  isAdmin: boolean;
  hasFilters: boolean;
  clearFiltersHref: string;
}) {
  const { rows, currencyCode, isAdmin, hasFilters, clearFiltersHref } = props;
  const [voidTarget, setVoidTarget] = useState<CashRow | null>(null);

  if (rows.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed px-6 py-16 text-center">
        {hasFilters ? (
          <>
            <p className="text-sm font-medium">Sin resultados para estos filtros.</p>
            <Button asChild size="sm" variant="outline">
              <Link href={clearFiltersHref}>Limpiar filtros</Link>
            </Button>
          </>
        ) : (
          <>
            <p className="text-sm font-medium">Sin movimientos en este período.</p>
            <p className="text-xs text-muted-foreground">
              Registrá el primero con “Nuevo movimiento”.
            </p>
          </>
        )}
      </div>
    );
  }

  return (
    <>
      <div className="overflow-x-auto rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Fecha</TableHead>
              <TableHead>Tipo</TableHead>
              <TableHead>Categoría</TableHead>
              <TableHead>Concepto</TableHead>
              <TableHead className="text-right">Monto</TableHead>
              <TableHead>Usuario</TableHead>
              {isAdmin ? <TableHead /> : null}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => {
              const voided = row.voidedAt !== null;
              return (
                <TableRow key={row.id} className={voided ? "opacity-70" : ""}>
                  <TableCell
                    className={cn(
                      "whitespace-nowrap tabular-nums",
                      voided && "line-through",
                    )}
                  >
                    {formatDate(row.date)}
                  </TableCell>
                  <TableCell className={voided ? "line-through" : ""}>
                    {CASH_KIND_LABELS[row.kind]}
                  </TableCell>
                  <TableCell className={voided ? "line-through" : ""}>
                    {row.categoryName}
                  </TableCell>
                  <TableCell className="max-w-72">
                    <span className={cn("block truncate", voided && "line-through")}>
                      {row.concept}
                    </span>
                    {voided ? (
                      <span className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
                        <Badge variant="secondary">Anulado</Badge>
                        <span className="truncate">
                          {row.voidedByName}: {row.voidReason}
                        </span>
                      </span>
                    ) : null}
                  </TableCell>
                  <TableCell
                    className={cn(
                      "whitespace-nowrap text-right tabular-nums",
                      voided && "line-through",
                    )}
                  >
                    {row.kind === "income" ? "+" : "−"}
                    {formatMoney(row.amount, currencyCode)}
                  </TableCell>
                  <TableCell
                    className={cn("whitespace-nowrap", voided && "line-through")}
                  >
                    {row.userName}
                  </TableCell>
                  {isAdmin ? (
                    <TableCell className="text-right">
                      {!voided ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setVoidTarget(row)}
                        >
                          Anular
                        </Button>
                      ) : null}
                    </TableCell>
                  ) : null}
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      <Dialog
        open={voidTarget !== null}
        onOpenChange={(open) => !open && setVoidTarget(null)}
      >
        <DialogContent className="sm:max-w-md">
          {voidTarget !== null ? (
            <VoidForm
              key={voidTarget.id}
              row={voidTarget}
              currencyCode={currencyCode}
              onClose={() => setVoidTarget(null)}
            />
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  );
}

function VoidForm(props: {
  row: CashRow;
  currencyCode: string;
  onClose: () => void;
}) {
  const { row, currencyCode, onClose } = props;
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    const result = await voidCashMovementAction(
      row.id,
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
        <DialogTitle>Anular movimiento</DialogTitle>
        <DialogDescription>
          {CASH_KIND_LABELS[row.kind]} de {formatMoney(row.amount, currencyCode)}{" "}
          — “{row.concept}” ({formatDate(row.date)}). El movimiento queda
          visible como anulado y sale de los totales y del export. No se puede
          deshacer: para corregirlo, cargalo de nuevo.
        </DialogDescription>
      </DialogHeader>
      <form onSubmit={handleSubmit} className="grid gap-4">
        <div className="grid gap-2">
          <Label htmlFor="void-reason">Motivo</Label>
          <Textarea
            id="void-reason"
            name="reason"
            rows={2}
            maxLength={300}
            required
            placeholder="p. ej., cargado dos veces"
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
          <Button type="submit" variant="destructive" disabled={submitting}>
            {submitting ? "Anulando…" : "Anular"}
          </Button>
        </DialogFooter>
      </form>
    </>
  );
}
