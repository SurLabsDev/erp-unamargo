# Evidencia de criterios de aceptación

Mapa de cada AC de la especificación (PROMPT_ERP.md §5–§10) a su evidencia:
**T** = test de Vitest (corre en `npm run verify`) · **S** = smoke ejecutado el
12/08/2026 contra el seed demo (build de producción local + Postgres real) ·
**M** = pendiente de verificación manual en la instancia desplegada (checklist
post-deploy del README).

| AC | Criterio | Evidencia |
|---|---|---|
| AC-USR-1 | 6.º usuario activo rechazado | T `domain/limits.test.ts` (regla) + validación bajo lock en `configuracion/actions.ts` |
| AC-USR-2 | Operator forzando action de admin es rechazado server-side | S (operador sin acciones admin vía HTTP; ver DECISIONS: se responde `{ok:false}` con mensaje, no 403 literal) |
| AC-USR-3 | Usuario desactivado expulsado al siguiente request | Código: `getCurrentUser` re-lee `is_active` por request · M (paso 13 del smoke) |
| AC-STK-1 | Salida > disponible rechazada, stock intacto | S (guard atómico verificado; mensaje con disponible) |
| AC-STK-2 | Ajuste a 0 con nota → delta correcto, resulting 0 | T `domain/stock.test.ts` (delta) + S (flujo de ajuste) |
| AC-STK-3 | SKU activo n.º 151 rechazado | T `domain/limits.test.ts` (planner import) + misma regla bajo lock en alta/reactivación |
| AC-STK-4 | Dos salidas concurrentes jamás dejan stock negativo | S (script de concurrencia: 2×(-6) sobre 10 → una sola gana, ledger íntegro) |
| AC-STK-5 | Entrada+salida → historial con usuario, sin editar/borrar | S (H1) |
| AC-BAL-1 | Fixture 1000/+500 (05/07)/−200 (10/08) → agosto 1500/−200/1300 | T `domain/money.test.ts` + S (números exactos del demo en /dinero) |
| AC-BAL-2 | Cierre de un período == inicio del siguiente | T `domain/money.test.ts` |
| AC-BAL-3 | Anulado fuera de totales/export, visible con motivo y autor | S (anulado de $999 del demo) |
| AC-BAL-4 | Fecha futura / anterior al corte / monto 0 rechazados | T `domain/money.test.ts` (validateCashDate, amountSchema) |
| AC-BAL-5 | CSV abre bien en Excel es-UY | T (formato: BOM/;/coma) + S (bytes verificados) · M (apertura real en Excel, paso 10) |
| AC-ALR-1 | Cruce del mínimo dispara una vez; seguir bajando no | T `domain/alerts.test.ts` + S (ciclo contra DB real) |
| AC-ALR-2 | Rearme estricto y re-disparo con eventos auditados | T + S (2 eventos exactos en `alert_events`) |
| AC-ALR-3 | Subir el mínimo por encima del stock dispara | T `domain/alerts.test.ts` |
| AC-ALR-4 | `min_stock = 0` = sin control | T (`decideAlertTransition` + `isLowStock`) |
| AC-ALR-5 | Sin API key todo funciona; evento `skipped` | S (outbox pending→skipped con motivo) |
| AC-IMP-1 | Import parcial con motivos; re-import rechaza todo | T `domain/import.test.ts` (parser) + S (executeImport + re-import contra DB) |
| AC-API-1 | 200 sin cookies, contrato exacto, CORS, cache | S (curl: shape con 4 campos, s-maxage=60+SWR, CORS *, POST→405, OPTIONS→204) |
| AC-API-2 | Producto desactivado desaparece de la API | S (curl antes/después de desactivar) |

Además: `npm run db:check` (invariante cache == Σ ledger) ejecutado tras cada
smoke — siempre OK.
