import { expect, test } from "@playwright/test";
import { apiLogin, DEMO, newUser, pageFor, recruiterCode, uniq } from "../helpers";

test("a recruiter creates a company page, confirms the work email code, and an admin approves them in the control plane", async ({ browser, request }) => {
  const person = await newUser(request, { displayName: "Rae Recruiter" });
  const company = `Quiet Harbor ${uniq("q").slice(-5)}`;
  const domain = `${uniq("qh")}.example.com`;
  const workEmail = `rae@${domain}`;

  const r = await pageFor(browser, person, "/recruiter/join");
  await test.step("register with a new company page and a work email", async () => {
    const form = r.getByTestId("recruiter-register-form");
    await form.getByRole("tab", { name: "Create a company page" }).click();
    await form.getByTestId("rc-company-name").fill(company);
    await form.locator("#rc-web").fill(`https://${domain}`);
    await form.getByTestId("rc-work-email").fill(workEmail);
    await form.locator("#rc-title").fill("Talent Partner");
    await form.getByTestId("rc-register-submit").click();
    await expect(r.getByTestId("recruiter-verify")).toBeVisible();
  });

  await test.step("enter the 6-digit code from the email", async () => {
    // The form submits by itself once six digits are in.
    await r.getByTestId("rc-code-input").fill(await recruiterCode(request, workEmail));
    await expect(r.getByText("Your email is confirmed")).toBeVisible();
  });

  const admin = await apiLogin(request, DEMO.admin);
  const a = await pageFor(browser, admin, "/admin?area=recruiters");
  await test.step("the admin sees the application with the domain evidence and approves it", async () => {
    const row = a.getByTestId("recruiter-queue").getByTestId("recruiter-row").filter({ hasText: workEmail });
    await expect(row).toBeVisible();
    await expect(row.getByTestId("domain-evidence")).toContainText(domain);
    await row.getByTestId("recruiter-approve").click();
    const confirm = a.getByTestId("reason-confirm");
    if (await confirm.isVisible().catch(() => false)) await confirm.click();
    await expect(a.getByTestId("recruiter-queue").getByTestId("recruiter-row").filter({ hasText: workEmail })).toHaveCount(0);
  });

  await test.step("the recruiter opens the workspace", async () => {
    await r.goto("/recruiter");
    await expect(r.getByTestId("recruiter-home")).toBeVisible();
    await expect(r.getByTestId("recruiter-company-card")).toContainText(company);
  });

  await test.step("the decision is in the audit log", async () => {
    await a.goto("/admin?area=audit");
    await expect(a.getByTestId("audit-log").getByTestId("audit-row").filter({ hasText: /recruiter\.review|approve/i }).first()).toBeVisible();
  });

  await r.context().close();
  await a.context().close();
});
