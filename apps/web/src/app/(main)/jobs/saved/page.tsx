import { RequireAuth } from "@/components/common/require-auth";
import { TwoColumn } from "@/components/shell/layouts";
import { SavedJobsPage } from "@/components/jobs/saved-jobs-page";

export const metadata = { title: "Saved jobs" };

export default function Page() {
  return (
    <TwoColumn max="max-w-[860px]">
      <RequireAuth>
        <SavedJobsPage />
      </RequireAuth>
    </TwoColumn>
  );
}
