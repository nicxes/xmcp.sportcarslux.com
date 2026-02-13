import { z } from "zod";
import { type InferSchema, type PromptMetadata } from "xmcp";

export const schema = {
  includeNotes: z
    .boolean()
    .optional()
    .describe("Include operational notes and context details"),
};

export const metadata: PromptMetadata = {
  name: "web-team-expenses",
  title: "Web Team Expenses",
  description: "Returns hardcoded current web team infrastructure expenses and payment details",
  role: "user",
};

export default function webTeamExpenses({
  includeNotes,
}: InferSchema<typeof schema>) {
  const notes = includeNotes !== false;

  return `Current IT Team expenses:

1) DigitalOcean Server
- Service: vauto.sportcarslux.com
- Purpose: Receives inventory from vAuto via FTP and uploads it to Supabase
- Cost: $6.00/month ($0.009/hour)
- Payment method: American Express ending in 1024 (primary), Mastercard ending in 7310 (backup)

2) Vercel Pro Account
- Services hosted: xmcp.sportcarslux.com and sportcarslux.com
- Purpose: Website hosting and MCP assistant (Sport Cars help chatbot)
- Cost: $20.00/month
- Payment method: American Express credit card ending in 1024

3) Cloudflare
- Purpose: Stores images or heavy files for the homepage, etc
- Cost: Free

4) Supabase
- Purpose: Vehicle inventory database
- Current cost: Free
- Plan reference: $25/month plan was considered due to a high traffic warning on January 21
- Optimization note: Improvements were implemented on February 1 to reduce consumption and remain on free tier

${notes ? "Note: This is static report provided by the team and may need manual updates over time. Last updated: February 13, 2026." : ""}`;
}
