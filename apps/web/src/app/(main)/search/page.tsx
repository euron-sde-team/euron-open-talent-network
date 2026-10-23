import { Suspense } from "react";
import { FullPageSpinner } from "@/components/common/require-auth";
import { SearchPage } from "@/components/search/search-page";

export const metadata = { title: "Search" };

export default function Page() {
  return (
    <Suspense fallback={<FullPageSpinner />}>
      <SearchPage />
    </Suspense>
  );
}
