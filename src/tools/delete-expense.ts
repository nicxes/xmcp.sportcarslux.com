import { z } from "zod";
import { type InferSchema, type ToolMetadata } from "xmcp";
import { createClient } from "@supabase/supabase-js";
import { gatekeeper, auditLine } from "../lib/gatekeeper";

export const schema = {
  id: z
    .string()
    .describe(
      "Expense id to delete: full UUID or the short 8-char prefix shown by get-expenses"
    ),
};

export const metadata: ToolMetadata = {
  name: "delete-expense",
  description:
    "Soft-delete one internal expense (to fix a wrongly logged entry). " +
    "Use get-expenses first to find the expense id, and confirm with the user before deleting.",
  annotations: {
    title: "Delete Vehicle Expense",
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: true,
  },
};

export default async function deleteExpense({ id }: InferSchema<typeof schema>) {
  const gate = await gatekeeper("T3", { roles: ["manager", "owner", "admin"] });
  if (!gate.allow) return gate.message;

  try {
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!supabaseUrl || !supabaseKey) {
      return "Error: Missing Supabase credentials. Please set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env file";
    }

    const supabase = createClient(supabaseUrl, supabaseKey);
    const needle = id.trim().toLowerCase();

    const { data: candidates, error: selectError } = await supabase
      .from("internal_expenses")
      .select("id, client_name, vehicle, description, amount, expense_date")
      .is("deleted_at", null);

    if (selectError) {
      return `Error finding expense: ${selectError.message}`;
    }

    const matches = (candidates ?? []).filter((r) => r.id.toLowerCase().startsWith(needle));
    if (matches.length === 0) {
      return `No active expense found with id '${id}'.`;
    }
    if (matches.length > 1) {
      return (
        `Error: '${id}' matches ${matches.length} expenses. Use a longer id:\n` +
        matches.map((m) => `• ${m.id} — ${m.client_name}: ${m.description}`).join("\n")
      );
    }

    const expense = matches[0];
    const { error: updateError } = await supabase
      .from("internal_expenses")
      .update({ deleted_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq("id", expense.id);

    if (updateError) {
      return `Error deleting expense: ${updateError.message}`;
    }

    return (
      `🗑️ Expense deleted (soft delete, recoverable in the database):\n\n` +
      `Client: ${expense.client_name}\n` +
      (expense.vehicle ? `Vehicle: ${expense.vehicle}\n` : "") +
      `Description: ${expense.description}\n` +
      `Amount: $${Number(expense.amount).toLocaleString()}` +
      auditLine(gate.identity)
    );
  } catch (err) {
    return `Error: ${err instanceof Error ? err.message : "Unknown error"}`;
  }
}
