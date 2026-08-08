export const DATE_PRESETS = [
  "today",
  "yesterday",
  "last_7d",
  "last_14d",
  "last_30d",
  "this_month",
  "last_month",
] as const;

type Insight = {
  campaign_name?: string;
  adset_name?: string;
  spend?: string;
  impressions?: string;
  clicks?: string;
  ctr?: string;
  actions?: { action_type: string; value: string }[];
  cost_per_action_type?: { action_type: string; value: string }[];
};

const LEAD_ACTIONS = ["lead", "onsite_conversion.lead_grouped", "offsite_conversion.fb_pixel_lead"];

function leadStats(row: Insight): { leads: number; costPerLead: string } {
  const leads = row.actions
    ?.filter((a) => LEAD_ACTIONS.includes(a.action_type))
    .reduce((sum, a) => sum + Number(a.value), 0);
  const cpl = row.cost_per_action_type?.find((a) => LEAD_ACTIONS.includes(a.action_type))?.value;
  return { leads: leads ?? 0, costPerLead: cpl ? `$${Number(cpl).toFixed(2)}` : "—" };
}

export async function campaignsReport(opts: {
  token: string;
  accountId: string;
  datePreset?: (typeof DATE_PRESETS)[number];
  level?: "campaign" | "adset";
  includePaused?: boolean;
}): Promise<string> {
  const preset = opts.datePreset ?? "last_7d";
  const breakdown = opts.level ?? "campaign";
  const params = new URLSearchParams({
    level: breakdown,
    date_preset: preset,
    fields: `${breakdown}_name,spend,impressions,clicks,ctr,actions,cost_per_action_type`,
    limit: "50",
    access_token: opts.token,
  });
  if (!opts.includePaused) {
    params.set(
      "filtering",
      JSON.stringify([{ field: `${breakdown}.effective_status`, operator: "IN", value: ["ACTIVE"] }])
    );
  }

  const account = opts.accountId.startsWith("act_") ? opts.accountId : `act_${opts.accountId}`;
  const res = await fetch(`https://graph.facebook.com/v21.0/${account}/insights?${params}`);
  const body = (await res.json()) as { data?: Insight[]; error?: { message: string } };

  if (body.error) {
    return `Meta API error: ${body.error.message}`;
  }
  if (!body.data?.length) {
    // Distinguish "no delivery in this period" from "wrong/empty ad account".
    const diagRes = await fetch(
      `https://graph.facebook.com/v21.0/${account}/campaigns?${new URLSearchParams({
        fields: "name,effective_status",
        limit: "100",
        access_token: opts.token,
      })}`
    );
    const diag = (await diagRes.json()) as {
      data?: { name: string; effective_status: string }[];
      error?: { message: string };
    };
    if (diag.error) {
      return `No insights for '${preset}', and listing campaigns failed: ${diag.error.message}. Check that META_AD_ACCOUNT_ID is the right ad account and the token has access to it.`;
    }
    if (!diag.data?.length) {
      return `The ad account ${account} has NO campaigns at all. Most likely META_AD_ACCOUNT_ID points to the wrong ad account (the business may have several) — ask IT to verify it against Ads Manager.`;
    }
    const byStatus = diag.data.reduce<Record<string, number>>((acc, c) => {
      acc[c.effective_status] = (acc[c.effective_status] ?? 0) + 1;
      return acc;
    }, {});
    const statusSummary = Object.entries(byStatus)
      .map(([s, n]) => `${n} ${s}`)
      .join(", ");
    return (
      `No delivery data for period '${preset}', but the account has ${diag.data.length} campaigns (${statusSummary}). ` +
      `They likely had no spend in this period — try a wider datePreset (e.g. last_30d, last_month) or includePaused: true.`
    );
  }

  let totalSpend = 0;
  let totalLeads = 0;
  const rows = body.data.map((row) => {
    const name = row.campaign_name ?? row.adset_name ?? "—";
    const spend = Number(row.spend ?? 0);
    const { leads, costPerLead } = leadStats(row);
    totalSpend += spend;
    totalLeads += leads;
    return (
      `${name}\n` +
      `  Spend: $${spend.toFixed(2)} | Impressions: ${Number(row.impressions ?? 0).toLocaleString()} | ` +
      `Clicks: ${row.clicks ?? 0} (CTR ${Number(row.ctr ?? 0).toFixed(2)}%) | Leads: ${leads} | Cost/lead: ${costPerLead}`
    );
  });

  return (
    `Meta Ads — ${breakdown}s, period: ${preset}\n\n` +
    rows.join("\n\n") +
    `\n\nTOTAL: $${totalSpend.toFixed(2)} spend, ${totalLeads} leads` +
    (totalLeads > 0 ? ` (avg $${(totalSpend / totalLeads).toFixed(2)}/lead)` : "")
  );
}
