import { RequireAuth } from "@/components/common/require-auth";
import { RecruiterWorkspace } from "@/components/recruiter/workspace-shell";
import { RecruiterJobsPage } from "@/components/recruiter/jobs/jobs-page";

export const metadata = { title: "Recruiter jobs" };

export default function Page() {
  return (
    <RequireAuth>
      <RecruiterWorkspace>
        <RecruiterJobsPage />
      </RecruiterWorkspace>
    </RequireAuth>
  );
}
