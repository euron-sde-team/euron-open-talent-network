import { TwoColumn } from "@/components/shell/layouts";
import { RequireAuth } from "@/components/common/require-auth";
import { ProfileSetup } from "@/components/profile/setup/profile-setup";

export const metadata = { title: "Build your profile" };

export default function Page() {
  return (
    <TwoColumn max="max-w-[860px]">
      <RequireAuth>
        <ProfileSetup />
      </RequireAuth>
    </TwoColumn>
  );
}
