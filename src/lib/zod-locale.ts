import { z } from "zod";

// Global Zod config: default validation messages in Spanish. Imported for its
// side effect by every module that defines schemas (§11: validación inline en
// español — also covers issues without a custom `error`).
z.config(z.locales.es());
