import { RequireAuth } from "@/components/common/require-auth";
import { RecruiterWorkspace } from "@/components/recruiter/workspace-shell";
import { SavedCandidatesPage } from "@/components/recruiter/saved-page";

export const metadata = { title: "Saved candidates" };

export default function Page() {
  return (
    <RequireAuth>
      <RecruiterWorkspace>
        <SavedCandidatesPage />
      </RecruiterWorkspace>
    </RequireAuth>
  );
}
