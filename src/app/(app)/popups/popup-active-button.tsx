"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { setPopupActiveAction } from "./actions";

/** El interruptor manual. Los pop-ups no se borran: se apagan. */
export function PopupActiveButton(props: {
  popupId: string;
  isActive: boolean;
  variant?: "ghost" | "outline";
}) {
  const { popupId, isActive, variant = "ghost" } = props;
  const [busy, setBusy] = useState(false);

  async function handleToggle() {
    if (busy) return;
    setBusy(true);
    const result = await setPopupActiveAction(popupId, !isActive);
    setBusy(false);
    if (result.ok) toast.success(result.message);
    else toast.error(result.error);
  }

  return (
    <Button
      variant={variant}
      size="sm"
      disabled={busy}
      onClick={() => void handleToggle()}
    >
      {isActive ? "Apagar" : "Encender"}
    </Button>
  );
}
