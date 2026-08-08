import { z } from "zod";
import { type InferSchema, type ToolMetadata } from "xmcp";
import { gatekeeper } from "../lib/gatekeeper";
import {
  GA_DATE_RANGES,
  type GaDateRange,
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
    .enum(Object.keys(GA_DATE_RANGES) as [GaDateRange, ...GaDateRange[]])
    .optional()
    .describe("Reporting period (default: last_7d)"),
  limit: z.number().min(1).max(100).optional().describe("[pages/events] Max rows (default: 20)"),
};

export const metadata: ToolMetadata = {
  name: "get-google",
  description:
    "Everything Google for Sport Cars Lux in one tool — pick a report: website traffic, top pages, events/conversions, or campaign performance (incl. Google Ads cost). Data source: GA4 Data API.",
  annotations: {
    title: "Google Analytics Reports",
    readOnlyHint: true,
  },
};

export default async function getGoogle({
  report,
  dateRange,
  limit,
}: InferSchema<typeof schema>): Promise<string> {
  const gate = await gatekeeper("T1", { roles: ["it-manager", "manager", "owner", "admin"] });
  if (!gate.allow) return gate.message;

  const range = dateRange ?? "last_7d";
  const rows = limit ?? 20;

  try {
    switch (report) {
      case "traffic":
        return await trafficReport(range);
      case "pages":
        return await pagesReport(range, rows);
      case "events":
        return await eventsReport(range, rows);
      case "campaigns":
        return await campaignsReport(range);
    }
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}
