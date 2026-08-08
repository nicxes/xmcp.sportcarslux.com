import { resolveIdentity, type Identity } from "./identity";

/**
 * Capability tiers, per knowledge/permissions.md in the brain repo:
 *   T1 read      — runs freely
 *   T2 log       — runs freely, must leave a trace
 *   T3 act       — business-impacting writes: approvers execute, everyone
 *                  else gets a proposal instruction
 *   T4 destroy   — destructive: approvers only, with explicit warning
 */
export type Tier = "T1" | "T2" | "T3" | "T4";

export type GateResult =
  | { allow: true; identity: Identity }
  | { allow: false; message: string };

export async function gatekeeper(tier: Tier): Promise<GateResult> {
  const identity = await resolveIdentity();

  if (tier === "T1" || tier === "T2") {
    return { allow: true, identity };
  }

  if (!identity.email || !identity.profile) {
    return {
      allow: false,
      message:
        `Denied (${tier}): the current user is not identified as a Sport Cars Lux team member. ` +
        `This action requires an authenticated approver. Do not retry; assist read-only instead.`,
    };
  }

  if (!identity.profile.approver) {
    return {
      allow: false,
      message:
        `Denied (${tier}): ${identity.profile.title} <${identity.email}> is not a T3 approver ` +
        `(see ${identity.profile.path}). Record the request as a proposal with add-notes, citing the ` +
        `data behind it, and tell the user an approver (see knowledge/team/index.md) must execute it.`,
    };
  }

  return { allow: true, identity };
}

/** Audit line to append to the output of gated write actions. */
export function auditLine(identity: Identity): string {
  return `\n\nExecuted by: ${identity.profile?.title ?? identity.name} <${identity.email}>`;
}
