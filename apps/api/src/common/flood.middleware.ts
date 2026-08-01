import { Injectable, NestMiddleware } from "@nestjs/common";
import type { NextFunction, Request, Response } from "express";

/**
 * בלם הצפה מוקדם — רץ לפני SessionMiddleware, כך שמקור שנחסם לא ממשיך
 * לגרור שאילתת session ב-DB על כל בקשה עם עוגייה פיקטיבית (ביקורת Codex).
 * ה-ThrottlerGuard הגלובלי (300/דקה) נשאר שכבת ה-429 המדויקת; כאן רק
 * תקרה גסה וזולה בזיכרון: חלון קבוע של דקה, ללא תלות חיצונית.
 */

const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 600;
const SWEEP_THRESHOLD = 10_000;

interface Slot {
  count: number;
  windowStart: number;
}

@Injectable()
export class FloodMiddleware implements NestMiddleware {
  private readonly slots = new Map<string, Slot>();

  use(req: Request, res: Response, next: NextFunction): void {
    const ip = req.ip ?? "unknown";
    const now = Date.now();
    const slot = this.slots.get(ip);

    if (!slot || now - slot.windowStart >= WINDOW_MS) {
      // ניקוי עצלן — רק כשהמפה תופחת, סורקים החוצה חלונות שפגו
      if (this.slots.size >= SWEEP_THRESHOLD) {
        for (const [key, value] of this.slots) {
          if (now - value.windowStart >= WINDOW_MS) this.slots.delete(key);
        }
      }
      this.slots.set(ip, { count: 1, windowStart: now });
      next();
      return;
    }

    slot.count += 1;
    if (slot.count > MAX_PER_WINDOW) {
      res.status(429).json({ message: "יותר מדי בקשות — נסו שוב בעוד רגע" });
      return;
    }
    next();
  }
}
