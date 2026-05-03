import puppeteer, { Browser, Page } from 'puppeteer';

export interface GMBRawData {
  url: string;
  pageTitle: string;
  overviewText: string;
  hoursText: string;
  reviewsText: string;
  aboutText: string;
  scrapedAt: string;
}

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

async function setConsentCookies(page: Page): Promise<void> {
  await page.setCookie(
    { name: 'CONSENT', value: 'YES+cb.20240101-00-p0.en+FX+111', domain: '.google.com', path: '/' },
    { name: 'SOCS',    value: 'CAISHAgCEhJnd3NfMjAyNDAxMDEtMF9SQzEaAmVuIAEaBgiA', domain: '.google.com', path: '/' },
  );
}

async function clickConsentIfPresent(page: Page): Promise<void> {
  const currentUrl = page.url();
  if (!currentUrl.includes('consent.google') && !currentUrl.includes('accounts.google')) return;

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

  const acceptWords = ['Accept all', 'Alles accepteren', 'Alle akzeptieren',
                       'Tout accepter', 'Acceptar todo', 'Accetta tutto'];
  for (const word of acceptWords) {
    try {
      const clicked = await page.evaluate((w) => {
        const btn = Array.from(document.querySelectorAll('button'))
          .find(b => b.textContent?.includes(w));
        if (btn) { (btn as HTMLElement).click(); return true; }
        return false;
      }, word);
      if (clicked) {
        await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 8000 }).catch(() => {});
        return;
      }
    } catch {}
  }
}

// Expand the hours dropdown so all 7 days are visible before we read the panel
async function expandHours(page: Page): Promise<void> {
  try {
    const expanded = await page.evaluate(() => {
      // The hours section has a button/div with aria-expanded="false"
      // It typically contains "Open", "Closed", or a time like "9 AM"
      const collapsed = Array.from(document.querySelectorAll('[aria-expanded="false"]')) as HTMLElement[];
      for (const el of collapsed) {
        const combined = (el.textContent || '') + (el.getAttribute('aria-label') || '');
        if (/(open|closed|opens|closes)/i.test(combined) || /\d\s*(am|pm)/i.test(combined)) {
          el.click();
          return true;
        }
      }
      // Fallback: look for a button that has an hours-related data-item-id
      const hoursBtn = document.querySelector('[data-item-id*="oh"]') as HTMLElement | null;
      if (hoursBtn) { hoursBtn.click(); return true; }
      return false;
    });
    if (expanded) await new Promise(r => setTimeout(r, 1200));
  } catch {}
}

// Extract all text content from the hours table/list after expansion
async function extractHoursText(page: Page): Promise<string> {
  return page.evaluate(() => {
    // After expanding, look for a table or list that contains Mon–Sun entries
    const dayPattern = /monday|tuesday|wednesday|thursday|friday|saturday|sunday/i;
    const candidates = Array.from(document.querySelectorAll('table, ul, [role="list"], div'))
      .filter(el => dayPattern.test((el as HTMLElement).innerText || ''));
    if (candidates.length > 0) {
      // Pick the most specific (smallest matching) element
      candidates.sort((a, b) => (a.textContent?.length ?? 0) - (b.textContent?.length ?? 0));
      return (candidates[0] as HTMLElement).innerText?.trim().substring(0, 1000) ?? '';
    }
    return '';
  });
}

// Extract the service-area text if there is no physical address shown
async function extractServiceArea(page: Page): Promise<string> {
  return page.evaluate(() => {
    const all = Array.from(document.querySelectorAll('*'));
    for (const el of all) {
      const text = (el as HTMLElement).innerText?.trim() ?? '';
      if (/service.?area/i.test(text) && text.length < 300) return text;
    }
    return '';
  });
}

async function getPanelText(page: Page): Promise<string> {
  return page.evaluate(() => {
    const candidates = ['[role="main"]', '.m6QErb', '.bJzME', '.tAiQdd', '.PPCwl'];
    for (const sel of candidates) {
      const el = document.querySelector(sel) as HTMLElement | null;
      if (el?.innerText && el.innerText.trim().length > 300)
        return el.innerText.trim().substring(0, 7000);
    }
    return (document.body as HTMLElement).innerText.trim().substring(0, 7000);
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

    await page.goto('https://www.google.com', { waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {});
    await setConsentCookies(page);

    await page.goto(targetUrl, { waitUntil: 'networkidle2', timeout: 45000 });
    await clickConsentIfPresent(page);
    await page.waitForSelector('h1', { timeout: 20000 });
    await new Promise(r => setTimeout(r, 2500));

    // Expand hours BEFORE reading the main panel so the full week is visible
    await expandHours(page);
    const hoursText = await extractHoursText(page);
    const serviceArea = await extractServiceArea(page);

    const overviewText = await getPanelText(page);
    const reviewsText = await clickTabAndGetText(page, ['reviews']);
    const aboutText   = await clickTabAndGetText(page, ['about']);

    // Append service-area info to overview so the report generator sees it
    const fullOverview = serviceArea
      ? `${overviewText}\n\n[SERVICE AREA INFO]\n${serviceArea}`
      : overviewText;

    return {
      url,
      pageTitle: await page.title(),
      overviewText: fullOverview,
      hoursText,
      reviewsText,
      aboutText,
      scrapedAt: new Date().toISOString(),
    };
  } finally {
    await browser?.close();
  }
}
