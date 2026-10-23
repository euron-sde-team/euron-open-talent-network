import { RequireAuth } from "@/components/common/require-auth";
import { RecruiterWorkspace } from "@/components/recruiter/workspace-shell";
import { ApproachesPage } from "@/components/recruiter/approaches-page";

export const metadata = { title: "Approaches" };

export default function Page() {
  return (
    <RequireAuth>
      <RecruiterWorkspace>
        <ApproachesPage />
      </RecruiterWorkspace>
    </RequireAuth>
  );
}
