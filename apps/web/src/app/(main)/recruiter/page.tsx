import { RequireAuth } from "@/components/common/require-auth";
import { RecruiterWorkspace } from "@/components/recruiter/workspace-shell";
import { RecruiterHome } from "@/components/recruiter/home-page";

export const metadata = { title: "Recruiter" };

export default function Page() {
  return (
    <RequireAuth>
      <RecruiterWorkspace>
        <RecruiterHome />
      </RecruiterWorkspace>
    </RequireAuth>
  );
}
