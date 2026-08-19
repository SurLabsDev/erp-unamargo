# Descuentos por campaña

Diseño validado el 19/08/2026. Alcance: H6.

## Objetivo

Que el cliente pueda armar campañas de descuento por tiempo limitado (tipo "Día
del Padre") eligiendo a qué productos, subtipos o categorías aplican, y que la
web pública muestre el precio con descuento junto al precio de lista.

El descuento es **información de exhibición**, igual que `products.price`. No
toca stock, no toca el módulo Dinero y no registra ventas: las ventas se cierran
por WhatsApp y la salida de stock se registra a mano, como hoy.

## Decisiones tomadas y por qué

| Decisión                                                         | Motivo                                                                                                                                                                                    |
| ---------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Precedencia **producto > subtipo > categoría**                   | Permite "todos los mates 30%, pero el imperial solo 10%", que es control real sobre el margen. La alternativa (gana el mayor) ignoraba en silencio un descuento menor puesto a propósito. |
| Empate a misma especificidad: **gana el porcentaje mayor**       | Caso que la precedencia no resuelve sola. Determinista y nunca deja al comprador pagando de más.                                                                                          |
| **Solo porcentaje**                                              | Es lo que se comunica en una campaña y funciona igual sobre productos de cualquier precio. Un monto fijo sobre una categoría entera puede dejar productos baratos en cero.                |
| **Fechas obligatorias + interruptor**                            | Las fechas evitan el descuento fantasma (la campaña de agosto descontando en diciembre). El interruptor permite pausar o preparar sin borrar.                                             |
| **Tope de 90%**                                                  | Un dedo de más convierte 10% en 100% y regala el catálogo. Para regalar algo se pone precio 0 a mano, que es una decisión visible.                                                        |
| **Objetivos con tres columnas nullable + CHECK**, no polimórfico | Mantiene foráneas reales en los tres niveles. Un `target_id` polimórfico no puede tener FK y dejaría objetivos apuntando a productos borrados.                                            |
| **Resolución en una función pura**, no en SQL                    | Convención del repo: reglas de negocio testeables sin base. A 150 SKU la diferencia de rendimiento no es medible; los tests sí valen.                                                     |
| **Las campañas no se borran**                                    | Igual que las categorías: si desaparecen, nadie puede explicar después por qué la web mostraba otro precio.                                                                               |
| **Sin redondeo del precio final**                                | Redondear por el cliente es decidirle el margen. Si quiere números redondos, los elige al poner el precio.                                                                                |
| **`price` sigue siendo el precio de lista**                      | Cambiarle el significado a un campo existente de `/v1` es una rotura silenciosa. Los campos nuevos se agregan, no se resignifican.                                                        |

## Modelo de datos

```sql
create table discount_campaigns (
  id          uuid primary key default gen_random_uuid(),
  name        text     not null,
  percentage  smallint not null,
  starts_on   date     not null,
  ends_on     date     not null,
  is_active   boolean  not null default true,
  created_by  uuid     not null references users(id),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint discount_campaigns_percentage_check
    check (percentage between 1 and 90),
  constraint discount_campaigns_dates_check
    check (ends_on >= starts_on)
);

create table discount_targets (
  id          uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references discount_campaigns(id),
  product_id  uuid references products(id),
  subtype_id  uuid references product_subtypes(id),
  category_id uuid references product_categories(id),
  constraint discount_targets_exactly_one_check
    check (num_nonnulls(product_id, subtype_id, category_id) = 1)
);

create unique index discount_targets_campaign_product_key
  on discount_targets (campaign_id, product_id) where product_id is not null;
create unique index discount_targets_campaign_subtype_key
  on discount_targets (campaign_id, subtype_id) where subtype_id is not null;
create unique index discount_targets_campaign_category_key
  on discount_targets (campaign_id, category_id) where category_id is not null;
create index discount_targets_campaign_idx on discount_targets (campaign_id);
```

Los índices únicos son **parciales** porque un `UNIQUE (campaign_id, product_id)`
común no impediría dos filas con `product_id` nulo repetido: en Postgres los
nulos no se comparan entre sí.

`updated_at` se actualiza a mano en las server actions, como ya hace `products`.

## Reglas de resolución

Función pura en `src/lib/domain/discounts.ts`.

**Vigencia.** Una campaña está vigente cuando `is_active` es verdadero **y** la
fecha de hoy, calculada en `settings.timezone`, cae entre `starts_on` y
`ends_on` inclusive. Nunca en UTC del servidor: es la regla 4 del `AGENTS.md`, y
con Montevideo en UTC-3 una campaña que termina "hoy" se apagaría tres horas
antes de tiempo.

**Estado mostrado en el ERP**, derivado y no almacenado:

| Estado     | Condición                             |
| ---------- | ------------------------------------- |
| Pausada    | `is_active` falso, cualquier fecha    |
| Programada | activa, `hoy < starts_on`             |
| Activa     | activa, `starts_on <= hoy <= ends_on` |
| Terminada  | activa, `hoy > ends_on`               |

**Elección de la campaña ganadora**, para un producto dado y el conjunto de
campañas vigentes:

1. Si el producto no tiene `price`, no hay descuento. Fin.
2. Se juntan las campañas que apuntan al producto **directamente**. Si hay al
   menos una, gana la de mayor `percentage` y se termina.
3. Si no hubo ninguna, se repite con las que apuntan a su `subtype_id`.
4. Si no hubo ninguna, se repite con las que apuntan a su `category_id`.
5. Si no hubo ninguna, no hay descuento.

Un producto sin clasificar (importado por CSV) solo puede recibir descuentos
apuntados a él directamente, que es lo correcto: no pertenece a ninguna
categoría.

**Una categoría o subtipo desactivado sigue aplicando su descuento** a los
productos ya clasificados en él. Desactivar significa "no ofrecer esto para
clasificaciones nuevas", no "estos productos perdieron su categoría": los
productos conservan la suya, y un descuento que dejara de aplicar por un cambio
en otra pantalla sería un efecto invisible.

**Cálculo.** En centavos con `BigInt`, nunca floats, siguiendo la decisión ya
tomada para el módulo Dinero. `descuento = round(centavos * percentage / 100)`
con redondeo medio-arriba; `final = centavos - descuento`. El resultado vuelve a
string decimal con dos decimales.

Ejemplo: `999.99` con 15% da `99999 * 15 / 100 = 14999.85` centavos, que redondea
a `15000`, y el final es `84999` centavos, o sea `849.99`.

## Pantallas

**`/descuentos`**, sección nueva en la barra, **solo administración**. Un
operador no la ve y las actions rechazan su llamada, igual que Importar y
Configuración.

- **Lista**: nombre, porcentaje, período, estado calculado y cuántos objetivos
  tiene cada campaña. Acciones: crear, editar, pausar y reactivar.
- **Detalle**: edición de la campaña y administración de objetivos, con tres
  selectores (categoría, subtipo, producto) que agregan filas a la lista de
  objetivos. Cada objetivo se puede quitar.

**Catálogo de stock y ficha del producto**: cuando hay un descuento vigente se
muestra el precio final y el nombre de la campaña que lo está aplicando. Sin
esto, un cliente que carga 10% a un producto dentro de una categoría con 30% no
entiende por qué la web muestra otro número.

**Panel**: aviso con la cantidad de campañas activas, enlazado a `/descuentos`.
Es la red contra la campaña olvidada.

## API pública

`GET /api/public/v1/stock`. Cambio **aditivo**: los campos existentes conservan
nombre y significado.

```json
{
  "sku": "MATE-IMP-CUE",
  "price": "1250.50",
  "price_final": "1000.40",
  "discount": { "percentage": 20, "campaign": "Día del Padre 2026" }
}
```

- `price`: precio de lista. **Sin cambios de significado.**
- `price_final`: lo que paga el comprador. Igual a `price` cuando no hay
  descuento. `null` si el producto no tiene precio cargado.
- `discount`: `null` cuando no hay campaña vigente para ese producto.

La cache se mantiene en `s-maxage=60, stale-while-revalidate=300`. Una campaña
que arranca a medianoche tarda hasta un minuto en verse, lo que es aceptable y
evita tener que invalidar la cache desde el ERP.

## Tests

Sobre la función pura, sin base:

1. Precedencia: producto le gana a subtipo, subtipo le gana a categoría.
2. Empate a misma especificidad: gana el porcentaje mayor.
3. Bordes de fecha en la zona horaria de la instancia: empieza hoy es vigente,
   terminó ayer no, termina hoy sí.
4. `is_active` falso no aplica aunque las fechas coincidan.
5. Producto sin `price` no recibe descuento en ningún nivel.
6. Producto sin clasificar solo recibe descuentos apuntados a él.
7. Redondeo a centavos, incluido el caso medio-arriba.
8. Estados derivados: pausada, programada, activa, terminada.

Verificación en browser real antes de dar por cerrado: crear una campaña,
apuntarla a una categoría, comprobar el precio en la ficha y en la API, y que un
descuento a nivel producto pisa al de categoría.

## Fuera de alcance

Códigos de cupón, descuentos por cliente, por cantidad, acumulación de
campañas, montos fijos, precio final fijo y vigencia por hora. Nada de eso se
pidió y cada uno multiplica los casos de borde.

## Migración y despliegue

Migración aditiva: dos tablas nuevas y ningún cambio a las existentes. No
requiere backfill ni ventana de mantenimiento. Los deploys anteriores siguen
funcionando contra el esquema nuevo porque no seleccionan esas tablas.
