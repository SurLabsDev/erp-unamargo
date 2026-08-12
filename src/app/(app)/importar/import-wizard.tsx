"use client";

import { Download, Upload } from "lucide-react";
import Link from "next/link";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatInteger } from "@/lib/format";
import {
  confirmImportAction,
  previewImportAction,
  type ConfirmResult,
  type PreviewResult,
} from "./actions";

type Step =
  | { name: "select" }
  | { name: "preview"; preview: Extract<PreviewResult, { ok: true }> }
  | { name: "done"; result: Extract<ConfirmResult, { ok: true }> };

export function ImportWizard() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [step, setStep] = useState<Step>({ name: "select" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function currentFile(): File | null {
    const file = fileInputRef.current?.files?.[0];
    return file && file.size > 0 ? file : null;
  }

  async function handlePreview() {
    const file = currentFile();
    if (!file) {
      setError("Elegí un archivo CSV.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const formData = new FormData();
      formData.set("file", file);
      const result = await previewImportAction(formData);
      if (result.ok) {
        setStep({ name: "preview", preview: result });
      } else {
        setError(result.error);
      }
    } catch {
      // e.g. the file changed on disk between selection and upload
      setError("Ocurrió un error al leer el archivo, intentá de nuevo.");
    } finally {
      setBusy(false);
    }
  }

  async function handleConfirm() {
    const file = currentFile();
    if (!file || busy) return;
    setBusy(true);
    setError(null);
    try {
      const formData = new FormData();
      formData.set("file", file);
      const result = await confirmImportAction(formData);
      if (result.ok) {
        toast.success(result.message);
        setStep({ name: "done", result });
      } else {
        setError(result.error);
      }
    } catch {
      setError(
        "Ocurrió un error al enviar el archivo (¿lo modificaste después de elegirlo?). Volvé a previsualizarlo.",
      );
      setStep({ name: "select" });
    } finally {
      setBusy(false);
    }
  }

  function reset() {
    if (fileInputRef.current) fileInputRef.current.value = "";
    setStep({ name: "select" });
    setError(null);
  }

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center gap-3 rounded-lg border p-4">
        <Button asChild variant="outline" size="sm">
          <a href="/api/plantilla-productos" download>
            <Download className="size-4" />
            Descargar plantilla
          </a>
        </Button>
        <p className="text-xs text-muted-foreground">
          Columnas: <span className="font-mono">sku, nombre, stock, minimo</span>{" "}
          · hasta 150 filas · la importación solo crea productos, nunca
          actualiza existentes.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-3 rounded-lg border p-4">
        <input
          ref={fileInputRef}
          type="file"
          accept=".csv,text/csv"
          onChange={() => {
            setStep({ name: "select" });
            setError(null);
          }}
          className="text-sm file:mr-3 file:rounded-md file:border file:bg-transparent file:px-3 file:py-1.5 file:text-sm"
          aria-label="Archivo CSV"
        />
        <Button
          size="sm"
          onClick={() => void handlePreview()}
          disabled={busy}
        >
          <Upload className="size-4" />
          {busy && step.name === "select" ? "Analizando…" : "Previsualizar"}
        </Button>
      </div>

      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}

      {step.name === "preview" ? (
        <div className="grid gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline">{step.preview.validCount} a crear</Badge>
            {step.preview.rejectedCount > 0 ? (
              <Badge variant="secondary">
                {step.preview.rejectedCount} con error (no se importan)
              </Badge>
            ) : null}
            <div className="ml-auto flex gap-2">
              <Button variant="outline" size="sm" onClick={reset} disabled={busy}>
                Cancelar
              </Button>
              <Button
                size="sm"
                onClick={() => void handleConfirm()}
                disabled={busy || step.preview.validCount === 0}
              >
                {busy
                  ? "Importando…"
                  : `Confirmar importación (${step.preview.validCount})`}
              </Button>
            </div>
          </div>
          <div className="overflow-x-auto rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Línea</TableHead>
                  <TableHead>SKU</TableHead>
                  <TableHead>Nombre</TableHead>
                  <TableHead className="text-right">Stock</TableHead>
                  <TableHead className="text-right">Mínimo</TableHead>
                  <TableHead>Estado</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {step.preview.rows.map((row) => (
                  <TableRow key={row.line}>
                    <TableCell className="tabular-nums text-muted-foreground">
                      {row.line}
                    </TableCell>
                    <TableCell className="font-mono text-xs">{row.sku}</TableCell>
                    <TableCell>{row.name}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {row.stock === null ? "—" : formatInteger(row.stock)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {row.minStock === null ? "—" : formatInteger(row.minStock)}
                    </TableCell>
                    <TableCell>
                      {row.status === "ok" ? (
                        <Badge variant="outline">Se crea</Badge>
                      ) : (
                        <span className="text-xs text-destructive">
                          {row.reason}
                        </span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      ) : null}

      {step.name === "done" ? (
        <div className="grid gap-3 rounded-lg border p-4">
          <p className="text-sm font-medium">{step.result.message}</p>
          {step.result.rejected.length > 0 ? (
            <ul className="grid gap-1 text-xs text-muted-foreground">
              {step.result.rejected.map((row) => (
                <li key={`${row.line}-${row.sku}`}>
                  Línea {row.line} · <span className="font-mono">{row.sku}</span>{" "}
                  — {row.reason}
                </li>
              ))}
            </ul>
          ) : null}
          <div className="flex gap-2">
            <Button asChild size="sm">
              <Link href="/stock">Ir al catálogo</Link>
            </Button>
            <Button variant="outline" size="sm" onClick={reset}>
              Importar otro archivo
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
