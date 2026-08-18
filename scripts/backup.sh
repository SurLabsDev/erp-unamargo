#!/bin/bash
# Backup de una instancia. Uso:
#   ./scripts/backup.sh                      -> lee DATABASE_URL de .env
#   DATABASE_URL="postgres://..." ./scripts/backup.sh
#   ./scripts/backup.sh /otro/directorio
#
# Requiere pg_dump >= la version del servidor (Supabase corre Postgres 17).
#   macOS: brew install libpq  (queda en /opt/homebrew/opt/libpq/bin, keg-only)
set -euo pipefail

DEST="${1:-$HOME/backups/erp-unamargo}"
cd "$(dirname "$0")/.."

# En Supabase FREE la conexion directa (db.<ref>.supabase.co) es IPv6 only y no
# resuelve desde la mayoria de las redes: el backup va por el SESSION POOLER
# (puerto 5432 del host pooler), que es el que quedo en .env.
URL="${DATABASE_URL:-}"
if [ -z "$URL" ] && [ -f .env ]; then
  URL=$(grep -m1 '^DATABASE_URL=' .env | sed 's/^DATABASE_URL=//; s/^"//; s/"$//')
fi
[ -n "$URL" ] || { echo "falta DATABASE_URL (ni en el entorno ni en .env)"; exit 1; }

command -v pg_dump >/dev/null || export PATH="/opt/homebrew/opt/libpq/bin:$PATH"
command -v pg_dump >/dev/null || { echo "pg_dump no encontrado: brew install libpq"; exit 1; }

mkdir -p "$DEST"
OUT="$DEST/unamargo-$(date +%Y%m%d-%H%M).dump"

# Solo los schemas de la app. Sin el filtro, el dump arrastra los schemas que
# administra Supabase (auth, storage, realtime, vault, graphql) y al restaurar
# chocan con los que el proyecto nuevo ya trae.
# `drizzle` NO es opcional: guarda el historial de migraciones. Sin el,
# `drizzle-kit migrate` sobre la base restaurada reintenta la migracion 0000.
pg_dump "$URL" --schema=public --schema=drizzle --format=custom --file="$OUT"

echo "OK  $OUT  ($(du -h "$OUT" | cut -f1))"
echo "verificando que sea legible..."
pg_restore --list "$OUT" | grep -c "TABLE DATA" | xargs -I{} echo "  {} tablas con datos en el dump"
