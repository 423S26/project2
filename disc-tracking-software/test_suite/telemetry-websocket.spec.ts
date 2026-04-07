import { test, expect } from '@playwright/test';

test('telemetry page mounts websocket widget', async ({ page }) => {
  await page.goto('http://localhost:3000/telemetry-test');

  await expect(page.getByText('Firmware WebSocket Connection')).toBeVisible();
  await expect(page.getByText('Disconnected')).toBeVisible();
});
