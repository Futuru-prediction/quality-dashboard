import { test, expect } from "@playwright/test";

test.describe("Smoke — Dashboard", () => {
  test("página carrega com título correto", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveTitle(/Futuru|Dashboard/i);
  });

  test("elemento principal está visível", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("body")).toBeVisible();
    // Verifica que não retornou erro 404 ou tela em branco
    const bodyText = await page.locator("body").innerText();
    expect(bodyText.length).toBeGreaterThan(10);
  });
});
