import { z } from "zod";
import { type InferSchema, type ToolMetadata } from "xmcp";
import { gatekeeper } from "../lib/gatekeeper";
import {
  GA_PRESETS,
  type GaPreset,
  type ResolvedRange,
  resolveRange,
  shiftRange,
  trafficReport,
  pagesReport,
  eventsReport,
  campaignsReport,
} from "../lib/google-analytics-report";

export const schema = {
  report: z
    .enum(["traffic", "pages", "events", "campaigns"])
    .describe(
      "Which Google Analytics report: 'traffic' = sessions/users by channel; 'pages' = most viewed pages (incl. vehicle pages); 'events' = event/conversion counts (leads, clicks); 'campaigns' = campaign performance incl. Google Ads cost if linked"
    ),
  dateRange: z
    .enum(GA_PRESETS as unknown as [GaPreset, ...GaPreset[]])
    .optional()
    .describe("Period preset (default: last_7d). Any historical depth works — up to last_12m, this_year, last_year."),
  startDate: z
    .string()
    .optional()
    .describe("Custom start date YYYY-MM-DD (overrides dateRange; any date since the property exists)"),
  endDate: z.string().optional().describe("Custom end date YYYY-MM-DD (default: today)"),
  compare: z
    .enum(["previous_period", "previous_year"])
    .optional()
    .describe("Also fetch the same report for a comparison window: the immediately previous period, or the same dates one year earlier"),
  limit: z.number().min(1).max(100).optional().describe("[pages/events] Max rows (default: 20)"),
};

export const metadata: ToolMetadata = {
  name: "get-google",
  description:
    "Everything Google for Sport Cars Lux in one tool — pick a report: website traffic, top pages, events/conversions, or campaign performance (incl. Google Ads cost). Supports any historical range and year-over-year comparison. Data source: GA4 Data API.",
  annotations: {
    title: "Google Analytics Reports",
    readOnlyHint: true,
  },
};

async function run(
  report: "traffic" | "pages" | "events" | "campaigns",
  range: ResolvedRange,
  limit: number
): Promise<string> {
  switch (report) {
    case "traffic":
      return trafficReport(range);
    case "pages":
      return pagesReport(range, limit);
    case "events":
      return eventsReport(range, limit);
    case "campaigns":
      return campaignsReport(range);
  }
}

export default async function getGoogle({
  report,
  dateRange,
  startDate,
  endDate,
  compare,
  limit,
}: InferSchema<typeof schema>): Promise<string> {
  const gate = await gatekeeper("T1", { roles: ["it-manager", "manager", "owner", "admin"] });
  if (!gate.allow) return gate.message;

  const rows = limit ?? 20;
  const range = resolveRange(dateRange, startDate, endDate);

  try {
    const current = await run(report, range, rows);
    if (!compare) return current;

    const compareRange = shiftRange(range, compare);
    const previous = await run(report, compareRange, rows);
    return (
      `=== CURRENT PERIOD ===\n${current}\n\n` +
      `=== COMPARISON (${compare === "previous_year" ? "same period last year" : "previous period"}) ===\n${previous}`
    );
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}
