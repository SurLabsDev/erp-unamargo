"use client";

import Link from "next/link";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { PopupState } from "@/lib/domain/popups";
import { PopupActiveButton } from "./popup-active-button";
import { PopupForm } from "./popup-form";
import { PopupStateBadge } from "./popup-state-badge";

/** Una fila ya formateada en el servidor, que es el que conoce la zona horaria
 *  de la instancia. */
export type PopupRowView = {
  id: string;
  title: string;
  schedule: string;
  editedAt: string;
  isActive: boolean;
  state: PopupState;
  isShown: boolean;
};

export function PopupsManager(props: { popups: PopupRowView[] }) {
  const { popups } = props;

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Pop-ups</CardTitle>
          <CardDescription>
            El estado sale solo del interruptor y de las fechas. Si hay más de
            uno en vivo, la web muestra el editado más recientemente y los
            demás quedan tapados hasta que ese se apague o termine.
          </CardDescription>
        </CardHeader>

        <CardContent>
          {popups.length === 0 ? (
            <p className="rounded-md border border-dashed px-3 py-6 text-center text-sm text-muted-foreground">
              Todavía no hay pop-ups. Creá el primero abajo.
            </p>
          ) : (
            <div className="overflow-x-auto rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Título</TableHead>
                    <TableHead>Período</TableHead>
                    <TableHead>Editado</TableHead>
                    <TableHead>Estado</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {popups.map((popup) => (
                    <TableRow key={popup.id}>
                      <TableCell>
                        <Link
                          prefetch={false}
                          href={`/popups/${popup.id}`}
                          className="font-medium underline-offset-4 hover:underline"
                        >
                          {popup.title}
                        </Link>
                      </TableCell>
                      <TableCell className="whitespace-nowrap">
                        {popup.schedule}
                      </TableCell>
                      <TableCell className="cifras whitespace-nowrap">
                        {popup.editedAt}
                      </TableCell>
                      <TableCell>
                        <PopupStateBadge
                          state={popup.state}
                          isShown={popup.isShown}
                        />
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-right">
                        <PopupActiveButton
                          popupId={popup.id}
                          isActive={popup.isActive}
                        />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Nuevo pop-up</CardTitle>
          <CardDescription>
            Nace apagado. Después de crearlo, entrá en él para agregarle una
            imagen si querés, revisalo y encendelo cuando esté listo.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <PopupForm />
        </CardContent>
      </Card>
    </>
  );
}
