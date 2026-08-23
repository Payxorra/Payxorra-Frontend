import { test, expect } from '@playwright/test';

test.describe('Audit Report PDF Generation & Print Styling', () => {
  test.beforeEach(async ({ page }) => {
    // Navigate to the reports page
    await page.goto('/reports');
    await page.waitForLoadState('networkidle');
    
    // Mock window.print to prevent browser print dialog from blocking test execution
    await page.evaluate(() => {
      (window as unknown).print = () => {
        (window as unknown).__printCalled = true;
      };
    });
  });

  test('should render report page with inputs and generate preview', async ({ page }) => {
    // Check main elements are visible
    await expect(page.getByText('Facility Audit Reports')).toBeVisible();
    await expect(page.locator('input[type="date"]').first()).toBeVisible();
    await expect(page.locator('input[type="date"]').last()).toBeVisible();

    // Generate the report
    await page.click('button[type="submit"]');
    
    // Wait for the preview panel to render
    await page.waitForSelector('.bg-white.rounded-xl.border', { state: 'visible' });
    
    // Confirm summary metrics are displayed
    await expect(page.getByText('Facility Performance Summary')).toBeVisible();
    await expect(page.getByText('Health Score')).toBeVisible();
    await expect(page.getByText('98%', { exact: true })).toBeVisible();
  });

  test('should emulate media print and toggle visibility correctly', async ({ page }) => {
    // Generate the report first
    await page.click('button[type="submit"]');
    await page.waitForSelector('.bg-white.rounded-xl.border', { state: 'visible' });

    // Mock window.print to verify container attachment and class structure during print trigger
    await page.evaluate(() => {
      (window as unknown).print = () => {
        const container = document.getElementById('report-print-container');
        (window as unknown).__printContainerExists = container !== null;
        (window as unknown).__printHeaderConfigured = container?.querySelector('.print-header') !== null;
      };
    });

    // Click Print / Save as PDF to trigger hook (populates activeVolumeToPrint)
    await page.click('button:has-text("Print / Save as PDF")');

    // Wait for mock print to be asynchronously executed
    await page.waitForFunction(() => (window as unknown).__printContainerExists !== undefined, { timeout: 5000 });

    // Retrieve assertion results
    const containerExists = await page.evaluate(() => (window as unknown).__printContainerExists);
    const headerConfigured = await page.evaluate(() => (window as unknown).__printHeaderConfigured);

    expect(containerExists).toBe(true);
    expect(headerConfigured).toBe(true);
  });

  test('should split report into multiple volumes for large datasets', async ({ page }) => {
    // Check the simulate large dataset checkbox
    await page.click('#simulateLarge');
    
    // Generate report
    await page.click('button[type="submit"]');
    
    // Wait for report compile message
    await page.waitForSelector('text=Report Compiled successfully', { state: 'visible' });

    // Assert multiple volumes are generated
    const volumeButtons = page.locator('button:has-text("Volume")');
    const count = await volumeButtons.count();
    expect(count).toBeGreaterThan(1); // Should have Volume 1, Volume 2, etc.

    // Switch to Volume 2
    await page.click('button:has-text("Volume 2")');
    await expect(page.locator('h2:has-text("Volume 2")')).toBeVisible();
  });

  test('should rasterize canvas charts to images when print lifecycle runs', async ({ page }) => {
    // Generate report
    await page.click('button[type="submit"]');
    await page.waitForSelector('.bg-white.rounded-xl.border', { state: 'visible' });

    // Override the mock to capture the HTML structure at print execution time
    await page.evaluate(() => {
      (window as unknown).print = () => {
        (window as unknown).__printHtml = document.getElementById('report-print-container')?.innerHTML;
      };
    });

    // Click Print button to trigger rasterization utility
    await page.click('button:has-text("Print / Save as PDF")');

    // Wait for the mock print function to be asynchronously executed and populate __printHtml
    await page.waitForFunction(() => (window as unknown).__printHtml !== undefined, { timeout: 5000 });

    // Retrieve the captured print-mode HTML
    const printHtml = await page.evaluate(() => (window as unknown).__printHtml);
    
    // Assert the canvas element is replaced with an img tag containing base64 data
    expect(printHtml).toContain('<img');
    expect(printHtml).toContain('alt="Static Chart"');
    expect(printHtml).toContain('src="data:image/png;base64');
  });
});
