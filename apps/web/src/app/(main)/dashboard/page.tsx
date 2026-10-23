import { Suspense } from "react";
import { FullPageSpinner, RequireAuth } from "@/components/common/require-auth";
import { TwoColumn } from "@/components/shell/layouts";
import { DashboardPage } from "@/components/dashboard/dashboard-page";

export const metadata = { title: "Dashboard" };

export default function Page() {
  return (
    <TwoColumn max="max-w-[1080px]">
      <RequireAuth>
        <Suspense fallback={<FullPageSpinner />}>
          <DashboardPage />
        </Suspense>
      </RequireAuth>
    </TwoColumn>
  );
}
