"use client";

import { Plus } from "lucide-react";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  createUserAction,
  resetUserPasswordAction,
  setUserActiveAction,
  setUserRoleAction,
} from "./actions";
import type { UserRow } from "./queries";

export function UsersManager(props: {
  users: UserRow[];
  currentUserId: string;
}) {
  const { users, currentUserId } = props;
  const [createOpen, setCreateOpen] = useState(false);
  const [oneTimePassword, setOneTimePassword] = useState<{
    email: string;
    password: string;
  } | null>(null);
  const [deactivateTarget, setDeactivateTarget] = useState<UserRow | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const activeCount = users.filter((user) => user.isActive).length;

  async function handleToggle(user: UserRow) {
    if (busyId) return;
    setBusyId(user.id);
    const result = await setUserActiveAction(user.id, !user.isActive);
    setBusyId(null);
    if (result.ok) toast.success(result.message);
    else toast.error(result.error);
  }

  async function handleReset(user: UserRow) {
    if (busyId) return;
    setBusyId(user.id);
    const result = await resetUserPasswordAction(user.id);
    setBusyId(null);
    if (result.ok && result.password) {
      setOneTimePassword({ email: user.email, password: result.password });
    } else if (!result.ok) {
      toast.error(result.error);
    }
  }

  async function handleRole(user: UserRow, role: "admin" | "operator") {
    if (busyId || role === user.role) return;
    setBusyId(user.id);
    const result = await setUserRoleAction(user.id, role);
    setBusyId(null);
    if (result.ok) toast.success(result.message);
    else toast.error(result.error);
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="grid gap-1.5">
            <CardTitle className="text-base">Usuarios</CardTitle>
            <CardDescription>
              {activeCount} de 5 usuarios activos. Un usuario desactivado pierde
              el acceso en su próxima navegación.
            </CardDescription>
          </div>
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            <Plus className="size-4" />
            Nuevo usuario
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nombre</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Rol</TableHead>
                <TableHead>Estado</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {users.map((user) => (
                <TableRow key={user.id}>
                  <TableCell className="whitespace-nowrap">
                    {user.name}
                    {user.id === currentUserId ? (
                      <span className="ml-1 text-xs text-muted-foreground">
                        (vos)
                      </span>
                    ) : null}
                  </TableCell>
                  <TableCell className="whitespace-nowrap">{user.email}</TableCell>
                  <TableCell>
                    <Select
                      value={user.role}
                      onValueChange={(value) =>
                        void handleRole(user, value as "admin" | "operator")
                      }
                      disabled={busyId === user.id}
                    >
                      <SelectTrigger size="sm" className="w-40">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="admin">Administración</SelectItem>
                        <SelectItem value="operator">
                          Operación/consulta
                        </SelectItem>
                      </SelectContent>
                    </Select>
                  </TableCell>
                  <TableCell>
                    {user.isActive ? (
                      <Badge variant="outline">Activo</Badge>
                    ) : (
                      <Badge variant="secondary">Inactivo</Badge>
                    )}
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-right">
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={busyId === user.id}
                      onClick={() => void handleReset(user)}
                    >
                      Resetear contraseña
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={busyId === user.id || user.id === currentUserId}
                      onClick={() =>
                        user.isActive
                          ? setDeactivateTarget(user) // destructive: confirm (§11)
                          : void handleToggle(user)
                      }
                    >
                      {user.isActive ? "Desactivar" : "Reactivar"}
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </CardContent>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-md">
          {createOpen ? (
            <CreateUserForm
              onClose={() => setCreateOpen(false)}
              onCreated={(email, password) => {
                setCreateOpen(false);
                setOneTimePassword({ email, password });
              }}
            />
          ) : null}
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={deactivateTarget !== null}
        onOpenChange={(open) => !open && setDeactivateTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Desactivar usuario</AlertDialogTitle>
            <AlertDialogDescription>
              Vas a desactivar a <strong>{deactivateTarget?.name}</strong> (
              {deactivateTarget?.email}). Pierde el acceso en su próxima
              navegación, incluso si tiene una sesión abierta. Podés reactivarlo
              cuando quieras.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                const target = deactivateTarget;
                setDeactivateTarget(null);
                if (target) void handleToggle(target);
              }}
            >
              Desactivar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog
        open={oneTimePassword !== null}
        onOpenChange={(open) => !open && setOneTimePassword(null)}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Contraseña temporal</DialogTitle>
            <DialogDescription>
              Compartila de forma segura con {oneTimePassword?.email}.{" "}
              <strong>No se vuelve a mostrar.</strong>
            </DialogDescription>
          </DialogHeader>
          <p className="rounded-md border bg-muted px-4 py-3 text-center font-mono text-lg tracking-wide">
            {oneTimePassword?.password}
          </p>
          <DialogFooter>
            <Button onClick={() => setOneTimePassword(null)}>Listo</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

function CreateUserForm(props: {
  onClose: () => void;
  onCreated: (email: string, password: string) => void;
}) {
  const { onClose, onCreated } = props;
  const [role, setRole] = useState<"admin" | "operator">("operator");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    const formData = new FormData(event.currentTarget);
    formData.set("role", role);
    const result = await createUserAction(formData);
    setSubmitting(false);
    if (result.ok && result.password) {
      toast.success(result.message);
      onCreated(String(formData.get("email")).toLowerCase(), result.password);
    } else if (!result.ok) {
      setError(result.error);
    }
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>Nuevo usuario</DialogTitle>
        <DialogDescription>
          Se genera una contraseña temporal que se muestra una única vez.
        </DialogDescription>
      </DialogHeader>
      <form onSubmit={handleSubmit} className="grid gap-4">
        <div className="grid gap-2">
          <Label htmlFor="user-name">Nombre</Label>
          <Input id="user-name" name="name" maxLength={80} required autoFocus />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="user-email">Email</Label>
          <Input id="user-email" name="email" type="email" required />
        </div>
        <div className="grid gap-2">
          <Label>Rol</Label>
          <Select
            value={role}
            onValueChange={(value) => setRole(value as "admin" | "operator")}
          >
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="operator">Operación/consulta</SelectItem>
              <SelectItem value="admin">Administración</SelectItem>
            </SelectContent>
          </Select>
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
            {submitting ? "Creando…" : "Crear"}
          </Button>
        </DialogFooter>
      </form>
    </>
  );
}
