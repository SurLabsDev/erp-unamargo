export function PageHeader(props: { title: string; description?: string }) {
  return (
    <div className="mb-6 grid gap-1">
      <h1 className="text-2xl font-semibold tracking-tight">{props.title}</h1>
      {props.description ? (
        <p className="text-sm text-muted-foreground">{props.description}</p>
      ) : null}
    </div>
  );
}

/** Empty state used while a module is not built yet (per-hito placeholders). */
export function ModulePlaceholder(props: { hito: string; detail: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed px-6 py-16 text-center">
      <p className="text-sm font-medium">{props.detail}</p>
      <p className="text-xs text-muted-foreground">
        Este módulo se construye en el {props.hito}.
      </p>
    </div>
  );
}
