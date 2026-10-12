# CyberP — Backend Architecture

A detailed walkthrough of how the backend fetches security data, processes it, and generates reports.

---

## 1. Overview

The backend is a single **Node.js ESM** application (`backend/src/server.js`) built on **Express 5**. It acts as the security brain of the platform — every check, every AI call, and every ZAP interaction runs here. The frontend never talks to Groq, ZAP, or Nmap directly.

```
Browser (React)
    │
    │  HTTPS  ·  Authorization: Bearer <jwt>
    ▼
┌──────────────────────────────────────────────────────┐
│                  Express Backend                     │
│                  localhost:3001                      │
│                                                      │
│  requireAuth ──► validates Supabase JWT              │
│                                                      │
│  POST /scan          ──► headers + SSL + WHOIS + nmap│
│  POST /zap/start     ──► ZAP spider scan             │
│  GET  /zap/status/:id──► ZAP progress poll           │
│  GET  /zap/alerts    ──► ZAP alerts + Groq overview  │
│  POST /ai/summary    ──► Groq markdown summary       │
│  POST /ai/vapt-report──► Groq structured JSON report │
└──────┬──────────────────────────────────────────────┘
       │
       ├──► Supabase  (JWT verification only)
       ├──► OWASP ZAP (localhost:8080 or Railway private)
       ├──► Nmap      (child process, XML stdout)
       └──► Groq API  (GROQ_API_KEY never in browser)
```

---

## 2. Startup and Middleware

```
server.js loads
  │
  ├── dotenv.config()            reads .env
  ├── globalThis.WebSocket = ws  polyfill for Supabase on Node 20
  ├── createClient(supabaseUrl)  Supabase client for JWT verification only
  ├── app.use(cors(...))         ALLOWED_ORIGINS env var; allows all if unset
  └── app.use(express.json())    5 MB body limit
```

**CORS** — when `ALLOWED_ORIGINS` is set (production), only those origins are allowed. When unset (local dev), all origins pass.

---

## 3. Authentication Middleware

Every protected route runs through `requireAuth` before the handler executes.

```
Request arrives with
  Authorization: Bearer <jwt>
        │
        ▼
requireAuth()
  ├── extracts token from header
  ├── calls supabase.auth.getUser(token)
  │     └── Supabase validates signature + expiry server-side
  ├── on success: request.user = data.user → next()
  └── on failure: 401 { error: "Invalid or expired session." }
```

The backend never stores tokens — it verifies them on every request using Supabase's own auth system.

---

## 4. Regular Scan — `POST /scan`

This is the core endpoint. It accepts a URL and runs four independent checks **in parallel**, combines the results, and returns a single `ScanResponse` object.

### 4.1 URL Validation

```
validateTargetUrl(url)
  ├── must be a non-empty string
  ├── must parse as a valid URL
  └── protocol must be http: or https:
      └── rejects everything else with 400
```

> **Note:** IP-based SSRF protection (blocking private/loopback ranges) is not yet implemented — `validateTargetUrl` only checks the scheme.

### 4.2 Parallel Execution

```javascript
const [upstreamResponse, whoisData, certificate, nmap] = await Promise.all([
  axios.get(targetUrl, { timeout, maxRedirects: 5, validateStatus: () => true }),
  fetchWhois(targetUrl),
  fetchCertificate(targetUrl),
  runNmapScan(parsedTarget.hostname),
]);
```

All four run simultaneously. Each one is independently fault-tolerant — if one fails, the others still return data and the endpoint responds with `status: "partial"` instead of `status: "success"`.

### 4.3 Security Headers Check

```
axios.get(targetUrl)
  └── reads response.headers
        └── buildHeaderAnalysis(headers)
              for each of 6 headers:
                ├── Content-Security-Policy     (high severity if missing)
                ├── Strict-Transport-Security   (high severity if missing)
                ├── X-Frame-Options             (medium)
                ├── Referrer-Policy             (medium)
                ├── Permissions-Policy          (medium)
                └── X-Content-Type-Options      (medium)
              returns:
                { header, status: "Present"|"Missing", severity, recommendation }
```

Header names are normalised to lowercase before comparison to handle case variations across servers.

### 4.4 SSL / TLS Certificate Check

```
fetchCertificate(targetUrl)
  │
  ├── skips if URL is http:// (no cert to inspect)
  │
  └── tls.connect({ host, port: 443, servername: hostname })
        ├── socket.getPeerCertificate(true)
        │     reads: valid_from, valid_to, issuer.O / issuer.CN
        ├── socket.getProtocol()
        │     reads: TLSv1.2, TLSv1.3, etc.
        ├── getDaysRemaining(expiryDate)
        └── getCertificateExpiryStatus(days)
              ├── < 0 days  → "expired"
              ├── ≤ 14 days → "expiring-soon"
              └── > 14 days → "valid"
```

Returns: `{ issuer, validFrom, expiryDate, daysRemaining, tlsVersion, expiryStatus, note }`

### 4.5 WHOIS Lookup

```
fetchWhois(targetUrl)
  │
  ├── strips www. from hostname
  ├── whois-json(domain)
  └── normalizeWhoisData(raw)
        ├── tries multiple field name variants per registrar
        │   (registrar, registrarName, sponsoringRegistrar, ...)
        ├── collects nameservers from: nameServer, nameserver, nserver, ...
        ├── formats all date strings → ISO 8601
        └── detects private records:
              if registrar + dates + nameservers all empty
              → whoisStatus: "private"
              else
              → whoisStatus: "available"
```

Returns: `{ registrar, organization, creationDate, expiryDate, updatedDate, nameServers, whoisStatus, note }`

### 4.6 Nmap Port Scan

```
runNmapScan(hostname)
  │
  ├── execFile('nmap', [
  │     '--unprivileged',   ← works without CAP_NET_RAW (Railway / Docker)
  │     '-sT',             ← TCP connect scan
  │     '-T4',             ← aggressive timing
  │     '--top-ports', '100',
  │     '-oX', '-',        ← XML output on stdout
  │     hostname
  │   ], { timeout: NMAP_TIMEOUT_MS })
  │
  ├── on ENOENT → nmapStatus: "unavailable"
  ├── on timeout → nmapStatus: "error" (timed out)
  │
  └── parseStringPromise(stdout)   xml2js parses XML
        └── normalises single-port vs multi-port XML shapes
              maps each port to:
              { port, protocol, state, service, version }
```

> Nmap must be installed on the host. In production it is baked into the Docker image via `apt-get install nmap`.

### 4.7 Final Response Assembly

```
{
  status:         "success" | "partial" | "error"
  message:        human-readable status string
  targetUrl:      the URL that was scanned
  upstreamStatus: HTTP status code of the target (e.g. 200)
  headers:        HeaderReport[]
  certificate:    CertificateReport
  whois:          WhoisReport
  nmap:           NmapReport
}
```

---

## 5. ZAP Scan Flow

OWASP ZAP runs as a separate Docker container. The backend communicates with it via its REST API (`/JSON/...` endpoints).

### 5.1 Start Scan — `POST /zap/start`

```
POST /zap/start  { url }
  │
  └── zapApi.startZapScan(url)
        ├── clearZapSession()
        │     GET /JSON/core/action/newSession/
        │     └── wipes old alerts so stale data doesn't pollute results
        │
        ├── setOptionMaxDepth(3)     limits crawl depth
        ├── setOptionMaxChildren(10) limits links per page
        │
        └── GET /JSON/spider/action/scan/?url=<target>&maxChildren=10
              └── returns { scan: "0" }  ← scanId
```

**Response:** `{ success: true, scanId: "0" }`

### 5.2 Poll Progress — `GET /zap/status/:scanId`

```
GET /zap/status/0
  │
  └── zapApi.getZapScanStatus("0")
        └── GET /JSON/spider/view/status/?scanId=0
              └── returns { status: "75" }  ← integer 0-100
```

The frontend polls this every 2 seconds. A 90-poll timeout (3 minutes) stops the poll and fetches partial results if ZAP stalls.

### 5.3 Fetch Alerts — `GET /zap/alerts?url=...`

```
GET /zap/alerts?url=https://example.com
  │
  ├── zapApi.getZapAlerts(url)
  │     GET /JSON/core/view/alerts/?baseurl=<url>&start=0&count=100
  │     └── returns raw alerts array (capped at 100 to prevent timeout)
  │
  ├── enrichZapAlerts(alerts)
  │     for each alert:
  │     └── buildZapFallbackInsight(alert)
  │           constructs: { whatItIs, whyDangerous, exampleAttack, fix, source: "fallback" }
  │
  └── generateZapOverview(enrichedAlerts, targetUrl)
        ├── builds compact prompt (risk counts, top 5 alert names)
        ├── calls Groq API (max_tokens: 500, no response_format — expects JSON string)
        ├── parses: { title, summary, impact, riskLevel, recommendations, quickWins, nextStep }
        └── on any failure → returns deterministic fallback overview
```

**Response:** `{ success: true, alerts: [...], overview: { title, summary, riskLevel, ... } }`

---

## 6. AI Proxy Endpoints

Both endpoints proxy data to Groq from the server side. **The `GROQ_API_KEY` never appears in the browser bundle.**

### 6.1 Quick AI Summary — `POST /ai/summary`

```
POST /ai/summary  { scanResult, zapAlerts, zapOverview }
  │
  ├── buildAiSummaryPrompt(scanResult, zapAlerts, zapOverview)
  │     constructs a prompt with:
  │     ├── target URL + HTTP status
  │     ├── count of missing security headers
  │     ├── SSL expiry status + days remaining
  │     ├── number of open ports
  │     └── top ZAP alerts grouped by risk level
  │     instructs Groq to respond in markdown with sections:
  │     ## Executive Summary / ## Critical Findings /
  │     ## Risk Level / ## Recommendations / ## Next Steps
  │
  └── fetch('https://api.groq.com/openai/v1/chat/completions', {
        model: GROQ_MODEL,
        temperature: 0.3,
        max_tokens: 800
        // no response_format → expects markdown text
      })
        └── returns choices[0].message.content as summary string
```

**Response:** `{ success: true, summary: "## Executive Summary\n..." }`

### 6.2 VAPT Report — `POST /ai/vapt-report`

```
POST /ai/vapt-report  { scanResult, zapAlerts }
  │
  ├── buildVaptPrompt(scanResult, zapAlerts)
  │     constructs a structured facts array:
  │     ├── Target URL + HTTP status
  │     ├── SSL: issuer, TLS version, expiry status, days remaining
  │     ├── WHOIS: registrar, organization, status
  │     ├── Open ports: port/protocol(service) list
  │     ├── Missing HIGH-severity headers (listed by name)
  │     ├── Missing MEDIUM-severity headers (listed by name)
  │     └── ZAP findings per risk level with CWE IDs (top 3 + count)
  │
  │     instructs Groq to respond with ONLY a valid JSON object:
  │     {
  │       executiveSummary: string,
  │       totalFindings: { critical, high, medium, low, informational },
  │       findings: [{
  │         id, title, owasp, riskLevel,
  │         description, evidence, impact, remediation
  │       }]
  │     }
  │
  └── fetch('https://api.groq.com/openai/v1/chat/completions', {
        model: GROQ_MODEL,
        temperature: 0.2,          ← lower temp for structured output
        max_tokens: 2000,
        response_format: { type: 'json_object' }  ← forces valid JSON
      })
        ├── stripCodeFences(text)   removes any accidental ``` wrapping
        └── JSON.parse(text)        → structured report object
```

**Response:** `{ success: true, report: { executiveSummary, totalFindings, findings[] } }`

---

## 7. Report Generation (Frontend)

After the VAPT report JSON is returned from the backend, the frontend assembles it with the raw scan data and builds the final report.

```
Scanner.tsx: generateVaptReport()
  │
  ├── calls callAiVaptReport(scanResult, zapAlerts, token)
  │     └── POST /ai/vapt-report → { executiveSummary, totalFindings, findings }
  │
  └── setVaptReport({
        targetUrl,
        scanDate,
        methodology,
        executiveSummary,   ← from Groq
        totalFindings,      ← from Groq
        findings,           ← from Groq
        scanResult,         ← raw regular scan data (headers, SSL, WHOIS, nmap)
        zapAlerts,          ← raw ZAP alerts array
      })
```

### 7.1 Screen Rendering (VaptReport.tsx)

The `VaptReport` component renders all sections on screen using the Tailwind cyber theme:

```
VaptReport component receives VaptReportData
  │
  ├── Cover card         targetUrl · scanDate · httpStatus · methodology
  ├── Executive Summary  Groq text + severity count tiles
  ├── Security Headers   grid of Present/Missing header cards
  ├── SSL + WHOIS        side-by-side key-value panels
  ├── Port Scan          table: port · protocol · state · service · version
  ├── ZAP Alerts         table: alert · risk · confidence · CWE · URL
  └── Detailed Findings  expandable cards per AI finding (description · evidence · impact · remediation)
```

### 7.2 PDF Export (Print to PDF)

```
handlePrint() in Scanner.tsx
  │
  ├── buildPrintHtml(vaptReport)     ← VaptReport.tsx export
  │     constructs a complete <!DOCTYPE html> with:
  │     ├── @page { size: A4 }       A4 page layout
  │     ├── inline CSS only          no Tailwind, no external fonts
  │     ├── esc() on all values      HTML-escapes every user-controlled string
  │     └── sections in order:
  │           Cover table (target, date, HTTP status, classification)
  │           Executive Summary
  │           Severity count table
  │           Security Headers table
  │           SSL/TLS Certificate table
  │           WHOIS / Domain table
  │           Port Scan table
  │           ZAP Alerts table
  │           Detailed Findings blocks
  │           Footer
  │
  ├── creates hidden 0×0 <iframe>
  ├── iframe.contentDocument.write(html)
  ├── iframe.onload → iframe.contentWindow.print()
  └── setTimeout(1000) → removes iframe
```

This technique avoids the blank-page problem that occurs when calling `window.print()` before the DOM has painted. The iframe loads its own complete document and prints only that.

---

## 8. Data Flow — End to End

```
User enters URL → clicks "Run Combined Scan"
        │
        ▼
handleRegularScan()
  POST /scan
        │
        ├── Promise.all([
        │     axios.get(url)          → HTTP headers
        │     fetchWhois(url)         → WHOIS data
        │     fetchCertificate(url)   → TLS cert
        │     runNmapScan(hostname)   → port list
        │   ])
        │
        └── ScanResponse → scanResult state
               │
               └── supabase.from('scans').insert(...)   saved to Postgres

handleZapScan()
  POST /zap/start → scanId
        │
        └── setInterval(2000ms) polls GET /zap/status/:scanId
              │
              └── at 100% (or 3-min timeout):
                    GET /zap/alerts
                          │
                          ├── enrichZapAlerts()
                          └── generateZapOverview() → Groq
                                └── zapAlerts + zapOverview state

User clicks "Generate VAPT Report"
        │
        ▼
generateVaptReport()
  POST /ai/vapt-report
    sends: scanResult + zapAlerts
        │
        └── buildVaptPrompt() → Groq (json_object mode)
              └── { executiveSummary, totalFindings, findings }

setVaptReport({
  ...groqData,
  scanResult,    ← attached here in frontend
  zapAlerts,     ← attached here in frontend
})
        │
        └── VaptReport component renders all sections

User clicks "Print / Export PDF"
        │
        └── buildPrintHtml(vaptReport)
              → hidden iframe → window.print() → browser saves as PDF
```

---

## 9. Error Handling and Graceful Degradation

| Module | On failure | Response |
|---|---|---|
| HTTP headers fetch | axios `.catch(() => null)` | all headers marked Missing, `status: "partial"` |
| SSL/TLS | socket `on('error')` | `expiryStatus: "unavailable"`, descriptive note |
| WHOIS | try/catch | `whoisStatus: "unavailable"`, note |
| Nmap | ENOENT / timeout / parse error | `nmapStatus: "unavailable"` or `"error"`, note |
| ZAP connection | 502 with message | `"Could not communicate with OWASP ZAP"` |
| ZAP alerts timeout | 20s hard timeout | `"Failed to get ZAP alerts: timeout"` |
| Groq overview | try/catch around JSON parse | deterministic fallback built from alert data |
| Groq AI endpoints | `GROQ_API_KEY` missing | 503 `"AI service is not configured"` |
| Groq AI endpoints | non-200 response | 502 with Groq's error message forwarded |

---

## 10. Key Files

| File | Responsibility |
|---|---|
| `backend/src/server.js` | Everything — auth middleware, all 6 route handlers, all scan functions, ZAP proxy, Groq proxy, prompt builders (~982 lines) |
| `backend/src/zapApi.js` | Three functions wrapping ZAP's REST API: `startZapScan`, `getZapScanStatus`, `getZapAlerts` + session clear |
| `frontend/src/lib/scanApi.ts` | Typed fetch helpers — auto-attaches JWT, wraps all 5 backend endpoints |
| `frontend/src/components/VaptReport.tsx` | Screen UI + `buildPrintHtml()` for PDF export |
| `frontend/src/pages/Scanner.tsx` | Orchestrates all scan flows, AI calls, state, and print trigger |

---

## 11. Environment Variables

| Variable | Used by | Purpose |
|---|---|---|
| `PORT` | server.js | Express listen port (default 3001) |
| `GROQ_API_KEY` | server.js | Groq API authentication |
| `GROQ_MODEL` | server.js | Model name (e.g. `llama-3.3-70b-versatile`) |
| `SUPABASE_URL` | server.js | Supabase project URL for JWT verification |
| `SUPABASE_ANON_KEY` | server.js | Supabase anon key for JWT verification |
| `ALLOWED_ORIGINS` | server.js | Comma-separated CORS allowlist |
| `ZAP_API_URL` | zapApi.js | ZAP base URL (default `http://localhost:8080`) |
| `SCAN_TIMEOUT_MS` | server.js | Timeout for HTTP + TLS checks (default 10000ms) |
| `NMAP_TIMEOUT_MS` | server.js | Timeout for Nmap child process (default 30000ms) |
| `ZAP_TIMEOUT_MS` | zapApi.js | Timeout for ZAP API calls (default 120000ms) |
