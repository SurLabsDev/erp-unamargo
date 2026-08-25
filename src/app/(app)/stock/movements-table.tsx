import Link from "next/link";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { MOVEMENT_TYPE_LABELS } from "@/lib/domain/stock";
import { formatDateTime, formatInteger } from "@/lib/format";
import type { MovementRow } from "./queries";

function formatDelta(delta: number): string {
  return delta > 0 ? `+${formatInteger(delta)}` : formatInteger(delta);
}

export function MovementsTable(props: {
  rows: MovementRow[];
  timezone: string;
  showProduct?: boolean;
}) {
  const { rows, timezone, showProduct = false } = props;

  if (rows.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-lg border border-dashed px-6 py-16 text-center">
        <p className="text-sm font-medium">Todavía no hay movimientos.</p>
        <p className="text-xs text-muted-foreground">
          Los movimientos del ledger no se editan ni se borran: un error se
          corrige con un ajuste.
        </p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Fecha</TableHead>
            {showProduct ? <TableHead>Producto</TableHead> : null}
            <TableHead>Tipo</TableHead>
            <TableHead className="text-right">Cantidad</TableHead>
            <TableHead className="text-right">Stock result.</TableHead>
            <TableHead>Usuario</TableHead>
            <TableHead>Nota</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.id}>
              <TableCell className="whitespace-nowrap tabular-nums">
                {formatDateTime(row.createdAt, timezone)}
              </TableCell>
              {showProduct ? (
                <TableCell>
                  <Link prefetch={false}
                    href={`/stock/${row.productId}`}
                    className="underline-offset-4 hover:underline"
                  >
                    <span className="font-mono text-xs">{row.productSku}</span>{" "}
                    <span className="text-muted-foreground">
                      {row.productName}
                    </span>
                  </Link>
                </TableCell>
              ) : null}
              <TableCell>{MOVEMENT_TYPE_LABELS[row.type]}</TableCell>
              <TableCell className="text-right tabular-nums">
                {formatDelta(row.delta)}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {formatInteger(row.resultingStock)}
              </TableCell>
              <TableCell className="whitespace-nowrap">
                {row.userName}
              </TableCell>
              <TableCell className="max-w-64 truncate text-muted-foreground">
                {row.note}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
