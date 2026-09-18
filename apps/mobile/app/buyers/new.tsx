import { useRouter } from "expo-router";
import { apiPost } from "@/lib/api";
import { useShell } from "@/lib/shell";
import { BuyerForm, Screen } from "@/components";

/**
 * ‏לקוח חדש — `POST /buyers`, אותו טופס כמו העריכה ועוד פרטי הקשר
 * ‏והמקור. אחרי הקליטה נפתח הכרטיס (ומשם: ההתאמות שנמצאו לו).
 */
export default function NewBuyerScreen() {
  const router = useRouter();
  const { refreshCounts } = useShell();
  return (
    <Screen title="לקוח חדש">
      <BuyerForm
        initial={null}
        submitLabel="קליטת הלקוח"
        onSubmit={async (body) => {
          const created = await apiPost<{ id: string }>("/buyers", body);
          refreshCounts();
          router.replace(`/buyers/${created.id}`);
        }}
      />
    </Screen>
  );
}
