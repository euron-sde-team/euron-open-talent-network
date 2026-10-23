import { RequireAuth } from "@/components/common/require-auth";
import { RecruiterWorkspace } from "@/components/recruiter/workspace-shell";
import { EngagementsPage } from "@/components/recruiter/engagements/engagements-page";

export const metadata = { title: "Engagements" };

export default function Page() {
  return (
    <RequireAuth>
      <RecruiterWorkspace>
        <EngagementsPage />
      </RecruiterWorkspace>
    </RequireAuth>
  );
}
