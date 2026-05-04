import puppeteer, { Browser, Page } from 'puppeteer';

export interface GMBRawData {
  url: string;
  pageTitle: string;
  ratingInfo: string;
  overviewText: string;
  hoursText: string;
  reviewsText: string;
  aboutText: string;
  ownerResponds: boolean;
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

// Extract star rating and review count using every technique available.
// Google Maps encodes this in multiple places — aria-labels, specific CSS classes,
// innerText patterns, and JavaScript initialization state. We try all of them.
async function extractRatingInfo(page: Page): Promise<string> {
  return page.evaluate(() => {
    const hits = new Set<string>();

    // 1. aria-label scan — "4.8 stars", "4.8 stars 1,234 reviews", etc.
    document.querySelectorAll('[aria-label]').forEach(el => {
      const lbl = el.getAttribute('aria-label') ?? '';
      if (/\d[\d.]*\s*stars?/i.test(lbl) || /[\d,]+\s*reviews?/i.test(lbl) || /rated\s+\d/i.test(lbl)) {
        hits.add(lbl.trim());
      }
    });

    // 2. Known Google Maps rating/review CSS classes (change over time but try anyway)
    for (const sel of [
      'span.MW4etd', 'span.UY7F9', 'div.F7nice', 'span.Aq14fc',
      'g-review-stars', 'div.gm2-caption', 'span[jslog]',
    ]) {
      document.querySelectorAll(sel).forEach(el => {
        const t = (el as HTMLElement).innerText?.trim() ?? '';
        if (t && /^[\d.,]+$/.test(t)) hits.add(`Rating: ${t}`);
        if (/[\d,]+\s*reviews?/i.test(t)) hits.add(t);
      });
    }

    // 3. innerText scan for standalone review counts and rating numbers
    document.querySelectorAll('button, span, a, div').forEach(el => {
      const txt = (el as HTMLElement).innerText?.trim() ?? '';
      // "384 reviews" or "1,234 reviews"
      if (/^[\d,]+\s*reviews?$/i.test(txt)) hits.add(txt);
      // "(384)" or "(1,234)" — parenthesised review count next to a star rating
      if (/^\([\d,]+\)$/.test(txt)) hits.add(`Reviews: ${txt.replace(/[()]/g, '')}`);
      // "4.8" or "5.0" alone in a small element — likely the rating digit
      if (/^\d\.\d$/.test(txt)) hits.add(`Rating: ${txt}`);
    });

    // 4. Scan visible page text for "5.0\n(384)" or "4.8 · 1,234 reviews" patterns
    const bodyText = (document.body as HTMLElement).innerText ?? '';
    const ratingBlock = bodyText.match(/(\d\.\d)\s*[\n·(]+\s*([\d,]+)\s*\)?/);
    if (ratingBlock) hits.add(`Rating ${ratingBlock[1]}, ${ratingBlock[2]} reviews`);

    // 5. Try to pull from APP_INITIALIZATION_STATE JS variable embedded in page
    try {
      const scripts = Array.from(document.querySelectorAll('script:not([src])'));
      for (const s of scripts) {
        const src = s.textContent ?? '';
        // Matches patterns like ,4.8,384, or "4.8","384"
        const m = src.match(/"?(\d\.\d)"?,\s*"?([\d]+)"?\s*,\s*(?:null|\d)/);
        if (m && parseFloat(m[1]) >= 1 && parseFloat(m[1]) <= 5) {
          hits.add(`Rating: ${m[1]}, Reviews: ${m[2]}`);
          break;
        }
      }
    } catch {}

    return [...hits].join(' | ') || '(not captured)';
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

// Detect owner responses. Checks captured text first, then scrolls the
// Google Maps side panel (which has its own scroll container) in passes
// to lazy-load older reviews before scanning.
async function detectOwnerResponds(page: Page, reviewsText: string): Promise<boolean> {
  const pattern = /response from the owner|owner's response|replied by owner/i;

  if (pattern.test(reviewsText)) return true;

  // Scroll the side panel — Google Maps doesn't use window scroll for reviews
  for (let pass = 0; pass < 4; pass++) {
    try {
      await page.evaluate(() => {
        // Walk candidate containers and scroll the first one that is actually scrollable
        const selectors = ['[role="main"]', '.m6QErb', '.bJzME', '.tAiQdd', '.DxyBCb', '.e07Vkf'];
        for (const sel of selectors) {
          const el = document.querySelector(sel) as HTMLElement | null;
          if (el && el.scrollHeight > el.clientHeight + 50) {
            el.scrollTop += 2500;
            return;
          }
        }
        window.scrollBy(0, 2500);
      });
      await new Promise(r => setTimeout(r, 1500));

      const found = await page.evaluate(() =>
        /response from the owner|owner's response|replied by owner/i.test(
          (document.body as HTMLElement).innerText ?? ''
        )
      );
      if (found) return true;
    } catch {}
  }

  return false;
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

    const context = browser.defaultBrowserContext();
    await context.overridePermissions('https://www.google.com', ['geolocation']);
    const page = await browser.newPage();
    await page.setGeolocation({ latitude: 37.0902, longitude: -95.7129, accuracy: 100 });
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
    const ownerResponds = await detectOwnerResponds(page, reviewsText);
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
      ownerResponds,
      scrapedAt: new Date().toISOString(),
    };
  } finally {
    await browser?.close();
  }
}
