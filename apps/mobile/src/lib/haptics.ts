import * as Haptics from "expo-haptics";

/**
 * ‏משוב מישושי — קצר, ורק במקומות שבהם משהו *קרה*: משימה שסומנה,
 * ‏פגישה שעודכנה, הקלטה שהתחילה. לא בכל לחיצה — כפתור שרוטט בכל
 * ‏נגיעה מפסיק להיות משוב. כישלון (סימולטור, מכשיר בלי מנוע) שקט.
 */
export function tapFeedback(): void {
  void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined);
}

export function successFeedback(): void {
  void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
}

export function errorFeedback(): void {
  void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => undefined);
}
