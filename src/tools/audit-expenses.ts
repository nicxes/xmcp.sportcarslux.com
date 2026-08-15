import { z } from "zod";
import { type InferSchema, type ToolMetadata } from "xmcp";
import { createClient } from "@supabase/supabase-js";
import { gatekeeper } from "../lib/gatekeeper";

export const schema = {
  program: z.string().optional().describe("Business program to audit (default: all)"),
};

export const metadata: ToolMetadata = {
  name: "audit-expenses",
  description:
    "Run data-quality checks over the internal expense ledger: possible duplicate entries, " +
    "client names that look like the same person spelled differently, vehicles missing their " +
    "purchase cost, and suspicious amounts. Read-only; run it periodically or whenever totals look off.",
  annotations: {
    title: "Audit Vehicle Expenses",
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
  },
};

type Row = {
  id: string;
  client_name: string | null;
  vehicle: string | null;
  description: string;
  category: string | null;
  amount: number;
  expense_date: string | null;
  notes: string | null;
  source: string;
  created_at: string;
};

const money = (value: number) =>
  `$${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const normalize = (text: string) =>
  text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\d{1,2}\/\d{1,2}\/\d{2,4}/g, "") // strip dates so re-logged entries still match
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

// "primer pago" vs "segundo pago" are installments, not duplicates
const ORDINALS = ["primer", "primera", "segundo", "segunda", "tercer", "tercera", "ultimo", "ultima", "1er", "2do", "3er"];

function tokenOverlap(a: string, b: string): number {
  const setA = new Set(a.split(" ").filter(Boolean));
  const setB = new Set(b.split(" ").filter(Boolean));
  if (setA.size === 0 || setB.size === 0) return 0;
  let shared = 0;
  for (const token of setA) if (setB.has(token)) shared++;
  return shared / Math.min(setA.size, setB.size);
}

function levenshtein(a: string, b: string): number {
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let diagonal = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const temp = prev[j];
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diagonal + (a[i - 1] === b[j - 1] ? 0 : 1));
      diagonal = temp;
    }
  }
  return prev[b.length];
}

export default async function auditExpenses({ program }: InferSchema<typeof schema>) {
  const gate = await gatekeeper("T1", { roles: ["manager", "owner", "admin"] });
  if (!gate.allow) return gate.message;

  try {
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!supabaseUrl || !supabaseKey) {
      return "Error: Missing Supabase credentials. Please set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env file";
    }

    const supabase = createClient(supabaseUrl, supabaseKey);
    let query = supabase
      .from("internal_expenses")
      .select("id, client_name, vehicle, description, category, amount, expense_date, notes, source, created_at")
      .is("deleted_at", null);
    if (program) query = query.eq("program", program);

    const { data, error } = await query.limit(10000);
    if (error) return `Error querying expenses: ${error.message}`;
    const rows = (data ?? []) as Row[];
    if (rows.length === 0) return "No expenses to audit.";

    const sections: string[] = [];
    const shortId = (r: Row) => r.id.slice(0, 8);

    // ── 1. Possible duplicates: same client + same amount + similar description
    const byClientAmount = new Map<string, Row[]>();
    for (const r of rows) {
      if (Number(r.amount) === 0) continue;
      const key = `${(r.client_name ?? "").toLowerCase()}|${Number(r.amount).toFixed(2)}`;
      byClientAmount.set(key, [...(byClientAmount.get(key) ?? []), r]);
    }
    const duplicatePairs: string[] = [];
    for (const group of byClientAmount.values()) {
      for (let i = 0; i < group.length; i++) {
        for (let j = i + 1; j < group.length; j++) {
          const a = normalize(group[i].description);
          const b = normalize(group[j].description);
          const ordinalA = ORDINALS.find((o) => a.includes(o));
          const ordinalB = ORDINALS.find((o) => b.includes(o));
          if (ordinalA && ordinalB && ordinalA !== ordinalB) continue;
          if (tokenOverlap(a, b) >= 0.5) {
            duplicatePairs.push(
              `• ${group[i].client_name} — ${money(Number(group[i].amount))}\n` +
                `    "${group[i].description}" [id:${shortId(group[i])}]\n` +
                `    "${group[j].description}" [id:${shortId(group[j])}]`
            );
          }
        }
      }
    }
    sections.push(
      duplicatePairs.length === 0
        ? "✅ Duplicados: ninguno detectado"
        : `⚠️ Posibles duplicados (mismo cliente, mismo monto, descripción similar) — revisar y borrar uno con delete-expense si corresponde:\n${duplicatePairs.join("\n")}`
    );

    // ── 2. Client names that may be the same person
    const uniqueNames = [...new Set(rows.map((r) => r.client_name).filter((n): n is string => !!n))];
    const nameIssues: string[] = [];
    for (let i = 0; i < uniqueNames.length; i++) {
      for (let j = i + 1; j < uniqueNames.length; j++) {
        const a = normalize(uniqueNames[i]);
        const b = normalize(uniqueNames[j]);
        const tokensA = new Set(a.split(" "));
        const tokensB = new Set(b.split(" "));
        const subset =
          [...tokensA].every((t) => tokensB.has(t)) || [...tokensB].every((t) => tokensA.has(t));
        if (subset || levenshtein(a, b) <= 2) {
          nameIssues.push(`• "${uniqueNames[i]}" vs "${uniqueNames[j]}"`);
        }
      }
    }
    sections.push(
      nameIssues.length === 0
        ? "✅ Nombres de clientes: sin variantes sospechosas"
        : `⚠️ Nombres que podrían ser la misma persona (los totales por cliente se parten si es así):\n${nameIssues.join("\n")}`
    );

    // ── 3. Clients without a vehicle purchase cost
    const clients = new Map<string, Row[]>();
    for (const r of rows) {
      const key = r.client_name ?? "(sin cliente)";
      clients.set(key, [...(clients.get(key) ?? []), r]);
    }
    const missingCost: string[] = [];
    for (const [client, clientRows] of clients) {
      const costRows = clientRows.filter((r) => r.category === "costo-vehiculo");
      const costTotal = costRows.reduce((sum, r) => sum + Number(r.amount), 0);
      if (costRows.length === 0) {
        missingCost.push(`• ${client} (${clientRows[0].vehicle ?? "?"}) — sin línea de costo del vehículo`);
      } else if (costTotal <= 0) {
        missingCost.push(`• ${client} (${clientRows[0].vehicle ?? "?"}) — costo cargado en ${money(costTotal)}`);
      }
    }
    sections.push(
      missingCost.length === 0
        ? "✅ Costos de vehículo: todos los clientes tienen su costo cargado"
        : `⚠️ Clientes sin costo de vehículo (sus totales están incompletos):\n${missingCost.join("\n")}`
    );

    // ── 4. Suspicious amounts
    const negative = rows.filter((r) => Number(r.amount) < 0);
    const huge = rows.filter((r) => Number(r.amount) >= 300000);
    const suspicious = [
      ...negative.map(
        (r) => `• ${r.client_name} — ${money(Number(r.amount))} "${r.description}" [id:${shortId(r)}] (negativo: ¿refund?)`
      ),
      ...huge.map(
        (r) => `• ${r.client_name} — ${money(Number(r.amount))} "${r.description}" [id:${shortId(r)}] (monto inusualmente alto)`
      ),
    ];
    sections.push(
      suspicious.length === 0
        ? "✅ Montos: sin valores fuera de rango"
        : `⚠️ Montos a revisar:\n${suspicious.join("\n")}`
    );

    // ── 5. Completeness counts
    const noDate = rows.filter((r) => !r.expense_date).length;
    const noCategory = rows.filter((r) => !r.category).length;
    const noVehicle = rows.filter((r) => !r.vehicle).length;
    sections.push(
      `ℹ️ Completitud: ${noDate} gastos sin fecha, ${noCategory} sin categoría, ${noVehicle} sin vehículo (no es un error, pero limita los reportes por fecha/categoría).`
    );

    const warnings = sections.filter((s) => s.startsWith("⚠️")).length;
    return (
      `🔍 Audit de gastos — ${rows.length} gastos, ${clients.size} clientes` +
      (program ? ` (programa: ${program})` : "") +
      ` — ${warnings === 0 ? "todo en orden ✅" : `${warnings} chequeos con avisos`}\n\n` +
      sections.join("\n\n")
    );
  } catch (err) {
    return `Error: ${err instanceof Error ? err.message : "Unknown error"}`;
  }
}
