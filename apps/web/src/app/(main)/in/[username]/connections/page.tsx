import { TwoColumn } from "@/components/shell/layouts";
import { ConnectionsList } from "@/components/profile/people-list";

export const metadata = { title: "Connections" };

export default async function Page({ params }: { params: Promise<{ username: string }> }) {
  const { username } = await params;
  return (
    <TwoColumn max="max-w-[760px]">
      <ConnectionsList username={decodeURIComponent(username)} />
    </TwoColumn>
  );
}
