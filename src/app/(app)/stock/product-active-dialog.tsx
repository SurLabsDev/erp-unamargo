"use client";

import { useState } from "react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { formatInteger } from "@/lib/format";
import { setProductActiveAction } from "./actions";
import type { CatalogRow } from "./queries";

export function ProductActiveDialog(props: {
  product: CatalogRow | null;
  onClose: () => void;
}) {
  const { product, onClose } = props;
  const [submitting, setSubmitting] = useState(false);

  async function handleConfirm() {
    if (!product || submitting) return;
    setSubmitting(true);
    const result = await setProductActiveAction(product.id, !product.isActive);
    setSubmitting(false);
    if (result.ok) {
      toast.success(result.message);
    } else {
      toast.error(result.error);
    }
    onClose();
  }

  const deactivating = product?.isActive ?? false;

  return (
    <AlertDialog
      open={product !== null}
      onOpenChange={(open) => !open && onClose()}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {deactivating ? "Desactivar producto" : "Reactivar producto"}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {product ? (
              deactivating ? (
                <>
                  Vas a desactivar{" "}
                  <span className="font-mono text-xs">{product.sku}</span> —{" "}
                  {product.name}, con{" "}
                  <strong>
                    {formatInteger(product.currentStock)} unidades
                  </strong>{" "}
                  en stock. Deja de aparecer en la web y no admite nuevos
                  movimientos; el historial se conserva y podés reactivarlo
                  cuando quieras.
                </>
              ) : (
                <>
                  Vas a reactivar{" "}
                  <span className="font-mono text-xs">{product.sku}</span> —{" "}
                  {product.name}. Vuelve a contar para el límite de 150 SKU
                  activos y a aparecer en la web.
                </>
              )
            ) : null}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={submitting}>Cancelar</AlertDialogCancel>
          <AlertDialogAction onClick={handleConfirm} disabled={submitting}>
            {submitting
              ? "Guardando…"
              : deactivating
                ? "Desactivar"
                : "Reactivar"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
