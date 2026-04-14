import { test, expect } from '@playwright/test';

test('telemetry page mounts upload telemetry widget', async ({ page }) => {
  await page.goto('http://localhost:3000/telemetry-test');

  await expect(page.getByText('Telemetry Test Page')).toBeVisible();
  await expect(page.getByText('live telemetry widget')).toBeVisible();
});
