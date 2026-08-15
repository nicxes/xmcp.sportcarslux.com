// Canonical values stored in internal_expenses. The database stores these
// human-readable labels directly; normalize*() maps any variant the model or
// old data might send (slugs, lowercase, no accents) onto the canonical form
// so the stored values never drift.

export const CATEGORIES = [
  "Costo del Vehículo",
  "Transporte y Envío",
  "Mecánica",
  "Seguro",
  "Comisión",
  "Título y Trámites",
  "Viajes y Viáticos",
  "Fees",
  "Otros",
] as const;

export const DEFAULT_PROGRAM = "Argentina Export";

const strip = (text: string) =>
  text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

const CATEGORY_ALIASES: Record<string, string> = {
  "costo vehiculo": "Costo del Vehículo",
  "costo del vehiculo": "Costo del Vehículo",
  "transporte envio": "Transporte y Envío",
  "transporte y envio": "Transporte y Envío",
  mecanica: "Mecánica",
  seguro: "Seguro",
  comision: "Comisión",
  "titulo tramites": "Título y Trámites",
  "titulo y tramites": "Título y Trámites",
  "viajes viaticos": "Viajes y Viáticos",
  "viajes y viaticos": "Viajes y Viáticos",
  fees: "Fees",
  otros: "Otros",
};

export function normalizeCategory(input: string | null | undefined): string | null {
  if (!input) return null;
  return CATEGORY_ALIASES[strip(input)] ?? input.trim();
}

export function normalizeProgram(input: string | null | undefined): string {
  if (!input) return DEFAULT_PROGRAM;
  if (strip(input) === "argentina export") return DEFAULT_PROGRAM;
  return input.trim();
}
