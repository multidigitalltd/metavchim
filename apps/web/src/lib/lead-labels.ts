export const LEAD_STATUS_LABELS: Record<string, string> = {
  new: "חדש",
  in_progress: "בטיפול",
  waiting_customer: "ממתין ללקוח",
  converted: "הומר",
  closed: "סגור",
};

export const LEAD_SOURCE_LABELS: Record<string, string> = {
  voice_call: "שיחה",
  whatsapp: "וואטסאפ",
  web_form: "אתר",
  landing: "דף נחיתה",
  kanko: "Kanko",
  referral: "המלצה",
  manual: "ידני",
};

export const LEAD_INTENT_LABELS: Record<string, string> = {
  buy: "קונה",
  sell: "מוכר",
  rent_in: "שוכר",
  rent_out: "משכיר",
  info: "מתעניין",
  unknown: "לא ידוע",
};
