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
- `npm run db:import-catalogo -- [--dry-run]` (carga única del catálogo del cliente; ver README)

## Mapa

- `src/app/(public)/login` — login. `src/app/(app)/…` — shell autenticado (panel, stock, dinero, descuentos, importar, configuracion).
- `src/app/(app)/descuentos` — campañas de descuento (solo administración): lista, detalle con administración de objetivos, server actions.
- `src/app/api/public/v1/stock` — única API pública (solo lectura). `src/app/api/auth/[...nextauth]` — Auth.js.
- `src/lib/db/{schema,client}.ts` — esquema (DDL de referencia en PROMPT_ERP.md §4) y cliente.
- `src/lib/storage.ts` — fotos en Supabase Storage por HTTP (sin `@supabase/supabase-js`).
- `src/lib/domain/` — **reglas de negocio como funciones puras, testeables sin DB** (deltas, alertas, saldos, CSV, descuentos). Las server actions solo orquestan transacción + dominio + revalidación.
- `src/lib/{auth,auth-helpers,settings,format,email}.ts` — infraestructura compartida.
- `scripts/` — seed, create-user, check-integrity, import-catalogo (+ su catálogo en `scripts/data/`). `drizzle/` — migraciones SQL. `config/` — parametrización por instancia.
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
9. **Ningún dato de un cliente puede llegar al comportamiento de la app en ejecución.** El código que corre en producción lee nombre, moneda, timezone, destinatarios y saldos de la instancia (`config/instance.json` → `settings`), nunca de una constante: si "Unamargo" aparece en un componente, en una consulta, en una server action o en una regla de dominio, la regla está rota. Fuera de eso no hay absoluto que sostener, y no se pretende: la prosa de la documentación, los fixtures de los tests, los scripts operativos (`seed.ts`, `backup.sh`, `supabase-hardening.sql`, `.env.example`) y los **scripts de carga inicial de una sola vez** (`import-catalogo.ts`, `extract-demo-catalog.ts` y sus datos en `scripts/data/`) nombran al cliente porque describen o cargan una instancia concreta, y ninguno de ellos corre dentro de la app. Ver `DECISIONS.md` (20/08).

## Estado

- H0 ✔ cimientos — scaffold, esquema completo, auth, shell, seeds, docs.
- H1 ✔ stock — catálogo (límite 150, SKU inmutable con movimientos), movimientos atómicos (entrada/salida/ajuste por stock contado), historial 50/pág con filtros, panel con quiebres, review adversarial aplicado.
- H2 ✔ dinero + usuarios/config — balance por período (5 números, aritmética en centavos), anulación soft, export CSV es-UY con mitigación de formula injection, categorías, usuarios (tope 5, último admin protegido bajo lock), configuración de saldo/destinatarios, review adversarial aplicado. **Versión funcional completa en local; el deploy a Vercel espera credenciales.**
- H3 ✔ alertas + import + API pública — máquina de estados con claim atómico y outbox en `alert_events` (pending→sent/failed/skipped), un aviso por quiebre con rearme estricto, email batch único; importación en dos pasos (parser tolerante, solo-crea bajo lock, plantilla canónica con test de igualdad); `/api/public/v1/stock` (cache CDN, CORS, contrato mínimo); review adversarial aplicado.
- H4 ✔ publicación (12/08/2026) — README completo (guía de deploy por instancia, smoke checklist de 14 pasos, riesgos del free tier, backups pg_dump), auditoría de permisos endpoint por endpoint (limpia), 404/estados vacíos en español, límites 150/5/3 como reglas puras testeadas, evidencia de ACs en `docs/EVIDENCIA-AC.md`. **Pendiente: deploy real a Vercel (espera credenciales de Surlabs: DB, Vercel, Resend).**
- H5 ✔ catálogo (19/08/2026) — taxonomía de dos niveles (`product_categories` → `product_subtypes`) administrable desde Configuración, con la pertenencia garantizada por una **foránea compuesta** y no por la app; precio, descripción y slug por producto; fotos en Supabase Storage redimensionadas **en el navegador** (Vercel corta el body en 4.5MB) con nombre único por subida (su CDN cachea las URLs públicas); API pública ampliada de forma aditiva. **Cuenta de soporte de Surlabs** (`users.is_support`): opera con permisos de admin pero no figura en la lista de usuarios, no ocupa lugar en el tope de 5, no cuenta para la regla del último admin, no aparece en los filtros y sus movimientos se muestran como "Sistema" (el enmascarado va en la consulta SQL, no en los componentes).
- H6 ✔ descuentos (19/08/2026) — campañas de descuento por porcentaje con vigencia obligatoria por fechas más un interruptor manual (`discount_campaigns`, `percentage` acotado 1-90 por CHECK), apuntadas a productos, subtipos o categorías vía `discount_targets`: tres columnas nullable con `CHECK num_nonnulls(...) = 1` en vez de un `target_id` polimórfico (que no podría tener foránea real), con tres índices únicos **parciales** porque un `UNIQUE` común no frena filas repetidas con la columna de objetivo en null (Postgres no compara nulos entre sí). Resolución en función pura `src/lib/domain/discounts.ts` (`campaignState`, `discountedPrice`, `resolveDiscount`): precedencia **producto > subtipo > categoría**, empate a igual especificidad lo gana el porcentaje mayor, plata en centavos con BigInt igual que el módulo Dinero, más redondeo medio-arriba propio de este cálculo, que Dinero no necesita porque nunca divide. Pantalla `/descuentos` (lista + detalle de objetivos), solo administración igual que Importar y Configuración. El descuento vigente se muestra en la ficha de stock y se agrega de forma **aditiva** a `/api/public/v1/stock` (`price_final`, `discount`; `price` conserva su significado de precio de lista). Aviso de campañas activas en el Panel, como red contra la campaña olvidada. Nueve tareas, cada una con review adversarial, sin hallazgos Critical/Important abiertos.
- H7 ✔ import del catálogo real (20/08/2026) — `scripts/import-catalogo.ts`, runner de una sola vez que carga los 34 productos del cliente (catálogo versionado en `scripts/data/catalogo-unamargo.json`, extraído de su demo HTML) sobre la taxonomía real de 4 categorías y 12 subtipos, más las 42 fotos al bucket `productos`. Taxonomía y productos van en **una transacción**; las fotos **después del commit**, porque un POST HTTP no tiene rollback, y por producto entero (todos sus archivos y recién ahí sus filas de `product_images` en un solo INSERT), así que ninguna fila puede apuntar a un objeto que no está. **El import corre con stock 0 y no crea ningún movimiento**: el ledger arranca vacío y, como el SKU solo se congela cuando el producto tiene movimientos, los 34 SKU siguen siendo editables hasta el primer conteo físico. Idempotente: un SKU que ya existe se saltea y un producto que ya tiene fotos se saltea entero. `--dry-run` corre el cuerpo real y lo revierte; `--path-prefix` es lo que permite ensayar contra el bucket sin ensuciarlo. Ensayado de punta a punta contra una base limpia (34 productos, 0 movimientos, 42 fotos subidas, servidas y borradas; segunda corrida sin crear ni subir nada) y, contra una reproducción del sembrado del 19/08, el camino que la instancia del cliente va a recorrer de verdad: 2 renombres (`Mate`→`Mates`, `Bombilla`→`Bombillas`) sobre la misma fila, `Combos` creada, `Accesorios` en silencio porque ya estaba bien, 11 subtipos creados (no 12: `Limpieza` se reusa) y las 3 categorías viejas desactivadas. El runbook del README describe esa salida, no la de la base limpia. **Todavía no corrió contra la instancia del cliente.**

- H7 ✔ panel con metricas (21/08/2026) — el Panel pasa de resumen a tablero: unidades que salieron contra el periodo anterior, saldo, inventario a precio de lista, quiebres, salidas por dia, lo que mas sale, **dias de cobertura** (stock / ritmo, que ordena la reposicion mejor que el minimo fijo), stock parado, reparto por rubro, caja mes a mes y egresos por categoria. Las cuentas viven en `src/lib/domain/metrics.ts` como funciones puras con tests; las consultas en `src/app/(app)/queries.ts`. **Los graficos son SVG y divs escritos a mano** (regla 6: nada de librerias de charts) y son Server Components, asi que no mandan JS. **No hay ticket promedio ni margen y no puede haberlos**: la caja no referencia productos y el precio es de exhibicion; la pantalla lo dice en vez de esconderlo. Dos trampas que costaron un rato y quedan anotadas: un `Date` interpolado dentro de un fragmento `sql` crudo el driver no lo sabe codificar (va el ISO con cast), y una altura en porcentaje no resuelve si el padre la tiene en `auto`.

**Aviso a la web**: cualquier accion que cambie lo que devuelve `/api/public/v1/stock` tiene que pasar por uno de los helpers de revalidacion (`revalidateStock`, `revalidateDiscounts`, `revalidateCatalog`), que ya avisan a la web publica. Si se agrega un helper nuevo, tiene que llamar a `avisarALaWeb()`. Sin `WEB_REVALIDATE_URL` y `WEB_REVALIDATE_SECRET` no hace nada, que es lo correcto en local.

**Pendiente**: crear el admin real del cliente (hoy la instancia tiene 0 usuarios visibles), correr el import del catálogo contra la instancia del cliente, Resend, y la web del cliente que consuma la API.
