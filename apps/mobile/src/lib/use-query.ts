import { useCallback, useEffect, useRef, useState } from "react";
import { errorMessage } from "./api";
import { readCache, writeCache } from "./cache";

/**
 * ‏טעינה של מסך: נתונים / שגיאה / רענון — ומטמון.
 *
 * ‏שלושה מצבים מפורשים ולא `data ?? []`: כישלון טעינה שמצויר כרשימה
 * ‏ריקה אומר למתווך „אין לך לידים” כשבאמת אין רשת. ההבחנה הזו היא
 * ‏כלל מחייב ב-web (`verify:lists`), והיא נשמרת כאן באותה צורה.
 *
 * ‏עם `cacheKey` המסך נפתח קודם על התשובה הקודמת (`stale: true`),
 * ‏ואז מתרענן מהרשת. כשהרשת נופלת, הנתונים הישנים נשארים על המסך
 * ‏עם `error` לצידם — והמסך מציג „מוצג מהמטמון”, לא מסך שגיאה ריק.
 */
export interface QueryState<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
  refreshing: boolean;
  /** ‏הנתונים על המסך הם מהמטמון, לא מהרשת */
  stale: boolean;
  /** ‏מתי נשמרו, כשהם מהמטמון */
  cachedAt: number | null;
  reload(): void;
  refresh(): Promise<void>;
}

export function useQuery<T>(
  load: () => Promise<T>,
  deps: readonly unknown[],
  options: { cacheKey?: string } = {},
): QueryState<T> {
  const { cacheKey } = options;
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [stale, setStale] = useState(false);
  const [cachedAt, setCachedAt] = useState<number | null>(null);
  const [tick, setTick] = useState(0);
  const generation = useRef(0);

  const run = useCallback(
    async (mode: "load" | "refresh") => {
      const mine = ++generation.current;
      if (mode === "load") setLoading(true);
      else setRefreshing(true);
      if (mode === "load" && cacheKey !== undefined) {
        const cached = await readCache<T>(cacheKey);
        if (mine !== generation.current) return;
        if (cached !== null) {
          setData(cached.value);
          setStale(true);
          setCachedAt(cached.at);
          setLoading(false);
        }
      }
      try {
        const result = await load();
        if (mine !== generation.current) return;
        setData(result);
        setError(null);
        setStale(false);
        setCachedAt(null);
        if (cacheKey !== undefined) void writeCache(cacheKey, result);
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
    [...deps, cacheKey],
  );

  useEffect(() => {
    void run("load");
  }, [run, tick]);

  const reload = useCallback(() => setTick((n) => n + 1), []);
  const refresh = useCallback(() => run("refresh"), [run]);

  return { data, error, loading, refreshing, stale, cachedAt, reload, refresh };
}
