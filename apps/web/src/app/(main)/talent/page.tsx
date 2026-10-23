import { Suspense } from "react";
import { FullPageSpinner } from "@/components/common/require-auth";
import { TalentPage } from "@/components/talent/talent-page";

export const metadata = { title: "Find talent" };

export default function Page() {
  return (
    <Suspense fallback={<FullPageSpinner />}>
      <TalentPage />
    </Suspense>
  );
}
