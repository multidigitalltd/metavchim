/**
 * RBAC מבוסס Capabilities — הקוד בודק תמיד יכולת, לעולם לא תפקיד גולמי.
 * (docs/04-security-privacy.md §3)
 */
export const CAPABILITIES = [
  "properties.view",
  "properties.create",
  "properties.edit",
  "properties.delete",
  "buyers.view_all",
  "buyers.view_own",
  "buyers.edit",
  "leads.view_all",
  "leads.view_own",
  "leads.edit",
  "offers.send",
  "matches.view",
  "calendar.manage",
  "collaboration.share",
  "collaboration.offer",
  "billing.manage",
  "users.manage",
  "settings.manage",
  "data.export",
  "audit.view",
] as const;

export type Capability = (typeof CAPABILITIES)[number];

export const ROLE_CAPABILITIES: Record<string, readonly Capability[]> = {
  owner: CAPABILITIES,
  admin: CAPABILITIES.filter((c) => c !== "billing.manage"),
  agent: [
    "properties.view",
    "properties.create",
    "properties.edit",
    "buyers.view_own",
    "buyers.edit",
    "leads.view_own",
    "leads.edit",
    "offers.send",
    "matches.view",
    "calendar.manage",
  ],
  assistant: [
    "properties.view",
    "properties.edit",
    "buyers.view_own",
    "leads.view_own",
    "leads.edit",
    "matches.view",
    "calendar.manage",
  ],
  viewer: ["properties.view", "buyers.view_own", "leads.view_own", "matches.view"],
};
