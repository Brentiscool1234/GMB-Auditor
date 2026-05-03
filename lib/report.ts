import Anthropic from '@anthropic-ai/sdk';
import { GMBData } from './scraper';

export interface Scores {
  basicInfo: number;
  reviewProfile: number;
  engagement: number;
  profileCompleteness: number;
  overall: number;
}

export function computeScores(data: GMBData): Scores {
  // Basic info: name, category, address, phone, website, hours
  let basicInfo = 0;
  if (data.name) basicInfo += 20;
  if (data.category) basicInfo += 15;
  if (data.address) basicInfo += 20;
  if (data.phone) basicInfo += 15;
  if (data.website) basicInfo += 15;
  if (data.hours) basicInfo += 15;

  // Review profile: rating, count, owner responses
  let reviewProfile = 0;
  const rating = parseFloat(data.rating) || 0;
  const reviewCount = parseInt(data.reviewCount) || 0;
  if (rating >= 4.5) reviewProfile += 50;
  else if (rating >= 4.0) reviewProfile += 38;
  else if (rating >= 3.5) reviewProfile += 25;
  else if (rating > 0) reviewProfile += 10;
  if (reviewCount >= 100) reviewProfile += 30;
  else if (reviewCount >= 50) reviewProfile += 22;
  else if (reviewCount >= 20) reviewProfile += 15;
  else if (reviewCount >= 5) reviewProfile += 8;
  if (data.hasOwnerResponses) reviewProfile += 20;
  reviewProfile = Math.min(reviewProfile, 100);

  // Engagement: photos, posts, Q&A
  let engagement = 0;
  const photos = parseInt(data.photoCount) || 0;
  const posts = parseInt(data.recentPostCount) || 0;
  const qa = parseInt(data.qaCount) || 0;
  if (photos >= 50) engagement += 50;
  else if (photos >= 20) engagement += 35;
  else if (photos >= 10) engagement += 22;
  else if (photos >= 3) engagement += 12;
  if (posts >= 4) engagement += 30;
  else if (posts >= 2) engagement += 20;
  else if (posts >= 1) engagement += 10;
  if (qa >= 5) engagement += 20;
  else if (qa >= 1) engagement += 10;
  engagement = Math.min(engagement, 100);

  // Profile completeness: all fields + description + attributes
  let profileCompleteness = 0;
  if (data.name) profileCompleteness += 12;
  if (data.category) profileCompleteness += 10;
  if (data.address) profileCompleteness += 12;
  if (data.phone) profileCompleteness += 10;
  if (data.website) profileCompleteness += 10;
  if (data.hours) profileCompleteness += 10;
  if (data.description) profileCompleteness += 18;
  if (data.attributes.length >= 5) profileCompleteness += 10;
  else if (data.attributes.length >= 1) profileCompleteness += 5;
  if (parseInt(data.photoCount) >= 5) profileCompleteness += 8;
  if (data.plusCode) profileCompleteness += 5;  // indicates verified/complete listing
  if (data.hasOwnerResponses) profileCompleteness += 5;
  profileCompleteness = Math.min(profileCompleteness, 100);

  const overall = Math.round((basicInfo + reviewProfile + engagement + profileCompleteness) / 4);

  return { basicInfo, reviewProfile, engagement, profileCompleteness, overall };
}

export async function generateReport(data: GMBData, scores: Scores): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not set in your .env file.');
  const client = new Anthropic({ apiKey });

  const auditDate = new Date().toLocaleDateString('en-US', {
    year: 'numeric', month: 'long', day: 'numeric',
  });

  const prompt = `You are a Google My Business (GMB) / Google Business Profile optimization expert. Analyze the data below and generate a professional HTML audit report with inline CSS — a complete HTML document ready to display in a browser.

---
LISTING DATA
Business Name: ${data.name || 'Not found'}
Category: ${data.category || 'Not set'}
Rating: ${data.rating || 'N/A'} stars
Review Count: ${data.reviewCount || '0'}
Address: ${data.address || 'Not set'}
Phone: ${data.phone || 'Not set'}
Website: ${data.website || 'Not set'}
Hours listed: ${data.hours ? 'Yes' : 'No'}
Current status: ${data.isOpen || 'Unknown'}
Description / About: ${data.description ? `"${data.description.substring(0, 300)}..."` : 'NOT SET'}
Photo Count: ${data.photoCount || '0'}
Recent Posts/Updates: ${data.recentPostCount || '0'}
Q&A entries: ${data.qaCount || '0'}
Owner responds to reviews: ${data.hasOwnerResponses ? 'Yes' : 'No / not detected'}
Attributes listed: ${data.attributes.length > 0 ? data.attributes.slice(0, 15).join(', ') : 'None'}
Plus Code: ${data.plusCode || 'Not found'}
Profile URL: ${data.url}
Audit Date: ${auditDate}

---
CALCULATED SCORES
Basic Info Score: ${scores.basicInfo}/100
Review Profile Score: ${scores.reviewProfile}/100
Engagement Score: ${scores.engagement}/100
Profile Completeness Score: ${scores.profileCompleteness}/100
OVERALL SCORE: ${scores.overall}/100

---

Generate a complete HTML document with:

1. **Header** — business name, overall score (large, color-coded: green ≥80, amber 60-79, red <60), audit date, and a one-line verdict
2. **Score Cards row** — 4 cards for the category scores, same color-coding
3. **Executive Summary** — 3–4 sentences describing the overall health of the listing
4. **Detailed Analysis** — one section per category with specific findings (what's present, what's missing, benchmark comparisons)
5. **Top 5 Priority Actions** — numbered list, highest-impact fixes first, each with a specific how-to step
6. **What's Working Well** — bullet list of genuine positives
7. **Footer** — "Generated by GMB Auditor • ${auditDate}"

Design requirements:
- White background, clean sans-serif font (system-ui or Inter)
- Color scheme: #1a73e8 (Google blue), #34a853 (green), #fbbc04 (amber), #ea4335 (red)
- Score circles/badges should be visually prominent
- Responsive, max-width 900px centered
- All CSS inline or in a <style> tag inside <head>
- Start the response with <!DOCTYPE html> — no preamble text outside the HTML`;

  const message = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 4096,
    messages: [{ role: 'user', content: prompt }],
  });

  const block = message.content[0];
  if (block.type !== 'text') throw new Error('Unexpected Claude response type');

  // Pull out the HTML block if Claude wrapped it in markdown fences
  const raw = block.text;
  const fenced = raw.match(/```html\s*([\s\S]*?)```/i);
  if (fenced) return fenced[1].trim();

  const doctype = raw.indexOf('<!DOCTYPE html>');
  if (doctype !== -1) return raw.slice(doctype).trim();

  return raw.trim();
}
