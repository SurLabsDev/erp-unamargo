# surlabs-erp

Sistema de gestión operativo para pymes, por **Surlabs**: control de stock de un depósito, balance operativo compartido, alertas de stock bajo por email, importación inicial por CSV y una API pública de solo lectura con el stock.

Es una **base reutilizable**: una instancia (deploy en Vercel + base Postgres propia) por cliente, parametrizada por `config/instance.json` + seed. **Sin multi-tenancy.** Primera instancia: Unamargo (Uruguay).

**Qué incluye por módulo:**

| Módulo | Qué hace |
|---|---|
| **Stock** | Catálogo de hasta 150 SKU activos, entradas/salidas/ajustes con ledger inmutable (el stock jamás queda negativo), historial filtrable, SKU inmutable con movimientos |
| **Dinero** | Ingresos/egresos por categoría, balance por período (saldo al inicio/cierre), anulación soft por admin, export CSV compatible con Excel es-UY |
| **Alertas** | Un email por evento de quiebre (`stock ≤ mínimo`), rearme automático al reponer, auditoría en `alert_events`; `mínimo = 0` = sin control |
| **Importación** | Carga inicial por CSV con plantilla oficial, preview fila por fila, solo crea (nunca actualiza) |
| **Catálogo** | Categorías y subtipos administrables por el cliente (mate → de calabaza), precio, descripción y fotos por producto. Las fotos se achican en el navegador y viven en Supabase Storage |
| **API pública** | `GET /api/public/v1/stock` — catálogo con stock, precio, clasificación y fotos para la web del cliente, con cache CDN |
| **Descuentos** | Campañas con vigencia por fechas más interruptor, aplicables a productos, subtipos o categorías. Gana la regla más puntual. Solo porcentaje |
| **Usuarios** | Hasta 5 activos, roles administración / operación-consulta, contraseñas temporales mostradas una única vez |

## Stack

Next.js 16 (App Router, TypeScript) · Postgres (Supabase o Neon) · Drizzle ORM · Auth.js v5 (credenciales, JWT) · Tailwind 4 + shadcn/ui · TanStack Table/Query · Resend (con fallback a consola) · Vitest.

## Desarrollo local

Requisitos: Node 20+, Docker.

```bash
# 1. Postgres local (puerto 5433 para no chocar con otros proyectos)
docker run -d --name surlabs-erp-postgres -p 5433:5432 \
  -e POSTGRES_USER=surlabs -e POSTGRES_PASSWORD=surlabs -e POSTGRES_DB=surlabs_erp \
  postgres:18-alpine

# 2. Instalar, migrar y seedear la demo
npm install
cp .env.example .env        # el default ya apunta al Docker de arriba
npm run db:migrate
npm run db:seed -- --demo

# 3. Levantar
npm run dev                 # http://localhost:3000
```

Credenciales demo (solo desarrollo; impresas también por el seed):

| Rol | Email | Password |
|---|---|---|
| Administración | `admin@unamargo.demo` | `unamargo-admin` |
| Operación | `operador@unamargo.demo` | `unamargo-operador` |

## Scripts

| Comando | Qué hace |
|---|---|
| `npm run verify` | `typecheck && lint && test && build` — compuerta de cada commit |
| `npm run db:generate` | Genera migraciones SQL desde `src/lib/db/schema.ts` |
| `npm run db:migrate` | Aplica migraciones (usa `DATABASE_URL` o el fallback local) |
| `npm run db:seed` | Seed de instancia desde `config/instance.json` (ver deploy) |
| `npm run db:seed -- --demo [--reset]` | Seed demo Unamargo (`--reset` borra todo antes; solo dev) |
| `npm run db:check` | Verifica el invariante de stock (cache == Σ ledger) |
| `npm run user:create -- --email … --name "…" --role admin\|operator` | Alta de usuario por CLI |
| `npm run db:import-catalogo -- [--dry-run]` | Carga el catálogo inicial desde `scripts/data/catalogo-unamargo.json`: taxonomía, productos y fotos. Idempotente (ver [Carga del catálogo inicial](#carga-del-catálogo-inicial)) |

## Variables de entorno

| Variable | Requerida | Descripción |
|---|---|---|
| `DATABASE_URL` | Sí | Connection string de Postgres. En producción usar SIEMPRE la variante **con pooler** (Supabase pgbouncer `:6543` / host `-pooler` de Neon): el runtime es serverless y sin pooler se agotan las conexiones del free tier |
| `AUTH_SECRET` | Sí | Secreto de sesión. Generar con `npx auth secret` u `openssl rand -base64 32` — uno distinto por instancia |
| `APP_URL` | Sí | URL pública de la instancia (links en los emails de alerta) |
| `RESEND_API_KEY` | No | API key de Resend. Sin ella, los emails se loguean a consola y los eventos quedan `skipped` — la app funciona igual |
| `EMAIL_FROM` | Si hay Resend | Remitente, p. ej. `ERP Unamargo <erp@dominio-verificado.uy>`. El dominio DEBE estar verificado en Resend |
| `SUPABASE_URL` | Si hay fotos | URL del proyecto Supabase. Sin ella la galería de fotos queda oculta y el resto funciona igual |
| `SUPABASE_SECRET_KEY` | Si hay fotos | Project Settings → API Keys → la **secret** (`sb_secret_…`). Saltea RLS: va SOLO en el servidor, nunca con prefijo `NEXT_PUBLIC_`. Requiere un bucket `productos` público (ver `scripts/supabase-hardening.sql`) |

Ver [.env.example](.env.example) comentado.

## Deploy de una nueva instancia

Cada cliente es un deploy + una base propia. **Cero forks**: el nombre del cliente solo vive en `config/instance.json` (no versionado) y en los datos. La guía completa, para seguir sin leer el código:

### 1. Base de datos

Crear un proyecto Postgres en [Neon](https://neon.tech) o [Supabase](https://supabase.com) (free tier alcanza para empezar — leé **Operación y riesgos** más abajo antes de elegir).

- **Neon**: copiar el connection string del host **`-pooler`**.
- **Supabase**: usar el connection string de **Transaction pooler (puerto 6543)**, no el directo.

Guardá también el connection string del **Session pooler (puerto 5432)**: es el que se usa para migraciones y backups. En Supabase free la conexión *directa* (`db.<ref>.supabase.co`) resuelve solo a IPv6 y no sirve ni desde Vercel ni desde la mayoría de las redes.

### 2. Migraciones y configuración de instancia

Desde una copia local del repo, apuntando a la base nueva:

```bash
# PowerShell:  $env:DATABASE_URL = "postgres://...pooler..."
# bash:        export DATABASE_URL="postgres://...pooler..."
npm install
npm run db:migrate
```

Crear la configuración del cliente y seedear (SIN `--demo` — producción no lleva datos de prueba):

```bash
cp config/instance.example.json config/instance.json
# Editar config/instance.json: companyName, currencyCode, timezone,
# alertRecipients (hasta 3), initialBalance + initialBalanceDate (fecha de
# corte: no puede ser futura), categorías, y el email/nombre del admin inicial.
npm run db:seed
```

El seed imprime **una única vez** la contraseña temporal del admin inicial: guardala ahora y entregala por un canal seguro.

### 3. Vercel

1. En Vercel: **Add New → Project → Import** el repo `SurLabsDev/erp-unamargo` (framework autodetectado: Next.js, sin configuración extra).
2. En *Environment Variables* cargar: `DATABASE_URL` (con pooler), `AUTH_SECRET` (nuevo para esta instancia), `APP_URL` (la URL final del proyecto), y si corresponde `RESEND_API_KEY` + `EMAIL_FROM`.
3. Deploy. Cada push a `main` redeploya.

> ⚠️ El plan **Hobby de Vercel prohíbe uso comercial**. Para la instancia productiva de un cliente corresponde el plan Pro (decisión comercial de Surlabs, fuera del código).

### 4. Resend (alertas por email)

1. Crear cuenta en [Resend](https://resend.com) y **verificar un dominio** (Domains → Add → registros DNS). **Sin dominio verificado, Resend solo envía al email del dueño de la cuenta** — las alertas a los destinatarios del cliente NO van a salir.
2. Crear una API key y cargarla en Vercel junto con `EMAIL_FROM` usando ese dominio.
3. Sin Resend la app funciona igual: el indicador de stock bajo del panel no depende del email, y Configuración avisa que las alertas no están operativas.

### 5. Puesta en marcha

1. Entrar con el admin inicial y **cambiar la contraseña** (menú de usuario → Cambiar contraseña).
2. **Configuración → Usuarios**: crear los usuarios reales (máx. 5 activos). Cada alta muestra una contraseña temporal una única vez.
3. **Configuración → Alertas**: cargar hasta 3 destinatarios.
4. **Importar**: descargar la plantilla, completarla con el conteo físico del cliente (`sku, nombre, stock, minimo`, hasta 150 filas) y subirla — la previsualización marca los errores fila por fila antes de confirmar.

### 6. Checklist post-deploy

- [ ] `/login` carga y el admin inicial entra (con la contraseña ya rotada).
- [ ] Crear un producto de prueba, registrar una entrada y una salida; la salida mayor al stock es rechazada.
- [ ] Registrar un ingreso y un egreso; el panel de Dinero muestra los 5 números.
- [ ] Exportar el CSV y abrirlo en Excel (acentos y montos correctos).
- [ ] Bajar un producto por debajo del mínimo → llega el email de alerta (o el evento queda `skipped` si no hay Resend).
- [ ] `curl https://<instancia>/api/public/v1/stock` responde 200 con los productos activos.
- [ ] Un usuario operador NO ve Importar/Configuración y no puede anular movimientos de dinero.
- [ ] Borrar el producto de prueba no existe como opción: desactivarlo (correcto — el historial se conserva).
- [ ] `npm run db:check` contra la base productiva pasa.
- [ ] Anotar el connection string directo y agendar el primer backup (ver abajo).

## Carga del catálogo inicial

`npm run db:import-catalogo` es el runner **de una sola vez** que sube a la instancia el catálogo real del cliente que hoy vive en `scripts/data/catalogo-unamargo.json` (34 productos, 42 fotos). Hace tres cosas, en este orden:

1. **Taxonomía**: deja las categorías y subtipos que el catálogo declara, renombra las que quedaron en singular del seed anterior y **desactiva** (nunca borra) las que ya no se venden.
2. **Productos**: crea los que falten, con **stock 0 y sin movimientos**, y no toca ningún SKU que ya esté en la base.
3. **Fotos**: sube las imágenes al bucket `productos` y las enlaza.

Los pasos 1 y 2 van en **una sola transacción**; el 3 corre **después del commit**, porque un POST HTTP no tiene rollback.

Es **idempotente**: correrlo dos veces no duplica nada. Un producto que ya existe se saltea, y un producto que ya tiene fotos se saltea entero (no se le agregan las que falten: si el cliente borró una desde Stock, volver a subirla sería deshacer su decisión).

### Cómo correrlo contra producción

```bash
# 1. Backup ANTES de tocar nada. La transacción cubre la base, pero no el bucket.
./scripts/backup.sh

# 2. Simulacro: corre todo, revierte la transacción y no sube una sola foto.
npm run db:import-catalogo -- --dry-run
```

El `--` no es decoración: sin él npm se come el flag y arranca la corrida real.

**Leer la salida del simulacro entera antes de seguir.** Y leerla sabiendo qué esperar: la instancia del cliente **no** es una base limpia. Trae la taxonomía sembrada el 19/08 (6 categorías en singular — `Mate`, `Bombilla`, `Termo`, `Matera`, `Yerba`, `Accesorios` — con 23 subtipos), así que el simulacro no imprime "4 categorías creadas con 12 subtipos": imprime renombres, una sola creación y un montón de desactivaciones.

Estos son los números exactos que tiene que dar. La columna de la derecha es la de una base limpia, que es lo que se ve en un ensayo y **no** lo que va a ver el operador acá:

| Líneas del simulacro | Instancia del cliente | Base limpia (ensayo) |
|---|---|---|
| `Categoría "X" renombrada a "Y"` | **2**: `Mate`→`Mates`, `Bombilla`→`Bombillas` | 0 |
| `Categoría "X" creada (slug …)` | **1**: `Combos` | 4 |
| `Categoría "X" desactivada` | **3**: `Termo`, `Yerba`, `Matera` | 0, con el aviso `no existe; nada que desactivar` |
| `Subtipo "X" creado bajo "Y" (slug …)` | **11** | 12 |
| `Subtipo "X" desactivado bajo "Y"` | **13** | 0 |
| `Producto "X" creado (slug …)` | **34** | 34 |
| Resumen | `categorías tocadas 7; productos creados 34, salteados 0` | `tocadas 4; creados 34, salteados 0` |

Más tres líneas que no dependen del estado de la base:

- La primera nombra la base destino (host, nombre y proyecto de Supabase). Si no es la del cliente, `DATABASE_URL` está apuntando a otro lado.
- `Catálogo: 34 productos leídos de scripts/data/catalogo-unamargo.json.`
- `El catálogo referencia 42 archivos y los 42 están en la demo.` Si falta uno, el script lo nombra y no escribe nada.

**Lo que NO va a estar, y está bien:**

- **Ninguna línea de `Accesorios` como categoría creada ni renombrada.** Ya existe con ese nombre y ese slug, y el sync no escribe lo que ya está bien: **silencio quiere decir que estaba correcto**. Aparece una sola vez, en el renumerado (`Categoría "Accesorios" ordenada en 4.`).
- **11 subtipos creados y no 12**, por lo mismo: `Limpieza` ya existe bajo `Accesorios` y se reusa en vez de duplicarse.
- Las líneas `ordenado en N` / `ordenada en N` (13 en esta corrida) no cambian contenido: reacomodan en qué orden se listan las categorías y los subtipos, dejando 1..N para los que el catálogo declara y el resto detrás.

**Lo que tiene que frenar la corrida:**

- **Cualquier categoría o subtipo creado con slug terminado en `-2`, `-3`, etc.** Las tres líneas de creación — categoría, subtipo y producto — imprimen el slug entre paréntesis, así que alcanza con leerlas. Un slug con sufijo significa que la taxonomía se corrió de lugar: alguien renombró una categoría o un subtipo desde el ERP, que a propósito **no** cambia el slug, y el nombre viejo quedó dueño de la dirección. Seguir crearía una categoría duplicada, con el nombre que el cliente conoce, y los productos adentro de la que no ve.

  **Esta deriva es asimétrica, y por eso el chequeo del slug importa tanto:** `Mates` y `Bombillas` están protegidas por la guarda de slug de los renombres y **abortan ruidoso** (`el slug "mates" ya lo usa la categoría "…"`); `Combos` y `Accesorios` no tienen esa guarda, **crean el duplicado con slug `-2` y la corrida sale con 0 como si todo hubiera ido bien**. El chequeo del slug es lo único que atrapa esa mitad silenciosa. Se arregla desde Configuración — liberando el slug o unificando las dos filas — y recién ahí se vuelve a correr.

- **Cualquier número de la tabla que no coincida.** Si el simulacro creó categorías que esperabas ver renombradas, o desactivó menos de 3, la taxonomía cambió desde el 19/08 y hay que mirar Configuración antes de seguir. El simulacro no escribió nada, así que no hay apuro.
- **Cualquier línea `ERROR:`.** Las ambigüedades que el script no puede resolver solo — dos filas que difieren únicamente en mayúsculas o acentos, un slug ocupado, la categoría vieja y la nueva conviviendo — cortan la corrida con un mensaje en español que dice qué arreglar. Ninguno de esos casos escribe nada.

```bash
# 3. Corrida real, con la salida guardada: es larga y es el único registro de qué subió.
npm run db:import-catalogo 2>&1 | tee ~/import-catalogo-$(date +%Y%m%d-%H%M).log
```

Al terminar: `npm run db:check` (tiene que pasar), `curl https://<instancia>/api/public/v1/stock` (los 34 con precio, descripción, categoría y fotos) y abrir dos o tres fichas en Stock para ver las imágenes servidas de verdad.

### Si falla la fase de fotos

Es la única que puede dejar cosas a medias, porque el bucket no revierte. Lo que el script garantiza:

- Un producto se sube **entero o nada**: primero van todos sus archivos y recién después sus filas de `product_images`, en un solo INSERT. Nunca queda una fila apuntando a un objeto que no está (eso sería una imagen rota en la web del cliente).
- Si la corrida se cae ahí, **buscá la línea `Resumen hasta el fallo (esto quedó escrito)`**: trae los números reales, con los productos ya commiteados y las fotos contadas como **enlazadas**, no como subidas. No cuentes con que sea la última: el `ERROR:` sale después, y encima por stderr mientras el resumen sale por stdout, así que en el log armado con `tee` el orden entre las dos ni siquiera está garantizado.
- El remedio es **volver a correrlo**: retoma por los productos sin fotos y saltea los que ya tienen. Lo que puede sobrar son objetos huérfanos en el bucket (subidos sin su fila), que no se ven en ningún lado y ocupan unos KB. Borrarlos es opcional y se hace desde el panel de Storage de Supabase.
- **Lo que no tiene remedio automático es al revés: filas sin objeto.** `--path-prefix` solo cambia la clave del bucket, y esa clave queda guardada tal cual en `product_images.path`. Si alguien ensaya con `--path-prefix _prueba/` contra la base del cliente y después borra ese prefijo del bucket, quedan 42 filas apuntando a nada — imágenes rotas en la web — y ninguna corrida posterior lo arregla, porque esos productos "ya tienen fotos" y se saltean para siempre. La única salida es borrar esas filas a mano. Por eso: **`--path-prefix` nunca se combina con la base de producción.** Es exclusivamente para ensayos contra una base descartable.

### Ensayos

Para probar el runner sin tocar la instancia del cliente: un Postgres descartable con su propio `DATABASE_URL` **exportado** (el entorno le gana al `.env`, así que la corrida no se va a producción por accidente) y `--path-prefix _prueba/`, que mete todo bajo ese prefijo en el bucket para poder borrarlo después sin dudar de qué era de quién. **Las dos cosas van juntas o ninguna**: el prefijo contra la base del cliente deja filas apuntando a objetos que después se borran (ver arriba). Así se ensayó el runner de punta a punta el 20/08/2026 (base limpia, 34 productos, 42 fotos subidas, servidas y después borradas del bucket) antes de habilitarlo contra la instancia del cliente.

## Smoke checklist manual (QA completo)

1. Login con admin y con operador (contraseña incorrecta → mensaje único de error).
2. Crear producto con stock inicial; aparece el movimiento "Stock inicial" en su historial.
3. Entrada, salida y ajuste por stock contado (la nota es obligatoria en el ajuste; ajustar al mismo valor no genera movimiento).
4. Salida mayor al disponible → rechazada indicando el stock actual.
5. Ciclo de alerta completo: bajar a ≤ mínimo (un email), seguir bajando (sin email), reponer por encima (sin email), volver a bajar (nuevo email). Ver `alert_events`.
6. Editar el mínimo por encima del stock actual → dispara la alerta.
7. Desactivar un producto con stock (confirmación muestra el remanente); desaparece de la API pública; reactivarlo lo devuelve.
8. Ingreso y egreso de dinero; el saldo al cierre del período coincide con el saldo al inicio del siguiente.
9. Anular un egreso (solo admin, con motivo): sale de los totales y del export, queda tachado con "Ver anulados".
10. Exportar CSV del período y abrirlo en Excel es-UY.
11. Importar un CSV con filas válidas e inválidas: la preview marca cada una; re-importar el mismo archivo rechaza todo por "ya existe".
12. `curl` a `/api/public/v1/stock` sin cookies: 200, solo `sku/name/stock/in_stock`, headers de cache y CORS; POST → 405.
13. Operador: puede registrar stock y dinero; no ve Anular, Importar ni Configuración; forzar una action de admin devuelve error en español.
14. Todo lo anterior desde un celular (375px): tablas scrollean dentro de su contenedor, formularios usables.

## Operación y riesgos del free tier

- **Supabase free** pausa los proyectos tras ~1 semana sin actividad: la instancia del cliente puede amanecer caída (la API pública incluida). **Neon free** no pausa pero tiene *cold starts* por scale-to-zero (primer request lento). Recomendación: **Neon** para empezar; si la instancia es crítica, plan pago del proveedor elegido.
- **Resend**: sin dominio verificado solo envía al dueño de la cuenta (ver paso 4). El free tier (100 emails/día) sobra para alertas.
- **Vercel Hobby** prohíbe uso comercial: instancia productiva ⇒ plan Pro.
- **`/api/public/v1/stock`** cachea en el CDN de Vercel por URL completa, no por ruta: un caller anónimo que agregue un query string variable (`?n=1`, `?n=2`...) fuerza un cache miss distinto por cada valor. No es una vulnerabilidad (el endpoint sigue siendo de solo lectura y sin datos sensibles), pero con las campañas de descuento cada miss pasó de 2 a 5 queries, así que el costo por miss es mayor que antes.
- **Backups**: los free tiers no garantizan point-in-time recovery y esta app es la única fuente de verdad del negocio del cliente. Supabase free directamente **no incluye backups automáticos**, así que el dump manual es el único que hay.

  ```bash
  ./scripts/backup.sh                 # lee DATABASE_URL de .env, escribe en ~/backups/erp-unamargo
  ```

  Frecuencia sugerida: semanal + antes de cualquier cambio de configuración grande. Guardar los dumps fuera de la máquina del cliente.

  Tres cosas que el script resuelve y que a mano se hacen mal:

  1. **No va por la conexión directa.** En Supabase free `db.<ref>.supabase.co` resuelve solo a IPv6 y no conecta desde la mayoría de las redes. El backup sale por el **session pooler** (puerto 5432 del host `pooler`), no por el de transacciones.
  2. **Filtra los schemas** con `--schema=public --schema=drizzle`. Sin el filtro el dump arrastra los schemas que administra Supabase (`auth` con 23 tablas, `storage`, `realtime`, `vault`, `graphql`) y al restaurar chocan con los que el proyecto nuevo ya trae.
  3. **Incluye el schema `drizzle`**, que no es opcional: ahí vive el historial de migraciones. Restaurando solo `public`, el próximo `drizzle-kit migrate` reintenta la migración `0000` sobre tablas que ya existen y explota.

  `pg_dump` tiene que ser de versión **mayor o igual a la del servidor** (Supabase corre Postgres 17). En macOS: `brew install libpq`, que queda keg-only en `/opt/homebrew/opt/libpq/bin`.

  Restaurar:

  ```bash
  pg_restore --dbname "postgres://...session-pooler..." --no-owner --no-privileges backup.dump
  ```

  Tira un único error ignorable, `schema "public" already exists`, porque toda base nueva ya lo trae. Ciclo verificado el 18/08/2026 restaurando contra un Postgres limpio: los conteos de las 7 tablas coinciden, el historial de migraciones viaja, y las 7 sentencias `ENABLE ROW LEVEL SECURITY` del hardening se preservan.

## Fuera de alcance (por contrato)

Carrito, pedidos, ventas online o **descuento automático de stock desde la web** (la web muestra disponibilidad; la salida se registra a mano en el ERP) · conexión bancaria, conciliación, contabilidad, impuestos o facturación electrónica · múltiples depósitos, códigos de barras, compras, proveedores, logística, lotes/vencimientos/costos · multi-moneda · WhatsApp/SMS/chatbot · multi-tenancy · construcción de la web del cliente (el ERP le da los datos por la API pública; el sitio es otro proyecto) · registro público de usuarios, recuperación de contraseña por email, 2FA · reportes/gráficos adicionales · modificación de la web del cliente (solo existe la API pública de stock).

Las ideas que surjan se anotan en [BACKLOG.md](BACKLOG.md) y se cotizan aparte.
