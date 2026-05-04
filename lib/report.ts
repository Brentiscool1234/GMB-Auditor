import Anthropic from '@anthropic-ai/sdk';
import { GMBRawData } from './scraper';

export async function generateReport(raw: GMBRawData, manualReviewCount?: string): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not set in your .env file.');
  const client = new Anthropic({ apiKey });

  const auditDate = new Date().toLocaleDateString('en-US', {
    year: 'numeric', month: 'long', day: 'numeric',
  });

  const prompt = `You are a Google Business Profile (GBP / GMB) optimization expert. Below is raw text scraped from a Google Maps business listing page. Your job is to:

1. Extract all available business data from the raw text
2. Score the listing across 4 categories (0–100 each)
3. Generate a professional HTML audit report

---
PROFILE URL: ${raw.url}
PAGE TITLE: ${raw.pageTitle}
AUDIT DATE: ${auditDate}

RATING & REVIEW COUNT (extracted from aria-labels — this is the most reliable source):
${raw.ratingInfo || '(not captured)'}
${manualReviewCount ? `MANUALLY PROVIDED REVIEW COUNT: ${manualReviewCount} reviews — treat this as the definitive review count; it overrides anything auto-detected above.` : ''}

OVERVIEW TEXT (main panel):
${raw.overviewText || '(empty)'}

HOURS (expanded weekly schedule — extracted after clicking the hours toggle):
${raw.hoursText || '(not captured — check overview text for partial hours)'}

REVIEWS TAB TEXT:
${raw.reviewsText ? raw.reviewsText.substring(0, 2000) : '(empty)'}

ABOUT TAB TEXT:
${raw.aboutText ? raw.aboutText.substring(0, 2000) : '(empty)'}

IMPORTANT NOTES FOR SCORING:
- Use the RATING & REVIEW COUNT field above as the authoritative source for star rating and number of reviews. Do not guess low if a count is present there.
- The RATING & REVIEW COUNT field may contain fragments like "Rating: 5.0", "384 reviews", "(384)", "Reviews: 384" — treat ANY numeric value preceded by "Rating:" as the star rating, and ANY numeric value near "reviews" or "Reviews:" as the review count. Combine them even if they appear in separate fragments.
- If the star rating found is 4.5 or higher, score the Review Profile rating component at the full 50 points. Never score a confirmed high rating as 0.
- ADDRESS: If no street address is found, do NOT penalize or flag this as missing. Many businesses (especially service-area businesses) intentionally hide their physical address. Only note address/service area if "Service area:" text is explicitly present.
- HOURS: Google Maps only exposes the current day's hours by default. If ANY hours data is present (even just one day), treat hours as LISTED and PRESENT — do not flag partial hours as a deficiency. Never say hours are "partial" or "missing days". Only flag hours as missing if absolutely no hours text was found at all.

---

SCORING RUBRIC (score each 0–100 based strictly on what you can confirm from the data above):

Basic Info — 20pts: business name | 20pts: address or service area (if neither present give 20pts anyway — many SABs hide address by design) | 20pts: phone | 20pts: website | 20pts: hours listed (give full 20pts if ANY hours appear — Google only shows current day by default)
Review Profile — 50pts: rating (4.5+=50, 4.0+=38, 3.5+=25, >0=10) | 30pts: review count (100+=30, 50+=22, 20+=15, 5+=8) | 20pts: owner responds to reviews
Engagement — 50pts: photo count (50+=50, 20+=35, 10+=22, 3+=12) | 30pts: posts/updates (4+=30, 2+=20, 1+=10) | 20pts: Q&A entries (5+=20, 1+=10)
Profile Completeness — 15pts: description | 10pts: category | 10pts: attributes | 10pts: address/service area (give full 10pts if address OR service area found, or if neither — SABs legitimately hide address) | 10pts: phone | 10pts: website | 10pts: hours (give full 10pts if ANY hours appear) | 10pts: photos | 5pts: verified (plus code present)

Overall = average of the 4 category scores, rounded to nearest integer.

---

CRITICAL HTML RULES — you are writing an HTML document, not markdown:
- Start immediately with <!DOCTYPE html> — zero text before it
- NEVER use markdown syntax anywhere: no [text](url), no **bold**, no # headings, no backticks
- All links must be proper HTML: <a href="https://...">link text</a>
- All bold text must use <strong> tags
- All headings must use <h1>/<h2>/<h3> tags
- All CSS goes in a <style> block inside <head>
- No inline style attributes

DESIGN:
- Font: system-ui, -apple-system, sans-serif
- Max-width 860px, centered, white background (#fff), page background #f8f9fa
- Color palette: blue #1a73e8, green #34a853, amber #f9ab00, red #ea4335, dark #202124
- Score badges: 80px circle, color-coded — green if ≥80, amber if 60–79, red if <60
- Clean card layout with subtle box-shadow: 0 1px 4px rgba(0,0,0,.12)

REPORT STRUCTURE:
1. Header — business name (h1), overall score badge, one-line verdict, audit date and profile link (<a> tag)
2. Four score cards in a 2×2 CSS grid — category name, score badge, 1-sentence finding
3. Executive Summary — 3–4 sentences on overall listing health, referencing actual numbers found
4. Detailed Analysis — one <section> per category:
   - Table of fields found vs missing (use <table>, not markdown)
   - What is missing and why it matters
   - Benchmark: what a fully optimised profile looks like
5. Top 5 Priority Actions — <ol>, highest ROI first, each item has a bolded action title and a concrete step (e.g. "Open Google Maps → click Edit profile → Description")
6. Positives — <ul> of what the business is already doing well
7. Footer — "Generated by GMB Auditor &bull; ${auditDate}"

Reference actual data values in the analysis. Do not say a field is missing if it was found in the scraped data.

CRITICAL RULE — CONFIRMED DATA ONLY:
- NEVER mention, list, estimate, or speculate about any field that does not appear explicitly in the scraped data above.
- If a value was NOT found in the scraped text, OMIT it entirely from the report. Do NOT write entries like "Photo count — UNCONFIRMED", "See photos link present", "Q&A — unknown", or any similar placeholder/guess.
- The analysis tables must only contain rows for fields you can confirm. No "not captured", no "unconfirmed", no "likely", no inferred counts.
- Score Engagement sub-items (photos, posts, Q&A) as 0 only if you have explicit evidence they are absent. If you simply have no data, omit the sub-item from the narrative rather than flagging it as missing.`;

  const message = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 5000,
    messages: [{ role: 'user', content: prompt }],
  });

  const block = message.content[0];
  if (block.type !== 'text') throw new Error('Unexpected Claude response type');

  const text = block.text;
  const fenced = text.match(/```html\s*([\s\S]*?)```/i);
  if (fenced) return fenced[1].trim();
  const doctype = text.indexOf('<!DOCTYPE html>');
  if (doctype !== -1) return text.slice(doctype).trim();
  return text.trim();
}
