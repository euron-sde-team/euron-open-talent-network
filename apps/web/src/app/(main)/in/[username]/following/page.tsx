import { TwoColumn } from "@/components/shell/layouts";
import { PeopleList } from "@/components/profile/people-list";

export const metadata = { title: "Following" };

export default async function Page({ params }: { params: Promise<{ username: string }> }) {
  const { username } = await params;
  return (
    <TwoColumn max="max-w-[760px]">
      <PeopleList username={decodeURIComponent(username)} kind="following" />
    </TwoColumn>
  );
}
