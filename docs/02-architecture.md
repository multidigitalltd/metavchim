# 02 · ארכיטקטורה

## 1. תמונה כללית

**Modular Monolith, API-First, Event-Driven** — אפליקציה אחת פרוסה, מחולקת פנימית למודולים עם גבולות נוקשים, שמתקשרים דרך חוזים (Interfaces) ואירועי דומיין. עבודות כבדות (תמלול, התאמות, שליחות) רצות בתורים ברקע.

```mermaid
flowchart TB
    subgraph Clients["צרכנים"]
        PWA["Web App / PWA<br/>(מתווך)"]
        WA["WhatsApp<br/>(מתווך + לקוח)"]
        TEL["טלפוניה<br/>(לקוח)"]
        EXT["מערכות חיצוניות<br/>(Kanko, אתר שיווקי, API)"]
    end

    subgraph Edge["שכבת קצה"]
        GW["API Gateway / LB<br/>TLS · WAF · Rate Limit"]
    end

    subgraph App["האפליקציה (Modular Monolith)"]
        API["REST API + Webhooks נכנסים"]
        subgraph Modules["מודולי דומיין"]
            M1[Identity & Tenancy]
            M2[Leads & Calls]
            M3[Properties]
            M4[Buyers]
            M5[Matching]
            M6[Offers]
            M7[Calendar & Tasks]
            M8[Collaboration & Credits]
        end
        subgraph Platform["מודולי פלטפורמה"]
            P1[Messaging Hub]
            P2[AI Services]
            P3[Voice Agent]
            P4[Billing & Quotas]
            P5[Audit & Analytics]
            P6[Notifications]
        end
        BUS["Event Bus פנימי + Outbox"]
    end

    subgraph Workers["עיבוד רקע"]
        Q["תורים (Redis)"]
        W["Workers: תמלול · חילוץ · התאמות · שליחות · סנכרונים"]
    end

    subgraph Data["נתונים"]
        PG[(PostgreSQL<br/>Multi-Tenant)]
        RD[(Redis<br/>Cache + Queue)]
        S3[(Object Storage<br/>הקלטות · תמונות · מסמכים)]
        SRCH[(חיפוש/וקטורים<br/>pgvector / Meilisearch)]
    end

    subgraph Providers["ספקים חיצוניים (מאחורי Adapters)"]
        PRV1[WhatsApp Cloud API]
        PRV2[טלפוניה / SIP]
        PRV3[STT + LLM]
        PRV4[Google Calendar]
        PRV5[תשלומים]
    end

    Clients --> GW --> API
    API --> Modules
    Modules <--> BUS
    BUS --> Q --> W
    W --> Modules
    Modules --> Data
    W --> Data
    P1 & P2 & P3 & P4 --> Providers
    EXT -->|Webhooks חתומים| GW
```

## 2. למה Modular Monolith (ולא Microservices)

- צוות קטן-בינוני: מונוליט מודולרי = מהירות פיתוח מקסימלית, Deploy אחד, דיבוג פשוט.
- הגבולות הפנימיים (מודול = חבילה עם API פנימי + אירועים) הם **אותם גבולות** שיאפשרו לחלץ שירות נפרד בעתיד (המועמדים הטבעיים: Voice Agent, Matching) — בלי לשכתב.
- הכלל המחייב: **מודול לא ניגש לטבלאות של מודול אחר** — רק דרך ה-API הפנימי או אירועים. נאכף ב-Code Review ובבדיקת ארכיטקטורה אוטומטית (dependency-cruiser / Nx boundaries).

ראו [ADR-001](adr/ADR-001-modular-monolith.md).

## 3. סטאק טכנולוגי מומלץ

| שכבה | בחירה | נימוק |
|------|-------|-------|
| Backend | **NestJS (Node 22, TypeScript)** | מערכת מודולים מובנית שממפה 1:1 על ה-Modular Monolith; DI, Guards, Pipes; מצטיין ב-WebSockets וסטרימינג (סוכן קולי, LLM) |
| Frontend | **Next.js (React) כ-PWA** | מאגר הגיוס הגדול בישראל; SSR לדפי הצעה; RTL מלא; PWA להתקנה במובייל |
| UI | **Radix UI + Tailwind** | רכיבים Headless נגישים מיסודם (ת"י 5568 / WCAG 2.2 AA) |
| טיפוסים משותפים | **Monorepo (pnpm + Turborepo) + Zod** | סכמה אחת לשרת, ל-Workers ולממשק — הקומפיילר תופס אי-התאמות חוזה |
| ORM | **Prisma** | טיפוסים מה-DB עד הממשק; מיגרציות מנוהלות |
| DB | **PostgreSQL 16** | RLS לבידוד דיירים, JSONB לשדות גמישים, pgvector להתאמות סמנטיות |
| Cache/Queue | **Redis + BullMQ** | Cache, תורים עם Retry/Backoff, Rate Limiting, Locks |
| Storage | **S3-compatible** | הקלטות, תמונות, מסמכים — עם URL חתומים בלבד |
| חיפוש | **pgvector בהתחלה; Meilisearch אם יידרש** | לא להוסיף רכיב תשתית לפני שיש צורך מוכח |
| Realtime | **WebSockets (NestJS Gateway / Socket.IO)** | התראות חיות בדשבורד ("קונה פתח הצעה") |

> ההחלטה והחלופות שנשקלו (Laravel, Python, Go, Elixir) — ראו [ADR-002](adr/ADR-002-tech-stack.md).

## 4. מפת מודולים וגבולות

### מודולי דומיין

| מודול | אחריות | חושף | מאזין ל- |
|-------|--------|------|----------|
| **Identity & Tenancy** | סוכנויות (Tenants), משתמשים, תפקידים, הרשאות, הזמנות, 2FA | `TenantContext`, `can()` | — |
| **Leads & Calls** | ליד מכל ערוץ, ציר זמן תקשורת, תמלולים, סטטוסים | `LeadCreated`, `CallSummarized` | הודעות נכנסות, שיחות |
| **Properties** | כרטיס נכס, מדיה, ציון מוכנות, סטטוסים | `PropertyCreated/Updated/Ready` | `VoiceIntakeParsed` |
| **Buyers** | פרופיל קונה, דרישות, בשלות, היסטוריה | `BuyerCreated/Updated` | `LeadQualified` |
| **Matching** | חישוב התאמות דו-כיווני, ניקוד, הסברים | `MatchesComputed` | `PropertyReady`, `BuyerUpdated` |
| **Offers** | הצעות, דפי הצעה, מעקב פתיחות/עניין | `OfferSent/Opened/Interested` | `MatchesComputed` |
| **Calendar & Tasks** | פגישות, סיורים, משימות, תזכורות, סנכרון Google | `AppointmentScheduled` | `OfferInterested`, `CallbackRequested` |
| **Collaboration** | ביקושים אנונימיים, הצעות בין סוכנויות, חיבורים, לידים מ-Kanko | `CoopOfferSent`, `ConnectionApproved` | `BuyerShared` |

### מודולי פלטפורמה

| מודול | אחריות |
|-------|--------|
| **Messaging Hub** | ערוץ יוצא/נכנס אחוד: WhatsApp (ראשי), SMS, Email. תבניות, חלון 24h, Opt-out, ניתוב הודעות נכנסות למודול הנכון |
| **AI Services** | שער יחיד ל-LLM/STT: תמלול, חילוץ שדות מובנים, ניסוח תיאורים, סיכומי שיחה, המלצות. כולל Prompt Registry, מדידת עלות, Fallback בין ספקים |
| **Voice Agent** | ניהול שיחה קולית בזמן אמת: מכונת מצבים לשיחה, גישה לנתוני נכסים דרך API פנימי, כללי אסקלציה לאדם |
| **Billing & Quotas** | מנויים, מסלולים, קרדיטים, מכסות (דקות/הודעות), Feature Flags לפי מסלול |
| **Audit & Analytics** | לוג ביקורת בלתי-ניתן-לשינוי, אירועי שימוש, דוחות |
| **Notifications** | התראות למתווך: In-App (WebSocket), WhatsApp, Push, Email — לפי העדפות |

## 5. תקשורת בין מודולים

1. **סינכרוני** — קריאה ל-Interface ציבורי של מודול אחר (`PropertiesApi::getForMatching()`). אסור לקרוא Models/Tables של מודול זר.
2. **אסינכרוני** — אירועי דומיין דרך Event Bus. כל אירוע נכתב קודם לטבלת **Outbox** באותה טרנזקציה עם השינוי, ו-Worker מפיץ אותו — כך אין אירועים אבודים ואין חצאי-מצב.
3. **כלל זהב**: אם מודול צריך נתון של מודול אחר בתדירות גבוהה — הוא מחזיק **Read Model** מקומי שמתעדכן מאירועים, לא שולף בזמן אמת.

### דוגמה: זרימת "נכס חדש בקול"

```mermaid
sequenceDiagram
    participant B as מתווך (WhatsApp/App)
    participant MH as Messaging Hub
    participant AI as AI Services
    participant PR as Properties
    participant MT as Matching
    participant OF as Offers

    B->>MH: הודעה קולית "דירת 3 חד' בבני ברק..."
    MH->>AI: Job: תמלול (תור)
    AI->>AI: STT → טקסט
    AI->>AI: LLM → חילוץ שדות + תיאור + חוסרים
    AI-->>PR: VoiceIntakeParsed {fields, gaps}
    PR->>PR: יצירת נכס + ציון מוכנות
    PR-->>B: "הנכס נקלט ✓ חסרים 4 פרטים: ..."
    PR--)MT: PropertyReady (אירוע)
    MT->>MT: חישוב התאמות מול קונים
    MT--)OF: MatchesComputed {17 קונים}
    OF-->>B: "נמצאו 17 קונים מתאימים — לשלוח הצעה?"
```

## 6. עקרונות הרחבה (Extensibility)

- **Connector SDK פנימי**: כל אינטגרציה (Kanko, פורטל עתידי, מקור לידים) מממשת ממשק אחיד — `receiveLead()`, `verifySignature()`, `mapToDomain()`. הוספת מקור לידים חדש = קובץ Connector אחד + רישום, אפס נגיעה בליבה.
- **Provider Adapters**: WhatsApp/טלפוניה/STT/LLM מאחורי ממשק. החלפת ספק = מימוש Adapter חדש + שינוי קונפיג.
- **Feature Flags**: לכל פיצ'ר חדש דגל, נשלט ברמת מסלול/דייר. מאפשר הדלקה הדרגתית, בטא לדיירים נבחרים, וכיבוי מיידי בתקלה.
- **Webhooks יוצאים + API ציבורי (שלב Enterprise)**: אירועי דומיין נבחרים ניתנים למנוי חיצוני — זה מה שיאפשר לאתר השיווקי ולשותפים להתחבר בלי פיתוח ייעודי.
- **גרסאות API**: `/api/v1/...` מהיום הראשון; שינוי שובר = גרסה חדשה, לא שינוי שקט.

## 7. מבנה ריפו מוצע

```
apps/
  api/               # NestJS — מודול Nest לכל מודול דומיין/פלטפורמה
    src/modules/
      identity/      # כל מודול: domain/ application/ infrastructure/ http/
      leads/  properties/  buyers/  matching/  offers/  calendar/  collaboration/
    src/platform/
      messaging/  ai/  voice/  billing/  audit/  notifications/
  web/               # Next.js (React) PWA
  workers/           # BullMQ processors (אותם מודולים, Entry נפרד)
packages/
  shared/            # סכמות Zod, טיפוסים, חוזי אירועים, TenantContext
  ui/                # Design System (Radix + Tailwind) + Storybook
docs/                # המסמכים האלה
```
