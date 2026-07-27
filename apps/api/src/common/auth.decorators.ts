import { SetMetadata } from "@nestjs/common";
import type { Capability } from "@metavchim/shared";

export const IS_PUBLIC_KEY = "isPublic";
/** Endpoint ציבורי — ללא Session. שמור למינימום ההכרחי (login, health, דפי הצעה). */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

export const CAPABILITY_KEY = "requiredCapability";
/** הצהרת היכולת הנדרשת — נאכפת ב-CapabilityGuard על כל Handler לא-ציבורי. */
export const RequireCapability = (capability: Capability) =>
  SetMetadata(CAPABILITY_KEY, capability);
