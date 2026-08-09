import { getGoogleAccessToken } from "./google-auth";
import type { ResolvedRange } from "./google-analytics-report";

type SearchRow = {
  keys?: string[];
  clicks?: number;
  impressions?: number;
  ctr?: number;
  position?: number;
};

async function query(siteUrl: string, body: object): Promise<{ rows?: SearchRow[]; error?: string }> {
  const token = await getGoogleAccessToken("https://www.googleapis.com/auth/webmasters.readonly");
  const res = await fetch(
    `https://searchconsole.googleapis.com/webmasters/v3/sites/${encodeURIComponent(siteUrl)}/searchAnalytics/query`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }
  );
  const data = (await res.json()) as { rows?: SearchRow[]; error?: { message: string } };
  if (data.error) return { error: data.error.message };
  return { rows: data.rows };
}

/**
 * Google Search Console: top queries or pages in organic search.
 * Tries the configured site, then domain property, then URL-prefix.
 */
export async function searchReport(
  range: ResolvedRange,
  dimension: "query" | "page",
  limit: number
): Promise<string> {
  const candidates = process.env.GSC_SITE_URL
    ? [process.env.GSC_SITE_URL]
    : ["sc-domain:sportcarslux.com", "https://sportcarslux.com/"];

  let lastError = "";
  for (const site of candidates) {
    const result = await query(site, {
      startDate: range.startDate,
      endDate: range.endDate,
      dimensions: [dimension],
      rowLimit: limit,
    });
    if (result.error) {
      lastError = `${site}: ${result.error}`;
      continue;
    }
    if (!result.rows?.length) {
      return `No organic search data for ${range.startDate}..${range.endDate} (site: ${site}).`;
    }

    let clicks = 0;
    let impressions = 0;
    const lines = result.rows.map((r) => {
      clicks += r.clicks ?? 0;
      impressions += r.impressions ?? 0;
      return (
        `- "${r.keys?.[0] ?? "?"}": ${r.clicks ?? 0} clicks, ${(r.impressions ?? 0).toLocaleString()} impressions, ` +
        `CTR ${((r.ctr ?? 0) * 100).toFixed(1)}%, avg position ${(r.position ?? 0).toFixed(1)}`
      );
    });
    return (
      `Organic search — top ${dimension === "query" ? "queries" : "pages"} (${range.startDate} to ${range.endDate}):\n` +
      lines.join("\n") +
      `\n\nTOTAL: ${clicks.toLocaleString()} clicks, ${impressions.toLocaleString()} impressions`
    );
  }

  return `Search Console error: ${lastError}. If it mentions permissions, add the service account email as a user in Search Console (Settings → Users and permissions) or set GSC_SITE_URL.`;
}
