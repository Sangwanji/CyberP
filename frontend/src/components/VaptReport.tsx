import { useRef, useEffect } from 'react';
import type { ScanResponse } from '../types/scan';
import type { ZapAlert } from './ZapAlerts';

// ─── Public types ─────────────────────────────────────────────────────────────

export interface VaptFinding {
  id: string;
  title: string;
  owasp: string;
  riskLevel: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | 'INFORMATIONAL';
  description: string;
  evidence: string;
  impact: string;
  remediation: string;
}

export interface VaptReportData {
  targetUrl: string;
  scanDate: string;
  methodology: string;
  executiveSummary: string;
  totalFindings: {
    critical: number;
    high: number;
    medium: number;
    low: number;
    informational: number;
  };
  findings: VaptFinding[];
  // Full scan data for detailed sections
  scanResult: ScanResponse | null;
  zapAlerts: ZapAlert[] | null;
  // AI quick summary markdown (optional — may not be generated yet)
  aiSummary: string | null;
}

interface VaptReportProps {
  report: VaptReportData;
  onPrint: () => void;
  autoScroll?: boolean;
}

// ─── Risk config ──────────────────────────────────────────────────────────────

const RISK_CFG: Record<
  VaptFinding['riskLevel'],
  { screenBadge: string; screenBorder: string; printBg: string; printColor: string }
> = {
  CRITICAL:      { screenBadge: 'bg-red-600 text-white',    screenBorder: 'border-l-red-500',    printBg: '#c0392b', printColor: '#fff' },
  HIGH:          { screenBadge: 'bg-orange-500 text-white', screenBorder: 'border-l-orange-500', printBg: '#e67e22', printColor: '#fff' },
  MEDIUM:        { screenBadge: 'bg-amber-400 text-black',  screenBorder: 'border-l-amber-400',  printBg: '#f39c12', printColor: '#000' },
  LOW:           { screenBadge: 'bg-yellow-300 text-black', screenBorder: 'border-l-yellow-300', printBg: '#95a5a6', printColor: '#fff' },
  INFORMATIONAL: { screenBadge: 'bg-blue-500 text-white',   screenBorder: 'border-l-blue-400',   printBg: '#2980b9', printColor: '#fff' },
};

const BORDER_COLOR: Record<VaptFinding['riskLevel'], string> = {
  CRITICAL:      '#c0392b',
  HIGH:          '#e67e22',
  MEDIUM:        '#f39c12',
  LOW:           '#95a5a6',
  INFORMATIONAL: '#2980b9',
};

const ZAP_RISK_COLOR: Record<string, string> = {
  High:          '#c0392b',
  Medium:        '#e67e22',
  Low:           '#f39c12',
  Informational: '#2980b9',
};

// ─── Escape helper ────────────────────────────────────────────────────────────

function esc(s: string | null | undefined): string {
  if (!s) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ─── Markdown → HTML (for AI summary display) ────────────────────────────────

function formatMarkdownForReport(markdown: string): string {
  const lines = markdown.split('\n');
  const out: string[] = [];
  let inList = false;
  const closeList = () => { if (inList) { out.push('</ul>'); inList = false; } };
  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    if (!line.trim()) { closeList(); continue; }
    if (/^### (.+)/.test(line)) { closeList(); out.push(`<h3>${applyInline(line.replace(/^### /, ''))}</h3>`); continue; }
    if (/^## (.+)/.test(line))  { closeList(); out.push(`<h2>${applyInline(line.replace(/^## /, ''))}</h2>`); continue; }
    if (/^# (.+)/.test(line))   { closeList(); out.push(`<h1>${applyInline(line.replace(/^# /, ''))}</h1>`); continue; }
    if (/^[-*] (.+)/.test(line))   { if (!inList) { out.push('<ul>'); inList = true; } out.push(`<li>${applyInline(line.replace(/^[-*] /, ''))}</li>`); continue; }
    if (/^\d+\. (.+)/.test(line)) { if (!inList) { out.push('<ul>'); inList = true; } out.push(`<li>${applyInline(line.replace(/^\d+\. /, ''))}</li>`); continue; }
    if (/^---+$/.test(line.trim())) { closeList(); out.push('<hr />'); continue; }
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

// ─────────────────────────────────────────────────────────────────────────────
// buildPrintHtml — fully self-contained HTML for browser print-to-PDF
// ─────────────────────────────────────────────────────────────────────────────

export function buildPrintHtml(report: VaptReportData): string {
  const { scanResult, zapAlerts } = report;

  const total =
    report.totalFindings.critical +
    report.totalFindings.high +
    report.totalFindings.medium +
    report.totalFindings.low +
    report.totalFindings.informational;

  // ── VAPT findings ──
  const findingsHtml = report.findings.map((f) => {
    const borderColor = BORDER_COLOR[f.riskLevel];
    const cfg = RISK_CFG[f.riskLevel];
    return `
      <div class="finding" style="border-left:4px solid ${borderColor}">
        <div class="fhdr">
          <div class="fhdr-left">
            <span class="fid">${esc(f.id)}</span>
            <span class="ftitle">${esc(f.title)}</span>
            <span class="fowasp">${esc(f.owasp)}</span>
          </div>
          <span class="badge" style="background:${cfg.printBg};color:${cfg.printColor}">${esc(f.riskLevel)}</span>
        </div>
        <table class="fbody">
          <tbody>
            <tr><th>Description</th><td>${esc(f.description)}</td></tr>
            <tr><th>Evidence</th><td class="mono">${esc(f.evidence)}</td></tr>
            <tr><th>Impact</th><td>${esc(f.impact)}</td></tr>
            <tr><th>Remediation</th><td><strong>${esc(f.remediation)}</strong></td></tr>
          </tbody>
        </table>
      </div>`;
  }).join('');

  // ── Security headers section ──
  let headersHtml = '';
  if (scanResult?.headers?.length) {
    const rows = scanResult.headers.map((h) => {
      const statusColor = h.status === 'Present' ? '#27ae60' : '#c0392b';
      const sevColor = h.severity === 'high' ? '#c0392b' : h.severity === 'medium' ? '#e67e22' : '#27ae60';
      return `<tr>
        <td class="mono" style="font-size:8pt">${esc(h.header)}</td>
        <td style="color:${statusColor};font-weight:700">${esc(h.status)}</td>
        <td style="color:${sevColor};text-transform:uppercase;font-size:7.5pt;font-weight:700">${esc(h.severity)}</td>
        <td style="font-size:8pt">${esc(h.recommendation)}</td>
      </tr>`;
    }).join('');
    headersHtml = `
      <h2>Security Headers</h2>
      <table class="data-table">
        <thead><tr><th>Header</th><th>Status</th><th>Severity</th><th>Recommendation</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>`;
  }

  // ── SSL/TLS section ──
  let sslHtml = '';
  if (scanResult?.certificate) {
    const c = scanResult.certificate;
    const statusColor = c.expiryStatus === 'valid' ? '#27ae60' : c.expiryStatus === 'expiring-soon' ? '#e67e22' : '#c0392b';
    sslHtml = `
      <h2>SSL / TLS Certificate</h2>
      <table class="meta">
        <tbody>
          <tr><th>Issuer</th><td>${esc(c.issuer)}</td></tr>
          <tr><th>Valid From</th><td>${esc(c.validFrom ?? 'N/A')}</td></tr>
          <tr><th>Expiry Date</th><td>${esc(c.expiryDate ?? 'N/A')}</td></tr>
          <tr><th>Days Remaining</th><td>${c.daysRemaining !== null ? c.daysRemaining : 'N/A'}</td></tr>
          <tr><th>TLS Version</th><td>${esc(c.tlsVersion ?? 'N/A')}</td></tr>
          <tr><th>Status</th><td style="color:${statusColor};font-weight:700;text-transform:uppercase">${esc(c.expiryStatus)}</td></tr>
          <tr><th>Note</th><td>${esc(c.note)}</td></tr>
        </tbody>
      </table>`;
  }

  // ── WHOIS / Domain section ──
  let whoisHtml = '';
  if (scanResult?.whois) {
    const w = scanResult.whois;
    whoisHtml = `
      <h2>Domain Information (WHOIS)</h2>
      <table class="meta">
        <tbody>
          <tr><th>Registrar</th><td>${esc(w.registrar)}</td></tr>
          <tr><th>Organization</th><td>${esc(w.organization)}</td></tr>
          <tr><th>Created</th><td>${esc(w.creationDate ? new Date(w.creationDate).toDateString() : 'N/A')}</td></tr>
          <tr><th>Expires</th><td>${esc(w.expiryDate ? new Date(w.expiryDate).toDateString() : 'N/A')}</td></tr>
          <tr><th>Last Updated</th><td>${esc(w.updatedDate ? new Date(w.updatedDate).toDateString() : 'N/A')}</td></tr>
          <tr><th>Name Servers</th><td class="mono">${esc(w.nameServers.join(', ') || 'N/A')}</td></tr>
          <tr><th>WHOIS Status</th><td style="text-transform:uppercase;font-weight:700">${esc(w.whoisStatus)}</td></tr>
        </tbody>
      </table>`;
  }

  // ── Port scan section ──
  let nmapHtml = '';
  if (scanResult?.nmap) {
    const n = scanResult.nmap;
    const portsHtml = n.ports.length
      ? n.ports.map((p) => `<tr>
          <td style="font-weight:700">${p.port}</td>
          <td style="text-transform:uppercase">${esc(p.protocol)}</td>
          <td>${esc(p.state)}</td>
          <td>${esc(p.service)}</td>
          <td class="mono" style="font-size:8pt">${esc(p.version)}</td>
        </tr>`).join('')
      : '<tr><td colspan="5" style="text-align:center;color:#888">No open ports detected</td></tr>';

    nmapHtml = `
      <h2>Port Scan Results</h2>
      <p style="font-size:8.5pt;color:#555;margin-bottom:8pt">${esc(n.note)}</p>
      <table class="data-table">
        <thead><tr><th>Port</th><th>Protocol</th><th>State</th><th>Service</th><th>Version</th></tr></thead>
        <tbody>${portsHtml}</tbody>
      </table>`;
  }

  // ── ZAP alerts section ──
  let zapHtml = '';
  if (zapAlerts && zapAlerts.length > 0) {
    const alertRows = zapAlerts.map((a) => {
      const riskColor = ZAP_RISK_COLOR[a.risk] ?? '#888';
      return `<tr>
        <td style="font-weight:700;font-size:9pt">${esc(a.alert)}</td>
        <td style="color:${riskColor};font-weight:700;text-transform:uppercase;font-size:8pt">${esc(a.risk)}</td>
        <td style="font-size:8pt">${esc(a.confidence)}</td>
        <td class="mono" style="font-size:7.5pt;word-break:break-all">${esc(a.url)}</td>
        <td style="font-size:7.5pt">${esc(a.cweid ? `CWE-${a.cweid}` : 'N/A')}</td>
      </tr>`;
    }).join('');
    zapHtml = `
      <h2>OWASP ZAP Scan Alerts (${zapAlerts.length})</h2>
      <table class="data-table">
        <thead><tr><th>Alert</th><th>Risk</th><th>Confidence</th><th>URL</th><th>CWE</th></tr></thead>
        <tbody>${alertRows}</tbody>
      </table>`;
  }

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>Security Report — ${esc(report.targetUrl)}</title>
  <style>
    @page { size: A4 portrait; margin: 18mm 14mm 14mm 14mm; }
    *, *::before, *::after { box-sizing: border-box; }
    body {
      margin: 0; padding: 0; background: #fff; color: #111;
      font-family: Arial, Helvetica, sans-serif; font-size: 10pt; line-height: 1.55;
    }

    h1 { font-size: 18pt; font-weight: 900; margin: 0 0 3pt; line-height: 1.2; color: #000; }
    .tagline { font-size: 9pt; color: #555; margin: 0 0 14pt; }
    h2 {
      font-size: 11pt; font-weight: 800; color: #000;
      border-bottom: 2px solid #222; padding-bottom: 3pt;
      margin: 18pt 0 8pt; text-transform: uppercase; letter-spacing: 0.04em;
    }
    p { font-size: 10pt; line-height: 1.6; margin: 0 0 8pt; color: #222; }

    /* Meta table (key-value) */
    table.meta { width: 100%; border-collapse: collapse; margin-bottom: 14pt; font-size: 9.5pt; }
    table.meta th {
      background: #f0f0f0; border: 1px solid #bbb; padding: 5px 9px;
      font-weight: 700; width: 22%; text-align: left; vertical-align: top; color: #333;
    }
    table.meta td { border: 1px solid #bbb; padding: 5px 9px; vertical-align: top; color: #111; word-break: break-all; }

    /* Severity count table */
    table.counts { width: 100%; border-collapse: collapse; margin-bottom: 14pt; }
    table.counts th {
      border: 1px solid #bbb; padding: 5px 8px; background: #f0f0f0;
      font-size: 8.5pt; font-weight: 700; text-align: center; color: #333;
    }
    table.counts td {
      border: 1px solid #bbb; padding: 8px; font-size: 16pt;
      font-weight: 900; text-align: center; color: #111;
    }

    /* Generic data table */
    table.data-table { width: 100%; border-collapse: collapse; margin-bottom: 14pt; font-size: 8.5pt; }
    table.data-table th {
      background: #f0f0f0; border: 1px solid #bbb; padding: 5px 8px;
      font-weight: 700; text-align: left; color: #333; white-space: nowrap;
    }
    table.data-table td { border: 1px solid #ddd; padding: 5px 8px; vertical-align: top; color: #111; }
    table.data-table tr:nth-child(even) td { background: #fafafa; }

    /* Finding blocks */
    .finding { border: 1px solid #ccc; margin-bottom: 12pt; page-break-inside: avoid; border-radius: 2px; }
    .fhdr {
      display: flex; align-items: flex-start; justify-content: space-between;
      gap: 8pt; padding: 6pt 8pt; background: #f7f7f7; border-bottom: 1px solid #ddd;
    }
    .fhdr-left { flex: 1; min-width: 0; }
    .fid { font-family: 'Courier New', monospace; font-size: 8.5pt; font-weight: 700; color: #444; display: block; margin-bottom: 2pt; }
    .ftitle { font-size: 10.5pt; font-weight: 800; color: #000; display: block; margin-bottom: 2pt; line-height: 1.3; }
    .fowasp { font-size: 8pt; color: #666; display: block; }
    .badge {
      flex-shrink: 0; font-size: 7.5pt; font-weight: 900; text-transform: uppercase;
      letter-spacing: 0.1em; padding: 2pt 7pt; border-radius: 2px; white-space: nowrap; margin-top: 2pt;
    }
    table.fbody { width: 100%; border-collapse: collapse; }
    table.fbody th {
      width: 17%; background: #fafafa; border: 1px solid #e0e0e0; padding: 5px 8px;
      font-size: 8pt; font-weight: 700; text-transform: uppercase;
      letter-spacing: 0.06em; vertical-align: top; color: #555; white-space: nowrap;
    }
    table.fbody td { border: 1px solid #e0e0e0; padding: 5px 8px; font-size: 9.5pt; vertical-align: top; color: #111; line-height: 1.5; }

    .mono { font-family: 'Courier New', monospace; font-size: 8.5pt; word-break: break-all; color: #1a1a1a; }
    .mono-cell { font-family: 'Courier New', monospace; }

    .footer {
      margin-top: 20pt; padding-top: 5pt; border-top: 1px solid #ccc;
      font-size: 7.5pt; color: #888; text-align: center;
    }
  </style>
</head>
<body>
  <h1>Security Assessment Report</h1>
  <p class="tagline">CyberP Automated Security Assessment — Passive black-box reconnaissance only</p>

  <table class="meta">
    <tbody>
      <tr><th>Target URL</th><td class="mono-cell">${esc(report.targetUrl)}</td></tr>
      <tr><th>Scan Date</th><td>${esc(report.scanDate)}</td></tr>
      <tr><th>Methodology</th><td>${esc(report.methodology)}</td></tr>
      <tr><th>HTTP Status</th><td>${scanResult?.upstreamStatus ?? 'N/A'}</td></tr>
      <tr><th>Classification</th><td>Confidential — For authorised personnel only</td></tr>
    </tbody>
  </table>

  <h2>Executive Summary</h2>
  <p>${esc(report.executiveSummary)}</p>

  ${report.aiSummary ? `
  <h2>AI Quick Summary</h2>
  <div style="background:#f9f9f9;border:1px solid #ddd;border-left:4px solid #27ae60;padding:10pt 12pt;margin-bottom:14pt;border-radius:2px;font-size:9.5pt;line-height:1.6;color:#111">
    ${report.aiSummary
      .split('\n')
      .map((line) => {
        const l = line.trimEnd();
        if (!l.trim()) return '';
        if (/^### (.+)/.test(l)) return `<h4 style="margin:8pt 0 3pt;font-size:9pt;font-weight:800;text-transform:uppercase;letter-spacing:0.04em">${esc(l.replace(/^### /, ''))}</h4>`;
        if (/^## (.+)/.test(l))  return `<h3 style="margin:10pt 0 4pt;font-size:10pt;font-weight:800">${esc(l.replace(/^## /, ''))}</h3>`;
        if (/^# (.+)/.test(l))   return `<h3 style="margin:10pt 0 4pt;font-size:11pt;font-weight:900">${esc(l.replace(/^# /, ''))}</h3>`;
        if (/^[-*] (.+)/.test(l)) return `<li style="margin-left:14pt;margin-bottom:2pt">${esc(l.replace(/^[-*] /, ''))}</li>`;
        return `<p style="margin:0 0 4pt">${esc(l)
          .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
          .replace(/\*(.+?)\*/g, '<em>$1</em>')
          .replace(/\`(.+?)\`/g, '<code style="font-family:Courier New,monospace;font-size:8pt;background:#eee;padding:1px 3px;border-radius:2px">$1</code>')
        }</p>`;
      })
      .filter(Boolean)
      .join('')}
  </div>` : ''}

  <table class="counts">
    <thead>
      <tr><th>Total</th><th>Critical</th><th>High</th><th>Medium</th><th>Low</th><th>Informational</th></tr>
    </thead>
    <tbody>
      <tr>
        <td>${total}</td>
        <td>${report.totalFindings.critical}</td>
        <td>${report.totalFindings.high}</td>
        <td>${report.totalFindings.medium}</td>
        <td>${report.totalFindings.low}</td>
        <td>${report.totalFindings.informational}</td>
      </tr>
    </tbody>
  </table>

  ${headersHtml}
  ${sslHtml}
  ${whoisHtml}
  ${nmapHtml}
  ${zapHtml}

  <h2>Detailed Findings</h2>
  ${findingsHtml || '<p style="color:#888">No AI-generated findings available.</p>'}

  <div class="footer">
    Generated by CyberP &mdash; ${esc(report.scanDate)} &mdash; ${esc(report.targetUrl)} &mdash; Confidential
  </div>
</body>
</html>`;
}

// ─── Screen component ─────────────────────────────────────────────────────────

export default function VaptReport({ report, onPrint, autoScroll = true }: VaptReportProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const { scanResult, zapAlerts } = report;

  useEffect(() => {
    if (!autoScroll) return;
    const el = rootRef.current;
    if (!el) return;
    const t = setTimeout(() => el.scrollIntoView({ behavior: 'smooth', block: 'start' }), 150);
    return () => clearTimeout(t);
  }, [autoScroll]);

  const total =
    report.totalFindings.critical +
    report.totalFindings.high +
    report.totalFindings.medium +
    report.totalFindings.low +
    report.totalFindings.informational;

  return (
    <div ref={rootRef} id="vapt-report-root" className="space-y-6">

      {/* ── Cover ── */}
      <div className="rounded-[2rem] border border-cyber-accent/40 bg-gradient-to-br from-cyber-panel via-cyber-panelAlt/80 to-cyber-bg p-8 shadow-glow">
        <div className="flex flex-wrap items-start justify-between gap-6">
          <div className="space-y-1">
            <p className="text-xs uppercase tracking-[0.4em] text-cyber-accent">CyberP — Automated Assessment</p>
            <h1 className="text-3xl font-black tracking-tight text-cyber-text sm:text-4xl">Security Report</h1>
            <p className="text-sm text-cyber-muted">Vulnerability Assessment &amp; Penetration Testing</p>
          </div>
          <button
            onClick={onPrint}
            className="inline-flex items-center gap-2 rounded-full border border-cyber-accent/50 bg-cyber-bg/60 px-5 py-2.5 text-sm font-semibold text-cyber-accent transition hover:bg-cyber-accent/10 hover:shadow-glow"
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
            </svg>
            Print / Export PDF
          </button>
        </div>
        <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4 rounded-2xl border border-white/10 bg-black/20 p-4 text-sm">
          {[
            { label: 'Target',      value: report.targetUrl,   mono: true  },
            { label: 'Date',        value: report.scanDate,    mono: false },
            { label: 'HTTP Status', value: scanResult?.upstreamStatus ? String(scanResult.upstreamStatus) : 'N/A', mono: false },
            { label: 'Methodology', value: report.methodology, mono: false },
          ].map(({ label, value, mono }) => (
            <div key={label}>
              <p className="text-xs uppercase tracking-widest text-cyber-muted">{label}</p>
              <p className={`mt-1 break-all text-cyber-text ${mono ? 'font-mono text-xs' : ''}`}>{value}</p>
            </div>
          ))}
        </div>
      </div>

      {/* ── Executive Summary + counts ── */}
      <div className="rounded-[2rem] border border-cyber-line bg-cyber-panel/90 p-6 shadow-glow lg:p-8">
        <h2 className="text-xl font-black text-cyber-text">Executive Summary</h2>
        <p className="mt-4 text-sm leading-7 text-cyber-muted">{report.executiveSummary}</p>
        <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-6">
          <div className="rounded-2xl border border-cyber-line bg-black/20 p-4 text-center">
            <p className="text-2xl font-black text-cyber-text">{total}</p>
            <p className="mt-1 text-[0.6rem] uppercase tracking-widest text-cyber-muted">Total</p>
          </div>
          {(
            [
              { key: 'critical',      label: 'Critical', cls: 'text-red-400' },
              { key: 'high',          label: 'High',     cls: 'text-orange-400' },
              { key: 'medium',        label: 'Medium',   cls: 'text-amber-400' },
              { key: 'low',           label: 'Low',      cls: 'text-yellow-300' },
              { key: 'informational', label: 'Info',     cls: 'text-blue-400' },
            ] as const
          ).map(({ key, label, cls }) => (
            <div key={key} className="rounded-2xl border border-cyber-line bg-black/20 p-4 text-center">
              <p className={`text-2xl font-black ${cls}`}>{report.totalFindings[key]}</p>
              <p className="mt-1 text-[0.6rem] uppercase tracking-widest text-cyber-muted">{label}</p>
            </div>
          ))}
        </div>
      </div>

      {/* ── AI Quick Summary ── */}
      {report.aiSummary && (
        <div className="rounded-[2rem] border border-cyber-accent/30 bg-cyber-panel/90 p-6 shadow-glow lg:p-8">
          <div className="flex items-center gap-3 mb-4">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-cyber-accent/20">
              <svg className="h-4 w-4 text-cyber-accent" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
            </span>
            <h2 className="text-xl font-black text-cyber-text">AI Quick Summary</h2>
            <span className="rounded-full border border-cyber-accent/30 bg-cyber-accent/10 px-2 py-0.5 text-[0.6rem] font-bold uppercase tracking-widest text-cyber-accent">Groq AI</span>
          </div>
          <div
            className="prose-sm text-cyber-muted
              [&_h1]:text-lg [&_h1]:font-black [&_h1]:text-cyber-text [&_h1]:mt-4 [&_h1]:mb-2
              [&_h2]:text-base [&_h2]:font-bold [&_h2]:text-cyber-text [&_h2]:mt-4 [&_h2]:mb-2 [&_h2]:border-b [&_h2]:border-cyber-line [&_h2]:pb-1
              [&_h3]:text-sm [&_h3]:font-bold [&_h3]:text-cyber-accent [&_h3]:mt-3 [&_h3]:mb-1
              [&_p]:leading-7 [&_p]:mb-2
              [&_ul]:mt-1 [&_ul]:mb-3 [&_ul]:pl-5 [&_ul]:space-y-1
              [&_li]:text-sm [&_li]:text-cyber-muted [&_li]:list-disc
              [&_strong]:font-semibold [&_strong]:text-cyber-text
              [&_code]:rounded [&_code]:bg-cyber-accent/10 [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:text-xs [&_code]:font-mono [&_code]:text-cyber-accent
              [&_hr]:border-white/10 [&_hr]:my-4"
            dangerouslySetInnerHTML={{ __html: formatMarkdownForReport(report.aiSummary) }}
          />
        </div>
      )}

      {/* ── Security Headers ── */}
      {scanResult?.headers && scanResult.headers.length > 0 && (
        <div className="rounded-[2rem] border border-cyber-line bg-cyber-panel/90 p-6 shadow-glow lg:p-8">
          <h2 className="text-xl font-black text-cyber-text mb-4">Security Headers</h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {scanResult.headers.map((h) => (
              <div key={h.header} className="rounded-2xl border border-cyber-line bg-cyber-bg/70 p-4">
                <div className="flex items-start justify-between gap-2 mb-2">
                  <p className="text-sm font-semibold text-cyber-text font-mono">{h.header}</p>
                  <span className={`shrink-0 rounded-full px-2 py-0.5 text-[0.65rem] uppercase tracking-wider ${
                    h.status === 'Present' ? 'bg-emerald-500/20 text-emerald-300' : 'bg-red-500/20 text-red-300'
                  }`}>{h.status}</span>
                </div>
                <p className="text-xs text-cyber-muted">{h.recommendation}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── SSL + WHOIS side by side ── */}
      {(scanResult?.certificate || scanResult?.whois) && (
        <div className="grid gap-6 lg:grid-cols-2">

          {/* SSL */}
          {scanResult?.certificate && (
            <div className="rounded-[2rem] border border-cyber-line bg-cyber-panel/90 p-6 shadow-glow">
              <h2 className="text-lg font-black text-cyber-text mb-4">SSL / TLS Certificate</h2>
              <dl className="space-y-2 text-sm">
                {[
                  { label: 'Issuer',         value: scanResult.certificate.issuer },
                  { label: 'Valid From',      value: scanResult.certificate.validFrom ?? 'N/A' },
                  { label: 'Expires',         value: scanResult.certificate.expiryDate ?? 'N/A' },
                  { label: 'Days Remaining',  value: scanResult.certificate.daysRemaining !== null ? String(scanResult.certificate.daysRemaining) : 'N/A' },
                  { label: 'TLS Version',     value: scanResult.certificate.tlsVersion ?? 'N/A' },
                ].map(({ label, value }) => (
                  <div key={label} className="flex justify-between gap-4 border-b border-white/5 pb-1">
                    <dt className="text-cyber-muted">{label}</dt>
                    <dd className="font-semibold text-cyber-text text-right">{value}</dd>
                  </div>
                ))}
                <div className="flex justify-between gap-4 pt-1">
                  <dt className="text-cyber-muted">Status</dt>
                  <dd className={`font-bold uppercase text-sm ${
                    scanResult.certificate.expiryStatus === 'valid' ? 'text-emerald-400'
                    : scanResult.certificate.expiryStatus === 'expiring-soon' ? 'text-amber-400'
                    : 'text-red-400'
                  }`}>{scanResult.certificate.expiryStatus}</dd>
                </div>
              </dl>
            </div>
          )}

          {/* WHOIS */}
          {scanResult?.whois && (
            <div className="rounded-[2rem] border border-cyber-line bg-cyber-panel/90 p-6 shadow-glow">
              <h2 className="text-lg font-black text-cyber-text mb-4">Domain Information</h2>
              <dl className="space-y-2 text-sm">
                {[
                  { label: 'Registrar',    value: scanResult.whois.registrar },
                  { label: 'Organization', value: scanResult.whois.organization },
                  { label: 'Created',      value: scanResult.whois.creationDate ? new Date(scanResult.whois.creationDate).toDateString() : 'N/A' },
                  { label: 'Expires',      value: scanResult.whois.expiryDate ? new Date(scanResult.whois.expiryDate).toDateString() : 'N/A' },
                  { label: 'Updated',      value: scanResult.whois.updatedDate ? new Date(scanResult.whois.updatedDate).toDateString() : 'N/A' },
                ].map(({ label, value }) => (
                  <div key={label} className="flex justify-between gap-4 border-b border-white/5 pb-1">
                    <dt className="text-cyber-muted">{label}</dt>
                    <dd className="font-semibold text-cyber-text text-right truncate max-w-[60%]">{value}</dd>
                  </div>
                ))}
                {scanResult.whois.nameServers.length > 0 && (
                  <div className="pt-1">
                    <dt className="text-cyber-muted mb-1">Name Servers</dt>
                    {scanResult.whois.nameServers.map((ns, i) => (
                      <dd key={i} className="font-mono text-xs text-cyber-text">{ns}</dd>
                    ))}
                  </div>
                )}
              </dl>
            </div>
          )}
        </div>
      )}

      {/* ── Port Scan ── */}
      {scanResult?.nmap && (
        <div className="rounded-[2rem] border border-cyber-line bg-cyber-panel/90 p-6 shadow-glow lg:p-8">
          <h2 className="text-xl font-black text-cyber-text mb-2">Port Scan Results</h2>
          <p className="text-sm text-cyber-muted mb-4">{scanResult.nmap.note}</p>
          {scanResult.nmap.ports.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-cyber-line text-left">
                    <th className="pb-2 pr-4 text-xs uppercase tracking-widest text-cyber-muted">Port</th>
                    <th className="pb-2 pr-4 text-xs uppercase tracking-widest text-cyber-muted">Protocol</th>
                    <th className="pb-2 pr-4 text-xs uppercase tracking-widest text-cyber-muted">State</th>
                    <th className="pb-2 pr-4 text-xs uppercase tracking-widest text-cyber-muted">Service</th>
                    <th className="pb-2 text-xs uppercase tracking-widest text-cyber-muted">Version</th>
                  </tr>
                </thead>
                <tbody>
                  {scanResult.nmap.ports.map((p) => (
                    <tr key={`${p.protocol}-${p.port}`} className="border-b border-white/5">
                      <td className="py-2 pr-4 font-mono font-bold text-cyber-accent">{p.port}</td>
                      <td className="py-2 pr-4 uppercase text-cyber-text">{p.protocol}</td>
                      <td className="py-2 pr-4">
                        <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                          p.state === 'open' ? 'bg-emerald-500/20 text-emerald-300' : 'bg-white/10 text-cyber-muted'
                        }`}>{p.state}</span>
                      </td>
                      <td className="py-2 pr-4 text-cyber-text">{p.service}</td>
                      <td className="py-2 font-mono text-xs text-cyber-muted">{p.version}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-sm text-cyber-muted">No open ports detected.</p>
          )}
        </div>
      )}

      {/* ── ZAP Alerts summary table ── */}
      {zapAlerts && zapAlerts.length > 0 && (
        <div className="rounded-[2rem] border border-cyber-line bg-cyber-panel/90 p-6 shadow-glow lg:p-8">
          <h2 className="text-xl font-black text-cyber-text mb-4">OWASP ZAP Alerts ({zapAlerts.length})</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-cyber-line text-left">
                  <th className="pb-2 pr-4 text-xs uppercase tracking-widest text-cyber-muted">Alert</th>
                  <th className="pb-2 pr-4 text-xs uppercase tracking-widest text-cyber-muted">Risk</th>
                  <th className="pb-2 pr-4 text-xs uppercase tracking-widest text-cyber-muted">Confidence</th>
                  <th className="pb-2 pr-4 text-xs uppercase tracking-widest text-cyber-muted">CWE</th>
                  <th className="pb-2 text-xs uppercase tracking-widest text-cyber-muted">URL</th>
                </tr>
              </thead>
              <tbody>
                {zapAlerts.map((a, i) => {
                  const riskCls = a.risk === 'High' ? 'text-red-400' : a.risk === 'Medium' ? 'text-amber-400' : a.risk === 'Low' ? 'text-yellow-300' : 'text-blue-400';
                  return (
                    <tr key={i} className="border-b border-white/5">
                      <td className="py-2 pr-4 font-semibold text-cyber-text">{a.alert}</td>
                      <td className={`py-2 pr-4 font-bold uppercase text-xs ${riskCls}`}>{a.risk}</td>
                      <td className="py-2 pr-4 text-cyber-muted text-xs">{a.confidence}</td>
                      <td className="py-2 pr-4 font-mono text-xs text-cyber-muted">{a.cweid ? `CWE-${a.cweid}` : 'N/A'}</td>
                      <td className="py-2 font-mono text-xs text-cyber-muted truncate max-w-[200px]">{a.url}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Detailed AI Findings ── */}
      <div className="rounded-[2rem] border border-cyber-line bg-cyber-panel/90 p-6 shadow-glow lg:p-8">
        <h2 className="text-xl font-black text-cyber-text mb-6">Detailed Findings</h2>
        <div className="space-y-5">
          {report.findings.length > 0 ? report.findings.map((f) => {
            const cfg = RISK_CFG[f.riskLevel];
            return (
              <article key={f.id} className={`overflow-hidden rounded-2xl border border-cyber-line border-l-4 ${cfg.screenBorder} bg-cyber-bg/60`}>
                <div className="flex flex-wrap items-start justify-between gap-3 bg-black/20 px-5 py-4">
                  <div className="space-y-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-xs font-bold text-cyber-accent">{f.id}</span>
                      <span className="h-1 w-1 rounded-full bg-cyber-muted" />
                      <h3 className="text-sm font-bold text-cyber-text">{f.title}</h3>
                    </div>
                    <p className="text-xs text-cyber-muted">{f.owasp}</p>
                  </div>
                  <span className={`shrink-0 inline-block rounded px-2 py-0.5 text-[0.65rem] font-bold uppercase tracking-widest ${cfg.screenBadge}`}>
                    {f.riskLevel}
                  </span>
                </div>
                <div className="grid gap-px bg-white/5 sm:grid-cols-2">
                  {(
                    [
                      { label: 'Description', content: f.description, mono: false, accent: false },
                      { label: 'Evidence',    content: f.evidence,    mono: true,  accent: false },
                      { label: 'Impact',      content: f.impact,      mono: false, accent: false },
                      { label: 'Remediation', content: f.remediation, mono: false, accent: true  },
                    ] as const
                  ).map(({ label, content, mono, accent }) => (
                    <div key={label} className={`p-5 ${accent ? 'bg-cyber-accent/5' : 'bg-cyber-bg/40'}`}>
                      <p className="mb-2 text-xs font-bold uppercase tracking-widest text-cyber-accent">{label}</p>
                      <p className={`text-sm leading-6 ${mono ? 'font-mono text-emerald-300 break-all' : 'text-cyber-muted'}`}>{content}</p>
                    </div>
                  ))}
                </div>
              </article>
            );
          }) : (
            <p className="text-sm text-cyber-muted">No detailed findings available.</p>
          )}
        </div>
      </div>

    </div>
  );
}
