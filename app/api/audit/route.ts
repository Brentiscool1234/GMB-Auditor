import { NextRequest, NextResponse } from 'next/server';
import { scrapeGMB } from '@/lib/scraper';
import { computeScores, generateReport } from '@/lib/report';

function isValidGMBUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return (
      u.hostname.includes('google.com') ||
      u.hostname.includes('maps.google') ||
      u.hostname === 'goo.gl' ||
      u.hostname === 'maps.app.goo.gl'
    );
  } catch {
    return false;
  }
}

export async function POST(req: NextRequest) {
  let url: string;
  try {
    ({ url } = await req.json());
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  if (!url || !isValidGMBUrl(url)) {
    return NextResponse.json(
      { error: 'Please provide a valid Google Maps or Google Business Profile URL.' },
      { status: 400 }
    );
  }

  try {
    const data = await scrapeGMB(url);
    const scores = computeScores(data);
    const html = await generateReport(data, scores);
    return NextResponse.json({ html, data, scores });
  } catch (err) {
    console.error('Audit error:', err);
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json(
      { error: `Audit failed: ${message}` },
      { status: 500 }
    );
  }
}
