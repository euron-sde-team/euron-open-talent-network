import { RequireAuth } from "@/components/common/require-auth";
import { NetworkPage } from "@/components/network/network-page";

export const metadata = { title: "My network" };

export default function Page() {
  return (
    <RequireAuth>
      <NetworkPage />
    </RequireAuth>
  );
}
