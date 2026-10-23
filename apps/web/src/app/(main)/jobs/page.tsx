import { Suspense } from "react";
import { FullPageSpinner } from "@/components/common/require-auth";
import { JobsPage } from "@/components/jobs/jobs-page";

export const metadata = { title: "Jobs" };

export default function Page() {
  return (
    <Suspense fallback={<FullPageSpinner />}>
      <JobsPage />
    </Suspense>
  );
}
