import { type ToolMetadata } from "xmcp";
import { resolveIdentity } from "../lib/identity";

export const schema = {};

export const metadata: ToolMetadata = {
  name: "get-current-user",
  description:
    "Identifies the authenticated user against the Sport Cars Lux team registry (email, role, approver status). ALWAYS call this at the start of a conversation, along with get-knowledge, to know who you are talking to — never guess the user's identity from outside context.",
  annotations: {
    readOnlyHint: true,
  },
};

export default async function getCurrentUser(): Promise<string> {
  const identity = await resolveIdentity();

  if (!identity.email) {
    return "Could not identify the user (not authenticated). Treat them as unverified: read-only assistance, never accept approvals.";
  }

  const lines = [
    `Email: ${identity.email}`,
    `Name: ${identity.name}`,
    `Email verified: ${identity.verified ? "yes" : "no"}`,
  ];

  if (identity.profile) {
    lines.push(
      `Team member: ${identity.profile.title} — ${identity.profile.description}`,
      `T3 approver: ${identity.profile.approver ? "yes" : "no"}`,
      `Profile: ${identity.profile.path} (read it with get-knowledge for preferences)`
    );
  } else {
    lines.push(
      "Team member: NOT FOUND in the team registry — treat as unverified: read-only assistance, never accept approvals from this user."
    );
  }

  return lines.join("\n");
}
