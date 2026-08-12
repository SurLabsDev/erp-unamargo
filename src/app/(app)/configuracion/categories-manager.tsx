"use client";

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
import {
  Dialog,
  DialogContent,
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
import { CASH_KIND_LABELS } from "@/lib/domain/money";
import {
  createCategoryAction,
  renameCategoryAction,
  setCategoryActiveAction,
} from "./actions";

type Category = {
  id: string;
  name: string;
  kind: "income" | "expense";
  isActive: boolean;
  inUse: boolean;
};

export function CategoriesManager(props: { categories: Category[] }) {
  const { categories } = props;
  const [kind, setKind] = useState<"income" | "expense">("income");
  const [creating, setCreating] = useState(false);
  const [renameTarget, setRenameTarget] = useState<Category | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  async function handleCreate(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (creating) return;
    setCreating(true);
    const form = event.currentTarget;
    const formData = new FormData(form);
    formData.set("kind", kind);
    const result = await createCategoryAction(formData);
    setCreating(false);
    if (result.ok) {
      toast.success(result.message);
      form.reset();
    } else {
      toast.error(result.error);
    }
  }

  async function handleToggle(category: Category) {
    if (busyId) return;
    setBusyId(category.id);
    const result = await setCategoryActiveAction(category.id, !category.isActive);
    setBusyId(null);
    if (result.ok) toast.success(result.message);
    else toast.error(result.error);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Categorías de dinero</CardTitle>
        <CardDescription>
          Las categorías con movimientos no se eliminan: se desactivan y los
          históricos las conservan.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        <div className="grid gap-2 sm:grid-cols-2">
          {(["income", "expense"] as const).map((groupKind) => (
            <div key={groupKind} className="grid content-start gap-1.5">
              <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {CASH_KIND_LABELS[groupKind]}s
              </h3>
              {categories
                .filter((category) => category.kind === groupKind)
                .map((category) => (
                  <div
                    key={category.id}
                    className="flex items-center justify-between gap-2 rounded-md border px-3 py-1.5 text-sm"
                  >
                    <span className="flex min-w-0 items-center gap-2">
                      <span
                        className={
                          category.isActive
                            ? "truncate"
                            : "truncate text-muted-foreground line-through"
                        }
                      >
                        {category.name}
                      </span>
                      {!category.isActive ? (
                        <Badge variant="secondary">Inactiva</Badge>
                      ) : null}
                    </span>
                    <span className="flex shrink-0 gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setRenameTarget(category)}
                      >
                        Renombrar
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={busyId === category.id}
                        onClick={() => void handleToggle(category)}
                      >
                        {category.isActive ? "Desactivar" : "Reactivar"}
                      </Button>
                    </span>
                  </div>
                ))}
            </div>
          ))}
        </div>

        <form
          onSubmit={handleCreate}
          className="flex flex-wrap items-end gap-2 border-t pt-4"
        >
          <div className="grid gap-1.5">
            <Label htmlFor="new-category-name">Nueva categoría</Label>
            <Input
              id="new-category-name"
              name="name"
              maxLength={60}
              required
              placeholder="Nombre"
              className="w-56"
            />
          </div>
          <div className="grid gap-1.5">
            <Label>Tipo</Label>
            <Select
              value={kind}
              onValueChange={(value) => setKind(value as "income" | "expense")}
            >
              <SelectTrigger className="w-36">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="income">Ingreso</SelectItem>
                <SelectItem value="expense">Egreso</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Button type="submit" size="sm" disabled={creating}>
            {creating ? "Creando…" : "Crear"}
          </Button>
        </form>
      </CardContent>

      <Dialog
        open={renameTarget !== null}
        onOpenChange={(open) => !open && setRenameTarget(null)}
      >
        <DialogContent className="sm:max-w-sm">
          {renameTarget !== null ? (
            <RenameForm
              key={renameTarget.id}
              category={renameTarget}
              onClose={() => setRenameTarget(null)}
            />
          ) : null}
        </DialogContent>
      </Dialog>
    </Card>
  );
}

function RenameForm(props: { category: Category; onClose: () => void }) {
  const { category, onClose } = props;
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    const result = await renameCategoryAction(
      category.id,
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
        <DialogTitle>Renombrar categoría</DialogTitle>
      </DialogHeader>
      <form onSubmit={handleSubmit} className="grid gap-4">
        <div className="grid gap-2">
          <Label htmlFor="rename-category">Nombre</Label>
          <Input
            id="rename-category"
            name="name"
            defaultValue={category.name}
            maxLength={60}
            required
            autoFocus
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
