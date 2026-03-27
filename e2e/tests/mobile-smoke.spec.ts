import { expect, test } from "@playwright/test";

test.describe("Smoke mobile 375px — Dashboard", () => {
  test.use({ viewport: { width: 375, height: 812 } });

  test("não deve ter overflow horizontal e deve renderizar blocos principais", async ({ page }) => {
    await page.goto("/");

    const title = page.getByRole("heading", { name: /quality dashboard/i });
    const ghToken = page.getByText(/github personal access token/i);
    const linearToken = page.getByText(/linear api key/i);
    const loadButton = page.getByRole("button", { name: /conectar/i });

    await expect(title).toBeVisible();
    await expect(ghToken).toBeVisible();
    await expect(linearToken).toBeVisible();
    await expect(loadButton).toBeVisible();

    const viewport = page.viewportSize();
    if (!viewport) {
      throw new Error("Viewport não disponível durante o teste mobile.");
    }

    const widths = await page.evaluate(() => {
      const root = document.documentElement;
      const body = document.body;
      return {
        rootScrollWidth: root.scrollWidth,
        rootClientWidth: root.clientWidth,
        bodyScrollWidth: body.scrollWidth,
        bodyClientWidth: body.clientWidth,
      };
    });

    expect(widths.rootScrollWidth).toBeLessThanOrEqual(viewport.width + 1);
    expect(widths.bodyScrollWidth).toBeLessThanOrEqual(viewport.width + 1);
  });
});
