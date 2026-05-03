import puppeteer, { Browser, Page } from 'puppeteer';

export interface GMBRawData {
  url: string;
  pageTitle: string;
  overviewText: string;
  reviewsText: string;
  aboutText: string;
  scrapedAt: string;
}

// Force English locale and US region to avoid consent redirects
function normalizeUrl(url: string): string {
  try {
    const u = new URL(url);
    u.searchParams.set('hl', 'en');
    u.searchParams.set('gl', 'US');
    return u.toString();
  } catch {
    return url;
  }
}

// Pre-set Google consent cookies so the page never shows the interstitial
async function setConsentCookies(page: Page): Promise<void> {
  await page.setCookie(
    { name: 'CONSENT',    value: 'YES+cb.20240101-00-p0.en+FX+111', domain: '.google.com', path: '/' },
    { name: 'SOCS',       value: 'CAISHAgCEhJnd3NfMjAyNDAxMDEtMF9SQzEaAmVuIAEaBgiA', domain: '.google.com', path: '/' },
  );
}

// Fallback: click through a consent page if it still appears
async function clickConsentIfPresent(page: Page): Promise<void> {
  const currentUrl = page.url();
  if (!currentUrl.includes('consent.google') && !currentUrl.includes('accounts.google')) return;

  // Try known button IDs / selectors (multi-language)
  for (const sel of ['#L2AGLb', '.tHlp8d', 'form[action] button[jsname]']) {
    try {
      const el = await page.$(sel);
      if (el) {
        await el.click();
        await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 8000 }).catch(() => {});
        return;
      }
    } catch {}
  }

  // Try matching by visible button text (handles any language)
  const acceptWords = ['Accept all', 'Alles accepteren', 'Alle akzeptieren',
                       'Tout accepter', 'Acceptar todo', 'Accetta tutto'];
  for (const word of acceptWords) {
    try {
      const clicked = await page.evaluate((w) => {
        const btn = Array.from(document.querySelectorAll('button'))
          .find(b => b.textContent?.includes(w));
        if (btn) { btn.click(); return true; }
        return false;
      }, word);
      if (clicked) {
        await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 8000 }).catch(() => {});
        return;
      }
    } catch {}
  }
}

async function getPanelText(page: Page): Promise<string> {
  return page.evaluate(() => {
    const candidates = ['[role="main"]', '.m6QErb', '.bJzME', '.tAiQdd', '.PPCwl'];
    for (const sel of candidates) {
      const el = document.querySelector(sel) as HTMLElement | null;
      if (el?.innerText && el.innerText.trim().length > 300)
        return el.innerText.trim().substring(0, 6000);
    }
    return (document.body as HTMLElement).innerText.trim().substring(0, 6000);
  });
}

async function clickTabAndGetText(page: Page, patterns: string[]): Promise<string> {
  try {
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
  const targetUrl = normalizeUrl(url);

  try {
    browser = await puppeteer.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-blink-features=AutomationControlled',
        '--window-size=1440,900',
        '--lang=en-US',
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

    // Visit google.com first so we can set cookies on the right domain
    await page.goto('https://www.google.com', { waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {});
    await setConsentCookies(page);

    // Now navigate to the actual GMB listing
    await page.goto(targetUrl, { waitUntil: 'networkidle2', timeout: 45000 });
    await clickConsentIfPresent(page);

    await page.waitForSelector('h1', { timeout: 20000 });
    await new Promise(r => setTimeout(r, 2500));

    const pageTitle = await page.title();
    const overviewText = await getPanelText(page);
    const reviewsText = await clickTabAndGetText(page, ['reviews']);
    const aboutText = await clickTabAndGetText(page, ['about']);

    return { url, pageTitle, overviewText, reviewsText, aboutText, scrapedAt: new Date().toISOString() };
  } finally {
    await browser?.close();
  }
}
