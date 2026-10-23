import { RequireAuth } from "@/components/common/require-auth";
import { ConnectionsPage } from "@/components/network/connections-page";

export const metadata = { title: "Connections" };

export default function Page() {
  return (
    <RequireAuth>
      <ConnectionsPage />
    </RequireAuth>
  );
}
