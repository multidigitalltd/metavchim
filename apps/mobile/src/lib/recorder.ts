import {
  RecordingPresets,
  getRecordingPermissionsAsync,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioRecorder,
  type AudioRecorder,
} from "expo-audio";
import { apiUpload } from "./api";

/**
 * ‏הקלטה ותמלול — הצד של המכשיר.
 *
 * ‏מונו ואיכות נמוכה בכוונה: תמלול דיבור אינו צריך סטריאו ב-128kbps,
 * ‏והקובץ קטן פי כמה — וזה מה שקובע כמה זמן המתווך מחכה ברשת
 * ‏סלולרית. הסיומת `.m4a` היא מה ששירות התמלול פותח לפי השם.
 */
export const RECORDING_OPTIONS = { ...RecordingPresets.LOW_QUALITY, extension: ".m4a" };

export function useVoiceRecorder(): AudioRecorder {
  return useAudioRecorder(RECORDING_OPTIONS);
}

/** ‏הרשאת מיקרופון — נשאלת רק מתוך לחיצה על כפתור ההקלטה. */
export async function ensureMicrophone(): Promise<boolean> {
  const current = await getRecordingPermissionsAsync();
  if (current.granted) return true;
  const asked = await requestRecordingPermissionsAsync();
  return asked.granted;
}

export async function startRecording(recorder: AudioRecorder): Promise<void> {
  // מצב שמע להקלטה — גם כשהמכשיר במצב שקט (iOS)
  await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
  await recorder.prepareToRecordAsync();
  recorder.record();
}

export async function stopRecording(recorder: AudioRecorder): Promise<string | null> {
  await recorder.stop();
  await setAudioModeAsync({ allowsRecording: false });
  return recorder.uri;
}

/**
 * ‏תמלול בשרת. הקובץ נשלח כ-multipart תחת `file`, כמו ההכתבה ב-web;
 * ‏רמז אוצר המילים מצורף בשרת (`transcription.service`), לא כאן.
 */
export async function transcribeRecording(uri: string): Promise<string> {
  const form = new FormData();
  /*
   * ‏ב-React Native קובץ ב-FormData הוא אובייקט `{ uri, name, type }`,
   * ‏לא Blob — הטיפוס של `FormData.append` בספרייה אינו יודע זאת.
   */
  form.append("file", { uri, name: "recording.m4a", type: "audio/m4a" } as unknown as Blob);
  const { text } = await apiUpload<{ text: string }>("/voice-intakes/transcribe", form);
  return text;
}
