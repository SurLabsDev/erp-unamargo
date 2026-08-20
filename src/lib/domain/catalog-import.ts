// Derivation rules for the one-off import of the client's HTML demo into the
// ERP. Pure and testable without a database, like the rest of src/lib/domain.
//
// These run ONCE, but they are kept as tested functions rather than inlined in
// the script because they encode judgment calls (which word is the mate's
// shape, which prefix is redundant) that a reviewer has to be able to check.

export type DemoCategory = "Mates" | "Bombillas" | "Combos" | "Accesorios";
export type Spec = { label: string; value: string };

const CATEGORY_PREFIX: Record<DemoCategory, string> = {
  Mates: "MATE",
  Bombillas: "BOMB",
  Combos: "COMBO",
  Accesorios: "ACC",
};

/** Dropped from SKUs so no name approaches the 40-character limit. */
const STOP_WORDS = new Set([
  "DE",
  "DEL",
  "CON",
  "PARA",
  "Y",
  "LA",
  "EL",
  "LOS",
  "LAS",
  "UN",
  "UNA",
]);

/** Leading word already implied by the category prefix. */
const REDUNDANT_LEAD: Record<DemoCategory, string[]> = {
  Mates: ["MATE"],
  // "BOMBILLON" is deliberately NOT here: a bombillon is a larger bombilla,
  // and dropping the word would erase the distinction between the two.
  Bombillas: ["BOMBILLA"],
  Combos: ["COMBO"],
  Accesorios: [],
};

function words(value: string): string[] {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, " ")
    .trim()
    .split(" ")
    .filter((word) => word !== "" && !STOP_WORDS.has(word));
}

export function buildSku(
  name: string,
  category: DemoCategory,
  variantLabel: string | null,
): string {
  let parts = words(name);
  const redundant = REDUNDANT_LEAD[category];
  // Only drop the redundant lead when something is left to identify the
  // product: a product literally named "Mate" must not collapse to "MATE".
  if (parts.length > 1 && redundant.includes(parts[0])) parts = parts.slice(1);
  if (variantLabel) parts = parts.concat(words(variantLabel));
  return [CATEGORY_PREFIX[category], ...parts].join("-");
}

/** Mate shapes, in the order they are searched for. */
const MATE_SHAPES = ["Ranchero", "Camionero", "Torpedo", "Imperial", "Porongo"];

export function deriveSubtype(
  name: string,
  category: DemoCategory,
): string | null {
  const lower = name.toLowerCase();

  if (category === "Mates") {
    return (
      MATE_SHAPES.find((shape) => lower.includes(shape.toLowerCase())) ?? null
    );
  }

  // Six bombillas: a second filter level would split five against one.
  if (category === "Bombillas") return null;

  if (category === "Accesorios") {
    if (lower.includes("matera")) return "Materas";
    if (lower.includes("yerbero")) return "Yerberos";
    if (lower.includes("posamate") || lower.includes("reposamate"))
      return "Posamates";
    if (lower.includes("secador")) return "Limpieza";
    return null;
  }

  if (lower.includes("porongo")) return "Con porongo";
  if (lower.includes("camionero")) return "Con camionero";
  if (lower.includes("galleta")) return "Con galleta";
  return null;
}

export function buildDescription(fullDesc: string, specs: Spec[]): string {
  const body = fullDesc.trim();
  if (specs.length === 0) return body;
  const lines = specs.map((spec) => `${spec.label}: ${spec.value}`).join("\n");
  return `${body}\n\n${lines}`;
}
