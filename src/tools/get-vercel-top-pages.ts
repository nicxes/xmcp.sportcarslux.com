import { z } from "zod";
import { type InferSchema, type ToolMetadata } from "xmcp";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

type TopPageRow = {
  item: string;
  visitors: number;
  total: number;
};

const DATA_DIR = path.resolve(process.cwd(), "src/lib/vercel");
const DEFAULT_FILE = "Top Pages - Nov 13 '25, 11pm - Feb 13 '26.csv";
const REPORT_LABELS = [
  "Top Pages",
  "Top Referrers",
  "Top Countries",
  "Top Browsers",
  "Top Devices",
  "Top Operating Systems",
] as const;
type ReportType = "pages" | "referrers" | "countries" | "browsers" | "devices" | "operating-systems";

export const schema = {
  reportType: z
    .enum(["pages", "referrers", "countries", "browsers", "devices", "operating-systems"])
    .optional()
    .describe("Analytics report type. Default: pages"),
  fileName: z
    .string()
    .optional()
    .describe("CSV filename inside src/lib/vercel. Overrides reportType selection"),
  listReports: z
    .boolean()
    .optional()
    .describe("Return available CSV report files and exit"),
  pageContains: z
    .string()
    .optional()
    .describe("Filter results by item text containing this value"),
  startsWith: z
    .string()
    .optional()
    .describe("Filter results by item text prefix"),
  minVisitors: z.number().optional().describe("Minimum unique visitors"),
  minTotal: z.number().optional().describe("Minimum total visits"),
  sortBy: z
    .enum(["visitors", "total"])
    .optional()
    .describe("Sort field. Default: visitors"),
  sortOrder: z
    .enum(["asc", "desc"])
    .optional()
    .describe("Sort order. Default: desc"),
  limit: z.number().optional().describe("Maximum rows to return. Default: 20"),
  includeSummary: z
    .boolean()
    .optional()
    .describe("Include totals and file metadata summary"),
};

export const metadata: ToolMetadata = {
  name: "get-vercel-top-pages",
  description:
    "Query Vercel Analytics CSV reports (Pages, Referrers, Countries, Browsers, Devices, OS) stored in src/lib/vercel",
  annotations: {
    title: "Get Vercel Analytics",
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
  },
};

function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];

    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === "," && !inQuotes) {
      fields.push(current);
      current = "";
      continue;
    }

    current += char;
  }

  fields.push(current);
  return fields;
}

async function resolveFileName(requested?: string): Promise<string> {
  const files = await readdir(DATA_DIR);
  const csvFiles = files.filter((f) => f.endsWith(".csv")).sort();

  if (csvFiles.length === 0) {
    throw new Error("No CSV files found in src/lib/vercel");
  }

  if (requested) {
    const clean = path.basename(requested);
    if (!clean.endsWith(".csv")) {
      throw new Error("fileName must be a .csv file");
    }
    if (!csvFiles.includes(clean)) {
      throw new Error(`CSV file not found: ${clean}`);
    }
    return clean;
  }

  return csvFiles.includes(DEFAULT_FILE) ? DEFAULT_FILE : csvFiles[csvFiles.length - 1];
}

function toReportLabel(reportType: ReportType): string {
  switch (reportType) {
    case "pages":
      return "Top Pages";
    case "referrers":
      return "Top Referrers";
    case "countries":
      return "Top Countries";
    case "browsers":
      return "Top Browsers";
    case "devices":
      return "Top Devices";
    case "operating-systems":
      return "Top Operating Systems";
  }
}

function inferReportLabel(fileName: string): string {
  for (const label of REPORT_LABELS) {
    if (fileName.startsWith(`${label} - `)) return label;
  }
  return "Unknown";
}

function extractDateRange(fileName: string): string {
  return fileName
    .replace(/\.csv$/i, "")
    .replace(/^Top [^-]+ - /, "");
}

async function resolveFileNameByType(reportType: ReportType): Promise<string> {
  const files = await readdir(DATA_DIR);
  const csvFiles = files.filter((f) => f.endsWith(".csv")).sort();
  const label = toReportLabel(reportType);
  const matches = csvFiles.filter((f) => f.startsWith(`${label} - `));
  if (matches.length === 0) {
    throw new Error(`No CSV found for reportType '${reportType}'`);
  }
  return matches[matches.length - 1];
}

async function listAvailableReports(): Promise<string[]> {
  const files = (await readdir(DATA_DIR)).filter((f) => f.endsWith(".csv")).sort();
  return files.map((file) => {
    const label = inferReportLabel(file);
    const dateRange = extractDateRange(file);
    return `${label} | ${dateRange} | ${file}`;
  });
}

function toNumber(value: string): number {
  const parsed = Number(value.replace(/,/g, "").trim());
  return Number.isFinite(parsed) ? parsed : 0;
}

async function loadRows(fileName: string): Promise<TopPageRow[]> {
  const filePath = path.join(DATA_DIR, fileName);
  const content = await readFile(filePath, "utf8");
  const lines = content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length <= 1) {
    return [];
  }

  const rows: TopPageRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const [pageRaw, visitorsRaw, totalRaw] = parseCsvLine(lines[i]);
    if (!pageRaw) continue;

    rows.push({
      item: pageRaw,
      visitors: toNumber(visitorsRaw || "0"),
      total: toNumber(totalRaw || "0"),
    });
  }

  return rows;
}

export default async function getVercelTopPages({
  reportType,
  fileName,
  listReports,
  pageContains,
  startsWith,
  minVisitors,
  minTotal,
  sortBy,
  sortOrder,
  limit,
  includeSummary,
}: InferSchema<typeof schema>) {
  try {
    if (listReports) {
      const reports = await listAvailableReports();
      if (reports.length === 0) return "No CSV reports found in src/lib/vercel.";
      return ["Available Vercel CSV reports:", "", ...reports.map((r, i) => `${i + 1}. ${r}`)].join("\n");
    }

    const selectedFile = fileName
      ? await resolveFileName(fileName)
      : await resolveFileNameByType(reportType || "pages");
    const rows = await loadRows(selectedFile);
    const initialCount = rows.length;

    let filtered = rows.filter((row) => {
      if (pageContains && !row.item.toLowerCase().includes(pageContains.toLowerCase())) return false;
      if (startsWith && !row.item.startsWith(startsWith)) return false;
      if (minVisitors !== undefined && row.visitors < minVisitors) return false;
      if (minTotal !== undefined && row.total < minTotal) return false;
      return true;
    });

    const by = sortBy || "visitors";
    const order = sortOrder || "desc";
    filtered = filtered.sort((a, b) => {
      const diff = by === "visitors" ? a.visitors - b.visitors : a.total - b.total;
      return order === "asc" ? diff : -diff;
    });

    const maxRows = Math.max(1, Math.min(limit || 20, 200));
    const top = filtered.slice(0, maxRows);
    const reportLabel = inferReportLabel(selectedFile);
    const dateRange = extractDateRange(selectedFile);

    if (top.length === 0) {
      return `No rows match the current filters.\n\nReport: ${reportLabel}\nPeriod: ${dateRange}\nFile: ${selectedFile}\nRows scanned: ${initialCount}`;
    }

    const withSummary = includeSummary !== false;
    const totalVisitors = filtered.reduce((sum, row) => sum + row.visitors, 0);
    const totalVisits = filtered.reduce((sum, row) => sum + row.total, 0);

    const lines: string[] = [];
    if (withSummary) {
      lines.push("Vercel Analytics Report");
      lines.push(`Report type: ${reportLabel}`);
      lines.push(`Period: ${dateRange}`);
      lines.push(`File: ${selectedFile}`);
      lines.push(`Rows scanned: ${initialCount}`);
      lines.push(`Rows matched: ${filtered.length}`);
      lines.push(`Total visitors (matched): ${totalVisitors.toLocaleString()}`);
      lines.push(`Total visits (matched): ${totalVisits.toLocaleString()}`);
      lines.push("");
    }

    lines.push(`Top ${top.length} rows by ${by} (${order})`);
    lines.push("");
    top.forEach((row, index) => {
      lines.push(
        `${index + 1}. ${row.item} | Visitors: ${row.visitors.toLocaleString()} | Total: ${row.total.toLocaleString()}`,
      );
    });

    return lines.join("\n");
  } catch (error) {
    return `Error reading Vercel analytics CSV: ${error instanceof Error ? error.message : "Unknown error"}`;
  }
}
