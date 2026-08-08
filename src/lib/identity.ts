import { getUser } from "@xmcp-dev/workos";
import { KNOWLEDGE } from "./knowledge-data";

export type TeamProfile = {
  path: string;
  title: string;
  description: string;
  approver: boolean;
};

export type Identity = {
  email: string | null;
  name: string;
  verified: boolean;
  profile: TeamProfile | null;
};

// Team profiles live in the bundled knowledge (knowledge/team/*.md), so
// identity data never has to be committed to this (public) repo.
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

/**
 * Single source of identity for every tool. Resolves the WorkOS
 * authenticated user and matches it against the team registry.
 */
export async function resolveIdentity(): Promise<Identity> {
  try {
    const user = await getUser();
    const email = user.email ?? null;
    return {
      email,
      name: [user.firstName, user.lastName].filter(Boolean).join(" ") || email || "unknown",
      verified: Boolean(user.emailVerified),
      profile: email ? findTeamProfile(email) : null,
    };
  } catch {
    return { email: null, name: "unknown", verified: false, profile: null };
  }
}
