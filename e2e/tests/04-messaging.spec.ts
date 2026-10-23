import { expect, test } from "@playwright/test";
import { as, connect, newUser, pageFor, publishProfile, uniq } from "../helpers";

test("strangers send a message request; after accepting, a real-time exchange with typing and Seen", async ({ browser, request }) => {
  const alice = await newUser(request, { displayName: "Alma Reyes" });
  const bob = await newUser(request, { displayName: "Bruno Pike" });
  await publishProfile(request, alice);
  // Alma takes requests from anyone, so Bruno (not connected, not a recruiter) may ask.
  await as(request, alice, "PATCH", "/users/me", { messageRequestPolicy: "ANYONE" });

  const b = await pageFor(browser, bob, `/in/${alice.username}`);
  await test.step("not connected: the profile offers a message request, not a direct message", async () => {
    const elig = await as<{ canMessage: boolean; canRequest: boolean; reason: string }>(request, bob, "GET", `/dms/eligibility/${alice.id}`);
    expect(elig).toMatchObject({ canMessage: false, canRequest: true, reason: "NOT_CONNECTED" });
    await expect(b.getByTestId("profile-actions").getByTestId("message-request-button")).toBeVisible();
  });

  const first = `Hi Alma, loved your write-up ${uniq("m")}`;
  const a = await pageFor(browser, alice, "/messaging");
  await a.getByRole("tab", { name: /Requests/ }).click();
  await expect(a.getByText("No message requests")).toBeVisible();

  await test.step("Bruno sends the request from the dock", async () => {
    await b.getByTestId("profile-actions").getByTestId("message-request-button").click();
    const win = b.getByTestId("dock-window").last();
    await expect(win).toBeVisible();
    await win.getByTestId("message-input").fill(first);
    await win.getByTestId("message-send").click();
    await expect(win.getByTestId("message-bubble").filter({ hasText: first })).toBeVisible();
  });

  let threadId = "";
  await test.step("Alma sees it under Requests live and accepts", async () => {
    const item = a.getByTestId("thread-list").getByTestId("thread-item").filter({ hasText: "Bruno Pike" });
    await expect(item).toBeVisible();
    threadId = (await item.getAttribute("data-thread-id")) ?? "";
    await item.click();
    const convo = a.getByTestId("conversation");
    await expect(convo.getByTestId("message-bubble").filter({ hasText: first })).toBeVisible();
    await convo.getByTestId("request-accept").click();
    await expect(convo.getByTestId("request-banner")).toHaveCount(0);
  });

  await test.step("a real-time exchange with the typing indicator and Seen", async () => {
    await b.goto(`/messaging/${threadId}`);
    const bc = b.getByTestId("conversation");
    const ac = a.getByTestId("conversation");
    await expect(bc).toBeVisible();

    await ac.getByTestId("message-input").pressSequentially("Hey Bruno", { delay: 20 });
    await expect(bc.getByTestId("typing-indicator")).toBeVisible();
    const reply = `Thanks for reaching out ${uniq("r")}`;
    await ac.getByTestId("message-input").fill(reply);
    await ac.getByTestId("message-send").click();
    await expect(bc.getByTestId("message-bubble").filter({ hasText: reply })).toBeVisible();
    await expect(bc.getByTestId("typing-indicator")).toHaveCount(0);
    await expect(ac.getByTestId("dm-seen").last()).toHaveText(/Seen/);
  });

  await a.context().close();
  await b.context().close();
});

test("connections message each other directly, with no request step", async ({ browser, request }) => {
  const a1 = await newUser(request, { displayName: "Cora Lind" });
  const b1 = await newUser(request, { displayName: "Dario Venn" });
  await publishProfile(request, b1);
  await connect(request, a1, b1);
  const elig = await as<{ canMessage: boolean }>(request, a1, "GET", `/dms/eligibility/${b1.id}`);
  expect(elig.canMessage).toBe(true);

  const page = await pageFor(browser, a1, `/in/${b1.username}`);
  await page.getByTestId("profile-actions").getByTestId("message-button").click();
  const win = page.getByTestId("dock-window").last();
  const text = `Coffee next week? ${uniq("c")}`;
  await win.getByTestId("message-input").fill(text);
  await win.getByTestId("message-send").click();
  await expect(win.getByTestId("message-bubble").filter({ hasText: text })).toBeVisible();

  const other = await pageFor(browser, b1, "/messaging");
  const item = other.getByTestId("thread-list").getByTestId("thread-item").filter({ hasText: "Cora Lind" });
  await expect(item).toBeVisible();
  await expect(item).toContainText(text);
  await page.context().close();
  await other.context().close();
});
