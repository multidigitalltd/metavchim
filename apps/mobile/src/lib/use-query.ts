import { useCallback, useEffect, useRef, useState } from "react";
import { errorMessage } from "./api";

/**
 * ‏טעינה של מסך: נתונים / שגיאה / רענון.
 *
 * ‏שלושה מצבים מפורשים ולא `data ?? []`: כישלון טעינה שמצויר כרשימה
 * ‏ריקה אומר למתווך „אין לך לידים” כשבאמת אין רשת. ההבחנה הזו היא
 * ‏כלל מחייב ב-web (`verify:lists`), והיא נשמרת כאן באותה צורה.
 */
export interface QueryState<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
  refreshing: boolean;
  reload(): void;
  refresh(): Promise<void>;
}

export function useQuery<T>(load: () => Promise<T>, deps: readonly unknown[]): QueryState<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [tick, setTick] = useState(0);
  const generation = useRef(0);

  const run = useCallback(
    async (mode: "load" | "refresh") => {
      const mine = ++generation.current;
      if (mode === "load") setLoading(true);
      else setRefreshing(true);
      try {
        const result = await load();
        if (mine !== generation.current) return;
        setData(result);
        setError(null);
      } catch (err: unknown) {
        if (mine !== generation.current) return;
        setError(errorMessage(err, "לא הצלחנו לטעון — נסו שוב"));
      } finally {
        if (mine === generation.current) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- התלויות מוצהרות על ידי הקורא, כמו ב-useEffect
    deps,
  );

  useEffect(() => {
    void run("load");
  }, [run, tick]);

  const reload = useCallback(() => setTick((n) => n + 1), []);
  const refresh = useCallback(() => run("refresh"), [run]);

  return { data, error, loading, refreshing, reload, refresh };
}
