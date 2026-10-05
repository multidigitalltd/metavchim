/** ‏הגרף של Meta — גרסה אחת לכל המודול. */
export const GRAPH_BASE = "https://graph.facebook.com/v23.0";

/**
 * ‏החשבונות העסקיים (WABA) שהטוקן פותח — מ-`debug_token`, בטוקן של
 * ‏האפליקציה (`app_id|app_secret`, הצורה שבה Meta מזהה אותנו כאן).
 * ‏ריק — גם כשל וגם „אין”; הקורא מחליט מה כל אחד מהם אומר לו.
 */
export async function tokenWabaIds(
  token: string,
  app: { appId: string; appSecret: string },
  timeoutMs: number,
): Promise<string[]> {
  const url = new URL(`${GRAPH_BASE}/debug_token`);
  url.searchParams.set("input_token", token);
  url.searchParams.set("access_token", `${app.appId}|${app.appSecret}`);
  const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = (await res.json()) as {
    data?: { granular_scopes?: { scope?: string; target_ids?: string[] }[] };
  };
  const ids = new Set<string>();
  for (const entry of json.data?.granular_scopes ?? []) {
    if (entry.scope !== "whatsapp_business_management" && entry.scope !== "whatsapp_business_messaging") continue;
    for (const id of entry.target_ids ?? []) if (/^\d{5,30}$/u.test(id)) ids.add(id);
  }
  return [...ids];
}
