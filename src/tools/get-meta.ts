import { z } from "zod";
import { type InferSchema, type ToolMetadata } from "xmcp";
import { gatekeeper } from "../lib/gatekeeper";
import { campaignsReport, DATE_PRESETS } from "../lib/meta-campaigns-report";
import { socialReport } from "../lib/meta-social-report";
import { catalogReport } from "../lib/meta-catalog-report";

export const schema = {
  report: z
    .enum(["campaigns", "social", "catalog"])
    .describe(
      "Which Meta report: 'campaigns' = paid ads performance (spend, leads, cost per lead); 'social' = organic Facebook Page + Instagram posts and engagement; 'catalog' = vehicle catalog health (feed errors, rejected products)"
    ),
  datePreset: z
    .enum(DATE_PRESETS)
    .optional()
    .describe("[campaigns] Reporting period (default: last_7d)"),
  level: z
    .enum(["campaign", "adset"])
    .optional()
    .describe("[campaigns] Breakdown level (default: campaign)"),
  includePaused: z
    .boolean()
    .optional()
    .describe("[campaigns] Include paused campaigns (default: false)"),
  platform: z
    .enum(["instagram", "facebook", "both"])
    .optional()
    .describe("[social] Which platform (default: both)"),
  limit: z.number().min(1).max(50).optional().describe("[social] Recent posts to analyze (default: 10)"),
  listRejected: z.boolean().optional().describe("[catalog] List rejected products by name (default: true)"),
};

export const metadata: ToolMetadata = {
  name: "get-meta",
  description:
    "Everything Meta (Facebook/Instagram) for Sport Cars Lux in one tool — pick a report: paid campaign performance, organic social engagement, or vehicle catalog health. Data source: Meta Graph/Marketing API.",
  annotations: {
    title: "Meta (FB/IG) Reports",
    readOnlyHint: true,
  },
};

export default async function getMeta({
  report,
  datePreset,
  level,
  includePaused,
  platform,
  limit,
  listRejected,
}: InferSchema<typeof schema>): Promise<string> {
  // TEMP TEST: it-manager/admin removed to verify role denial — revert after
  const gate = await gatekeeper("T1", { roles: ["manager", "owner"] });
  if (!gate.allow) return gate.message;

  const token = process.env.META_ACCESS_TOKEN;
  if (!token) {
    return "Meta is not configured yet: set META_ACCESS_TOKEN in the server environment (ask IT).";
  }

  switch (report) {
    case "campaigns": {
      const accountId = process.env.META_AD_ACCOUNT_ID;
      if (!accountId) {
        return "Meta Ads is not configured yet: set META_AD_ACCOUNT_ID in the server environment (ask IT).";
      }
      return campaignsReport({ token, accountId, datePreset, level, includePaused });
    }
    case "social":
      return socialReport({ token, platform, limit });
    case "catalog":
      return catalogReport({ token, listRejected });
  }
}
