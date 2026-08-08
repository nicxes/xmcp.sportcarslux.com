import { graph } from "./meta-graph";

export async function catalogReport(opts: { token: string; listRejected?: boolean }): Promise<string> {
  try {
    let catalogId = process.env.META_CATALOG_ID;
    let catalogName = "";
    if (!catalogId) {
      // Catalog discovery is unreliable with system-user tokens; META_CATALOG_ID is the supported path.
      try {
        const catalogs = await graph<{ data?: { id: string; name: string }[] }>(
          "me/assigned_product_catalogs",
          opts.token,
          { fields: "id,name" }
        );
        if (catalogs.data?.length) {
          catalogId = catalogs.data[0].id;
          catalogName = catalogs.data[0].name;
        }
      } catch {
        // fall through to the explicit-config message
      }
      if (!catalogId) {
        return "Catalog discovery is not available with this token. Ask IT to set META_CATALOG_ID in the server environment (the catalog ID is in Commerce Manager → catalog settings/URL).";
      }
    }

    const sections: string[] = [`Catalog: ${catalogName || catalogId}`];

    // Feed uploads: did the last sync go through clean?
    const feeds = await graph<{
      data?: {
        name: string;
        product_count?: number;
        latest_upload?: { end_time?: string; error_count?: number; warning_count?: number };
      }[];
    }>(`${catalogId}/product_feeds`, opts.token, {
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
    }>(`${catalogId}/products`, opts.token, { fields: "name,review_status", limit: "200" });

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
    if (rejected.length && opts.listRejected !== false) {
      sections.push(
        `REJECTED by Meta (not showing in catalog ads):\n${rejected.slice(0, 15).map((n) => `- ${n}`).join("\n")}`
      );
    }

    return sections.join("\n\n");
  } catch (e) {
    return `Meta API error: ${e instanceof Error ? e.message : String(e)}. If it mentions permissions, regenerate the token including 'catalog_management'.`;
  }
}
