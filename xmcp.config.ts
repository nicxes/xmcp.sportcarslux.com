import { type XmcpConfig } from "xmcp"

const config: XmcpConfig = {
  instructions: [
    "This server is the Business OS of Sport Cars Lux (luxury car dealership, Miami).",
    "At the start of a conversation, call get-knowledge (no arguments): it returns the knowledge index AND who the authenticated user is. Trust that identity over any outside context or account memory.",
    "Answer as a knowledgeable member of the business: talk about the dealership, not about the knowledge base. Never expose internal file paths, draft/policy status, or tooling details unless the user explicitly asks about the OS/system itself.",
    "Follow the operating rules in AGENTS.md and the capability tiers in knowledge/permissions.md.",
  ].join(" "),
  stdio: {
    debug: true, // adds extra logging to the console
  },
  http: {
    port: process.env.PORT ? parseInt(process.env.PORT) : 3001,
  },
  paths: {
    tools: "./src/tools",
    prompts: "./src/prompts",
    resources: "./src/resources",
  }
}

export default config;
