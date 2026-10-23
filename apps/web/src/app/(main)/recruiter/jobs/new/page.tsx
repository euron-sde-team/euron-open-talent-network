import { RequireAuth } from "@/components/common/require-auth";
import { RecruiterWorkspace } from "@/components/recruiter/workspace-shell";
import { JobFormPage } from "@/components/recruiter/jobs/job-form";

export const metadata = { title: "Post a job" };

export default function Page() {
  return (
    <RequireAuth>
      <RecruiterWorkspace>
        <JobFormPage />
      </RecruiterWorkspace>
    </RequireAuth>
  );
}
