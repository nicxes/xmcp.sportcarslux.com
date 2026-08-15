#!/usr/bin/env node
// One-off migration: inserts the parsed Excel rows (scripts/data/argentina-expenses.json,
// produced by scripts/parse-expenses-xlsx.py) into internal_expenses.
//
// Idempotent: refuses to run if rows with source='excel-import' already exist
// for the program, unless --force is passed (which deletes and re-imports them).
//
// Usage: node scripts/migrate-expenses.mjs [--force]

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import "dotenv/config";

const PROGRAM = "argentina-export";
const here = dirname(fileURLToPath(import.meta.url));
const dataPath = join(here, "data", "argentina-expenses.json");

const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY in .env");
  process.exit(1);
}
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const rows = JSON.parse(readFileSync(dataPath, "utf8"));
console.log(`Loaded ${rows.length} rows from ${dataPath}`);

// Table exists?
const probe = await supabase.from("internal_expenses").select("id").limit(1);
if (probe.error) {
  console.error(`\nCannot query internal_expenses: ${probe.error.message}`);
  console.error("Did you run scripts/sql/internal_expenses.sql in the Supabase SQL Editor?");
  process.exit(1);
}

// Already imported?
const existing = await supabase
  .from("internal_expenses")
  .select("id", { count: "exact", head: true })
  .eq("source", "excel-import")
  .eq("program", PROGRAM);

if ((existing.count ?? 0) > 0) {
  if (!process.argv.includes("--force")) {
    console.error(`\n${existing.count} excel-import rows already exist for '${PROGRAM}'.`);
    console.error("Re-run with --force to delete and re-import them.");
    process.exit(1);
  }
  console.log(`--force: deleting ${existing.count} previously imported rows…`);
  const del = await supabase
    .from("internal_expenses")
    .delete()
    .eq("source", "excel-import")
    .eq("program", PROGRAM);
  if (del.error) {
    console.error(`Delete failed: ${del.error.message}`);
    process.exit(1);
  }
}

let inserted = 0;
for (let i = 0; i < rows.length; i += 100) {
  const chunk = rows.slice(i, i + 100);
  const { error } = await supabase.from("internal_expenses").insert(chunk);
  if (error) {
    console.error(`Insert failed at chunk ${i / 100}: ${error.message}`);
    process.exit(1);
  }
  inserted += chunk.length;
}

const total = rows.reduce((sum, r) => sum + r.amount, 0);
const clients = new Set(rows.map((r) => r.client_name)).size;
console.log(`\nInserted ${inserted} expenses (${clients} clients, $${total.toLocaleString("en-US", { maximumFractionDigits: 2 })} total).`);
