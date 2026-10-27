import { Badge } from "@/components/ui/badge";
import { POPUP_STATE_LABELS, type PopupState } from "@/lib/domain/popups";

/** Sin hooks a proposito: lo usan la lista (cliente) y el detalle (servidor). */
export function PopupStateBadge(props: { state: PopupState; isShown: boolean }) {
  const { state, isShown } = props;
  // En vivo pero tapado por otro editado despues: decir solo "En vivo"
  // prometeria algo que la web no esta mostrando, y es justo la duda que trae
  // la regla de uno a la vez.
  if (state === "live" && !isShown) {
    return <Badge variant="secondary">Tapado por otro</Badge>;
  }
  return (
    <Badge variant={state === "live" ? "default" : "secondary"}>
      {POPUP_STATE_LABELS[state]}
    </Badge>
  );
}
