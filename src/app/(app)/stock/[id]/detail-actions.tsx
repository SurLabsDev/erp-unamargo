"use client";

import { Pencil, Plus, Power } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { MovementFormDialog } from "../movement-form-dialog";
import { ProductActiveDialog } from "../product-active-dialog";
import { ProductFormDialog } from "../product-form-dialog";
import type { CatalogRow } from "../queries";

export function DetailActions(props: {
  product: CatalogRow;
  isAdmin: boolean;
}) {
  const { product, isAdmin } = props;
  const [movementOpen, setMovementOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [activeOpen, setActiveOpen] = useState(false);

  return (
    <div className="flex flex-wrap gap-2">
      <Button
        size="sm"
        onClick={() => setMovementOpen(true)}
        disabled={!product.isActive}
      >
        <Plus className="size-4" />
        Registrar movimiento
      </Button>
      {isAdmin ? (
        <>
          <Button size="sm" variant="outline" onClick={() => setEditOpen(true)}>
            <Pencil className="size-4" />
            Editar
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setActiveOpen(true)}
          >
            <Power className="size-4" />
            {product.isActive ? "Desactivar" : "Reactivar"}
          </Button>
        </>
      ) : null}

      <MovementFormDialog
        product={movementOpen ? product : null}
        onClose={() => setMovementOpen(false)}
      />
      <ProductFormDialog
        state={editOpen ? { mode: "edit", product } : null}
        onClose={() => setEditOpen(false)}
      />
      <ProductActiveDialog
        product={activeOpen ? product : null}
        onClose={() => setActiveOpen(false)}
      />
    </div>
  );
}
