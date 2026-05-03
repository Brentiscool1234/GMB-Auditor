import puppeteer, { Browser, Page } from 'puppeteer';

export interface GMBRawData {
  url: string;
  pageTitle: string;
  overviewText: string;
  reviewsText: string;
  aboutText: string;
  scrapedAt: string;
}

async function dismissConsent(page: Page): Promise<void> {
  for (const sel of ['#L2AGLb', 'button[aria-label*="Accept all"]', 'button[aria-label*="Agree"]']) {
    try {
      const el = await page.$(sel);
      if (el) {
        await el.click();
        await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 5000 }).catch(() => {});
        return;
      }
    } catch {}
  }
}

async function getPanelText(page: Page): Promise<string> {
  return page.evaluate(() => {
    // Try progressively broader selectors until we get meaningful text
    const candidates = [
      '[role="main"]',
      '.m6QErb',
      '.bJzME',
      '.tAiQdd',
      '.PPCwl',
    ];
    for (const sel of candidates) {
      const el = document.querySelector(sel) as HTMLElement | null;
      if (el?.innerText && el.innerText.trim().length > 300) {
        return el.innerText.trim().substring(0, 6000);
      }
    }
    return (document.body as HTMLElement).innerText.trim().substring(0, 6000);
  });
}

async function clickTabAndGetText(page: Page, patterns: string[]): Promise<string> {
  try {
    // Find a tab/button matching one of the patterns
    const tabs = await page.$$('[role="tab"], button');
    for (const tab of tabs) {
      const label: string = await page.evaluate(
        el => ((el as HTMLElement).getAttribute('aria-label') || (el as HTMLElement).textContent || '').toLowerCase(),
        tab
      );
      if (patterns.some(p => label.includes(p.toLowerCase()))) {
        await tab.click();
        await new Promise(r => setTimeout(r, 2000));
        return getPanelText(page);
      }
    }
  } catch {}
  return '';
}

export async function scrapeGMB(url: string): Promise<GMBRawData> {
  let browser: Browser | null = null;
  try {
    browser = await puppeteer.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-blink-features=AutomationControlled',
        '--window-size=1440,900',
      ],
    });

    const page = await browser.newPage();
    await page.setViewport({ width: 1440, height: 900 });
    await page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
    );
    await page.setExtraHTTPHeaders({ 'Accept-Language': 'en-US,en;q=0.9' });
    await page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    });

    await page.goto(url, { waitUntil: 'networkidle2', timeout: 45000 });
    await dismissConsent(page);
    await page.waitForSelector('h1', { timeout: 20000 });
    await new Promise(r => setTimeout(r, 2500));

    const pageTitle = await page.title();
    const overviewText = await getPanelText(page);
    const reviewsText = await clickTabAndGetText(page, ['reviews']);
    const aboutText = await clickTabAndGetText(page, ['about']);

    return {
      url,
      pageTitle,
      overviewText,
      reviewsText,
      aboutText,
      scrapedAt: new Date().toISOString(),
    };
  } finally {
    await browser?.close();
  }
}
