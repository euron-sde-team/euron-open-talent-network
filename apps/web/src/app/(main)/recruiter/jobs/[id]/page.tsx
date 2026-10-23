import { Suspense } from "react";
import { FullPageSpinner, RequireAuth } from "@/components/common/require-auth";
import { RecruiterWorkspace } from "@/components/recruiter/workspace-shell";
import { PipelinePage } from "@/components/recruiter/pipeline/pipeline-page";

export const metadata = { title: "Pipeline" };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <RequireAuth>
      <RecruiterWorkspace wide>
        <Suspense fallback={<FullPageSpinner />}>
          <PipelinePage jobId={id} />
        </Suspense>
      </RecruiterWorkspace>
    </RequireAuth>
  );
}
