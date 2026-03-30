# CLAUDE.md

## Project Overview

MCP (Model Context Protocol) server for SportcarsLux, built with the **xmcp** framework. Manages luxury/sports vehicle inventory via Supabase, with Cloudflare R2 integration for file storage.

## Tech Stack

- **Runtime**: Node.js 22.20.0, TypeScript (ES2016, CommonJS)
- **Framework**: xmcp 0.3.2
- **Database**: Supabase (service role access)
- **Storage**: Cloudflare R2 (via AWS S3 SDK)
- **Validation**: Zod

## Commands

- `npm run dev` — Start development server
- `npm run build` — Compile TypeScript to `dist/`
- `npm start` — Run STDIO transport (default)
- `npm run start:http` — Run HTTP transport (port 3001)
- `npm run deploy` — Deploy to Vercel

## Project Structure

```
src/
  tools/              # MCP tool implementations
    get-vehicles.ts   # Query inventory (20+ filters, sorting, pagination)
    update-price.ts   # Update vehicle pricing by ID/VIN/stock number
    delete-vehicle.ts # Hard delete vehicles (warns about vAuto resync)
    add-notes.ts      # Add/update/delete vehicle notes
    delete-ai-video.ts # Delete AI videos from Supabase + R2
    get-website-analytics.ts # Parse Vercel Analytics CSV exports
    it-team-expenses.ts      # Static infrastructure cost report
  prompts/            # Prompt templates for AI interactions
  resources/          # Resource handlers (users, config)
  lib/
    supabase.ts       # Supabase client initialization
    vercel/           # Analytics CSV data files
  middleware.ts       # API key authentication (x-api-key header)
xmcp.config.ts        # Framework config (paths, port 3001, debug logging)
```

## Code Conventions

### Tool Pattern

Every tool follows the same structure:

1. **`schema`** — Zod validation schema for input parameters
2. **`metadata`** — `ToolMetadata` object with `name`, `description`, and `annotations` (`readOnlyHint`, `destructiveHint`, `idempotentHint`)
3. **Default export function** — Implementation returning text content

### Database Queries

- Use Supabase SDK for all database operations
- Dynamic filtering: `ilike` for text search, `eq`/`gte`/`lte` for numeric, `is` for null checks
- Always filter on `deleted_at is null` (soft delete support)
- Vehicle identification accepts `id`, `vin`, or `stock_number` — exactly one must be provided

### Error Handling

- Wrap tool implementations in try-catch blocks
- Return descriptive error messages as text content
- Validate environment variables early with clear error messages

### Output Formatting

- Human-readable text with labeled fields
- Use `toLocaleString()` for currency and timestamps
- Emojis for visual emphasis in tool responses

## Environment Variables

**Required:**
- `SUPABASE_URL` — Supabase instance URL
- `SUPABASE_SERVICE_ROLE_KEY` — Admin access key
- `API_KEY` — Authentication key for middleware

**Optional:**
- `PORT` — HTTP server port (default: 3001)
- `R2_ENDPOINT`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_NAME` — Cloudflare R2 credentials

## Data Integration

- Vehicle inventory syncs from **vAuto.com** every 2 hours into Supabase
- Deleted vehicles may reappear on next sync if still listed at vAuto
- Analytics data comes from Vercel Analytics CSV exports stored in `src/lib/vercel/`

## Deployment

- **Platform**: Vercel
- **Entry points**: `dist/stdio.js` (STDIO), `dist/http.js` (HTTP)
- **Auth**: All MCP requests require valid `x-api-key` header
