import { Controller, Get } from "@nestjs/common";
import { RequireCapability } from "../../common/auth.decorators";
import { TelephonyService } from "./telephony.service";

/**
 * „האם מחוברת מרכזיה” — לבאנר במסך השיחות, ותו לא.
 *
 * ## למה מחלקה נפרדת ולא עוד נתיב ב-`TelephonyController`
 *
 * שם יושב `@RequireFeature("telephony")` ברמת המחלקה, והנתיב הזה
 * נועד לענות **דווקא** למשרד שאין לו את הפיצ'ר. תחת השער ההוא הוא
 * החזיר 403, כלומר הקהל היחיד שההסבר נכתב בשבילו היה הקהל היחיד
 * שלא קיבל אותו.
 *
 * ## למה הנתיב הוא `telephony/presence`
 *
 * המסך קרא ל-`/telephony/presence` בעוד הנתיב היה
 * `settings/telephony/presence` — 404 בכל משרד, מחובר או לא, ולכן
 * הבאנר לא הופיע לאיש מעולם. הכתובת כאן היא זו שהמסך מבקש: הבאנר
 * אינו חלק מהגדרות המשרד, והוא נקרא ממסך השיחות.
 *
 * ## למה שתי היכולות
 *
 * אותו שער כמו רשימת השיחות עצמה
 * (`@RequireCapability("leads.view_own", "buyers.view_own")`). עם
 * `leads.view_own` בלבד, סוכן שרואה את המסך בזכות הקונים היה מקבל
 * 403 על הבאנר — כלומר מסך שהוא רשאי לראות, בלי ההסבר שנכתב לו.
 */
@Controller("telephony")
export class TelephonyPresenceController {
  constructor(private readonly telephony: TelephonyService) {}

  @Get("presence")
  @RequireCapability("leads.view_own", "buyers.view_own")
  async presence(): Promise<{ connected: boolean }> {
    return { connected: await this.telephony.isConnected() };
  }
}
