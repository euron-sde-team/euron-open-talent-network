import { RequireAuth } from "@/components/common/require-auth";
import { RecruiterWorkspace } from "@/components/recruiter/workspace-shell";
import { TalentSearchPage } from "@/components/recruiter/talent/talent-page";

export const metadata = { title: "Talent search" };

export default function Page() {
  return (
    <RequireAuth>
      <RecruiterWorkspace>
        <TalentSearchPage />
      </RecruiterWorkspace>
    </RequireAuth>
  );
}
