import { useRouter } from "expo-router";
import { routeFor } from "@/lib/nav";
import { apiPost } from "@/lib/api";
import { useShell } from "@/lib/shell";
import { PropertyForm, Screen } from "@/components";

/**
 * ‏נכס חדש — `POST /properties`, אותו טופס כמו העריכה ועוד בעל הנכס.
 * ‏אחרי הקליטה נפתח הכרטיס (ומשם: מוכנות, מה חסר, התאמות).
 */
export default function NewPropertyScreen() {
  const router = useRouter();
  const { refreshCounts } = useShell();
  return (
    <Screen title="נכס חדש">
      <PropertyForm
        initial={null}
        submitLabel="קליטת הנכס"
        onSubmit={async (body) => {
          const created = await apiPost<{ id: string }>("/properties", body);
          refreshCounts();
          // ‏`replace` ולא `push`: חזרה מהכרטיס לא צריכה לחזור לטופס שנשלח
          router.replace(routeFor(`/properties/${created.id}`));
        }}
      />
    </Screen>
  );
}
