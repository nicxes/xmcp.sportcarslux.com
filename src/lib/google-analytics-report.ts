import { getGoogleAccessToken } from "./google-auth";

export const GA_PRESETS = [
  "today",
  "yesterday",
  "last_7d",
  "last_14d",
  "last_30d",
  "last_90d",
  "last_6m",
  "last_12m",
  "this_year",
  "last_year",
] as const;

export type GaPreset = (typeof GA_PRESETS)[number];

export type ResolvedRange = { startDate: string; endDate: string };

const iso = (d: Date) => d.toISOString().slice(0, 10);
const daysAgo = (n: number) => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d;
};

/** Resolves a preset or explicit dates into a concrete YYYY-MM-DD range. */
export function resolveRange(preset?: GaPreset, startDate?: string, endDate?: string): ResolvedRange {
  if (startDate) return { startDate, endDate: endDate ?? iso(new Date()) };
  const today = iso(new Date());
  switch (preset ?? "last_7d") {
    case "today":
      return { startDate: today, endDate: today };
    case "yesterday":
      return { startDate: iso(daysAgo(1)), endDate: iso(daysAgo(1)) };
    case "last_7d":
      return { startDate: iso(daysAgo(7)), endDate: today };
    case "last_14d":
      return { startDate: iso(daysAgo(14)), endDate: today };
    case "last_30d":
      return { startDate: iso(daysAgo(30)), endDate: today };
    case "last_90d":
      return { startDate: iso(daysAgo(90)), endDate: today };
    case "last_6m":
      return { startDate: iso(daysAgo(182)), endDate: today };
    case "last_12m":
      return { startDate: iso(daysAgo(365)), endDate: today };
    case "this_year":
      return { startDate: `${new Date().getFullYear()}-01-01`, endDate: today };
    case "last_year": {
      const y = new Date().getFullYear() - 1;
      return { startDate: `${y}-01-01`, endDate: `${y}-12-31` };
    }
  }
}

/** Shifts a resolved range for comparisons. */
export function shiftRange(range: ResolvedRange, mode: "previous_period" | "previous_year"): ResolvedRange {
  const start = new Date(range.startDate);
  const end = new Date(range.endDate);
  if (mode === "previous_year") {
    start.setFullYear(start.getFullYear() - 1);
    end.setFullYear(end.getFullYear() - 1);
  } else {
    const days = Math.round((end.getTime() - start.getTime()) / 86400000) + 1;
    start.setDate(start.getDate() - days);
    end.setDate(end.getDate() - days);
  }
  return { startDate: iso(start), endDate: iso(end) };
}

type Row = { dimensionValues?: { value: string }[]; metricValues?: { value: string }[] };

async function runReport(body: object): Promise<{ rows?: Row[]; rowCount?: number; error?: string }> {
  const propertyId = process.env.GA4_PROPERTY_ID;
  if (!propertyId) {
    return { error: "Google Analytics is not configured: set GA4_PROPERTY_ID (ask IT)." };
  }
  const token = await getGoogleAccessToken("https://www.googleapis.com/auth/analytics.readonly");
  const res = await fetch(
    `https://analyticsdata.googleapis.com/v1beta/properties/${propertyId}:runReport`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }
  );
  const data = (await res.json()) as { rows?: Row[]; rowCount?: number; error?: { message: string } };
  if (data.error) return { error: data.error.message };
  return { rows: data.rows, rowCount: data.rowCount };
}

function dateRange(range: ResolvedRange) {
  return [{ startDate: range.startDate, endDate: range.endDate }];
}

const num = (v?: string) => Number(v ?? 0);
const fmt = (v?: string) => num(v).toLocaleString();

export async function trafficReport(range: ResolvedRange): Promise<string> {
  const report = await runReport({
    dateRanges: dateRange(range),
    dimensions: [{ name: "sessionDefaultChannelGroup" }],
    metrics: [{ name: "sessions" }, { name: "totalUsers" }, { name: "screenPageViews" }],
    orderBys: [{ metric: { metricName: "sessions" }, desc: true }],
    limit: 15,
  });
  if (report.error) return `GA4 error: ${report.error}`;
  if (!report.rows?.length) return `No traffic data for ${range.startDate}..${range.endDate}.`;

  let sessions = 0;
  let users = 0;
  const lines = report.rows.map((r) => {
    sessions += num(r.metricValues?.[0]?.value);
    users += num(r.metricValues?.[1]?.value);
    return `- ${r.dimensionValues?.[0]?.value}: ${fmt(r.metricValues?.[0]?.value)} sessions, ${fmt(r.metricValues?.[1]?.value)} users, ${fmt(r.metricValues?.[2]?.value)} pageviews`;
  });
  return `Website traffic by channel (${range.startDate} to ${range.endDate}):\n${lines.join("\n")}\n\nTOTAL: ${sessions.toLocaleString()} sessions, ${users.toLocaleString()} users`;
}

export async function pagesReport(range: ResolvedRange, limit: number): Promise<string> {
  const report = await runReport({
    dateRanges: dateRange(range),
    dimensions: [{ name: "pagePath" }],
    metrics: [{ name: "screenPageViews" }, { name: "totalUsers" }],
    orderBys: [{ metric: { metricName: "screenPageViews" }, desc: true }],
    limit,
  });
  if (report.error) return `GA4 error: ${report.error}`;
  if (!report.rows?.length) return `No page data for ${range.startDate}..${range.endDate}.`;

  const lines = report.rows.map(
    (r) =>
      `- ${r.dimensionValues?.[0]?.value}: ${fmt(r.metricValues?.[0]?.value)} views, ${fmt(r.metricValues?.[1]?.value)} users`
  );
  return `Top pages (${range.startDate} to ${range.endDate}):\n${lines.join("\n")}`;
}

export async function eventsReport(range: ResolvedRange, limit: number): Promise<string> {
  const report = await runReport({
    dateRanges: dateRange(range),
    dimensions: [{ name: "eventName" }],
    metrics: [{ name: "eventCount" }],
    orderBys: [{ metric: { metricName: "eventCount" }, desc: true }],
    limit,
  });
  if (report.error) return `GA4 error: ${report.error}`;
  if (!report.rows?.length) return `No event data for ${range.startDate}..${range.endDate}.`;

  const lines = report.rows.map(
    (r) => `- ${r.dimensionValues?.[0]?.value}: ${fmt(r.metricValues?.[0]?.value)}`
  );
  return `Events (${range.startDate} to ${range.endDate}):\n${lines.join("\n")}`;
}

export async function campaignsReport(range: ResolvedRange): Promise<string> {
  // With Google Ads linked to GA4, cost metrics come through the Data API.
  const withCost = await runReport({
    dateRanges: dateRange(range),
    dimensions: [{ name: "sessionCampaignName" }],
    metrics: [
      { name: "sessions" },
      { name: "advertiserAdCost" },
      { name: "advertiserAdClicks" },
    ],
    orderBys: [{ metric: { metricName: "sessions" }, desc: true }],
    limit: 20,
  });

  if (!withCost.error && withCost.rows?.length) {
    let totalCost = 0;
    const lines = withCost.rows.map((r) => {
      const cost = num(r.metricValues?.[1]?.value);
      totalCost += cost;
      return `- ${r.dimensionValues?.[0]?.value}: ${fmt(r.metricValues?.[0]?.value)} sessions, $${cost.toFixed(2)} ad cost, ${fmt(r.metricValues?.[2]?.value)} ad clicks`;
    });
    return `Campaigns (${range.startDate} to ${range.endDate}):\n${lines.join("\n")}\n\nTOTAL ad cost: $${totalCost.toFixed(2)}`;
  }

  // Fallback without cost metrics (Ads not linked or metrics unavailable).
  const plain = await runReport({
    dateRanges: dateRange(range),
    dimensions: [{ name: "sessionCampaignName" }],
    metrics: [{ name: "sessions" }, { name: "totalUsers" }],
    orderBys: [{ metric: { metricName: "sessions" }, desc: true }],
    limit: 20,
  });
  if (plain.error) return `GA4 error: ${plain.error}`;
  if (!plain.rows?.length) return `No campaign data for ${range.startDate}..${range.endDate}.`;
  const lines = plain.rows.map(
    (r) =>
      `- ${r.dimensionValues?.[0]?.value}: ${fmt(r.metricValues?.[0]?.value)} sessions, ${fmt(r.metricValues?.[1]?.value)} users`
  );
  return `Campaigns (${range.startDate} to ${range.endDate}) — ad cost unavailable (Google Ads link?):\n${lines.join("\n")}`;
}
