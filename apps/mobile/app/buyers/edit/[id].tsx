import { useLocalSearchParams, useRouter } from "expo-router";
import { apiGet, apiPatch } from "@/lib/api";
import type { BuyerDetail } from "@/lib/dtos";
import { useQuery } from "@/lib/use-query";
import { BuyerForm, ErrorState, Loading, Screen } from "@/components";

/**
 * ‏עריכת קונה — אותו `PATCH /buyers/:id` כמו ב-web: הדרישות נשלחות
 * ‏במלואן על בסיס מה שיש בכרטיס (ראו `BuyerForm`).
 */
export default function EditBuyerScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const query = useQuery(() => apiGet<BuyerDetail>(`/buyers/${id}`), [id]);

  if (query.data === null) {
    return query.error ? (
      <ErrorState message={query.error} onRetry={query.reload} />
    ) : (
      <Loading />
    );
  }

  return (
    <Screen title={`עריכה — ${query.data.contact.name}`}>
      <BuyerForm
        initial={query.data}
        submitLabel="שמירת השינויים"
        onSubmit={async (body) => {
          await apiPatch(`/buyers/${id}`, body);
          router.back();
        }}
      />
    </Screen>
  );
}
