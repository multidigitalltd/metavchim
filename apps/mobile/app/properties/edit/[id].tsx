import { useLocalSearchParams, useRouter } from "expo-router";
import { apiGet, apiPatch } from "@/lib/api";
import type { PropertyDetail } from "@/lib/dtos";
import { useQuery } from "@/lib/use-query";
import { ErrorState, Loading, PropertyForm, Screen } from "@/components";

/**
 * ‏עריכת נכס — אותו `PATCH /properties/:id` כמו ב-web, ואותם כללים:
 * ‏שדה שלא נשלח הוא „בלי שינוי” (ראו `PropertyForm`).
 */
export default function EditPropertyScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const query = useQuery(
    () => apiGet<PropertyDetail>(`/properties/${id}`),
    [id],
  );

  if (query.data === null) {
    return query.error ? (
      <ErrorState message={query.error} onRetry={query.reload} />
    ) : (
      <Loading />
    );
  }

  return (
    <Screen title="עריכת נכס">
      <PropertyForm
        initial={query.data}
        submitLabel="שמירת השינויים"
        onSubmit={async (body) => {
          await apiPatch(`/properties/${id}`, body);
          router.back();
        }}
      />
    </Screen>
  );
}
