# Diseño

Cómo conseguir en este ERP la prolijidad del login de `formulario.surlabs.tech`,
**con la identidad de Un Amargo**.

> **De dónde salen los colores.** Los tokens de `globals.css` son los mismos hex
> que `web-unamargo/src/app/globals.css`, y están escritos en hex y no en oklch
> a propósito: la marca está definida en hex del otro lado, y traducir agrega un
> paso donde un valor puede alejarse de la marca sin que nadie lo note. Así
> verificar que los dos repos pintan igual es un grep. Si la marca cambia allá,
> cambia acá.

Esto **no** pide tirar shadcn. shadcn está bien y ya está instalado: lo que hay
que hacer es afinarle los tokens y respetar seis o siete reglas. La prolijidad
casi nunca viene de la librería de componentes, viene de la disciplina.

Y algo que conviene decir de entrada: **un ERP no es una landing.** Buena parte
de lo que hace lindo a un sitio de marketing (aire enorme, tipografía gigante,
una sola columna) acá juega en contra. Al final está separado qué transfiere y
qué no.

---

## 1. Lo que más se nota: los grises son grises puros

Hoy todos los neutros del proyecto tienen croma cero:

```css
--background: oklch(1 0 0);       /* blanco puro */
--foreground: oklch(0.145 0 0);   /* casi negro, sin nada de color */
```

Un gris de croma cero se lee clínico, como una planilla. Darle una pizca de
croma, siempre en el mismo tono, hace que el conjunto se lea intencional. Es el
cambio de una línea que más se nota, y es la razón por la que el formulario usa
`#0d0c0b` y no `#000000`.

**Nunca blanco puro ni negro puro.** Sacan toda la profundidad.

```css
:root {
  --background:       oklch(0.995 0.002 80);  /* #fefdfc */
  --foreground:       oklch(0.18  0.006 60);  /* #14110f  18.6:1 sobre el fondo */
  --muted:            oklch(0.968 0.004 80);
  --muted-foreground: oklch(0.505 0.010 70);  /* #68645f   5.8:1 */
  --border:           oklch(0.90  0.006 80);  /* filete decorativo */
  --input:            oklch(0.66  0.010 75);  /* borde de control, ver punto 3 */
}
```

El `80` es el tono: cálido, tirando a arena. Si lo preferís frío, usá `250` en
todos por igual. **Un solo tono para todos los neutros.** Mezclar grises cálidos
y fríos en el mismo producto es lo que hace que algo se vea sucio sin que sepas
por qué.

**Cómo quedó al adoptar la marca de Un Amargo.** Su paleta es de gris neutro
puro (`#0a0a0a`, `#555555`, `#e8e8e8`, `#f2f2f2`), o sea justo lo que este
punto desaconseja. Las dos reglas se cruzan y la resolución es quedarse con
las dos mitades que no chocan: **el tono neutro de la marca**, porque es la
marca y no es negociable, y **la prohibición de los extremos puros**, porque
esa parte es la que de verdad saca profundidad. Por eso el fondo es `#fafafa`
y no `#ffffff`, y la tinta es `#0a0a0a` y no `#000000`. La marca ya había
elegido un near-black por la misma razón. Un solo tono sigue valiendo: acá
todos los neutros son el mismo gris neutro, ninguno es cálido.

## 2. Un acento, y uno solo

Hoy `--primary` es `oklch(0.205 0 0)`, o sea gris oscuro. Por eso el botón
"Ingresar" es negro. Funciona y es sobrio, pero el producto no tiene identidad.

Elegí **un** color de acento y usalo en todo el ERP: la acción primaria, el
estado activo del menú, el foco. Nada más. Si estás por agregar un segundo
acento, estás rompiendo el sistema.

La regla que más veces se viola y que es medible: **el texto sobre el acento
tiene que pasar 4.5:1.** En el sitio de SurLabs el botón naranja lleva texto
casi negro y no hueso, porque hueso sobre naranja da 3.12:1 y no pasa, y tinta
sobre naranja da 5.21:1 y sí. Medilo antes de shipear, no lo mires a ojo.

**Acá el acento es el verde de Un Amargo (`#0e6e50`), y eso INVIERTE la regla
anterior.** El ember de SurLabs era claro y pedía texto tinta; el verde es
oscuro y pide texto **blanco**:

| sobre `#0e6e50` | contraste | |
|---|---|---|
| blanco `#ffffff` | 6.24:1 | pasa |
| tinta `#0a0a0a` | 3.17:1 | **no pasa** |

No es preferencia, es el número: un botón verde con texto negro no pasa AA. Y
es el mismo verde con el mismo texto blanco en claro y en oscuro, para tener
una regla menos que se pueda romper.

**El acento no significa "el número subió".** Significa acción, estado activo y
foco. Si además pintara las cifras buenas, el mismo verde diría dos cosas y el
botón verde de al lado se leería como un estado. La dirección de una variación
ya la dice el signo del texto.

**Y el rojo se reserva para lo accionable.** Una baja de 5% contra el período
anterior es ruido normal; pintarla de rojo entrena al cliente a ignorar el rojo
justo para cuando pase algo de verdad (un producto en cero, cobertura de menos
de una semana).

## 3. El borde de los inputs de shadcn no llega al mínimo

Esto lo medí sobre los tokens que trae el proyecto hoy:

| | valor | contraste sobre el fondo | mínimo |
|---|---|---|---|
| `--input` (borde) | `#e5e5e5` | **1.26:1** | 3:1 |
| `--muted-foreground` | `#737373` | 4.73:1 | 4.5:1 |
| `--foreground` | `#0a0a0a` | 19.79:1 | 4.5:1 |

Como los inputs de shadcn son transparentes, **el borde es lo único que dice
dónde empieza y termina el campo**. A 1.26:1, en una pantalla con brillo bajo o
al sol, el formulario se lee como etiquetas sueltas sin cajas.

WCAG 1.4.11 pide 3:1 para el límite visual de un control. Sobre un fondo casi
blanco eso arranca en `oklch(0.66 …)`, que da 3.07:1. Todo lo más claro que eso
no llega:

```
oklch(0.80 …) → 1.84:1     oklch(0.68 …) → 2.84:1
oklch(0.70 …) → 2.64:1     oklch(0.66 …) → 3.07:1  ✓
```

Alternativa igual de válida: darle relleno propio al input (`--muted` de fondo)
y ahí el borde puede ser suave, porque el relleno ya delimita el control.

**Separá los dos usos.** Un filete decorativo entre filas de una tabla y el borde
de un control no son la misma cosa y no pueden compartir token.

## 4. Dos radios, no seis (y no uno)

shadcn trae seis escalones (`--radius-sm` a `--radius-3xl`). Seis radios
distintos en la misma pantalla es de las cosas que más ensucian sin que se note
qué está mal.

La versión original de este punto pedía **uno solo**. Con la marca de Un Amargo
son **dos**, porque el pill es su firma visual y renunciar a él es renunciar a
lo que hace que el producto se vea de ellos. Dos está bien **si hay una regla
que decide cuál**, y ésta es la regla:

| | radio | qué es |
|---|---|---|
| Lo que se toca y es autónomo | `--radius-pill` (100px) | botones, chips de estado |
| Toda superficie | `--radius` (6px) | cards, inputs, tablas, diálogos, checkboxes |

Es la misma regla que sigue su web: campos rectangulares, botón de envío pill.
Los botones **agrupados** son la excepción de la excepción y van en 6px: pills
pegadas una contra otra se leen como un error de render.

Tres o más radios sí es desorden. Lo verifica el navegador, no el ojo: recorrer
la página con `getComputedStyle` y juntar los `borderRadius` distintos tiene que
dar exactamente dos valores. Así apareció un `rounded-[4px]` escrito a mano en
el checkbox de shadcn que no se veía en ningún screenshot.

Los círculos son la excepción: un avatar es un círculo, no un rectángulo
redondeado.

## 5. Tipografía: el carácter sale del ancho, no del peso

El formulario usa Bricolage Grotesque para títulos con el eje `wdth` en 82, y
JetBrains Mono solo para etiquetas chicas en versalitas. Dos familias, no tres.

Lo que transfiere al ERP:

- **Una familia para la interfaz y una mono para datos.** Los números tabulados
  (montos, cantidades, fechas) van en mono o con `font-variant-numeric:
  tabular-nums`. Sin eso, una columna de importes baila y se lee mal.
- **La jerarquía se hace con peso y color, no con tamaño.** Un ERP no aguanta
  títulos de 48px: hay demasiadas pantallas y todas competirían.
- Si usás una variable con eje de ancho, pedilo explícitamente en `next/font`
  (`axes: ["wdth"]`). Sin eso el navegador renderiza el ancho por defecto y la
  tipografía pierde justo lo que la distinguía.

## 6. Formularios: las reglas que hacen que se vean prolijos

Estas son las que más rinden y las que más se rompen:

- **Etiqueta arriba del input. Nunca el placeholder como etiqueta.** Al empezar
  a escribir el usuario pierde la referencia de qué campo es. El placeholder es
  para un ejemplo (`Ej: 12.345.678-9`), no para el nombre del campo.
- **El texto de ayuda va abajo del input, el de error también.** Siempre en el
  markup, aunque esté vacío: si aparece recién cuando hay error, el layout salta.
- **Un `gap` fijo para el bloque etiqueta + input** (`gap-2`) y otro fijo entre
  campos (`gap-5`). Dos números, no diez.
- **Toda opción cerrada necesita salida.** Un select con las opciones que
  escribiste vos y nada más obliga al usuario a mentir. Va un "otro" con texto
  libre.
- **Nada falla en silencio.** Si un guardado se cae, se muestra. En el
  formulario el autoguardado avisa "Sin guardar" en el acento, porque alguien
  que cierra la pestaña creyendo que guardó pierde todo lo que escribió. En un
  ERP es peor: pierde una factura.
- **Los cuatro estados existen siempre**: vacío, cargando, error, listo. Un
  skeleton con la forma del contenido final, no un spinner centrado.

## 7. Espaciado: pocos números, repetidos

El desorden casi nunca es de color, es de espaciado. Elegí una escala corta y no
te salgas:

```
4  8  12  16  24  32  48  64
```

Si escribís `py-[13px]`, algo está mal. En el formulario hay dos o tres valores
de padding en toda la app y por eso las secciones se ven alineadas sin esfuerzo.

Ancho de columna: **65 caracteres de línea como máximo** para texto corrido
(`max-w-[65ch]`). El formulario usa `max-w-[46rem]` para toda la columna, y esa
es la razón principal de que se lea cómodo.

## 8. Movimiento

Casi nada. Transiciones de color y opacidad en hover y foco, 200 a 300ms, y
listo. Un ERP se usa ocho horas por día: cualquier animación que te guste el
primer día te va a molestar el décimo.

`prefers-reduced-motion` siempre, y en un ERP conviene ser generoso con eso.

---

## Lo que NO transfiere del formulario

Vale la pena ser explícito, porque copiar esto mal es peor que no copiarlo.

| En el formulario | En el ERP |
|---|---|
| Una sola columna angosta | Sidebar + contenido, y tablas anchas |
| Aire enorme entre secciones | Densidad: se ven muchas filas de una |
| Títulos grandes | Jerarquía chica, hay demasiadas pantallas |
| Fondo oscuro | Claro, porque se mira ocho horas seguidas (el login es la única pantalla oscura) |
| Titulares enormes | El mismo peso 700 y tracking -0.035em de la marca, pero en tamaño chico: `.type-display` |
| Cero tablas | Las tablas son el producto |

Para las tablas, dos reglas que valen más que cualquier otra cosa: **encabezado
pegajoso** y **números alineados a la derecha con `tabular-nums`**. Y el filete
entre filas lo más suave posible, o mejor `divide-y` con un color casi
imperceptible: una grilla marcada convierte la tabla en una cárcel.

---

## Cosas que me costaron tiempo y conviene no repetir

Todas salieron de construir el formulario. Ninguna se ve en un screenshot.

**Las clases propias fuera de `@layer` le ganan a las utilidades de Tailwind.**
Si definís `.mi-clase { color: X }` suelta en el CSS, `text-primary` al lado no
la va a pisar, sin importar la especificidad, porque las utilidades viven en
`@layer utilities` y lo que está fuera de capa gana siempre. Me comió nueve
lugares donde el color o el tamaño no se aplicaba y no había ningún error. Va
dentro de `@layer components`.

**Con header fijo hace falta `scroll-padding-top` en `html`.** Sin eso, un salto
por ancla deja el título tapado por el header, y lo mismo le pasa al foco cuando
alguien navega con teclado (WCAG 2.4.11). Pero si además ponés `scroll-mt` en
las secciones, los dos se suman y el título queda demasiado abajo. Uno de los
dos, no los dos.

**Los tokens por defecto van en `html:not([data-tema])`, no en `:root`.** Con
`:root` tienen la misma especificidad que `[data-tema="x"]` y gana el que esté
escrito después en el archivo. Me pasó: el sitio pedía una paleta y pintaba
otra, y build, lint y todos los chequeos estaban en verde.

**Las funciones de Vercel cortan el cuerpo del request en 4.5 MB.** Devuelven
`FUNCTION_PAYLOAD_TOO_LARGE` antes de que corra una línea tuya. Si el ERP va a
recibir adjuntos (facturas escaneadas, remitos, fotos), el archivo tiene que ir
del navegador directo al storage con URL firmada. Y al leer el error, no asumas
que es JSON: cuando corta la plataforma la respuesta es texto plano y un
`.json()` a ciegas explota.

**Verificá en un browser de verdad.** Chrome en macOS fuerza un ancho mínimo de
500px en headless, así que un `--window-size=390` renderiza a 500 y el bug mobile
que "encontraste" no existe. Se maneja con `playwright-core` apuntando al Chrome
del sistema. Los tres bugs más caros que tuve en el formulario no los agarró ni
el build ni el lint ni el typecheck: los agarró abrir la página.

---

## Checklist antes de dar una pantalla por terminada

- [ ] Los neutros tienen todos el mismo tono, y ninguno es blanco o negro puro
- [ ] Un solo acento en toda la pantalla, y NO se usa para "el número subió"
- [ ] El texto sobre el acento pasa 4.5:1, medido
- [ ] El rojo aparece solo en lo accionable, no en variaciones normales
- [ ] El borde de los controles pasa 3:1, o el control tiene relleno propio
- [ ] Dos radios: pill en botones y chips, 6px en superficies. Contados en el
      navegador con `getComputedStyle`, no a ojo
- [ ] Etiquetas arriba de los inputs, nunca placeholder como etiqueta
- [ ] Existen los estados vacío, cargando y error, no solo el feliz
- [ ] Ningún error se traga en silencio
- [ ] El espaciado sale de la escala corta
- [ ] Números tabulados en las columnas de importes
- [ ] Se ve bien en un browser real, no solo compila
