import { Suspense } from "react";
import { TwoColumn } from "@/components/shell/layouts";
import { CompaniesPage } from "@/components/companies/companies-page";

export const metadata = { title: "Companies" };

export default function Page() {
  return (
    <TwoColumn>
      <Suspense>
        <CompaniesPage />
      </Suspense>
    </TwoColumn>
  );
}
