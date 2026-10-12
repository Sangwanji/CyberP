import { useState } from 'react';
import { scanTargetUrl, callAiSummary, callAiVaptReport } from '../lib/scanApi';
import type { ScanResponse } from '../types/scan';
import { supabase } from '../lib/supabaseClient';
import ZapAlerts, { type ZapAlert, type ZapOverview } from '../components/ZapAlerts';
import VaptReport, { type VaptReportData, buildPrintHtml } from '../components/VaptReport';

const ZAP_API_BASE = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3001';

// Robust markdown → HTML converter
// Processes line by line so headers, lists and paragraphs never fight each other.
function formatMarkdown(markdown: string): string {
  const lines = markdown.split('\n');
  const out: string[] = [];
  let inList = false;

  const closeList = () => {
    if (inList) { out.push('</ul>'); inList = false; }
  };

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();

    // Blank line — close any open list, emit a spacer
    if (!line.trim()) {
      closeList();
      continue;
    }

    // Headings
    if (/^### (.+)/.test(line)) {
      closeList();
      out.push(`<h3>${applyInline(line.replace(/^### /, ''))}</h3>`);
      continue;
    }
    if (/^## (.+)/.test(line)) {
      closeList();
      out.push(`<h2>${applyInline(line.replace(/^## /, ''))}</h2>`);
      continue;
    }
    if (/^# (.+)/.test(line)) {
      closeList();
      out.push(`<h1>${applyInline(line.replace(/^# /, ''))}</h1>`);
      continue;
    }

    // List items  (- or *)
    if (/^[-*] (.+)/.test(line)) {
      if (!inList) { out.push('<ul>'); inList = true; }
      out.push(`<li>${applyInline(line.replace(/^[-*] /, ''))}</li>`);
      continue;
    }

    // Numbered list items
    if (/^\d+\. (.+)/.test(line)) {
      if (!inList) { out.push('<ul>'); inList = true; }
      out.push(`<li>${applyInline(line.replace(/^\d+\. /, ''))}</li>`);
      continue;
    }

    // Horizontal rule
    if (/^---+$/.test(line.trim())) {
      closeList();
      out.push('<hr />');
      continue;
    }

    // Plain paragraph
    closeList();
    out.push(`<p>${applyInline(line)}</p>`);
  }

  closeList();
  return out.join('\n');
}

function applyInline(text: string): string {
  return text
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/`(.+?)`/g, '<code>$1</code>');
}

function getCertificateTone(expiryStatus: ScanResponse['certificate']['expiryStatus']) {
  switch (expiryStatus) {
    case 'expired':
      return 'border-red-400/40 bg-red-500/10 text-red-100';
    case 'expiring-soon':
      return 'border-amber-400/40 bg-amber-500/10 text-amber-100';
    case 'valid':
      return 'border-emerald-400/40 bg-emerald-500/10 text-emerald-100';
    default:
      return 'border-cyber-line bg-cyber-bg/70 text-cyber-text';
  }
}

function getWhoisTone(whoisStatus: ScanResponse['whois']['whoisStatus']) {
  switch (whoisStatus) {
    case 'available':
      return 'border-emerald-400/40 bg-emerald-500/10 text-emerald-100';
    case 'private':
      return 'border-amber-400/40 bg-amber-500/10 text-amber-100';
    default:
      return 'border-cyber-line bg-cyber-bg/70 text-cyber-text';
  }
}

function getNmapTone(nmapStatus: ScanResponse['nmap']['nmapStatus']) {
  switch (nmapStatus) {
    case 'success':
      return 'border-emerald-400/40 bg-emerald-500/10 text-emerald-100';
    case 'error':
      return 'border-amber-400/40 bg-amber-500/10 text-amber-100';
    default:
      return 'border-cyber-line bg-cyber-bg/70 text-cyber-text';
  }
}

export default function Scanner() {
  const [url, setUrl] = useState('');
  const [scanResult, setScanResult] = useState<ScanResponse | null>(null);
  const [status, setStatus] = useState('Ready to scan a target URL.');
  const [error, setError] = useState('');
  const [isScanning, setIsScanning] = useState(false);

  // ZAP Scan State
  const [isZapScanning, setIsZapScanning] = useState(false);
  const [zapProgress, setZapProgress] = useState(0);
  const [zapAlerts, setZapAlerts] = useState<ZapAlert[] | null>(null);
  const [zapOverview, setZapOverview] = useState<ZapOverview | null>(null);

  // Scan type selection
  const [scanType, setScanType] = useState<'combined' | 'regular' | 'zap'>('combined');

  // AI Analysis state
  const [aiAnalysis, setAiAnalysis] = useState<string | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisError, setAnalysisError] = useState('');

  // VAPT Report state
  const [vaptReport, setVaptReport] = useState<VaptReportData | null>(null);
  const [isGeneratingVapt, setIsGeneratingVapt] = useState(false);
  const [vaptError, setVaptError] = useState('');
  const [vaptToast, setVaptToast] = useState(false);

  const handleZapScan = async () => {
    const targetUrl = url.trim();

    if (!targetUrl) {
      setError('Enter a URL before starting a ZAP scan.');
      return;
    }

    // ZAP endpoints are protected — get the session token upfront
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      setError('You must be signed in to run a ZAP scan.');
      return;
    }
    const token = session.access_token;
    const authHeaders = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    };

    setIsZapScanning(true);
    setZapProgress(0);
    setZapAlerts(null);
    setZapOverview(null);
    setStatus('Initializing OWASP ZAP scan...');

    try {
      // 1. Start Scan
      const startRes = await fetch(`${ZAP_API_BASE}/zap/start`, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({ url: targetUrl }),
      });
      const startData = await startRes.json();

      if (!startData.success) {
        throw new Error(startData.error || 'Failed to start ZAP scan');
      }

      const scanId = startData.scanId;
      setStatus('ZAP scan running. Polling progress...');

      // 2. Poll Status — stop after 3 minutes (90 polls × 2s) or when done
      const MAX_POLLS = 90;
      let pollCount = 0;

      const fetchAlerts = async () => {
        setStatus('ZAP scan complete. Fetching alerts...');
        const alertsRes = await fetch(
          `${ZAP_API_BASE}/zap/alerts?url=${encodeURIComponent(targetUrl)}`,
          { headers: authHeaders },
        );
        const alertsData = await alertsRes.json();
        if (alertsData.success) {
          setZapAlerts(alertsData.alerts);
          setZapOverview(alertsData.overview ?? null);
          setStatus('ZAP alerts retrieved successfully.');
        } else {
          throw new Error(alertsData.error || 'Failed to fetch ZAP alerts');
        }
        setIsZapScanning(false);
      };

      const pollInterval = setInterval(async () => {
        try {
          pollCount++;

          // Timeout guard — fetch whatever alerts ZAP has so far
          if (pollCount >= MAX_POLLS) {
            clearInterval(pollInterval);
            setStatus('ZAP scan timed out. Fetching partial results...');
            await fetchAlerts();
            return;
          }

          const statusRes = await fetch(`${ZAP_API_BASE}/zap/status/${scanId}`, {
            headers: authHeaders,
          });
          const statusData = await statusRes.json();
          
          if (statusData.success) {
            setZapProgress(statusData.status);
            
            if (statusData.status >= 100) {
              clearInterval(pollInterval);
              await fetchAlerts();
            }
          }
        } catch (pollErr) {
          console.error('Error polling ZAP status:', pollErr);
          clearInterval(pollInterval);
          setIsZapScanning(false);
          setStatus('ZAP scan interrupted.');
        }
      }, 2000);

    } catch (err) {
      setError(err instanceof Error ? err.message : 'ZAP scan request failed.');
      setIsZapScanning(false);
      setStatus('ZAP scan failed.');
    }
  };

  const handleRegularScan = async () => {
    const targetUrl = url.trim();

    if (!targetUrl) {
      setError('Enter a URL before starting a scan.');
      setScanResult(null);
      setStatus('Waiting for a valid target.');
      return;
    }

    setIsScanning(true);
    setError('');
    setStatus('Sending scan request to the backend.');

    try {
      const result = await scanTargetUrl(targetUrl);
      setScanResult(result);
      setStatus(result.message);

      // Save to Supabase if user is authenticated
      const { data: { session } } = await supabase.auth.getSession();
      if (session) {
        const { error: dbError } = await supabase.from('scans').insert({
          user_id: session.user.id,
          target_url: targetUrl,
          status: result.status,
          upstream_status: result.upstreamStatus,
          headers: result.headers,
          whois: result.whois,
          certificate: result.certificate,
          nmap: result.nmap,
        });

        if (dbError) {
          console.error('Failed to save scan to history:', dbError);
        }
      }
    } catch (caughtError) {
      const message = caughtError instanceof Error ? caughtError.message : 'Scan request failed.';
      setError(message);
      setScanResult(null);
      setStatus('The scan request failed.');
    } finally {
      setIsScanning(false);
    }
  };

  const handleScan = async () => {
    // Clear previous AI analysis and VAPT report when starting a new scan
    setAiAnalysis(null);
    setAnalysisError('');
    setVaptReport(null);
    setVaptError('');
    setVaptToast(false);
    
    if (scanType === 'combined') {
      // Run both scans
      setStatus('Running combined scan...');
      await handleRegularScan();
      await handleZapScan();
    } else if (scanType === 'regular') {
      await handleRegularScan();
    } else if (scanType === 'zap') {
      await handleZapScan();
    }
  };

  const generateAIAnalysis = async () => {
    if (!scanResult && !zapAlerts) {
      setAnalysisError('No scan data available to analyze. Run a scan first.');
      return;
    }

    setIsAnalyzing(true);
    setAnalysisError('');
    setAiAnalysis(null);

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        setAnalysisError('You must be signed in to use AI analysis.');
        return;
      }

      const summary = await callAiSummary(scanResult, zapAlerts, zapOverview, session.access_token);
      setAiAnalysis(summary);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'AI analysis failed.';
      setAnalysisError(message);
      console.error('AI Analysis Error:', err);
    } finally {
      setIsAnalyzing(false);
    }
  };

  // ── VAPT Report ──────────────────────────────────────────────────────────

  const generateVaptReport = async () => {
    if (!scanResult && !zapAlerts) {
      setVaptError('Run a scan first before generating a VAPT report.');
      return;
    }

    setIsGeneratingVapt(true);
    setVaptError('');
    setVaptReport(null);

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        setVaptError('You must be signed in to generate a VAPT report.');
        return;
      }

      const parsed = await callAiVaptReport(scanResult, zapAlerts, session.access_token) as Omit<VaptReportData, 'targetUrl' | 'scanDate' | 'methodology' | 'scanResult' | 'zapAlerts' | 'aiSummary'>;

      setVaptReport({
        targetUrl:        scanResult?.targetUrl ?? zapAlerts?.[0]?.url ?? url,
        scanDate:         new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' }),
        methodology:      'Passive black-box reconnaissance — no exploitation or authenticated testing.',
        executiveSummary: parsed.executiveSummary,
        totalFindings:    parsed.totalFindings,
        findings:         parsed.findings,
        scanResult:       scanResult,
        zapAlerts:        zapAlerts,
        aiSummary:        aiAnalysis,
      });

      // Show toast — auto-dismiss after 4s
      setVaptToast(true);
      setTimeout(() => setVaptToast(false), 4000);
    } catch (err) {
      setVaptError(err instanceof Error ? err.message : 'VAPT report generation failed.');
      console.error('VAPT generation error:', err);
    } finally {
      setIsGeneratingVapt(false);
    }
  };

  const handlePrint = () => {
    if (!vaptReport) return;

    // Build a fully self-contained HTML document and write it into a hidden
    // iframe. The iframe's contentWindow.print() prints only that document,
    // with no timing issues and no interaction with the dark-themed main page.
    const html = buildPrintHtml(vaptReport);

    const iframe = document.createElement('iframe');
    iframe.style.position = 'fixed';
    iframe.style.inset = '0';
    iframe.style.width = '0';
    iframe.style.height = '0';
    iframe.style.border = 'none';
    iframe.style.opacity = '0';
    iframe.style.pointerEvents = 'none';
    document.body.appendChild(iframe);

    const doc = iframe.contentDocument ?? iframe.contentWindow?.document;
    if (!doc) {
      document.body.removeChild(iframe);
      return;
    }

    doc.open();
    doc.write(html);
    doc.close();

    // Wait for the iframe to fully render before printing
    iframe.onload = () => {
      iframe.contentWindow?.focus();
      iframe.contentWindow?.print();
      // Remove the iframe after the print dialog closes
      setTimeout(() => {
        document.body.removeChild(iframe);
      }, 1000);
    };
  };

  return (
    <div className="mx-auto flex min-h-[calc(100vh-4rem)] w-full max-w-[90rem] flex-col gap-8 px-4 py-8 sm:px-6 lg:px-8">
      {/* Scan Input Section */}
      <div className="w-full rounded-[2rem] border border-cyber-line bg-cyber-panel/90 p-6 shadow-glow lg:p-8">
        <div className="max-w-3xl">
          <p className="text-sm uppercase tracking-[0.3em] text-cyber-accent">Scanner</p>
          <h1 className="mt-2 text-3xl font-black tracking-tight text-cyber-text sm:text-4xl">
            AI-powered vulnerability scanner
          </h1>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-cyber-muted sm:text-base">
            Enter a URL below and select the scan type. Combined scan runs both regular and OWASP ZAP scans for comprehensive security analysis.
          </p>
          <form
            className="mt-8 space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              void handleScan();
            }}
          >
            <label htmlFor="url" className="block text-sm font-medium text-cyber-text">
              Target URL
            </label>
            <input
              id="url"
              type="url"
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              placeholder="https://example.com"
              className="w-full rounded-2xl border border-cyber-line bg-cyber-bg/80 px-4 py-3 text-sm text-cyber-text outline-none transition placeholder:text-cyber-muted focus:border-cyber-accent focus:ring-2 focus:ring-cyber-accent/30"
            />
            
            <div className="space-y-3">
              <label htmlFor="scanType" className="block text-sm font-medium text-cyber-text">
                Scan Type
              </label>
              <select
                id="scanType"
                value={scanType}
                onChange={(e) => setScanType(e.target.value as 'combined' | 'regular' | 'zap')}
                className="w-full rounded-2xl border border-cyber-line bg-cyber-bg/80 px-4 py-3 text-sm text-cyber-text outline-none transition focus:border-cyber-accent focus:ring-2 focus:ring-cyber-accent/30"
              >
                <option value="combined">Combined (Regular + OWASP ZAP)</option>
                <option value="regular">Regular Scan Only</option>
                <option value="zap">OWASP ZAP Only</option>
              </select>
            </div>

            <button
              type="submit"
              disabled={isScanning || isZapScanning}
              className="inline-flex items-center justify-center rounded-full bg-cyber-accent px-8 py-3 text-sm font-semibold text-cyber-bg transition duration-200 hover:bg-cyber-accentSoft hover:shadow-glow focus:outline-none focus:ring-2 focus:ring-cyber-accent focus:ring-offset-2 focus:ring-offset-cyber-bg disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isScanning || isZapScanning
                ? scanType === 'combined'
                  ? 'Running Combined Scan...'
                  : scanType === 'zap'
                    ? `ZAP Scanning (${zapProgress}%)`
                    : 'Scanning...'
                : scanType === 'combined'
                  ? 'Run Combined Scan'
                  : scanType === 'zap'
                    ? 'Run ZAP Scan'
                    : 'Run Regular Scan'}
            </button>
          </form>

          <div className="mt-6 rounded-3xl border border-cyber-accent/20 bg-cyber-bg/70 p-4 text-sm text-cyber-text">
            <span className="font-semibold text-cyber-accent">Status: </span>
            {status}
            {error ? <p className="mt-2 text-sm text-red-300">{error}</p> : null}
          </div>
        </div>
      </div>

      {/* Results Section - Full Width Tiles Grid */}
      <div className="w-full space-y-8">
        {/* AI Analysis & VAPT Report buttons — shown when we have scan results */}
        {(scanResult || zapAlerts) && (
          <div className="rounded-[2rem] border border-cyber-accent/40 bg-gradient-to-br from-cyber-panel/90 to-cyber-panelAlt/80 p-6 shadow-glow">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <h2 className="text-xl font-black tracking-tight text-cyber-text">AI-Powered Reports</h2>
                <p className="mt-1 text-sm text-cyber-muted">
                  Generate an executive summary or a full VAPT-format report from scan data
                </p>
              </div>

              {/* Buttons */}
              <div className="flex flex-wrap gap-3">
                {/* Quick AI Analysis */}
                <button
                  onClick={() => void generateAIAnalysis()}
                  disabled={isAnalyzing || isGeneratingVapt}
                  className="inline-flex items-center justify-center rounded-full border border-cyber-accent/60 bg-cyber-bg/60 px-5 py-2.5 text-sm font-semibold text-cyber-accent transition duration-200 hover:bg-cyber-accent/10 hover:shadow-glow focus:outline-none focus:ring-2 focus:ring-cyber-accent disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isAnalyzing ? (
                    <>
                      <svg className="animate-spin -ml-1 mr-2 h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                      </svg>
                      Analyzing…
                    </>
                  ) : (
                    <>
                      <svg className="mr-2 h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                      </svg>
                      Quick AI Summary
                    </>
                  )}
                </button>

                {/* Full VAPT Report */}
                <button
                  onClick={() => void generateVaptReport()}
                  disabled={isAnalyzing || isGeneratingVapt}
                  className="inline-flex items-center justify-center rounded-full bg-gradient-to-r from-cyber-accent to-cyber-accentSoft px-6 py-2.5 text-sm font-semibold text-cyber-bg transition duration-200 hover:shadow-glow focus:outline-none focus:ring-2 focus:ring-cyber-accent disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isGeneratingVapt ? (
                    <>
                      <svg className="animate-spin -ml-1 mr-2 h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                      </svg>
                      Generating Report…
                    </>
                  ) : (
                    <>
                      <svg className="mr-2 h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                      </svg>
                      Generate VAPT Report
                    </>
                  )}
                </button>
              </div>
            </div>

            {/* Quick AI Summary output */}
            {analysisError && (
              <div className="mt-4 rounded-2xl border border-red-500/40 bg-red-500/10 p-4">
                <p className="text-sm text-red-300">{analysisError}</p>
              </div>
            )}
            {aiAnalysis && (
              <div className="mt-6 rounded-2xl border border-cyber-accent/20 bg-black/20 overflow-hidden">
                {/* Header bar */}
                <div className="flex items-center gap-2 border-b border-white/10 bg-cyber-accent/10 px-5 py-3">
                  <svg className="h-3.5 w-3.5 text-cyber-accent" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                  </svg>
                  <span className="text-xs font-bold uppercase tracking-[0.3em] text-cyber-accent">Quick Summary</span>
                </div>

                {/* Content */}
                <div
                  className="px-5 py-5 text-sm leading-7 text-cyber-text
                    [&_h1]:text-lg [&_h1]:font-black [&_h1]:text-cyber-accent [&_h1]:mt-5 [&_h1]:mb-2 [&_h1]:first:mt-0
                    [&_h2]:text-base [&_h2]:font-bold [&_h2]:text-cyber-accent [&_h2]:mt-5 [&_h2]:mb-2 [&_h2]:first:mt-0
                    [&_h3]:text-sm [&_h3]:font-semibold [&_h3]:text-cyber-accent [&_h3]:mt-4 [&_h3]:mb-1.5
                    [&_p]:text-cyber-text [&_p]:leading-7 [&_p]:mb-0
                    [&_ul]:mt-2 [&_ul]:mb-0 [&_ul]:space-y-1.5 [&_ul]:pl-0 [&_ul]:list-none
                    [&_li]:flex [&_li]:items-start [&_li]:gap-2.5 [&_li]:text-cyber-muted
                    [&_li]:before:content-['›'] [&_li]:before:text-cyber-accent [&_li]:before:font-bold [&_li]:before:shrink-0 [&_li]:before:mt-0.5
                    [&_strong]:text-cyber-text [&_strong]:font-semibold
                    [&_code]:rounded [&_code]:bg-cyber-accent/10 [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:text-xs [&_code]:font-mono [&_code]:text-cyber-accent
                    [&_hr]:border-white/10 [&_hr]:my-4"
                  dangerouslySetInnerHTML={{ __html: formatMarkdown(aiAnalysis) }}
                />
              </div>
            )}

            {/* VAPT Report error */}
            {vaptError && (
              <div className="mt-4 rounded-2xl border border-red-500/40 bg-red-500/10 p-4">
                <p className="text-sm text-red-300">{vaptError}</p>
              </div>
            )}
          </div>
        )}

        {/* Regular Scan Results */}
        {scanResult && (
          <div className="rounded-[2rem] border border-cyber-line bg-cyber-panel/90 p-6 shadow-glow lg:p-8">
            <h2 className="text-2xl font-black tracking-tight text-cyber-text mb-6">Regular Scan Results</h2>
            
            <div className="grid gap-6 lg:grid-cols-2 xl:grid-cols-3">
              {/* Summary Card */}
              <div className="rounded-2xl border border-cyber-line bg-cyber-panelAlt/80 p-5 xl:col-span-3 lg:col-span-2">
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                  <div>
                    <p className="text-xs uppercase tracking-[0.25em] text-cyber-muted">Status</p>
                    <p className="mt-2 text-lg font-semibold text-cyber-text">{scanResult.status}</p>
                  </div>
                  <div>
                    <p className="text-xs uppercase tracking-[0.25em] text-cyber-muted">HTTP Status</p>
                    <p className="mt-2 text-lg font-semibold text-cyber-text">{scanResult.upstreamStatus ?? 'N/A'}</p>
                  </div>
                  <div className="sm:col-span-2">
                    <p className="text-xs uppercase tracking-[0.25em] text-cyber-muted">Target</p>
                    <p className="mt-2 text-sm text-cyber-text break-all">{scanResult.targetUrl}</p>
                  </div>
                </div>
              </div>

              {/* SSL Certificate Card */}
              <article
                className={`rounded-2xl border p-5 ${getCertificateTone(
                  scanResult.certificate.expiryStatus,
                )}`}
              >
                <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
                  <div>
                    <p className="text-xs uppercase tracking-[0.25em] opacity-70">SSL Certificate</p>
                    <h3 className="mt-1 text-lg font-semibold">Certificate</h3>
                  </div>
                  <span className="rounded-full border border-current/20 px-2 py-0.5 text-xs uppercase tracking-[0.2em] opacity-80">
                    {scanResult.certificate.expiryStatus}
                  </span>
                </div>

                <div className="space-y-3">
                  <div>
                    <p className="text-xs uppercase tracking-[0.2em] opacity-70">Issuer</p>
                    <p className="mt-1 text-sm">{scanResult.certificate.issuer}</p>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <p className="text-xs uppercase tracking-[0.2em] opacity-70">TLS Version</p>
                      <p className="mt-1 text-sm">{scanResult.certificate.tlsVersion ?? 'N/A'}</p>
                    </div>
                    <div>
                      <p className="text-xs uppercase tracking-[0.2em] opacity-70">Days Left</p>
                      <p className="mt-1 text-xl font-black">{scanResult.certificate.daysRemaining ?? 'N/A'}</p>
                    </div>
                  </div>
                  <div>
                    <p className="text-xs uppercase tracking-[0.2em] opacity-70">Expiry</p>
                    <p className="mt-1 text-sm">{scanResult.certificate.expiryDate ?? 'N/A'}</p>
                  </div>
                </div>
              </article>

              {/* WHOIS Card */}
              <article className={`rounded-2xl border p-5 ${getWhoisTone(scanResult.whois.whoisStatus)}`}>
                <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
                  <div>
                    <p className="text-xs uppercase tracking-[0.25em] opacity-70">WHOIS</p>
                    <h3 className="mt-1 text-lg font-semibold">Domain Info</h3>
                  </div>
                  <span className="rounded-full border border-current/20 px-2 py-0.5 text-xs uppercase tracking-[0.2em] opacity-80">
                    {scanResult.whois.whoisStatus}
                  </span>
                </div>

                <div className="space-y-3">
                  <div>
                    <p className="text-xs uppercase tracking-[0.2em] opacity-70">Registrar</p>
                    <p className="mt-1 text-sm">{scanResult.whois.registrar}</p>
                  </div>
                  <div>
                    <p className="text-xs uppercase tracking-[0.2em] opacity-70">Organization</p>
                    <p className="mt-1 text-sm">{scanResult.whois.organization}</p>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <p className="text-xs uppercase tracking-[0.2em] opacity-70">Created</p>
                      <p className="mt-1 text-xs">{scanResult.whois.creationDate ? new Date(scanResult.whois.creationDate).toLocaleDateString() : 'N/A'}</p>
                    </div>
                    <div>
                      <p className="text-xs uppercase tracking-[0.2em] opacity-70">Expires</p>
                      <p className="mt-1 text-xs">{scanResult.whois.expiryDate ? new Date(scanResult.whois.expiryDate).toLocaleDateString() : 'N/A'}</p>
                    </div>
                  </div>
                </div>
              </article>

              {/* Nmap Card */}
              <article className={`rounded-2xl border p-5 ${getNmapTone(scanResult.nmap.nmapStatus)}`}>
                <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
                  <div>
                    <p className="text-xs uppercase tracking-[0.25em] opacity-70">Port Scan</p>
                    <h3 className="mt-1 text-lg font-semibold">Open Ports</h3>
                  </div>
                  <span className="rounded-full border border-current/20 px-2 py-0.5 text-xs uppercase tracking-[0.2em] opacity-80">
                    {scanResult.nmap.nmapStatus}
                  </span>
                </div>

                {scanResult.nmap.ports.length > 0 ? (
                  <div className="space-y-2">
                    {scanResult.nmap.ports.slice(0, 5).map((entry) => (
                      <div key={`${entry.protocol}-${entry.port}`} className="rounded-xl border border-white/10 bg-black/10 p-2">
                        <div className="flex justify-between items-start">
                          <div>
                            <p className="text-sm font-mono font-semibold">{entry.port}/{entry.protocol}</p>
                            <p className="text-xs opacity-70">{entry.service}</p>
                          </div>
                          <span className="text-xs rounded-full px-2 py-0.5 bg-white/10">{entry.state}</span>
                        </div>
                      </div>
                    ))}
                    {scanResult.nmap.ports.length > 5 && (
                      <p className="text-xs text-center opacity-70 pt-2">+ {scanResult.nmap.ports.length - 5} more ports</p>
                    )}
                  </div>
                ) : (
                  <p className="text-sm opacity-70">No open ports detected</p>
                )}
              </article>

              {/* Security Headers */}
              <div className="xl:col-span-3 lg:col-span-2">
                <h3 className="text-lg font-semibold text-cyber-text mb-4">Security Headers</h3>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {scanResult.headers.map((headerReport) => (
                    <article
                      key={headerReport.header}
                      className="rounded-2xl border border-cyber-line bg-cyber-bg/70 p-4"
                    >
                      <div className="flex items-start justify-between gap-2 mb-2">
                        <h4 className="text-sm font-semibold text-cyber-text">{headerReport.header}</h4>
                        <span className={`shrink-0 rounded-full px-2 py-0.5 text-[0.65rem] uppercase tracking-wider ${
                          headerReport.status === 'Present' 
                            ? 'bg-emerald-500/20 text-emerald-300' 
                            : 'bg-red-500/20 text-red-300'
                        }`}>
                          {headerReport.status}
                        </span>
                      </div>
                      <p className="text-xs text-cyber-muted line-clamp-2">{headerReport.recommendation}</p>
                    </article>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ZAP Results */}
        {zapAlerts && (
          <div className="rounded-[2rem] border border-cyber-line bg-cyber-panel/90 p-6 shadow-glow lg:p-8">
            <h2 className="text-2xl font-black tracking-tight text-cyber-text mb-6">OWASP ZAP Results</h2>
            <ZapAlerts alerts={zapAlerts} overview={zapOverview} />
          </div>
        )}

        {/* ZAP Scanning Progress */}
        {isZapScanning && !zapAlerts && (
          <div className="rounded-[2rem] border border-cyber-line bg-cyber-panel/90 p-6 shadow-glow lg:p-8">
            <h2 className="text-2xl font-black tracking-tight text-cyber-text mb-6">OWASP ZAP Scan</h2>
            <div className="max-w-2xl mx-auto">
              <div className="flex justify-between text-sm font-semibold text-cyber-muted mb-2">
                <span>Spider Scan Progress</span>
                <span>{zapProgress}%</span>
              </div>
              <div className="w-full bg-black/40 rounded-full h-4 border border-white/10 overflow-hidden">
                <div className="bg-cyber-accent h-4 rounded-full transition-all duration-500 ease-out shadow-[0_0_10px_#4ade80]" style={{ width: `${zapProgress}%` }}></div>
              </div>
              <p className="text-center text-sm text-cyber-muted mt-4">{status}</p>
            </div>
          </div>
        )}

        {/* Empty State */}
        {!scanResult && !zapAlerts && !isScanning && !isZapScanning && (
          <div className="rounded-[2rem] border border-dashed border-cyber-line bg-cyber-panel/60 p-12 text-center">
            <p className="text-lg font-semibold text-cyber-text mb-2">No scan results yet</p>
            <p className="text-sm text-cyber-muted">Enter a target URL and select a scan type to begin</p>
          </div>
        )}

        {/* VAPT Report — rendered below all other results */}
        {vaptReport && (
          <VaptReport report={vaptReport} onPrint={handlePrint} autoScroll />
        )}
      </div>

      {/* Toast — fixed bottom-right, auto-dismisses */}
      {vaptToast && (
        <div
          role="alert"
          className="fixed bottom-6 right-6 z-50 flex items-center gap-3 rounded-2xl border border-cyber-accent/40 bg-cyber-panel/95 px-5 py-4 shadow-glow backdrop-blur-sm animate-fade-in"
        >
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-cyber-accent/20 text-cyber-accent">
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
            </svg>
          </span>
          <div>
            <p className="text-sm font-semibold text-cyber-text">VAPT Report Generated</p>
            <p className="text-xs text-cyber-muted">Scrolling to report&hellip;</p>
          </div>
          <button
            onClick={() => setVaptToast(false)}
            className="ml-2 text-cyber-muted hover:text-cyber-text transition"
            aria-label="Dismiss"
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      )}
    </div>
  );
}
