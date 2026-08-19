import { GUIDES, guideMarkdown } from "@/lib/guide-content";
import { markdownResponse } from "../markdown-response";

/**
 * נושא בודד כקובץ Markdown.
 *
 * מי שרוצה תשובה על „איך משתפים קונה ברשת” לא צריך להדביק לצ'אט
 * את כל התיעוד: מסמך ארוך מדלל את השאלה, ובכלים עם חלון הקשר קטן
 * גם דוחק החוצה חלק ממנו. נושא אחד הוא בדיוק ההקשר שנדרש.
 */
export const dynamic = "force-static";

/**
 * הנושאים נבנים מראש.
 *
 * הרשימה סגורה וידועה בזמן בנייה, ולכן אין סיבה שכל בקשה תרוץ
 * בשרת. זה גם מה שהופך את הנתיב לחסין: מזהה שאינו ברשימה מקבל
 * 404 ואינו נוגע בדבר.
 */
export function generateStaticParams(): { topic: string }[] {
  return GUIDES.map((guide) => ({ topic: guide.id }));
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ topic: string }> },
): Promise<Response> {
  const { topic } = await params;
  const guide = GUIDES.find((item) => item.id === topic);
  if (guide === undefined) {
    return new Response("לא קיים נושא בשם הזה. הרשימה המלאה: /docs\n", {
      status: 404,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }
  return markdownResponse(guideMarkdown(guide), `metavchim-${guide.id}.md`);
}
