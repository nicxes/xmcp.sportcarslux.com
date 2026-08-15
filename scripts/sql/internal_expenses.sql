-- internal_expenses: generic internal expense ledger, mirrors the "Vehicle
-- Expense Report" Excel structure. One row per expense; client/vehicle data is
-- denormalized onto each row. `program` scopes each row to a business program
-- (first one: 'Argentina Export'), so future programs reuse this same table.
--
-- Run this once in the Supabase SQL Editor.

create table if not exists internal_expenses (
  id                uuid primary key default gen_random_uuid(),
  program           text not null default 'Argentina Export',

  -- Who/what the expense belongs to (the Excel block header)
  client_name       text,
  vehicle           text,
  stock_number      text,
  deal_number       text,
  customer_number   text,
  vin               text,

  -- The expense itself (the Excel line item)
  description       text not null,
  category          text,             -- Costo del Vehículo | Transporte y Envío | Mecánica | Seguro | Comisión | Título y Trámites | Viajes y Viáticos | Fees | Otros
  amount            numeric not null, -- always USD
  amount_original   numeric,          -- if paid in another currency
  currency_original text,             -- e.g. 'EUR'
  exchange_rate     numeric,
  expense_date      date,
  reference         text,             -- invoice #, "F1TOW 2488", etc.
  notes             text,

  -- Audit
  source            text not null default 'mcp',  -- 'excel-import' for migrated rows
  created_by        text,             -- email of the team member who logged it
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  deleted_at        timestamptz       -- soft delete
);

create index if not exists internal_expenses_program_idx     on internal_expenses (program);
create index if not exists internal_expenses_client_idx      on internal_expenses (client_name);
create index if not exists internal_expenses_stock_idx       on internal_expenses (stock_number);
create index if not exists internal_expenses_date_idx        on internal_expenses (expense_date);
create index if not exists internal_expenses_category_idx    on internal_expenses (category);

-- Lock the table down: only the service role (used by the MCP server) can
-- touch it. No policies = no anon/authenticated access.
alter table internal_expenses enable row level security;
