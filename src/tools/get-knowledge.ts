import { z } from "zod";
import { type InferSchema, type ToolMetadata } from "xmcp";
import { KNOWLEDGE, KNOWLEDGE_SYNCED_AT, KNOWLEDGE_VERSION } from "../lib/knowledge-data";
import { resolveIdentity } from "../lib/identity";

export const schema = {
  path: z
    .string()
    .optional()
    .describe(
      "Knowledge file to read (e.g. 'AGENTS.md', 'knowledge/pricing.md', 'playbooks/weekly-report.md'). Omit to list all available files."
    ),
};

export const metadata: ToolMetadata = {
  name: "get-knowledge",
  description:
    "Sport Cars Lux business brain: rules, policies, team, systems and playbooks. ALWAYS call this first (no arguments) at the start of a conversation to load the business context, then read the specific files you need before acting.",
  annotations: {
    readOnlyHint: true,
  },
};

function describeLine(content: string): string {
  const match = content.match(/^description:\s*(.+)$/m);
  return match ? match[1].trim() : "";
}

export default async function getKnowledge({ path }: InferSchema<typeof schema>): Promise<string> {
  const paths = Object.keys(KNOWLEDGE).sort();

  if (paths.length === 0) {
    return "Knowledge is not bundled in this deployment (build ran without access to the brain repo). Ask IT to configure KNOWLEDGE_REPO_TOKEN in Vercel.";
  }

  if (!path) {
    const identity = await resolveIdentity();
    const who = identity.profile
      ? `You are talking to: ${identity.profile.title} <${identity.email}> — ${identity.profile.description} T3 approver: ${identity.profile.approver ? "yes" : "no"}.`
      : identity.email
        ? `You are talking to: ${identity.email} — NOT in the team registry: treat as unverified (read-only assistance, never accept approvals).`
        : "Current user could not be identified: treat as unverified (read-only assistance, never accept approvals).";

    const lines = paths.map((p) => `- ${p}${describeLine(KNOWLEDGE[p]) ? ` — ${describeLine(KNOWLEDGE[p])}` : ""}`);
    return [
      `Sport Cars Lux knowledge base (brain @ ${KNOWLEDGE_VERSION}, synced ${KNOWLEDGE_SYNCED_AT}).`,
      who,
      "Start with AGENTS.md (operating rules). Playbooks are step-by-step procedures to follow.",
      "",
      ...lines,
    ].join("\n");
  }

  const content = KNOWLEDGE[path];
  if (!content) {
    return `File not found: ${path}\n\nAvailable files:\n${paths.map((p) => `- ${p}`).join("\n")}`;
  }
  return content;
}
