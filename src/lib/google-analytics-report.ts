import { getGoogleAccessToken } from "./google-auth";

export const GA_DATE_RANGES = {
  today: "today",
  yesterday: "yesterday",
  last_7d: "7daysAgo",
  last_14d: "14daysAgo",
  last_30d: "30daysAgo",
  last_90d: "90daysAgo",
} as const;

export type GaDateRange = keyof typeof GA_DATE_RANGES;

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

function dateRange(range: GaDateRange) {
  return [{ startDate: GA_DATE_RANGES[range], endDate: "today" }];
}

const num = (v?: string) => Number(v ?? 0);
const fmt = (v?: string) => num(v).toLocaleString();

export async function trafficReport(range: GaDateRange): Promise<string> {
  const report = await runReport({
    dateRanges: dateRange(range),
    dimensions: [{ name: "sessionDefaultChannelGroup" }],
    metrics: [{ name: "sessions" }, { name: "totalUsers" }, { name: "screenPageViews" }],
    orderBys: [{ metric: { metricName: "sessions" }, desc: true }],
    limit: 15,
  });
  if (report.error) return `GA4 error: ${report.error}`;
  if (!report.rows?.length) return `No traffic data for ${range}.`;

  let sessions = 0;
  let users = 0;
  const lines = report.rows.map((r) => {
    sessions += num(r.metricValues?.[0]?.value);
    users += num(r.metricValues?.[1]?.value);
    return `- ${r.dimensionValues?.[0]?.value}: ${fmt(r.metricValues?.[0]?.value)} sessions, ${fmt(r.metricValues?.[1]?.value)} users, ${fmt(r.metricValues?.[2]?.value)} pageviews`;
  });
  return `Website traffic by channel (${range}):\n${lines.join("\n")}\n\nTOTAL: ${sessions.toLocaleString()} sessions, ${users.toLocaleString()} users`;
}

export async function pagesReport(range: GaDateRange, limit: number): Promise<string> {
  const report = await runReport({
    dateRanges: dateRange(range),
    dimensions: [{ name: "pagePath" }],
    metrics: [{ name: "screenPageViews" }, { name: "totalUsers" }],
    orderBys: [{ metric: { metricName: "screenPageViews" }, desc: true }],
    limit,
  });
  if (report.error) return `GA4 error: ${report.error}`;
  if (!report.rows?.length) return `No page data for ${range}.`;

  const lines = report.rows.map(
    (r) =>
      `- ${r.dimensionValues?.[0]?.value}: ${fmt(r.metricValues?.[0]?.value)} views, ${fmt(r.metricValues?.[1]?.value)} users`
  );
  return `Top pages (${range}):\n${lines.join("\n")}`;
}

export async function eventsReport(range: GaDateRange, limit: number): Promise<string> {
  const report = await runReport({
    dateRanges: dateRange(range),
    dimensions: [{ name: "eventName" }],
    metrics: [{ name: "eventCount" }],
    orderBys: [{ metric: { metricName: "eventCount" }, desc: true }],
    limit,
  });
  if (report.error) return `GA4 error: ${report.error}`;
  if (!report.rows?.length) return `No event data for ${range}.`;

  const lines = report.rows.map(
    (r) => `- ${r.dimensionValues?.[0]?.value}: ${fmt(r.metricValues?.[0]?.value)}`
  );
  return `Events (${range}):\n${lines.join("\n")}`;
}

export async function campaignsReport(range: GaDateRange): Promise<string> {
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
    return `Campaigns (${range}):\n${lines.join("\n")}\n\nTOTAL ad cost: $${totalCost.toFixed(2)}`;
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
  if (!plain.rows?.length) return `No campaign data for ${range}.`;
  const lines = plain.rows.map(
    (r) =>
      `- ${r.dimensionValues?.[0]?.value}: ${fmt(r.metricValues?.[0]?.value)} sessions, ${fmt(r.metricValues?.[1]?.value)} users`
  );
  return `Campaigns (${range}) — ad cost unavailable (Google Ads link?):\n${lines.join("\n")}`;
}
