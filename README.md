# surlabs-erp

Sistema de gestión operativo para pymes, por **Surlabs**: control de stock de un depósito, balance operativo compartido, alertas de stock bajo por email, importación inicial por CSV y una API pública de solo lectura con el stock.

Se construye como **base reutilizable**: una instancia (deploy + base Postgres propia) por cliente, parametrizada por `config/instance.json` + seed. Sin multi-tenancy. Primera instancia: Unamargo (Uruguay).

> Estado: **Hito 0 — cimientos**. Módulos de stock (H1), dinero (H2), alertas/import/API pública (H3) y guía de deploy completa (H4) en construcción.

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

Credenciales demo (impresas también por el seed):

| Rol | Email | Password |
|---|---|---|
| Administración | `admin@unamargo.demo` | `unamargo-admin` |
| Operación | `operador@unamargo.demo` | `unamargo-operador` |

## Scripts

| Comando | Qué hace |
|---|---|
| `npm run verify` | `typecheck && lint && test && build` — compuerta de cada commit |
| `npm run db:generate` | Genera migraciones SQL desde `src/lib/db/schema.ts` |
| `npm run db:migrate` | Aplica migraciones |
| `npm run db:seed` | Seed de instancia desde `config/instance.json` (fallback: example) |
| `npm run db:seed -- --demo [--reset]` | Seed demo Unamargo (`--reset` borra todo antes) |
| `npm run db:check` | Verifica invariante de stock (cache == Σ ledger) |
| `npm run user:create -- --email … --name … --role …` | Alta de usuario por CLI (máx. 5 activos) |

## Variables de entorno

Ver [.env.example](.env.example). Regla clave: en producción `DATABASE_URL` debe ser la **connection string con pooler** (Supabase pgbouncer :6543 / host `-pooler` de Neon) porque el runtime es serverless.

## Deploy de una nueva instancia

La guía completa paso a paso (crear DB free tier, Vercel, Resend con dominio verificado, seed real sin datos demo, rotación de credenciales, checklist post-deploy, riesgos del free tier y backups) se escribe en el **Hito 4**. Esqueleto del proceso: crear base → `DATABASE_URL` con pooler → `npm run db:migrate` → editar `config/instance.json` → `npm run db:seed` → proyecto nuevo en Vercel → smoke.
