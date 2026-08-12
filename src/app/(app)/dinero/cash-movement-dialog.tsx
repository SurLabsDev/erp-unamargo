"use client";

import { Plus } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { createCashMovementAction } from "./actions";

type CategoryOption = { id: string; name: string; kind: "income" | "expense" };

export function NewCashMovementButton(props: {
  categories: CategoryOption[];
  todayISO: string;
  minDateISO: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>
        <Plus className="size-4" />
        Nuevo movimiento
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          {open ? (
            <CashMovementForm {...props} onClose={() => setOpen(false)} />
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  );
}

function CashMovementForm(props: {
  categories: CategoryOption[];
  todayISO: string;
  minDateISO: string;
  onClose: () => void;
}) {
  const { categories, todayISO, minDateISO, onClose } = props;
  const [kind, setKind] = useState<"income" | "expense">("income");
  const [categoryId, setCategoryId] = useState<string>("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const kindCategories = categories.filter((c) => c.kind === kind);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    const formData = new FormData(event.currentTarget);
    formData.set("kind", kind);
    formData.set("categoryId", categoryId);
    const result = await createCashMovementAction(formData);
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
        <DialogTitle>Nuevo movimiento de dinero</DialogTitle>
        <DialogDescription>
          Control interno. No reemplaza la contabilidad formal.
        </DialogDescription>
      </DialogHeader>
      <form onSubmit={handleSubmit} className="grid gap-4">
        <div className="grid grid-cols-2 gap-4">
          <div className="grid gap-2">
            <Label>Tipo</Label>
            <Select
              value={kind}
              onValueChange={(value) => {
                setKind(value as "income" | "expense");
                setCategoryId("");
              }}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="income">Ingreso</SelectItem>
                <SelectItem value="expense">Egreso</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="cash-date">Fecha</Label>
            <Input
              id="cash-date"
              name="date"
              type="date"
              defaultValue={todayISO}
              min={minDateISO}
              max={todayISO}
              required
            />
          </div>
        </div>

        <div className="grid gap-2">
          <Label>Categoría</Label>
          <Select value={categoryId} onValueChange={setCategoryId}>
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Elegí una categoría" />
            </SelectTrigger>
            <SelectContent>
              {kindCategories.map((category) => (
                <SelectItem key={category.id} value={category.id}>
                  {category.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="grid gap-2">
          <Label htmlFor="cash-concept">Concepto</Label>
          <Input
            id="cash-concept"
            name="concept"
            maxLength={200}
            required
            placeholder="p. ej., Ventas de la semana"
          />
        </div>

        <div className="grid gap-2">
          <Label htmlFor="cash-amount">Monto</Label>
          <Input
            id="cash-amount"
            name="amount"
            inputMode="decimal"
            placeholder="0,00"
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
          <Button type="submit" disabled={submitting || categoryId === ""}>
            {submitting ? "Registrando…" : "Registrar"}
          </Button>
        </DialogFooter>
      </form>
    </>
  );
}
