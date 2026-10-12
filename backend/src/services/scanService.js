import axios from 'axios';
import { execFile } from 'node:child_process';
import tls from 'node:tls';
import whois from 'whois-json';
import { parseStringPromise } from 'xml2js';

const securityHeaders = [
  {
    key: 'Content-Security-Policy',
    severity: 'high',
    recommendation: 'Set a restrictive Content-Security-Policy to limit script, style, and resource loading.',
  },
  {
    key: 'Strict-Transport-Security',
    severity: 'high',
    recommendation: 'Enable HSTS so browsers always use HTTPS for future requests to this site.',
  },
  {
    key: 'X-Frame-Options',
    severity: 'medium',
    recommendation: 'Set X-Frame-Options to DENY or SAMEORIGIN to reduce clickjacking risk.',
  },
  {
    key: 'Referrer-Policy',
    severity: 'medium',
    recommendation: 'Use a strict Referrer-Policy such as strict-origin-when-cross-origin to limit leakage.',
  },
  {
    key: 'Permissions-Policy',
    severity: 'medium',
    recommendation: 'Set Permissions-Policy to disable browser features your application does not need.',
  },
  {
    key: 'X-Content-Type-Options',
    severity: 'medium',
    recommendation: 'Set X-Content-Type-Options to nosniff to prevent MIME type sniffing.',
  },
];

export function validateTargetUrl(value) {
  if (typeof value !== 'string' || !value.trim()) {
    return 'URL is required.';
  }

  try {
    const parsedUrl = new URL(value.trim());
    if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
      return 'URL must use http or https.';
    }
    return null;
  } catch {
    return 'URL must be a valid absolute URL.';
  }
}

export function stripCodeFences(value) {
  return String(value ?? '')
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
}

function collectWhoisValues(...candidates) {
  return candidates.flatMap((candidate) => {
    if (Array.isArray(candidate)) return candidate;
    if (typeof candidate === 'string' && candidate.trim()) return [candidate.trim()];
    return [];
  });
}

function firstNonEmpty(values) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return null;
}

function formatDateValue(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toISOString();
}

function normalizeWhoisData(whoisData, targetUrl) {
  const nameServers = Array.from(
    new Set(
      collectWhoisValues(
        whoisData?.nameServer,
        whoisData?.nameserver,
        whoisData?.name_servers,
        whoisData?.nserver,
      ),
    ),
  );

  const organization = firstNonEmpty([
    whoisData?.organization,
    whoisData?.org,
    whoisData?.registrantOrganization,
    whoisData?.registrantOrganizationName,
    whoisData?.registrant?.organization,
    whoisData?.registrant?.org,
  ]);

  const registrar = firstNonEmpty([
    whoisData?.registrar,
    whoisData?.registrarName,
    whoisData?.sponsoringRegistrar,
  ]);

  const creationDate = formatDateValue(
    firstNonEmpty([
      whoisData?.creationDate,
      whoisData?.createdDate,
      whoisData?.created,
      whoisData?.registrationDate,
    ]),
  );

  const expiryDate = formatDateValue(
    firstNonEmpty([
      whoisData?.expiryDate,
      whoisData?.expires,
      whoisData?.expirationDate,
      whoisData?.registryExpiryDate,
      whoisData?.registrarRegistrationExpirationDate,
    ]),
  );

  const updatedDate = formatDateValue(
    firstNonEmpty([
      whoisData?.updatedDate,
      whoisData?.updated,
      whoisData?.dateUpdated,
      whoisData?.lastChangedDate,
    ]),
  );

  const privateDataDetected =
    !registrar && !creationDate && !expiryDate && !updatedDate && nameServers.length === 0 && !organization;

  return {
    registrar: registrar ?? 'Unavailable',
    creationDate,
    expiryDate,
    updatedDate,
    nameServers,
    organization: organization ?? 'Unavailable',
    whoisStatus: privateDataDetected ? 'private' : 'available',
    note: privateDataDetected ? 'WHOIS data appears to be private or unavailable for this domain.' : `WHOIS data retrieved from ${new URL(targetUrl).hostname}`,
  };
}

async function fetchWhois(targetUrl) {
  try {
    const parsedUrl = new URL(targetUrl);
    const domain = parsedUrl.hostname.replace(/^www\./i, '');
    const whoisData = await whois(domain);
    return normalizeWhoisData(whoisData, targetUrl);
  } catch (error) {
    return {
      registrar: 'Unavailable',
      creationDate: null,
      expiryDate: null,
      updatedDate: null,
      nameServers: [],
      organization: 'Unavailable',
      whoisStatus: 'unavailable',
      note: error instanceof Error ? error.message : 'WHOIS lookup failed.',
    };
  }
}

function getDaysRemaining(expiryDate) {
  const expiryTime = new Date(expiryDate).getTime();
  const now = Date.now();
  return Math.ceil((expiryTime - now) / (1000 * 60 * 60 * 24));
}

function getCertificateExpiryStatus(daysRemaining) {
  if (daysRemaining < 0) return 'expired';
  if (daysRemaining <= 14) return 'expiring-soon';
  return 'valid';
}

function formatCertificateDetails(peerCertificate, protocol, targetUrl) {
  const certificatePresent = peerCertificate && Object.keys(peerCertificate).length > 0;
  if (!certificatePresent) {
    return {
      issuer: 'Unavailable',
      validFrom: null,
      expiryDate: null,
      daysRemaining: null,
      tlsVersion: protocol ?? null,
      expiryStatus: 'unavailable',
      note: 'No certificate data was returned for this target.',
    };
  }

  const validFrom = peerCertificate.valid_from ?? null;
  const expiryDate = peerCertificate.valid_to ?? null;
  const daysRemaining = expiryDate ? getDaysRemaining(expiryDate) : null;

  return {
    issuer: peerCertificate.issuer?.O || peerCertificate.issuer?.CN || 'Unknown issuer',
    validFrom,
    expiryDate,
    daysRemaining,
    tlsVersion: protocol ?? 'Unknown',
    expiryStatus: daysRemaining === null ? 'unavailable' : getCertificateExpiryStatus(daysRemaining),
    note: `Certificate retrieved from ${targetUrl}`,
  };
}

function fetchCertificate(targetUrl) {
  const parsedUrl = new URL(targetUrl);
  if (parsedUrl.protocol !== 'https:') {
    return Promise.resolve({
      issuer: 'Unavailable',
      validFrom: null,
      expiryDate: null,
      daysRemaining: null,
      tlsVersion: null,
      expiryStatus: 'unavailable',
      note: 'Certificate inspection requires an HTTPS URL.',
    });
  }

  return new Promise((resolve, reject) => {
    const socket = tls.connect(
      {
        host: parsedUrl.hostname,
        port: Number(parsedUrl.port || 443),
        servername: parsedUrl.hostname,
        rejectUnauthorized: true,
      },
      () => {
        try {
          const peerCertificate = socket.getPeerCertificate(true);
          resolve(formatCertificateDetails(peerCertificate, socket.getProtocol(), targetUrl));
        } catch (error) {
          reject(error);
        } finally {
          socket.end();
        }
      },
    );

    socket.setTimeout(Number(process.env.SCAN_TIMEOUT_MS ?? 10000), () => {
      socket.destroy(new Error('Certificate scan timed out.'));
    });

    socket.on('error', (error) => {
      reject(error);
    });
  });
}

const NMAP_TIMEOUT_MS = Number(process.env.NMAP_TIMEOUT_MS ?? 60000);

function runNmapScan(hostname) {
  return new Promise((resolve) => {
    const args = ['--unprivileged', '-sT', '-T4', '--top-ports', '100', '-oX', '-', hostname];

    const child = execFile('nmap', args, { timeout: NMAP_TIMEOUT_MS, maxBuffer: 10 * 1024 * 1024 }, async (error, stdout) => {
      if (error) {
        if (error.code === 'ENOENT') {
          resolve({
            ports: [],
            nmapStatus: 'unavailable',
            note: 'Nmap is not installed or not in PATH.',
          });
          return;
        }

        resolve({
          ports: [],
          nmapStatus: 'error',
          note: error.killed ? `Nmap scan timed out after ${NMAP_TIMEOUT_MS / 1000}s.` : `Nmap scan failed: ${error.message}`,
        });
        return;
      }

      try {
        const parsed = await parseStringPromise(stdout, { explicitArray: false });
        const hosts = parsed?.nmaprun?.host;

        if (!hosts) {
          resolve({
            ports: [],
            nmapStatus: 'success',
            note: `Nmap scan completed for ${hostname} — no hosts found.`,
          });
          return;
        }

        const host = Array.isArray(hosts) ? hosts[0] : hosts;
        const portsNode = host?.ports?.port;

        if (!portsNode) {
          resolve({
            ports: [],
            nmapStatus: 'success',
            note: `Nmap scan completed for ${hostname} — no open ports found.`,
          });
          return;
        }

        const portList = Array.isArray(portsNode) ? portsNode : [portsNode];

        const ports = portList.map((p) => ({
          port: Number(p?.$?.portid ?? 0),
          protocol: p?.$?.protocol ?? 'unknown',
          state: p?.state?.$?.state ?? 'unknown',
          service: p?.service?.$?.name ?? 'unknown',
          version: [p?.service?.$?.product, p?.service?.$?.version].filter(Boolean).join(' ') || 'unknown',
        }));

        resolve({
          ports,
          nmapStatus: 'success',
          note: `Nmap scan completed for ${hostname} — ${ports.length} port(s) found.`,
        });
      } catch (parseError) {
        resolve({
          ports: [],
          nmapStatus: 'error',
          note: `Failed to parse Nmap XML output: ${parseError instanceof Error ? parseError.message : 'Unknown error'}`,
        });
      }
    });
  });
}

function buildHeaderAnalysis(headers) {
  return securityHeaders.map((header) => {
    const present = Object.prototype.hasOwnProperty.call(headers ?? {}, header.key.toLowerCase());
    return {
      header: header.key,
      status: present ? 'Present' : 'Missing',
      severity: present ? 'low' : header.severity,
      recommendation: present ? 'Header is present. Confirm the configured value matches the application’s security policy.' : header.recommendation,
    };
  });
}

export async function runRegularScan(targetUrl) {
  try {
    const parsedTarget = new URL(targetUrl);
    const [upstreamResponse, whoisData, certificate, nmap] = await Promise.all([
      axios.get(targetUrl, {
        validateStatus: () => true,
        timeout: Number(process.env.SCAN_TIMEOUT_MS ?? 10000),
        maxRedirects: 5,
      }).catch((error) => {
        console.warn('Upstream fetch failed:', error.message);
        return null;
      }),
      fetchWhois(targetUrl),
      fetchCertificate(targetUrl).catch(() => ({ issuer: 'Unavailable', expiryStatus: 'unavailable' })),
      runNmapScan(parsedTarget.hostname),
    ]);

    const httpFailed = upstreamResponse === null;

    return {
      status: httpFailed || upstreamResponse.status >= 400 ? 'partial' : 'success',
      message: httpFailed ? 'HTTP fetch failed but other scans completed.' : 'Scan Completed',
      targetUrl,
      upstreamStatus: httpFailed ? null : upstreamResponse.status,
      headers: httpFailed
        ? securityHeaders.map((header) => ({
            header: header.key,
            status: 'Missing',
            severity: header.severity,
            recommendation: header.recommendation,
          }))
        : buildHeaderAnalysis(upstreamResponse.headers ?? {}),
      whois: whoisData,
      certificate,
      nmap,
    };
  } catch (error) {
    return {
      status: 'error',
      message: error instanceof Error ? error.message : 'Unable to fetch target URL.',
      targetUrl,
      upstreamStatus: null,
      headers: securityHeaders.map((header) => ({ header: header.key, status: 'Missing', severity: header.severity, recommendation: header.recommendation })),
      whois: { registrar: 'Unavailable', creationDate: null, expiryDate: null, updatedDate: null, nameServers: [], organization: 'Unavailable', whoisStatus: 'unavailable', note: 'WHOIS lookup failed.' },
      certificate: { issuer: 'Unavailable', validFrom: null, expiryDate: null, daysRemaining: null, tlsVersion: null, expiryStatus: 'unavailable', note: 'Certificate scan failed.' },
      nmap: { ports: [], nmapStatus: 'unavailable', note: 'Nmap scan was skipped because the overall scan failed.' },
    };
  }
}

export function buildAiSummaryPrompt(scanResult, zapAlerts, zapOverview) {
  const missingHeaders = (scanResult?.headers ?? []).filter((header) => header.status === 'Missing').length;

  return [
    'Security Scan Analysis - Provide a brief executive summary.',
    'Use markdown headers (##) and bullets; keep it short and actionable.',
    '',
    `Target: ${scanResult?.targetUrl ?? 'unknown'}`,
    `Status: ${scanResult?.status ?? 'unknown'} (HTTP ${scanResult?.upstreamStatus ?? 'N/A'})`,
    `Security Headers: ${missingHeaders} missing`,
    `Open Ports: ${scanResult?.nmap?.ports?.length ?? 0}`,
    zapAlerts?.length ? `ZAP Alerts: ${zapAlerts.length}` : 'ZAP Alerts: none',
    zapOverview ? `ZAP Overview: ${zapOverview.riskLevel ?? 'Unknown'}` : 'ZAP Overview: unavailable',
    '',
    'Provide a concise summary now.',
  ].join('\n');
}

export function buildVaptPrompt(scanResult, zapAlerts) {
  const facts = [
    `Target: ${scanResult?.targetUrl ?? 'unknown'}`,
    `HTTP status: ${scanResult?.upstreamStatus ?? 'N/A'}`,
    `Open ports: ${(scanResult?.nmap?.ports ?? []).length}`,
    `Missing headers: ${(scanResult?.headers ?? []).filter((header) => header.status === 'Missing').length}`,
  ];

  if (Array.isArray(zapAlerts) && zapAlerts.length > 0) {
    facts.push(`ZAP alerts: ${zapAlerts.length}`);
  }

  return `You are a security analyst. Return valid JSON only.\n${facts.join('\n')}`;
}

export default { runRegularScan, validateTargetUrl, buildAiSummaryPrompt, buildVaptPrompt, stripCodeFences };
