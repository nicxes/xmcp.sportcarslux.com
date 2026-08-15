import { z } from "zod";
import { type InferSchema, type ToolMetadata } from "xmcp";
import { createClient } from "@supabase/supabase-js";
import { gatekeeper } from "../lib/gatekeeper";

export const schema = {
  clientName: z.string().optional().describe("Filter by client name (partial match)"),
  vehicle: z.string().optional().describe("Filter by vehicle (partial match, e.g. 'GT2')"),
  stockNumber: z.string().optional().describe("Filter by exact stock number"),
  dealNumber: z.string().optional().describe("Filter by exact deal number"),
  category: z.string().optional().describe("Filter by category, e.g. 'transporte-envio'"),
  search: z.string().optional().describe("Search text inside expense descriptions"),
  dateFrom: z.string().optional().describe("Only expenses on/after this date (YYYY-MM-DD)"),
  dateTo: z.string().optional().describe("Only expenses on/before this date (YYYY-MM-DD)"),
  program: z.string().optional().describe("Business program (default: all programs)"),
  summary: z
    .enum(["clients", "categories", "none"])
    .optional()
    .describe(
      "'clients' = one line per client with totals (default when no client filter). " +
        "'categories' = totals by category. 'none' = full expense detail."
    ),
  limit: z.number().int().positive().max(500).optional().describe("Max detail rows (default 200)"),
  format: z
    .enum(["text", "json"])
    .optional()
    .describe(
      "'text' (default) = human-readable report. 'json' = raw structured data with per-client " +
        "and per-category aggregates. ALWAYS use 'json' when the user wants charts, graphs, " +
        "visualizations, comparisons, or data to export."
    ),
};

export const metadata: ToolMetadata = {
  name: "get-expenses",
  description:
    "Query internal vehicle expenses (the data that used to live in the 'Reporte de Autos' Excel). " +
    "Without filters it returns a per-client summary with totals. Filter by client to see their " +
    "full expense report; use 'search' to find specific invoices or expense types.",
  annotations: {
    title: "Get Vehicle Expenses",
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
  },
};

type ExpenseRow = {
  id: string;
  program: string;
  client_name: string | null;
  vehicle: string | null;
  stock_number: string | null;
  deal_number: string | null;
  customer_number: string | null;
  description: string;
  category: string | null;
  amount: number;
  amount_original: number | null;
  currency_original: string | null;
  expense_date: string | null;
  reference: string | null;
  notes: string | null;
  created_by: string | null;
  created_at: string;
};

const money = (value: number) =>
  `$${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export default async function getExpenses(input: InferSchema<typeof schema>) {
  const gate = await gatekeeper("T1", { roles: ["manager", "owner"] });
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
      .select(
        "id, program, client_name, vehicle, stock_number, deal_number, customer_number, description, category, amount, amount_original, currency_original, expense_date, reference, notes, created_by, created_at"
      )
      .is("deleted_at", null);

    if (input.program) query = query.eq("program", input.program);
    if (input.clientName) query = query.ilike("client_name", `%${input.clientName}%`);
    if (input.vehicle) query = query.ilike("vehicle", `%${input.vehicle}%`);
    if (input.stockNumber) query = query.eq("stock_number", input.stockNumber);
    if (input.dealNumber) query = query.eq("deal_number", input.dealNumber);
    if (input.category) query = query.eq("category", input.category);
    if (input.search) query = query.ilike("description", `%${input.search}%`);
    if (input.dateFrom) query = query.gte("expense_date", input.dateFrom);
    if (input.dateTo) query = query.lte("expense_date", input.dateTo);

    const { data, error } = await query
      .order("client_name", { ascending: true })
      .order("created_at", { ascending: true })
      .limit(5000);

    if (error) {
      return `Error querying expenses: ${error.message}`;
    }
    const rows = (data ?? []) as ExpenseRow[];
    if (rows.length === 0) {
      return "No expenses found with those filters.";
    }

    const total = rows.reduce((sum, r) => sum + Number(r.amount), 0);

    if (input.format === "json") {
      const byClient = new Map<string, { total: number; count: number; vehicle: string | null }>();
      const byCategory = new Map<string, { total: number; count: number }>();
      const byMonth = new Map<string, { total: number; count: number }>();
      for (const r of rows) {
        const client = r.client_name ?? "(sin cliente)";
        const clientEntry = byClient.get(client) ?? { total: 0, count: 0, vehicle: null };
        clientEntry.total = Math.round((clientEntry.total + Number(r.amount)) * 100) / 100;
        clientEntry.count += 1;
        clientEntry.vehicle = clientEntry.vehicle ?? r.vehicle;
        byClient.set(client, clientEntry);

        const category = r.category ?? "(sin categoria)";
        const categoryEntry = byCategory.get(category) ?? { total: 0, count: 0 };
        categoryEntry.total = Math.round((categoryEntry.total + Number(r.amount)) * 100) / 100;
        categoryEntry.count += 1;
        byCategory.set(category, categoryEntry);

        if (r.expense_date) {
          const month = r.expense_date.slice(0, 7);
          const monthEntry = byMonth.get(month) ?? { total: 0, count: 0 };
          monthEntry.total = Math.round((monthEntry.total + Number(r.amount)) * 100) / 100;
          monthEntry.count += 1;
          byMonth.set(month, monthEntry);
        }
      }
      const detailLimit = input.limit ?? 500;
      return JSON.stringify(
        {
          count: rows.length,
          grand_total: Math.round(total * 100) / 100,
          by_client: Object.fromEntries(byClient),
          by_category: Object.fromEntries(byCategory),
          by_month: Object.fromEntries([...byMonth.entries()].sort()),
          note_by_month: "only includes expenses that have expense_date",
          expenses: rows.slice(0, detailLimit).map((r) => ({
            id: r.id.slice(0, 8),
            client: r.client_name,
            vehicle: r.vehicle,
            description: r.description,
            category: r.category,
            amount: Number(r.amount),
            date: r.expense_date,
          })),
          expenses_truncated: rows.length > detailLimit,
        },
        null,
        1
      );
    }

    const summaryMode =
      input.summary ?? (input.clientName || input.search || input.stockNumber ? "none" : "clients");

    if (summaryMode === "clients") {
      const byClient = new Map<string, { total: number; count: number; vehicle: string | null }>();
      for (const r of rows) {
        const key = r.client_name ?? "(sin cliente)";
        const entry = byClient.get(key) ?? { total: 0, count: 0, vehicle: null };
        entry.total += Number(r.amount);
        entry.count += 1;
        entry.vehicle = entry.vehicle ?? r.vehicle;
        byClient.set(key, entry);
      }
      const lines = [...byClient.entries()]
        .sort((a, b) => b[1].total - a[1].total)
        .map(
          ([client, s]) =>
            `• ${client} — ${s.vehicle ?? "?"} — ${money(s.total)} (${s.count} gastos)`
        );
      return (
        `📊 Expenses by client (${byClient.size} clients, ${rows.length} expenses)\n\n` +
        lines.join("\n") +
        `\n\n💰 Grand total: ${money(total)}`
      );
    }

    if (summaryMode === "categories") {
      const byCategory = new Map<string, { total: number; count: number }>();
      for (const r of rows) {
        const key = r.category ?? "(sin categoria)";
        const entry = byCategory.get(key) ?? { total: 0, count: 0 };
        entry.total += Number(r.amount);
        entry.count += 1;
        byCategory.set(key, entry);
      }
      const lines = [...byCategory.entries()]
        .sort((a, b) => b[1].total - a[1].total)
        .map(([category, s]) => `• ${category} — ${money(s.total)} (${s.count} gastos)`);
      return (
        `📊 Expenses by category (${rows.length} expenses)\n\n` +
        lines.join("\n") +
        `\n\n💰 Grand total: ${money(total)}`
      );
    }

    // Full detail, grouped by client like the Excel blocks
    const limit = input.limit ?? 200;
    const shown = rows.slice(0, limit);
    const sections: string[] = [];
    let currentClient: string | null = null;
    let lines: string[] = [];
    let clientTotal = 0;

    const flush = () => {
      if (currentClient !== null) {
        sections.push(lines.join("\n") + `\n   Subtotal: ${money(clientTotal)}`);
      }
    };

    for (const r of shown) {
      const client = r.client_name ?? "(sin cliente)";
      if (client !== currentClient) {
        flush();
        currentClient = client;
        clientTotal = 0;
        const header = [client, r.vehicle, r.stock_number ? `Stock ${r.stock_number}` : null, r.deal_number ? `Deal ${r.deal_number}` : null]
          .filter(Boolean)
          .join(" | ");
        lines = [`🚗 ${header}`];
      }
      clientTotal += Number(r.amount);
      const bits = [
        r.expense_date ? `[${r.expense_date}]` : null,
        r.description,
        `— ${money(Number(r.amount))}`,
        r.amount_original ? `(${r.amount_original.toLocaleString()} ${r.currency_original ?? "?"})` : null,
        r.category ? `· ${r.category}` : null,
      ].filter(Boolean);
      lines.push(`   • ${bits.join(" ")} [id:${r.id.slice(0, 8)}]`);
    }
    flush();

    return (
      sections.join("\n\n") +
      `\n\n💰 Total (${rows.length} expenses${rows.length > limit ? `, showing first ${limit}` : ""}): ${money(total)}`
    );
  } catch (err) {
    return `Error: ${err instanceof Error ? err.message : "Unknown error"}`;
  }
}
