import { z } from "zod";
import { type InferSchema, type ToolMetadata } from "xmcp";
import { gatekeeper } from "../lib/gatekeeper";

export const schema = {
  listRejected: z
    .boolean()
    .optional()
    .describe("List the rejected products by name (default: true)"),
};

export const metadata: ToolMetadata = {
  name: "get-catalog-health",
  description:
    "Health of the Meta (Facebook/Instagram) vehicle catalog synced by trigger.dev: feed upload errors/warnings and products rejected by Meta. Use to detect vehicles that are not showing in catalog ads.",
  annotations: {
    title: "Meta Catalog Health",
    readOnlyHint: true,
  },
};

const GRAPH = "https://graph.facebook.com/v21.0";

async function graph<T>(path: string, token: string, params: Record<string, string> = {}): Promise<T> {
  const qs = new URLSearchParams({ ...params, access_token: token });
  const res = await fetch(`${GRAPH}/${path}?${qs}`);
  const body = (await res.json()) as T & { error?: { message: string } };
  if (body.error) throw new Error(body.error.message);
  return body;
}

export default async function getCatalogHealth({ listRejected }: InferSchema<typeof schema>): Promise<string> {
  const gate = await gatekeeper("T1", { roles: ["it-manager", "manager", "owner", "admin"] });
  if (!gate.allow) return gate.message;

  const token = process.env.META_ACCESS_TOKEN;
  if (!token) {
    return "Meta is not configured yet: set META_ACCESS_TOKEN in the server environment (ask IT).";
  }

  try {
    let catalogId = process.env.META_CATALOG_ID;
    let catalogName = "";
    if (!catalogId) {
      const catalogs = await graph<{ data?: { id: string; name: string }[] }>(
        "me/assigned_product_catalogs",
        token,
        { fields: "id,name" }
      );
      if (!catalogs.data?.length) {
        return "No catalog accessible with this token. Assign the catalog to the system user and include 'catalog_management' when regenerating the token (or set META_CATALOG_ID).";
      }
      catalogId = catalogs.data[0].id;
      catalogName = catalogs.data[0].name;
    }

    const sections: string[] = [`Catalog: ${catalogName || catalogId}`];

    // Feed uploads: did the last sync go through clean?
    const feeds = await graph<{
      data?: {
        name: string;
        product_count?: number;
        latest_upload?: { end_time?: string; error_count?: number; warning_count?: number };
      }[];
    }>(`${catalogId}/product_feeds`, token, {
      fields: "name,product_count,latest_upload{end_time,error_count,warning_count}",
    });
    if (feeds.data?.length) {
      for (const feed of feeds.data) {
        const up = feed.latest_upload;
        sections.push(
          `Feed "${feed.name}": ${feed.product_count ?? "?"} products — last upload ${up?.end_time?.slice(0, 16) ?? "?"}: ` +
            `${up?.error_count ?? 0} errors, ${up?.warning_count ?? 0} warnings`
        );
      }
    } else {
      sections.push("No product feeds found (catalog may be API-synced without feeds).");
    }

    // Review status: what did Meta reject?
    const products = await graph<{
      data?: { name?: string; review_status?: string }[];
      paging?: unknown;
    }>(`${catalogId}/products`, token, { fields: "name,review_status", limit: "200" });

    const byStatus: Record<string, number> = {};
    const rejected: string[] = [];
    for (const p of products.data ?? []) {
      const status = p.review_status ?? "unknown";
      byStatus[status] = (byStatus[status] ?? 0) + 1;
      if (status === "rejected" && p.name) rejected.push(p.name);
    }
    sections.push(
      `Products by review status: ${Object.entries(byStatus)
        .map(([s, n]) => `${n} ${s}`)
        .join(", ") || "none found"}`
    );
    if (rejected.length && listRejected !== false) {
      sections.push(`REJECTED by Meta (not showing in catalog ads):\n${rejected.slice(0, 15).map((n) => `- ${n}`).join("\n")}`);
    }

    return sections.join("\n\n");
  } catch (e) {
    return `Meta API error: ${e instanceof Error ? e.message : String(e)}. If it mentions permissions, regenerate the token including 'catalog_management'.`;
  }
}
