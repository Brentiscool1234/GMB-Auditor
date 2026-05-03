import puppeteer, { Browser, Page } from 'puppeteer';

export interface GMBData {
  url: string;
  name: string;
  category: string;
  rating: string;
  reviewCount: string;
  address: string;
  phone: string;
  website: string;
  hours: string;
  isOpen: string;
  photoCount: string;
  description: string;
  plusCode: string;
  attributes: string[];
  recentPostCount: string;
  qaCount: string;
  hasOwnerResponses: boolean;
  scrapedAt: string;
}

async function dismissConsent(page: Page): Promise<void> {
  const selectors = ['#L2AGLb', 'button[aria-label*="Accept all"]', 'button[aria-label*="Agree"]'];
  for (const sel of selectors) {
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

async function clickTab(page: Page, labelPatterns: string[]): Promise<boolean> {
  for (const pattern of labelPatterns) {
    try {
      const tabs = await page.$$('[role="tab"], button');
      for (const tab of tabs) {
        const label = await page.evaluate(el =>
          (el.getAttribute('aria-label') || el.textContent || '').toLowerCase(), tab);
        if (label.includes(pattern.toLowerCase())) {
          await tab.click();
          await new Promise(r => setTimeout(r, 1500));
          return true;
        }
      }
    } catch {}
  }
  return false;
}

export async function scrapeGMB(url: string): Promise<GMBData> {
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
    await new Promise(r => setTimeout(r, 2000));

    // Extract main panel data
    const main = await page.evaluate(() => {
      const getText = (...selectors: string[]): string => {
        for (const sel of selectors) {
          const el = document.querySelector(sel);
          if (el?.textContent?.trim()) return el.textContent.trim();
        }
        return '';
      };

      const name = getText('h1.DUwDvf', 'h1');

      // Category is typically a button near the title
      const category = getText('button.DkEaL', '.fontBodyMedium button');

      // Rating: aria-hidden span inside rating widget
      const ratingEl = document.querySelector('div.F7nice span[aria-hidden="true"]');
      const rating = ratingEl?.textContent?.trim() ?? '';

      // Review count: find span with aria-label containing "reviews"
      let reviewCount = '';
      document.querySelectorAll('[aria-label]').forEach(el => {
        const lbl = el.getAttribute('aria-label') ?? '';
        const m = lbl.match(/([\d,]+)\s+review/i);
        if (m && !reviewCount) reviewCount = m[1].replace(/,/g, '');
      });
      // Fallback: look for a link/button whose text is just a number near the rating
      if (!reviewCount) {
        const btn = document.querySelector('button[aria-label*="review"]');
        if (btn) {
          const m = (btn.textContent ?? '').match(/([\d,]+)/);
          if (m) reviewCount = m[1].replace(/,/g, '');
        }
      }

      // Address / phone / website via data-item-id or aria-label
      let address = '', phone = '', website = '';
      document.querySelectorAll('[data-item-id], [aria-label]').forEach(el => {
        const id = el.getAttribute('data-item-id') ?? '';
        const lbl = el.getAttribute('aria-label') ?? '';
        const text = el.textContent?.trim() ?? '';

        if (!address && (id === 'address' || /^address:/i.test(lbl)))
          address = lbl.replace(/^address:\s*/i, '') || text;

        if (!phone && (id.includes('phone') || /phone number:/i.test(lbl)))
          phone = lbl.replace(/phone number:\s*/i, '').replace(/^phone:\s*/i, '') || text;

        if (!website && (id.includes('authority') || id.includes('website') || /^website:/i.test(lbl)))
          website = lbl.replace(/^website:\s*/i, '') || text;
      });

      // Hours summary (aria-label on the hours button/row)
      let hours = '', isOpen = '';
      document.querySelectorAll('[aria-label]').forEach(el => {
        const lbl = el.getAttribute('aria-label') ?? '';
        if (!hours && /\d+(:\d+)?\s*(am|pm)/i.test(lbl)) hours = lbl;
        if (!isOpen) {
          const text = el.textContent?.trim() ?? '';
          if (/^(open now|closed|opens|closes)/i.test(text)) isOpen = text;
        }
      });

      // Plus code
      let plusCode = '';
      document.querySelectorAll('[aria-label]').forEach(el => {
        const lbl = el.getAttribute('aria-label') ?? '';
        if (/plus code/i.test(lbl) && !plusCode)
          plusCode = lbl.replace(/plus code:\s*/i, '').trim();
      });

      // Photo count from tab or button text
      let photoCount = '';
      document.querySelectorAll('button, [role="tab"]').forEach(el => {
        const text = el.textContent ?? '';
        const lbl = el.getAttribute('aria-label') ?? '';
        if (/photo/i.test(text + lbl) && !photoCount) {
          const m = (text + lbl).match(/([\d,]+)/);
          if (m) photoCount = m[1].replace(/,/g, '');
        }
      });

      return { name, category, rating, reviewCount, address, phone, website, hours, isOpen, plusCode, photoCount };
    });

    // About tab — description & attributes
    let description = '';
    let attributes: string[] = [];
    const clickedAbout = await clickTab(page, ['about']);
    if (clickedAbout) {
      const aboutData = await page.evaluate(() => {
        const desc =
          document.querySelector('.PYvSYb')?.textContent?.trim() ??
          document.querySelector('[aria-label="From the business"]')?.nextElementSibling?.textContent?.trim() ??
          '';

        const attrs: string[] = [];
        document.querySelectorAll('.E0DTEd, [class*="attribute"], li').forEach(el => {
          const t = el.textContent?.trim();
          if (t && t.length < 80 && t.length > 2) attrs.push(t);
        });
        return { description: desc, attributes: [...new Set(attrs)].slice(0, 20) };
      });
      description = aboutData.description;
      attributes = aboutData.attributes;
    }

    // Updates / Posts tab
    let recentPostCount = '0';
    const clickedUpdates = await clickTab(page, ['updates', 'posts']);
    if (clickedUpdates) {
      const count = await page.evaluate(() =>
        document.querySelectorAll('[role="article"], .Yr7JMd-pane').length
      );
      recentPostCount = count > 0 ? String(count) : '0';
    }

    // Q&A tab
    let qaCount = '0';
    await clickTab(page, ['q&a', 'questions']);
    const qaData = await page.evaluate(() => {
      const items = document.querySelectorAll('[role="listitem"], .qjESne');
      return String(items.length);
    });
    qaCount = qaData !== '0' ? qaData : qaCount;

    // Reviews tab — owner responses
    let hasOwnerResponses = false;
    const clickedReviews = await clickTab(page, ['reviews']);
    if (clickedReviews) {
      hasOwnerResponses = await page.evaluate(() =>
        document.querySelectorAll('.CDe7pd, [aria-label*="Response from the owner"]').length > 0
      );
    }

    return {
      url,
      ...main,
      description,
      attributes,
      recentPostCount,
      qaCount,
      hasOwnerResponses,
      scrapedAt: new Date().toISOString(),
    };
  } finally {
    await browser?.close();
  }
}
