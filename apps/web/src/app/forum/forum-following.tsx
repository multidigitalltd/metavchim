"use client";

import { useEffect, useState } from "react";
import {
  DEFAULT_FORUM_PREFS,
  FORUM_PREF_KEY,
  parseForumPrefs,
  type ForumPrefs,
} from "@metavchim/shared";
import { apiGet, apiPatch } from "@/lib/api";
import { IconBell, IconMail } from "../icons";
import { Notice } from "../notice";
import { ThreadList } from "./forum-threads";

/**
 * „עוקב/ת” — השיחות שאני עוקב/ת אחריהן, ואיך העדכונים מגיעים אליי.
 *
 * ההעדפות נשמרות ב-`users.preferences.forum` — אותו מנגנון של
 * העדפות הוואטסאפ, ובאותו כלל: נשלח **רק** המפתח שלנו, והשרת ממזג.
 * הוואטסאפ עצמו אינו מוגדר כאן: הוא ערוץ של הסוכן האישי, ומי שיש
 * לו אותו מכבה או מדליק את קטגוריית „הפורום המקצועי” בפרופיל.
 */

interface ProfileDto {
  preferences: Record<string, unknown>;
}

export function FollowingPanel({ hasWhatsapp }: { hasWhatsapp: boolean }) {
  const [prefs, setPrefs] = useState<ForumPrefs>(DEFAULT_FORUM_PREFS);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    apiGet<ProfileDto>("/auth/profile")
      .then((res) => setPrefs(parseForumPrefs(res.preferences)))
      .catch(() => undefined);
  }, []);

  function persist(next: ForumPrefs): void {
    setPrefs(next);
    apiPatch<ProfileDto>("/auth/profile", { preferences: { [FORUM_PREF_KEY]: next } })
      .then((res) => {
        setPrefs(parseForumPrefs(res.preferences));
        setMessage("✓ ההגדרה נשמרה");
      })
      .catch(() => setMessage("השמירה נכשלה — נסו שוב"));
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
      <div>
        <h2 className="mv-card-head__title m-0 mb-3">שיחות שאני עוקב/ת אחריהן</h2>
        <ThreadList followingOnly />
      </div>
      <aside className="mv-card mv-card--pad self-start" aria-labelledby="forum-prefs-heading">
        <div className="mv-card-head mv-domain-green">
          <span className="mv-tile" aria-hidden="true"><IconBell s={19} /></span>
          <h2 id="forum-prefs-heading" className="mv-card-head__title m-0">איך לעדכן אותי</h2>
        </div>
        <p className="m-0 mb-3 text-[length:var(--type-caption-lg)]" style={{ color: "var(--color-text-muted)" }}>
          תגובה בשיחה שאתם עוקבים אחריה מגיעה תמיד לפעמון. מכאן בוחרים מה מגיע גם החוצה.
        </p>
        {message ? <Notice tone="success">{message}</Notice> : null}

        <label className="flex items-start gap-2.5 text-[length:var(--type-body-sm)] font-semibold">
          <input type="checkbox" className="mt-1" checked={prefs.followAll} onChange={(e) => persist({ ...prefs, followAll: e.target.checked })} />
          <span>
            לעקוב אחרי כל הפורום
            <span className="mv-forum-anon__hint">כל שאלה חדשה — התראה. מתאים למי שרוצה לעזור, פחות למי שרוצה שקט.</span>
          </span>
        </label>

        <p className="mb-1.5 mt-4 inline-flex items-center gap-1.5 text-[length:var(--type-caption)] font-semibold">
          <IconMail s={14} /> במייל
        </p>
        <label className="flex items-center gap-2.5 text-[length:var(--type-body-sm)] font-semibold">
          <input type="checkbox" checked={prefs.email} onChange={(e) => persist({ ...prefs, email: e.target.checked })} />
          לשלוח לי במייל את מה שמגיע לפעמון
        </label>
        {prefs.email ? (
          <div className="mv-seg mt-2" role="group" aria-label="קצב המייל">
            <button type="button" aria-pressed={prefs.digest === "instant"} onClick={() => persist({ ...prefs, digest: "instant" })}>מיידי</button>
            <button type="button" aria-pressed={prefs.digest === "daily"} onClick={() => persist({ ...prefs, digest: "daily" })}>תקציר יומי</button>
          </div>
        ) : null}
        <p className="mv-form-hint mt-2">
          {prefs.digest === "daily" ? "מייל אחד ב-08:00 עם כל מה שקרה מאתמול." : "מייל אחד לכל מה שהצטבר, עד פעם בעשר דקות — לא מייל לכל תגובה."}
        </p>

        <p className="mb-1.5 mt-4 text-[length:var(--type-caption)] font-semibold">בוואטסאפ</p>
        <p className="mv-form-hint m-0">
          {hasWhatsapp
            ? "העדכונים מגיעים לסוכן האישי שלכם, ואפשר להשיב משם — „להשיב בפורום” על ההודעה. לכיבוי: הפרופיל, „עדכונים בוואטסאפ”, קטגוריית הפורום."
            : "למי שיש את הסוכן האישי בוואטסאפ, העדכונים מגיעים גם לשם ואפשר להשיב מהצ׳אט."}
        </p>
      </aside>
    </div>
  );
}
