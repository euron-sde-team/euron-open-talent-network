import { Suspense } from "react";
import type { Metadata } from "next";
import { FullWidth } from "@/components/shell/layouts";
import { RequireAuth } from "@/components/common/require-auth";
import { AdminPage } from "@/components/admin/admin-page";

export const metadata: Metadata = { title: "Control plane" };

// Signed-in only; which areas open is decided by GET /api/admin/me (RECRUITER_OPS included).
export default function Page() {
  return (
    <FullWidth>
      <div className="mx-auto max-w-[1200px] px-4 py-4 lg:py-6">
        <RequireAuth>
          <Suspense>
            <AdminPage />
          </Suspense>
        </RequireAuth>
      </div>
    </FullWidth>
  );
}
