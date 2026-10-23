import { RequireAuth } from "@/components/common/require-auth";
import { RecruiterWorkspace } from "@/components/recruiter/workspace-shell";
import { JobFormPage } from "@/components/recruiter/jobs/job-form";

export const metadata = { title: "Edit job" };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <RequireAuth>
      <RecruiterWorkspace>
        <JobFormPage jobId={id} />
      </RecruiterWorkspace>
    </RequireAuth>
  );
}
