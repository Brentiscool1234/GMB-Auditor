'use client';

import { useState } from 'react';

type Status = 'idle' | 'scraping' | 'generating' | 'done' | 'error';

export default function Home() {
  const [url, setUrl] = useState('');
  const [reviewCount, setReviewCount] = useState('');
  const [status, setStatus] = useState<Status>('idle');
  const [reportHtml, setReportHtml] = useState('');
  const [error, setError] = useState('');

  async function runAudit() {
    if (!url.trim()) return;
    setStatus('scraping');
    setError('');
    setReportHtml('');

    try {
      setStatus('scraping');
      const res = await fetch('/api/audit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: url.trim(), reviewCount: reviewCount.trim() || undefined }),
      });

      setStatus('generating');
      const json = await res.json();

      if (!res.ok) {
        setError(json.error ?? 'Something went wrong.');
        setStatus('error');
        return;
      }

      setReportHtml(json.html);
      setStatus('done');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Network error');
      setStatus('error');
    }
  }

  async function downloadPdf() {
    const res = await fetch('/api/pdf', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ html: reportHtml }),
    });
    if (!res.ok) { alert('PDF generation failed'); return; }
    const blob = await res.blob();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'gmb-audit.pdf';
    a.click();
  }

  const isLoading = status === 'scraping' || status === 'generating';

  return (
    <main className="min-h-screen flex flex-col">
      {/* Header */}
      <header className="border-b border-gray-800 px-6 py-4 flex items-center gap-3">
        <div className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center text-sm font-bold">G</div>
        <span className="font-semibold text-lg tracking-tight">GMB Auditor</span>
      </header>

      {/* Hero / Input */}
      <section className="flex flex-col items-center justify-center px-4 pt-20 pb-12 text-center">
        <h1 className="text-4xl font-bold mb-3 tracking-tight">
          Audit Your Google Business Profile
        </h1>
        <p className="text-gray-400 text-lg mb-10 max-w-xl">
          Paste your Google Maps URL and get a full AI-powered audit with a downloadable PDF report — no API key required on your end.
        </p>

        <div className="w-full max-w-2xl flex flex-col gap-3">
          <div className="flex gap-3">
            <input
              type="url"
              value={url}
              onChange={e => setUrl(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && !isLoading && runAudit()}
              placeholder="https://www.google.com/maps/place/..."
              className="flex-1 bg-gray-900 border border-gray-700 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-blue-500 placeholder-gray-600 transition-colors"
              disabled={isLoading}
            />
            <button
              onClick={runAudit}
              disabled={isLoading || !url.trim()}
              className="bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed text-white font-semibold px-6 py-3 rounded-xl text-sm transition-colors whitespace-nowrap"
            >
              {isLoading ? 'Auditing...' : 'Run Audit'}
            </button>
          </div>
          <div className="flex items-center gap-3">
            <input
              type="number"
              min="0"
              value={reviewCount}
              onChange={e => setReviewCount(e.target.value)}
              placeholder="Review count (optional — enter manually if auto-detect fails)"
              className="flex-1 bg-gray-900 border border-gray-700 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-blue-500 placeholder-gray-600 transition-colors"
              disabled={isLoading}
            />
          </div>
        </div>

        {/* Status indicator */}
        {isLoading && (
          <div className="mt-8 flex flex-col items-center gap-3">
            <div className="flex gap-2 items-center text-sm text-gray-400">
              <span className={`w-2 h-2 rounded-full animate-pulse ${status === 'scraping' ? 'bg-blue-500' : 'bg-gray-600'}`} />
              <span className={status === 'scraping' ? 'text-white' : 'text-gray-600'}>
                Scraping Google Business Profile
              </span>
            </div>
            <div className="flex gap-2 items-center text-sm text-gray-400">
              <span className={`w-2 h-2 rounded-full animate-pulse ${status === 'generating' ? 'bg-blue-500' : 'bg-gray-600'}`} />
              <span className={status === 'generating' ? 'text-white' : 'text-gray-600'}>
                Generating AI audit report
              </span>
            </div>
          </div>
        )}

        {status === 'error' && (
          <div className="mt-6 bg-red-950 border border-red-800 text-red-300 text-sm rounded-xl px-5 py-3 max-w-xl">
            {error}
          </div>
        )}
      </section>

      {/* Report */}
      {status === 'done' && reportHtml && (
        <section className="flex-1 flex flex-col items-center px-4 pb-16 gap-4">
          <div className="flex items-center gap-3 w-full max-w-5xl justify-between">
            <span className="text-sm text-gray-400">Audit complete</span>
            <button
              onClick={downloadPdf}
              className="bg-green-600 hover:bg-green-500 text-white font-semibold px-5 py-2 rounded-lg text-sm transition-colors flex items-center gap-2"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3M3 17V7a2 2 0 012-2h6l2 2h6a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z" />
              </svg>
              Download PDF
            </button>
          </div>

          <iframe
            srcDoc={reportHtml}
            className="w-full max-w-5xl rounded-xl border border-gray-800 bg-white"
            style={{ height: '80vh' }}
            title="GMB Audit Report"
          />
        </section>
      )}
    </main>
  );
}
