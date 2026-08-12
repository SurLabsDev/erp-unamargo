# DECISIONS

Una línea por decisión tomada fuera de la especificación (fecha · decisión · motivo).

- 2026-08-12 · Repo llamado `surlabs-erp` (producto, no cliente) · la base es reutilizable; Unamargo es solo la primera instancia.
- 2026-08-12 · `src/proxy.ts` en lugar de `middleware.ts` · convención nueva de Next 16 (middleware quedó deprecado).
- 2026-08-12 · shadcn CLI 4.x con base Radix + preset Nova (Geist/Lucide) · el preset trae exactamente el tema neutral monocromo que pide la spec; radius reducido a 0.375rem.
- 2026-08-12 · Postgres local: Docker `postgres:18-alpine` en puerto **5433** · el 5432 está ocupado por otro proyecto en la máquina de desarrollo.
- 2026-08-12 · `DATABASE_URL` con fallback a la URL local de Docker (con warning) · evita romper build/scripts sin env; producción define la suya en Vercel.
- 2026-08-12 · bcryptjs cost 12; passwords generadas de 12 chars (base64url) · equilibrio costo/seguridad para 5 usuarios.
- 2026-08-12 · Passwords demo fijas (`unamargo-admin` / `unamargo-operador`) impresas por el seed · demo reproducible; la guía de deploy exige rotarlas fuera de dev.
- 2026-08-12 · Seed demo se niega sobre base con datos salvo `--reset` (trunca todo) · "idempotente o con reset claro" de la spec, sin riesgo de merges raros.
- 2026-08-12 · Vulnerabilidades npm moderadas aceptadas · vienen de un esbuild viejo embebido en drizzle-kit; solo afectan tooling de desarrollo.
- 2026-08-12 · `.gitignore` del scaffold ignoraba `.env*`: se agregó excepción `!.env.example` y se ignora `config/instance.json` · el example se versiona; la config real por cliente no.
- 2026-08-12 · TanStack Table v9 (instalada por npm como latest) · se adopta su API en H1; si hay fricción se documenta acá.
