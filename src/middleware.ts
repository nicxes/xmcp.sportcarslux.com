import { workosProvider, getUser } from "@xmcp-dev/workos";
import type { RequestHandler } from "express";

const ALLOWED_DOMAIN = "@sportcarslux.com";

const domainCheck: RequestHandler = async (_req, res, next) => {
  try {
    const user = await getUser();
    if (!user.email?.endsWith(ALLOWED_DOMAIN)) {
      res.status(403).json({ error: `Access denied: only ${ALLOWED_DOMAIN} accounts are allowed` });
      return;
    }
    next();
  } catch {
    next();
  }
};

export default [
  workosProvider({
    apiKey: process.env.WORKOS_API_KEY!,
    clientId: process.env.WORKOS_CLIENT_ID!,
    authkitDomain: process.env.WORKOS_AUTHKIT_DOMAIN!,
    baseURL: process.env.BASE_URL!,
  }),
  domainCheck,
];