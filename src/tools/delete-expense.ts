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
  confirm: z
    .boolean()
    .optional()
    .describe(
      "Must be true to actually delete. Without it, the tool only returns a preview of the " +
        "expense. Only set it after the user has seen the expense details and explicitly confirmed."
    ),
};

export const metadata: ToolMetadata = {
  name: "delete-expense",
  description:
    "Soft-delete one internal expense (to fix a wrongly logged entry). The expense disappears " +
    "from reports but stays recoverable in the database. Two-step: call without 'confirm' to get " +
    "a preview, show it to the user, and only call again with confirm=true after they explicitly agree.",
  annotations: {
    title: "Delete Vehicle Expense",
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: true,
  },
};

export default async function deleteExpense({ id, confirm }: InferSchema<typeof schema>) {
  const gate = await gatekeeper("T3", { roles: ["manager", "owner"] });
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

    if (!confirm) {
      return (
        `⚠️ CONFIRMACIÓN REQUERIDA — este gasto se va a eliminar de todos los reportes:\n\n` +
        `Client: ${expense.client_name}\n` +
        (expense.vehicle ? `Vehicle: ${expense.vehicle}\n` : "") +
        `Description: ${expense.description}\n` +
        `Amount: $${Number(expense.amount).toLocaleString()}\n` +
        (expense.expense_date ? `Date: ${expense.expense_date}\n` : "") +
        `\nNothing was deleted yet. Show this to the user and ask them to confirm. ` +
        `Only if they explicitly say yes, call delete-expense again with confirm=true. ` +
        `(It is a soft delete: recoverable from the database by IT, but gone from all reports.)`
      );
    }

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
