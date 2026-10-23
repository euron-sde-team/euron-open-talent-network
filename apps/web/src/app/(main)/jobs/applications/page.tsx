import { Suspense } from "react";
import { RequireAuth } from "@/components/common/require-auth";
import { TwoColumn } from "@/components/shell/layouts";
import { ApplicationsPage } from "@/components/jobs/applications-page";

export const metadata = { title: "My applications" };

export default function Page() {
  return (
    <TwoColumn max="max-w-[860px]">
      <RequireAuth>
        <Suspense>
          <ApplicationsPage />
        </Suspense>
      </RequireAuth>
    </TwoColumn>
  );
}
