import { z } from "zod";
import { type InferSchema, type ToolMetadata } from "xmcp";
import { createClient } from "@supabase/supabase-js";
import { gatekeeper, auditLine } from "../lib/gatekeeper";

export const schema = {
  clientName: z.string().describe("Client the expense belongs to, e.g. 'Nicolas Botti'"),
  description: z.string().describe("What the expense was, e.g. 'Contenedor Red Logistics inv 43799'"),
  amount: z.number().describe("Amount in USD. Negative for refunds/credits."),

  vehicle: z.string().optional().describe("Vehicle, e.g. '2008 Porsche GT2 997'"),
  stockNumber: z.string().optional().describe("Stock number"),
  dealNumber: z.string().optional().describe("Deal number in CDK"),
  customerNumber: z.string().optional().describe("Customer number in CDK"),
  vin: z.string().optional().describe("VIN, for cars without stock number"),

  category: z
    .enum([
      "costo-vehiculo",
      "transporte-envio",
      "mecanica",
      "seguro",
      "comision",
      "titulo-tramites",
      "viajes-viaticos",
      "fees",
      "otros",
    ])
    .optional()
    .describe("Expense category. Infer it from the description if the user doesn't say."),
  expenseDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD")
    .optional()
    .describe("Date the expense was paid (YYYY-MM-DD)"),
  amountOriginal: z.number().optional().describe("Original amount if paid in another currency"),
  currencyOriginal: z.string().optional().describe("Original currency code, e.g. 'EUR'"),
  exchangeRate: z.number().optional().describe("Exchange rate used to convert to USD"),
  reference: z.string().optional().describe("Invoice or reference number, e.g. 'F1TOW 2488'"),
  notes: z.string().optional().describe("Extra context worth keeping"),
  program: z
    .string()
    .optional()
    .describe("Business program this expense belongs to. Defaults to 'argentina-export'."),
};

export const metadata: ToolMetadata = {
  name: "add-expense",
  description:
    "Log an internal expense for a client's vehicle (Argentina export program by default). " +
    "This replaces the 'Reporte de Autos' Excel: each call adds one expense line. " +
    "Before logging, if the client already has expenses, reuse their exact clientName/vehicle/stock " +
    "spelling from get-expenses so their history stays grouped.",
  annotations: {
    title: "Add Vehicle Expense",
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
  },
};

export default async function addExpense(input: InferSchema<typeof schema>) {
  const gate = await gatekeeper("T2", { roles: ["manager", "owner", "admin"] });
  if (!gate.allow) return gate.message;

  try {
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!supabaseUrl || !supabaseKey) {
      return "Error: Missing Supabase credentials. Please set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env file";
    }

    const supabase = createClient(supabaseUrl, supabaseKey);

    const { data: expense, error } = await supabase
      .from("internal_expenses")
      .insert({
        program: input.program ?? "argentina-export",
        client_name: input.clientName.trim(),
        vehicle: input.vehicle?.trim() ?? null,
        stock_number: input.stockNumber?.trim() ?? null,
        deal_number: input.dealNumber?.trim() ?? null,
        customer_number: input.customerNumber?.trim() ?? null,
        vin: input.vin?.trim() ?? null,
        description: input.description.trim(),
        category: input.category ?? null,
        amount: input.amount,
        amount_original: input.amountOriginal ?? null,
        currency_original: input.currencyOriginal ?? null,
        exchange_rate: input.exchangeRate ?? null,
        expense_date: input.expenseDate ?? null,
        reference: input.reference ?? null,
        notes: input.notes ?? null,
        source: "mcp",
        created_by: gate.identity.email,
      })
      .select("id")
      .single();

    if (error) {
      return `Error saving expense: ${error.message}`;
    }

    // Running total for this client, so the user sees the effect immediately
    const { data: clientRows } = await supabase
      .from("internal_expenses")
      .select("amount")
      .eq("client_name", input.clientName.trim())
      .is("deleted_at", null);
    const clientTotal = (clientRows ?? []).reduce((sum, r) => sum + Number(r.amount), 0);

    return (
      `✅ Expense saved (id: ${expense.id})\n\n` +
      `Client: ${input.clientName}\n` +
      (input.vehicle ? `Vehicle: ${input.vehicle}\n` : "") +
      `Description: ${input.description}\n` +
      `Amount: $${input.amount.toLocaleString()}` +
      (input.amountOriginal
        ? ` (${input.amountOriginal.toLocaleString()} ${input.currencyOriginal ?? "?"})`
        : "") +
      `\n` +
      (input.category ? `Category: ${input.category}\n` : "") +
      (input.expenseDate ? `Date: ${input.expenseDate}\n` : "") +
      `\n💰 Running total for ${input.clientName}: $${clientTotal.toLocaleString("en-US", { maximumFractionDigits: 2 })}` +
      auditLine(gate.identity)
    );
  } catch (err) {
    return `Error: ${err instanceof Error ? err.message : "Unknown error"}`;
  }
}
