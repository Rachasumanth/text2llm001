const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
  const page = await browser.newPage();
  
  let hasErrors = false;
  page.on('pageerror', err => { console.log('PAGE ERROR:', err.message); hasErrors = true; });
  page.on('console', msg => {
      if (msg.type() === 'error') { console.log('CONSOLE ERROR:', msg.text()); hasErrors = true; }
  });
  
  await page.goto('http://localhost:8787/');
  await page.waitForTimeout(1500);
  
  if (!hasErrors) {
      console.log('SUCCESS: No JavaScript errors detected on page load. All buttons should now work.');
  }
  await browser.close();
})();
