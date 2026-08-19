// Slugs para las URLs de la web del cliente (/mates/de-calabaza). Funcion pura
// y testeable sin base, como el resto de src/lib/domain.
//
// REGLA: el slug se genera UNA vez, al crear, y NO cambia al renombrar. Si
// cambiara, cada link publicado de esa categoria se rompe. Renombrar es un
// cambio de etiqueta; cambiar la URL es otra cosa.

export function slugify(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // saca acentos: "Calabaza" y no "Calábaza"
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/g, ""); // el slice puede dejar un guion colgando
}

/**
 * Agrega un sufijo numerico si el slug ya existe en el conjunto dado.
 * "De metal" bajo Mate y bajo Bombilla NO colisionan: cada categoria trae su
 * propio conjunto, porque los subtipos son unicos por categoria.
 */
export function uniqueSlug(base: string, taken: Set<string>): string {
  if (!taken.has(base)) return base;
  for (let n = 2; n < 1000; n++) {
    const candidate = `${base}-${n}`;
    if (!taken.has(candidate)) return candidate;
  }
  throw new Error("No se pudo generar un slug unico.");
}
