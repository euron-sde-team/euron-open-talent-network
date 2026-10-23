import { RequireAuth } from "@/components/common/require-auth";
import { RecruiterWorkspace } from "@/components/recruiter/workspace-shell";
import { RecruiterSettingsPage } from "@/components/recruiter/settings-page";

export const metadata = { title: "Recruiter settings" };

export default function Page() {
  return (
    <RequireAuth>
      <RecruiterWorkspace>
        <RecruiterSettingsPage />
      </RecruiterWorkspace>
    </RequireAuth>
  );
}
