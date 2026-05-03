import puppeteer, { Browser, Page } from 'puppeteer';

export interface GMBRawData {
  url: string;
  pageTitle: string;
  ratingInfo: string;
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

// Dedicated extraction for rating + review count from aria-labels and button text.
// Google Maps encodes this in aria-labels like "4.8 stars 1,234 reviews" and in
// button text like "1,234 reviews". Extracting it separately avoids it being
// buried or lost in the larger panel text blob.
async function extractRatingInfo(page: Page): Promise<string> {
  return page.evaluate(() => {
    const lines: string[] = [];

    // Scan all aria-labels for rating / review patterns
    document.querySelectorAll('[aria-label]').forEach(el => {
      const lbl = el.getAttribute('aria-label') ?? '';
      if (/(\d[\d.]*)\s*stars?/i.test(lbl) || /[\d,]+\s*reviews?/i.test(lbl)) {
        lines.push(lbl.trim());
      }
    });

    // Also scan button/span text for standalone review counts like "1,234 reviews"
    document.querySelectorAll('button, span, a').forEach(el => {
      const txt = (el as HTMLElement).innerText?.trim() ?? '';
      if (/^[\d,]+\s*reviews?$/i.test(txt)) lines.push(txt);
    });

    // Deduplicate and return
    return [...new Set(lines)].join(' | ');
  });
}

// Expand the hours toggle so all 7 days become visible in the DOM.
// Strategy: click any aria-expanded="false" element whose text/label mentions
// open/closed or a time, then fall back to data-item-id="oh" (opening hours).
async function expandHours(page: Page): Promise<void> {
  try {
    const clicked = await page.evaluate(() => {
      const collapsed = Array.from(
        document.querySelectorAll('[aria-expanded="false"]')
      ) as HTMLElement[];

      for (const el of collapsed) {
        const combined = (el.textContent ?? '') + (el.getAttribute('aria-label') ?? '');
        if (/(open|closed|opens|closes)/i.test(combined) || /\d\s*(am|pm)/i.test(combined)) {
          el.click();
          return true;
        }
      }

      // Fallback: element with opening-hours data-item-id
      const oh = document.querySelector('[data-item-id*="oh"]') as HTMLElement | null;
      if (oh) { oh.click(); return true; }

      return false;
    });

    // Give the DOM time to render the expanded week view
    if (clicked) await new Promise(r => setTimeout(r, 2000));
  } catch {}
}

// Extract the full weekly hours after expansion.
// Scans ALL elements for day-of-week names and collects the most relevant block.
async function extractHoursText(page: Page): Promise<string> {
  return page.evaluate(() => {
    const dayPattern = /\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i;

    // Collect innerText from every element that contains at least one day name
    const hits = Array.from(document.querySelectorAll('*'))
      .map(el => (el as HTMLElement).innerText?.trim() ?? '')
      .filter(t => dayPattern.test(t) && t.length < 2000);

    if (hits.length === 0) return '';

    // Sort by length ascending — the shortest hit that still contains a day
    // is usually the most focused hours block
    hits.sort((a, b) => a.length - b.length);

    // Walk up until we find one that contains multiple days (fuller schedule)
    for (const text of hits) {
      const dayCount = (text.match(/\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/gi) ?? []).length;
      if (dayCount >= 3) return text.substring(0, 1200);
    }

    // Return smallest even if it only has one or two days
    return hits[0].substring(0, 1200);
  });
}

// Capture "Service area:" text for SABs that hide their physical address.
async function extractServiceArea(page: Page): Promise<string> {
  return page.evaluate(() => {
    const all = Array.from(document.querySelectorAll('*'));
    for (const el of all) {
      const text = (el as HTMLElement).innerText?.trim() ?? '';
      if (/service.?area/i.test(text) && text.length < 400) return text;
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

    // Extract rating + review count before anything else moves focus
    const ratingInfo = await extractRatingInfo(page);

    // Expand hours, then extract the full weekly schedule
    await expandHours(page);
    await new Promise(r => setTimeout(r, 500)); // small extra settle
    const hoursText = await extractHoursText(page);

    const serviceArea = await extractServiceArea(page);
    const overviewText = await getPanelText(page);
    const reviewsText = await clickTabAndGetText(page, ['reviews']);
    const aboutText   = await clickTabAndGetText(page, ['about']);

    const fullOverview = serviceArea
      ? `${overviewText}\n\n[SERVICE AREA INFO]\n${serviceArea}`
      : overviewText;

    return {
      url,
      pageTitle: await page.title(),
      ratingInfo,
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
