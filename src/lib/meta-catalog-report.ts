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

    catalogId = catalogId.trim();
    const sections: string[] = [];

    // Step 1 — read the catalog node itself; if this fails, nothing else can work.
    let vertical = "";
    try {
      const node = await graph<{ id: string; name?: string; product_count?: number; vertical?: string }>(
        catalogId,
        opts.token,
        { fields: "id,name,product_count,vertical" }
      );
      vertical = node.vertical ?? "";
      sections.push(
        `Catalog: ${node.name ?? catalogName ?? catalogId} — ${node.product_count ?? "?"} products (vertical: ${node.vertical ?? "?"})`
      );
    } catch (e) {
      return (
        `Cannot read catalog ${catalogId} at all — raw Meta error: "${e instanceof Error ? e.message : String(e)}". ` +
        `This means the ID is wrong OR the app/token still lacks catalog capability. Verify META_CATALOG_ID against Business Settings → Data sources → Catalogs.`
      );
    }

    // Step 2 — feed uploads: did the last sync go through clean?
    try {
      const feeds = await graph<{
        data?: {
          id: string;
          name: string;
          product_count?: number;
          latest_upload?: { id?: string; end_time?: string; error_count?: number; warning_count?: number };
        }[];
      }>(`${catalogId}/product_feeds`, opts.token, {
        fields: "id,name,product_count,latest_upload{id,end_time,error_count,warning_count}",
      });
      if (feeds.data?.length) {
        for (const feed of feeds.data) {
          const up = feed.latest_upload;
          sections.push(
            `Feed "${feed.name}": ${feed.product_count ?? "?"} products — last upload ${up?.end_time?.slice(0, 16) ?? "?"}: ` +
              `${up?.error_count ?? 0} errors, ${up?.warning_count ?? 0} warnings`
          );
          if (up?.id && ((up.error_count ?? 0) > 0 || (up.warning_count ?? 0) > 0)) {
            try {
              const errs = await graph<{ data?: { summary?: string; severity?: string; total_count?: number }[] }>(
                `${up.id}/errors`,
                opts.token,
                { fields: "summary,severity,total_count", limit: "10" }
              );
              for (const err of errs.data ?? []) {
                sections.push(`  ${err.severity ?? "issue"}: ${err.summary ?? "?"} (${err.total_count ?? 1} items)`);
              }
            } catch {
              // detail unavailable; counts above are still useful
            }
          }
        }
      } else {
        sections.push("No product feeds found (catalog may be API-synced without feeds).");
      }
    } catch (e) {
      sections.push(`Feeds: unavailable — raw Meta error: "${e instanceof Error ? e.message : String(e)}"`);
    }

    // Step 3 — item availability/review. Vehicle catalogs use the /vehicles edge, not /products.
    try {
      if (vertical === "vehicles") {
        const vehicles = await graph<{
          data?: { title?: string; availability?: string }[];
        }>(`${catalogId}/vehicles`, opts.token, { fields: "title,availability", limit: "200" });
        const byAvailability: Record<string, number> = {};
        for (const v of vehicles.data ?? []) {
          const a = v.availability ?? "unknown";
          byAvailability[a] = (byAvailability[a] ?? 0) + 1;
        }
        sections.push(
          `Vehicles by availability: ${Object.entries(byAvailability)
            .map(([s, n]) => `${n} ${s}`)
            .join(", ") || "none found"}`
        );
      } else {
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
      }
    } catch (e) {
      sections.push(`Item status: unavailable — raw Meta error: "${e instanceof Error ? e.message : String(e)}"`);
    }

    return sections.join("\n\n");
  } catch (e) {
    return `Meta API error (raw): "${e instanceof Error ? e.message : String(e)}"`;
  }
}
