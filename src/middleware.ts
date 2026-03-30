import { workosProvider } from "@xmcp-dev/workos";

export default workosProvider({
  apiKey: process.env.WORKOS_API_KEY!,
  clientId: process.env.WORKOS_CLIENT_ID!,
  authkitDomain: process.env.WORKOS_AUTHKIT_DOMAIN!,
  baseURL: process.env.BASE_URL!,
});