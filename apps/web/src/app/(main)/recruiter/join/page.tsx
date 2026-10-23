import { RequireAuth } from "@/components/common/require-auth";
import { RecruiterJoinPage } from "@/components/recruiter/join/join-page";

export const metadata = { title: "Become a recruiter" };

export default function Page() {
  return (
    <RequireAuth>
      <RecruiterJoinPage />
    </RequireAuth>
  );
}
