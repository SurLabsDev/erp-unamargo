<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# surlabs-erp

ERP web liviano para pymes, producto de **Surlabs**. Base reutilizable: **una instancia (deploy Vercel + base Postgres) por cliente**, parametrizada por `config/instance.json` + seed. Primera instancia: Unamargo (mates, Uruguay). La especificación completa y contractual vive en `PROMPT_ERP.md` de la carpeta de la propuesta; ante duda de alcance, ese documento manda.

## Stack

Next.js 16 (App Router, TS estricto, `src/`) · Postgres (Supabase/Neon free tier; local: Docker en :5433) · Drizzle ORM + drizzle-kit · Auth.js v5 Credentials (JWT, bcryptjs) · Zod 4 · Tailwind 4 + shadcn/ui (preset Nova: Geist/Lucide, tema neutral monocromo) · TanStack Table v9 + TanStack Query v5 · Resend (fallback consola) · Vitest.

## Comandos

- `npm run dev` / `npm run build` / `npm run start`
- `npm run verify` = typecheck && lint && test && build — **compuerta obligatoria antes de cada commit**
- `npm run db:generate` (migraciones desde el schema) / `npm run db:migrate`
- `npm run db:seed` (instancia desde `config/instance.json`) / `npm run db:seed -- --demo [--reset]`
- `npm run db:check` (invariante stock: cache == Σ delta del ledger)
- `npm run user:create -- --email x --name "N" --role admin|operator`

## Mapa

- `src/app/(public)/login` — login. `src/app/(app)/…` — shell autenticado (panel, stock, dinero, descuentos, importar, configuracion).
- `src/app/(app)/descuentos` — campañas de descuento (solo administración): lista, detalle con administración de objetivos, server actions.
- `src/app/api/public/v1/stock` — única API pública (solo lectura). `src/app/api/auth/[...nextauth]` — Auth.js.
- `src/lib/db/{schema,client}.ts` — esquema (DDL de referencia en PROMPT_ERP.md §4) y cliente.
- `src/lib/storage.ts` — fotos en Supabase Storage por HTTP (sin `@supabase/supabase-js`).
- `src/lib/domain/` — **reglas de negocio como funciones puras, testeables sin DB** (deltas, alertas, saldos, CSV, descuentos). Las server actions solo orquestan transacción + dominio + revalidación.
- `src/lib/{auth,auth-helpers,settings,format,email}.ts` — infraestructura compartida.
- `scripts/` — seed, create-user, check-integrity. `drizzle/` — migraciones SQL. `config/` — parametrización por instancia.
- `src/proxy.ts` — protección de rutas (convención Next 16; reemplaza middleware.ts).

## Reglas de oro

1. **Ledger inmutable**: `stock_movements` es append-only; jamás UPDATE/DELETE. Correcciones = ajuste con nota. Dinero: jamás editar/borrar; solo soft-void por admin.
2. **El stock nunca queda negativo**; `current_stock` se actualiza en la MISMA transacción con `UPDATE … SET current_stock = current_stock + delta … RETURNING` (nunca read-then-write).
3. **Rol y datos se validan en el servidor** en cada action/route; la UI solo oculta botones. 403 con mensaje en español.
4. **Fechas en la timezone de la instancia** (`settings.timezone`), nunca UTC del servidor: "hoy", "no futura" y bordes de período.
5. **UI en español (es-UY); código, esquema y commits en inglés.** Moneda/formatos desde settings, nunca hardcodeados.
6. Sin dependencias nuevas sin justificación en `DECISIONS.md`. Prohibido: charts, state managers extra, i18n framework, colas, Redis, websockets, cron jobs.
7. `npm run verify` verde antes de cada commit. Conventional Commits en inglés.
8. Fuera de alcance = no se construye: anotar la idea en `BACKLOG.md` y seguir. Si dudás si algo está en alcance, está fuera.
9. Nada específico de un cliente hardcodeado: "Unamargo" solo puede aparecer en `config/instance.json` (no versionado) y en el seed demo.

## Estado

- H0 ✔ cimientos — scaffold, esquema completo, auth, shell, seeds, docs.
- H1 ✔ stock — catálogo (límite 150, SKU inmutable con movimientos), movimientos atómicos (entrada/salida/ajuste por stock contado), historial 50/pág con filtros, panel con quiebres, review adversarial aplicado.
- H2 ✔ dinero + usuarios/config — balance por período (5 números, aritmética en centavos), anulación soft, export CSV es-UY con mitigación de formula injection, categorías, usuarios (tope 5, último admin protegido bajo lock), configuración de saldo/destinatarios, review adversarial aplicado. **Versión funcional completa en local; el deploy a Vercel espera credenciales.**
- H3 ✔ alertas + import + API pública — máquina de estados con claim atómico y outbox en `alert_events` (pending→sent/failed/skipped), un aviso por quiebre con rearme estricto, email batch único; importación en dos pasos (parser tolerante, solo-crea bajo lock, plantilla canónica con test de igualdad); `/api/public/v1/stock` (cache CDN, CORS, contrato mínimo); review adversarial aplicado.
- H4 ✔ publicación (12/08/2026) — README completo (guía de deploy por instancia, smoke checklist de 14 pasos, riesgos del free tier, backups pg_dump), auditoría de permisos endpoint por endpoint (limpia), 404/estados vacíos en español, límites 150/5/3 como reglas puras testeadas, evidencia de ACs en `docs/EVIDENCIA-AC.md`. **Pendiente: deploy real a Vercel (espera credenciales de Surlabs: DB, Vercel, Resend).**
- H5 ✔ catálogo (19/08/2026) — taxonomía de dos niveles (`product_categories` → `product_subtypes`) administrable desde Configuración, con la pertenencia garantizada por una **foránea compuesta** y no por la app; precio, descripción y slug por producto; fotos en Supabase Storage redimensionadas **en el navegador** (Vercel corta el body en 4.5MB) con nombre único por subida (su CDN cachea las URLs públicas); API pública ampliada de forma aditiva. **Cuenta de soporte de Surlabs** (`users.is_support`): opera con permisos de admin pero no figura en la lista de usuarios, no ocupa lugar en el tope de 5, no cuenta para la regla del último admin, no aparece en los filtros y sus movimientos se muestran como "Sistema" (el enmascarado va en la consulta SQL, no en los componentes).
- H6 ✔ descuentos (19/08/2026) — campañas de descuento por porcentaje con vigencia obligatoria por fechas más un interruptor manual (`discount_campaigns`, `percentage` acotado 1-90 por CHECK), apuntadas a productos, subtipos o categorías vía `discount_targets`: tres columnas nullable con `CHECK num_nonnulls(...) = 1` en vez de un `target_id` polimórfico (que no podría tener foránea real), con tres índices únicos **parciales** porque un `UNIQUE` común no frena filas repetidas con la columna de objetivo en null (Postgres no compara nulos entre sí). Resolución en función pura `src/lib/domain/discounts.ts` (`campaignState`, `discountedPrice`, `resolveDiscount`): precedencia **producto > subtipo > categoría**, empate a igual especificidad lo gana el porcentaje mayor, plata en centavos con BigInt igual que el módulo Dinero, más redondeo medio-arriba propio de este cálculo, que Dinero no necesita porque nunca divide. Pantalla `/descuentos` (lista + detalle de objetivos), solo administración igual que Importar y Configuración. El descuento vigente se muestra en la ficha de stock y se agrega de forma **aditiva** a `/api/public/v1/stock` (`price_final`, `discount`; `price` conserva su significado de precio de lista). Aviso de campañas activas en el Panel, como red contra la campaña olvidada. Nueve tareas, cada una con review adversarial, sin hallazgos Critical/Important abiertos.

**Pendiente**: crear el admin real del cliente (hoy la instancia tiene 0 usuarios visibles), Resend, y la web del cliente que consuma la API.
