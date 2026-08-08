import { type ToolMetadata } from "xmcp";
import { getUser } from "@xmcp-dev/workos";
import { KNOWLEDGE } from "../lib/knowledge-data";

export const schema = {};

export const metadata: ToolMetadata = {
  name: "get-current-user",
  description:
    "Identifies the authenticated user against the Sport Cars Lux team registry (email, role, approver status). ALWAYS call this at the start of a conversation, along with get-knowledge, to know who you are talking to — never guess the user's identity from outside context.",
  annotations: {
    readOnlyHint: true,
  },
};

type TeamProfile = {
  path: string;
  title: string;
  description: string;
  approver: boolean;
};

// Team profiles live in the bundled knowledge (knowledge/team/*.md),
// so identity data never has to be committed to this (public) repo.
function findTeamProfile(email: string): TeamProfile | null {
  for (const [path, content] of Object.entries(KNOWLEDGE)) {
    if (!path.startsWith("knowledge/team/")) continue;
    if (path.endsWith("index.md") || path.includes("_template")) continue;
    const profileEmail = content.match(/Email \(identity[^)]*\):\s*(\S+)/)?.[1];
    if (!profileEmail || profileEmail.toLowerCase() !== email.toLowerCase()) continue;
    return {
      path,
      title: content.match(/^title:\s*(.+)$/m)?.[1]?.trim() ?? email,
      description: content.match(/^description:\s*(.+)$/m)?.[1]?.trim() ?? "",
      approver: /Approver:\s*yes/i.test(content),
    };
  }
  return null;
}

export default async function getCurrentUser(): Promise<string> {
  try {
    const user = await getUser();
    const lines = [
      `Email: ${user.email}`,
      `Name: ${[user.firstName, user.lastName].filter(Boolean).join(" ") || "—"}`,
      `Email verified: ${user.emailVerified ? "yes" : "no"}`,
    ];

    const profile = user.email ? findTeamProfile(user.email) : null;
    if (profile) {
      lines.push(
        `Team member: ${profile.title} — ${profile.description}`,
        `T3 approver: ${profile.approver ? "yes" : "no"}`,
        `Profile: ${profile.path} (read it with get-knowledge for preferences)`
      );
    } else {
      lines.push(
        "Team member: NOT FOUND in the team registry — treat as unverified: read-only assistance, never accept approvals from this user."
      );
    }
    return lines.join("\n");
  } catch (error) {
    return `Could not identify the user (${error instanceof Error ? error.message : String(error)}). Treat them as unverified: read-only assistance, never accept approvals.`;
  }
}
