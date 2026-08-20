# Import del catálogo de Unamargo

Diseño validado el 20/08/2026. Alcance: H7, primera mitad.

## Objetivo

Cargar en el ERP los 34 SKU reales de Unamargo con precio, descripción,
clasificación y fotos, tomados de la demo HTML que el cliente construyó por su
cuenta. Al terminar, la instancia deja de estar vacía y la API pública devuelve
un catálogo con el que se puede construir la web.

Este spec cubre **solo el import**. La web pública es un proyecto aparte, con su
propio spec, y arranca cuando esto esté cargado.

## De dónde salen los datos

`web-unamargo/claude code unamargo/` contiene la demo del cliente: un
`index.html` de 2695 líneas con un array `PRODUCTS` de 30 entradas, y 62
imágenes ya optimizadas (11 MB contra 151 MB de los originales). Las 30 entradas
incluyen nombre, precio, descripción corta y larga, specs estructuradas y rutas
de imagen. Ocho traen variantes con precio propio.

La demo también trae un `panel-compartido/Code.gs`: venían administrando esto
con Google Apps Script y una planilla. El ERP reemplaza eso.

## Decisiones tomadas y por qué

| Decisión                                  | Motivo                                                                                                                                                                                                                                                                                      |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Un SKU por variante**                   | El ERP lleva stock por SKU y su regla es explícita: cada variante cuenta como un SKU. Agrupar perdería saber cuántos camioneros pulidos quedan contra cuántos clásicos, justo en los productos que más se venden.                                                                           |
| **SKU legibles derivados del nombre**     | Son 34 items que el cliente va a leer en pantalla todos los días. Códigos opacos tipo `MAT-001` son inmunes a que cambie el nombre, pero ilegibles. Se descartan preposiciones (`DE`, `CON`, `PARA`, `Y`) para que ninguno se acerque al límite de 40 caracteres: el más largo queda en 36. |
| **Taxonomía de la demo, no la inferida**  | Las 6 categorías sembradas el 19/08 fueron una inferencia mía a partir de los SKU del seed demo. La demo del cliente trae su rubro real: Mates, Bombillas, Combos, Accesorios. Termo y Yerba los inventé y no venden ninguno.                                                               |
| **Subtipo = forma del mate**, no material | El campo `material` de la demo no sirve como filtro: "combinado" cubre 19 de 30. Las formas (camionero, porongo, torpedo, imperial, ranchero) clasifican 13 de 14 mates y son por lo que un matero busca.                                                                                   |
| **Bombillas sin subtipo**                 | Son 6 productos; un segundo nivel de filtro no separa nada útil. El ERP admite categoría sin subtipo. Se agregan cuando el catálogo crezca.                                                                                                                                                 |
| **Stock inicial en 0**                    | El campo `stock` de la demo es el string `"En stock"`, no un número. Las cantidades salen de un conteo físico del cliente y nadie más puede inventarlas.                                                                                                                                    |
| **Las fotos se suben al ERP**             | Ya existe la galería por producto. Dejarlas en el repo de la web haría que el ERP y la web discrepen sobre cómo se ve un producto, y el cliente no podría cambiar una foto sin nosotros.                                                                                                    |

## Lo que hace editable a todo esto

Importar con `currentStock: 0` **no crea ningún movimiento de stock**:
`createProductAction` solo inserta en el ledger `if (initialStock > 0)`.

Sin movimientos, el SKU sigue siendo editable desde la pantalla, porque el
bloqueo depende de `moved > 0`. Es decir: este import es un borrador corregible,
no una decisión grabada. Recién cuando el cliente haga el primer conteo y
registre movimientos, los SKU quedan fijos.

## Las tres fusiones, y qué confirmar con el cliente

La demo trae productos duplicados entre sí. La evidencia es que **comparten
archivos de imagen**, lo que no pasaría si fueran productos distintos.

| Se descarta                           | A favor de               | Evidencia                                                                   |
| ------------------------------------- | ------------------------ | --------------------------------------------------------------------------- |
| Camionero Pulido                      | Mate Camionero           | Mismas 2 fotos y precios idénticos: Clásico $490, Pulido $690               |
| Porongo Pulido                        | Porongo                  | Mismas 2 fotos. El Clásico difiere: $450 contra $490                        |
| Combo Porongo Virola Chata + Posamate | Combo Porongo + Posamate | Foto compartida y mismo precio $990; ya existe como variante "Virola Chata" |

Un producto llamado "Pulido" que además tiene una variante "Clásico" es una
contradicción, y es la señal más clara de que se cargó dos veces.

**Supuesto que el cliente tiene que confirmar:** en el porongo clásico se toma
**$490**, el mayor de los dos precios en conflicto. Cobrar de menos es peor que
cobrar de más, y es trivial de corregir en pantalla.

**No se fusionan** "Combo Camionero + Posamate" y "Combo Camionero Virola +
Posamate": no comparten ninguna foto, y la virola es un aro de metal que
probablemente los hace productos distintos de verdad.

## Corrección de la taxonomía sembrada

Hoy en producción hay 6 categorías con 23 subtipos y **cero productos**. Este es
el momento sin costo de corregirla.

- **Se crea** `Combos`, que no existía y tiene 7 productos.
- **Se desactivan** `Termo` y `Yerba`: los inferí yo y el cliente no vende ninguno.
- **Se desactiva** `Matera` como categoría: sus 4 productos van dentro de
  `Accesorios`, que es como los agrupa el cliente en su propia demo.
- **Se reemplazan los subtipos** de `Mates` (hoy materiales) por las formas.

Desactivar y no borrar es la regla del ERP para categorías, y acá además
conviene: si el cliente prefiere después separar Materas, se reactiva.

## El catálogo: 34 SKU

| SKU                                                                            | Nombre                                  | Categoría  | Subtipo       | Precio |
| ------------------------------------------------------------------------------ | --------------------------------------- | ---------- | ------------- | ------ |
| `MATE-RANCHERO-ALGARROBO`                                                      | Mate Ranchero de Algarrobo              | Mates      | Ranchero      | $1990  |
| `MATE-CAMIONERO-CLASICO`                                                       | Mate Camionero (Clásico)                | Mates      | Camionero     | $490   |
| `MATE-CAMIONERO-PULIDO`                                                        | Mate Camionero (Pulido)                 | Mates      | Camionero     | $690   |
| `COMBO-GALLETA`                                                                | Combo Galleta                           | Combos     | Con galleta   | $1290  |
| `MATE-TORPEDO-CUERO-VACA`                                                      | Torpedo de Cuero de Vaca                | Mates      | Torpedo       | $2490  |
| `ACC-MATERA-CANASTA-ECOCUERO`                                                  | Matera Canasta de Ecocuero              | Accesorios | Materas       | $1790  |
| `MATE-ALGARROBO-OSCURO`                                                        | Algarrobo Oscuro                        | Mates      | —             | $1990  |
| `MATE-IMPERIAL-ALGARROBO`                                                      | Imperial de Algarrobo                   | Mates      | Imperial      | $1990  |
| `MATE-CAMIONERO-VIROLA-NEGRO`                                                  | Camionero Virola (Negro)                | Mates      | Camionero     | $690   |
| `MATE-CAMIONERO-VIROLA-MARRON`                                                 | Camionero Virola (Marrón)               | Mates      | Camionero     | $690   |
| `ACC-MATERA-DIVIDIDA`                                                          | Matera Dividida                         | Accesorios | Materas       | $990   |
| `MATE-PORONGO-CLASICO`                                                         | Porongo (Clásico)                       | Mates      | Porongo       | $490   |
| `MATE-PORONGO-PULIDO`                                                          | Porongo (Pulido)                        | Mates      | Porongo       | $690   |
| `MATE-PORONGO-VIROLA-CHATA`                                                    | Porongo Virola Chata                    | Mates      | Porongo       | $750   |
| `MATE-IMPERIAL-ZEBRA`                                                          | Imperial Zebra                          | Mates      | Imperial      | $2490  |
| `COMBO-PORONGO-POSAMATE-VIROLA-CHATA`                                          | Combo Porongo + Posamate (Virola Chata) | Combos     | Con porongo   | $990   |
| `COMBO-PORONGO-POSAMATE-CLASICO`                                               | Combo Porongo + Posamate (Clásico)      | Combos     | Con porongo   | $850   |
| `COMBO-PORONGO-POSAMATE-PULIDO`                                                | Combo Porongo + Posamate (Pulido)       | Combos     | Con porongo   | $990   |
| `COMBO-CAMIONERO-POSAMATE-CLASICO`                                             | Combo Camionero + Posamate (Clásico)    | Combos     | Con camionero | $890   |
| `COMBO-CAMIONERO-POSAMATE-PULIDO`                                              | Combo Camionero + Posamate (Pulido)     | Combos     | Con camionero | $990   |
| `COMBO-CAMIONERO-VIROLA-POSAMATE`                                              | Combo Camionero Virola + Posamate       | Combos     | Con camionero | $990   |
| `BOMB-BOMBILLON-DISENO`                                                        | Bombillón con Diseño                    | Bombillas  | —             | $790   |
| `BOMB-APLIQUES`                                                                | Bombilla con Apliques                   | Bombillas  | —             | $690   |
| `BOMB-BOMBILLON-PICO-LORO-DORADO`                                              | Bombillón Pico Loro Dorado              | Bombillas  | —             | $990   |
| `BOMB-BOMBILLON-LISO`                                                          | Bombillón Liso                          | Bombillas  | —             | $890   |
| `BOMB-BOMBILLON-DORADO`                                                        | Bombillón Dorado                        | Bombillas  | —             | $1090  |
| `MATE-TORPEDO-VIROLA-SIMPLE-NEGRO`                                             | Torpedo Virola Simple (Negro)           | Mates      | Torpedo       | $690   |
| `MATE-TORPEDO-VIROLA-SIMPLE-MARRON`                                            | Torpedo Virola Simple (Marrón)          | Mates      | Torpedo       | $690   |
| `ACC-MATERA-CUERO-CRUDO-TRENZADA`                                              | Matera Cuero Crudo Trenzada             | Accesorios | Materas       | $2390  |
| `ACC-MATERA-CUERO-CRUDO-COCIDA-TIENTO`                                         | Matera Cuero Crudo Cocida con Tiento    | Accesorios | Materas       | $2390  |
| `ACC-YERBERO-AMARGO`                                                           | Yerbero Un Amargo                       | Accesorios | Yerberos      | $490   |
| `BOMB-BOMBILLON-RECTO-PREMIUM-DORADO`                                          | Bombillón Recto Premium Dorado          | Bombillas  | —             | $1090  |
| `ACC-BASE-REPOSAMATE`                                                          | Base Reposamate                         | Accesorios | Posamates     | $349   |
| `ACC-SECADOR-MATE-BOMBILLA`                                                    | Secador para Mate y Bombilla            | Accesorios | Limpieza      | $349   |
| Siete productos quedan **sin subtipo**: las 6 bombillas por decisión, y        |
| "Algarrobo Oscuro" porque su nombre indica material y no forma. Inventarle una |
| forma sería peor que dejarlo sin clasificar.                                   |

## Mapeo de campos

| Campo del ERP  | Origen                          | Transformación                                                           |
| -------------- | ------------------------------- | ------------------------------------------------------------------------ |
| `sku`          | generado                        | Prefijo de categoría + palabras del nombre sin preposiciones + variante  |
| `name`         | `name` de la demo               | Con la variante entre paréntesis: "Mate Camionero (Pulido)"              |
| `price`        | `price` o `variants[].price`    | String decimal de dos decimales. **Nunca float.**                        |
| `description`  | `fullDesc` + `specs`            | Las specs se anexan como líneas `Etiqueta: valor`                        |
| `slug`         | generado del nombre             | Ya lo hace `createProductAction`                                         |
| `categoryId`   | `category`                      | Mapeo directo a las 4 categorías                                         |
| `subtypeId`    | derivado del nombre             | Forma para mates, agrupación natural para el resto; nulo si no clasifica |
| fotos          | `images[]` / `variants[].image` | 42 archivos, 33-95 KB cada uno                                           |
| `currentStock` | —                               | **0**                                                                    |
| `minStock`     | —                               | **0**, o sea sin control de mínimo hasta que el cliente lo defina        |

`specs` no tiene campo propio en el ERP y no se crea uno: son cuatro líneas por
producto que caben en la descripción sin perder nada, y agregar una tabla de
atributos por un caso que nadie pidió sería construir de más.

## Consecuencia del stock en cero, y cómo se resuelve

Con los 34 productos en 0, la API pública devuelve `in_stock: false` en todos.
Si la web mostrara disponibilidad tal cual, saldría diciendo que no hay nada.

**No se tapa con un valor inventado.** Se resuelve en la web, que es donde
corresponde: mientras el ERP no tenga conteos reales, la ficha dice "Consultá
disponibilidad" en lugar de "Sin stock". Cuando el cliente cuente, pasa a
mostrar disponibilidad real sin tocar código.

Eso queda anotado como requisito para el spec de la web.

## El script

`scripts/import-catalogo.ts`, en el repo del ERP, junto al resto de los scripts.

**Idempotente.** Si un SKU ya existe, lo saltea y sigue. Correrlo dos veces no
duplica nada ni falla. Eso permite arreglar un problema a mitad de camino y
volver a correrlo entero.

**Orden de las operaciones, y por qué.** Por producto: primero se sube cada
imagen al bucket, después se inserta el producto, y recién al final se insertan
las filas de `product_images`. Al revés, una subida fallida dejaría una fila
apuntando a una foto que no está, que es lo que se ve roto en la web. Un archivo
huérfano en el bucket, en cambio, es invisible y barato.

**Las imágenes se suben ya optimizadas.** El redimensionado del ERP vive en el
navegador y existe para que una foto de celular no choque contra el corte de
4.5 MB de Vercel. Acá los archivos ya pesan entre 33 y 95 KB y el script corre
en Node, así que se suben tal cual por la API de Storage.

**Nombres de archivo únicos.** Cada objeto lleva un uuid, igual que la subida
por pantalla, porque el CDN de Supabase cachea las URLs públicas y reusar una
ruta al reemplazar una foto dejaría al cliente viendo la vieja.

## Verificación

Antes de tocar la base del cliente, el script corre **entero** contra un
Postgres local en Docker, con las imágenes yendo a un prefijo `_prueba/` del
bucket que se borra después. Se comprueba:

1. Los 34 SKU se crean, ninguno duplicado.
2. Cada producto queda con su categoría y, si corresponde, su subtipo.
3. Correrlo dos veces no crea un segundo juego: la segunda corrida saltea los 34.
4. Ningún producto queda con movimientos de stock, o sea que el SKU sigue editable.
5. `npm run db:check` pasa: el invariante de stock se mantiene.
6. La API pública devuelve los 34 con precio, descripción, categoría y fotos, y
   ningún id interno.
7. Las fotos cargan por su URL pública.

Recién con eso verde se corre contra producción, con un `pg_dump` previo.

## Fuera de alcance

La web pública, el conteo de stock, los mates personalizados como producto, las
zonas de envío y cualquier cambio al modelo de datos del ERP. El import usa el
esquema tal como está.

## Pendiente de confirmar con el cliente

1. Las tres fusiones de productos duplicados.
2. El precio del porongo clásico: $450 o $490.
3. Que "Combo Camionero + Posamate" y "Combo Camionero Virola + Posamate" son
   efectivamente productos distintos.
4. Los conteos físicos de stock, que son lo único que este import no puede traer.
