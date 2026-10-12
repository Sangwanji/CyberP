# CyberP — Technical Working Document

This document explains every function, every API call, how data flows end to end,
how the PDF is generated, and where each file lives in the project directory.

---

## Directory Map

```
cyberp/
├── WORKING.md                          ← this file
├── README.md                           ← public-facing documentation
├── backend/
│   ├── .env                            ← GROQ_API_KEY, SUPABASE_URL, PORT etc.
│   ├── .env.example                    ← template for new developers
│   ├── package.json
│   └── src/
│       ├── server.js                   ← Express app — all endpoints, all logic
│       └── src/services/zapService.js    ← ZAP REST API client moved to services/zapService.js
└── frontend/
    ├── .env.local                      ← VITE_API_BASE_URL, VITE_SUPABASE_*
    ├── index.html
    ├── tailwind.config.ts
    ├── vite.config.ts
    └── src/
        ├── App.tsx                     ← router root, four routes
        ├── index.css                   ← global styles, animate-fade-in keyframe
        ├── main.tsx                    ← ReactDOM.createRoot entry point
        ├── types/
        │   └── scan.ts                 ← TypeScript interfaces for scan data
        ├── lib/
        │   ├── supabaseClient.ts       ← creates the Supabase browser client
        │   └── scanApi.ts              ← all backend fetch helpers with JWT
        ├── components/
        │   ├── Navbar.tsx              ← reactive nav, auth state
        │   ├── ZapAlerts.tsx           ← ZAP result cards, types ZapAlert/ZapOverview
        │   └── VaptReport.tsx          ← screen report UI + buildPrintHtml()
        └── pages/
            ├── Scanner.tsx             ← main scan page, all scan/AI orchestration
            ├── Dashboard.tsx           ← scan history table
            ├── Login.tsx               ← email/password sign-in
            └── Signup.tsx              ← new account registration
```

---

## Backend — `backend/src/server.js`

This is the single Express application file. It handles authentication,
all scan logic, ZAP proxying, and AI proxying.

### Startup

```
dotenv.config()          ← reads backend/.env into process.env
createClient(url, key)   ← creates a Supabase client used only for JWT verification
app.use(cors())          ← allows any origin (lock down for production)
app.use(express.json())  ← parses application/json request bodies
app.listen(port)         ← starts on PORT env var, default 3001
```

---

### `requireAuth(request, response, next)`

**Location:** `backend/src/server.js`

Middleware that protects every sensitive route.

1. Reads `Authorization` header, strips `Bearer ` prefix to get the raw token.
2. If token is missing → `401 Authentication required.`
3. Calls `supabase.auth.getUser(token)` — Supabase validates the JWT signature
   and expiry server-side using its own signing keys.
4. If invalid or expired → `401 Invalid or expired session.`
5. On success → attaches `request.user` (the Supabase User object) and calls `next()`.

Applied to: `POST /scan`, `POST /zap/start`, `GET /zap/status/:scanId`,
`GET /zap/alerts`, `POST /ai/summary`, `POST /ai/vapt-report`.

---

### Security Header Check Functions

**`normalizeHeaderName(name)`**
Lowercases a header name so comparison is case-insensitive.

**`checkHeaderPresence(headers, headerName)`**
Uses `Object.prototype.hasOwnProperty.call` (safe against prototype pollution)
to check if a normalized header name exists in the response headers object.

**`buildHeaderAnalysis(headers)`**
Iterates the six target security headers (CSP, HSTS, X-Frame-Options,
Referrer-Policy, Permissions-Policy, X-Content-Type-Options).
For each one, calls `checkHeaderPresence`. Returns an array of `HeaderReport`:
- `status`: `'Present'` or `'Missing'`
- `severity`: `'low'` if present (already set), or `'high'`/`'medium'` if missing
- `recommendation`: confirmation note if present, fix guidance if missing

---

### WHOIS Functions

**`collectWhoisValues(...candidates)`**
Accepts multiple field names that different WHOIS providers use for the same data
(e.g. `nameServer`, `nameserver`, `nserver`). Flattens arrays and filters empty
strings into a single deduplicated array.

**`firstNonEmpty(values)`**
Iterates a list of candidate strings and returns the first non-empty one, or null.

**`formatDateValue(value)`**
Converts any date string to ISO 8601 via `new Date().toISOString()`.
Returns the raw string if parsing fails (some registrars use non-standard formats).

**`normalizeWhoisData(whoisData, targetUrl)`**
Extracts registrar, organization, creation/expiry/updated dates, and name servers
from the raw WHOIS object by trying multiple field variants per value.
If all fields are empty, sets `whoisStatus: 'private'`.

**`fetchWhois(targetUrl)`**
Strips `www.` from the hostname, calls `whois(domain)` from `whois-json`,
passes the result to `normalizeWhoisData`. Catches all errors and returns
an `'unavailable'` fallback object.

---

### SSL / TLS Certificate Functions

**`getDaysRemaining(expiryDate)`**
Subtracts `Date.now()` from the expiry timestamp and converts milliseconds to days,
rounding up with `Math.ceil`.

**`getCertificateExpiryStatus(daysRemaining)`**
Returns `'expired'` (< 0), `'expiring-soon'` (≤ 14 days), or `'valid'`.

**`formatCertificateDetails(peerCertificate, protocol, targetUrl)`**
Takes the raw Node.js TLS `peerCertificate` object and the negotiated protocol
string. Extracts `valid_from`, `valid_to`, and `issuer.O` / `issuer.CN`.
Returns an unavailable fallback if the certificate object is empty.

**`fetchCertificate(targetUrl)`**
Opens a raw TLS socket with `tls.connect()` on port 443 (or the port in the URL).
On the `secureConnect` callback, calls `socket.getPeerCertificate(true)` and
`socket.getProtocol()`, then closes the socket.
- HTTP targets return an `'unavailable'` response immediately.
- A `socket.setTimeout` of `SCAN_TIMEOUT_MS` destroys the socket if it stalls.
- `socket.on('error')` rejects the promise for upstream error handling.

---

### Nmap Functions

**`runNmapScan(hostname)`**
Spawns `nmap -sV -T4 --top-ports 100 -oX - <hostname>` as a child process.

- `-sV` — service and version detection
- `-T4` — aggressive timing template (faster scan)
- `--top-ports 100` — scan only the 100 most common ports
- `-oX -` — output XML to stdout instead of a file

Stdout XML is parsed with `xml2js.parseStringPromise(..., { explicitArray: false })`.
The parser walks `nmaprun.host.ports.port` (normalising single-port vs multi-port
responses, which differ in structure). Each port is mapped to:
`{ port, protocol, state, service, version }`.

Error handling:
- `ENOENT` → Nmap not installed (`nmapStatus: 'unavailable'`)
- `error.killed` → timeout exceeded (`nmapStatus: 'error'`)
- XML parse failure → `nmapStatus: 'error'` with parse message

---

### URL Validation

**`validateTargetUrl(value)`**
Used at the top of every endpoint that accepts a URL body or query param.
Checks the value is a non-empty string, parses it with `new URL()`,
and verifies the protocol is `http:` or `https:`. Returns an error string
or `null` on success.

---

### Utility Functions

**`stripCodeFences(value)`**
Removes ` ```json ` or ` ``` ` opening and closing fences that some LLMs
add even when told not to, ensuring clean JSON for `JSON.parse`.

**`toSingleLine(value, fallback)`**
Returns `value.trim()` if it is a non-empty string, otherwise the fallback.
Used when normalising AI JSON responses where fields might be null or empty.

---

### ZAP Fallback / Insight Functions

**`buildZapFallbackInsight(alert)`**
Constructs a structured insight object from a ZAP alert's own `alert`,
`description`, and `solution` fields — no AI call needed. Sets
`source: 'fallback'`. This is what every alert uses since per-alert
Gemini enrichment was removed.

**`normalizeZapInsight(rawInsight, alert)`**
(Legacy, called from old Gemini path — kept in codebase.)
Merges a parsed AI JSON response with fallback values using `toSingleLine`
for every field.

**`buildZapInsightPrompt(alert, targetUrl)`**
(Legacy.) Builds the per-alert prompt string that was used when individual
Gemini enrichment was active.

**`enrichZapAlerts(alerts, targetUrl)`**
Called by `GET /zap/alerts`. Currently returns all alerts with fallback
insights only — no AI call per alert. Kept async for future re-enablement.

---

### ZAP Overview Functions

**`buildZapOverviewPrompt(alerts, targetUrl)`**
Builds a short prompt for Groq. Aggregates risk counts from the alerts array,
takes the top 5 alert names, and requests strict JSON with keys:
`title, summary, impact, riskLevel, recommendations, quickWins, nextStep`.
`max 1 sentence per field, max 3 items in arrays` keeps the output token-efficient.

**`generateZapOverview(alerts, targetUrl)`**
1. Builds a deterministic `fallback` object from alert data (no API call needed).
2. If `GROQ_API_KEY` is missing, returns the fallback immediately.
3. Calls `POST https://api.groq.com/openai/v1/chat/completions` with:
   - model: `GROQ_MODEL` (default `llama-3.3-70b-versatile`)
   - temperature: `0.2`, max_tokens: `500`
   - `response_format: { type: 'json_object' }` — forces valid JSON output
4. Extracts `choices[0].message.content`, strips code fences, parses JSON.
5. Normalises each field with `toSingleLine` and array filtering.
6. On any error, logs a warning and returns `{ ...fallback, source: 'fallback' }`.

---

### AI Prompt Builders

**`buildAiSummaryPrompt(scanResult, zapAlerts, zapOverview)`**
Constructs a compact prompt for the Quick AI Summary endpoint.
Includes: missing header count, SSL status + days, open port count,
and top 2 ZAP alerts per risk level. Requests markdown output with five
sections: Executive Summary, Critical Findings, Risk Level,
Recommendations, Next Steps.

**`buildVaptPrompt(scanResult, zapAlerts)`**
Constructs the VAPT JSON prompt. Builds a `facts[]` array with one line
per data point (target, HTTP status, SSL, WHOIS, ports, missing headers,
ZAP findings per risk). Includes an explicit JSON schema with all required
fields and constraint rules. `response_format: json_object` is requested
in the API call to enforce clean JSON.

---

## Backend — API Endpoints

### `GET /health` (public)

Returns `{ ok: true, service: 'cyberp-backend' }`.
No auth required. Used to verify the server is running.

---

### `POST /scan` (protected)

**Auth:** `requireAuth` middleware.

**Flow:**
1. Calls `validateTargetUrl(body.url)` — rejects non-http/https or malformed URLs.
2. Runs four tasks in `Promise.all`:
   - `axios.get(targetUrl)` — fetches live HTTP response; `validateStatus: () => true`
     means any HTTP status code (200, 403, 500) is accepted rather than thrown.
   - `fetchWhois(targetUrl)` — WHOIS lookup.
   - `fetchCertificate(targetUrl)` — TLS socket inspection.
   - `runNmapScan(hostname)` — Nmap child process.
3. If Axios returns null (network error / timeout), `httpFailed = true` and
   status is set to `'partial'`.
4. Builds `scanResponse` combining all four results.
5. Returns `200` with the combined JSON, or `502` if the entire try block throws.

**Response shape:** `ScanResponse` (see `frontend/src/types/scan.ts`).

---

### `POST /zap/start` (protected)

**Auth:** `requireAuth`.

1. Validates `body.url`.
2. Calls `startZapScan(url)` from `zapApi.js`.
3. Returns `{ success: true, scanId: "0" }`.
4. If ZAP is unreachable → `502` with a descriptive error.

---

### `GET /zap/status/:scanId` (protected)

**Auth:** `requireAuth`.

1. Calls `getZapScanStatus(scanId)` from `zapApi.js`.
2. Returns `{ success: true, status: 0–100 }`.

---

### `GET /zap/alerts?url=<targetUrl>` (protected)

**Auth:** `requireAuth`.

1. Validates the `url` query parameter.
2. Calls `getZapAlerts(targetUrl)` from `zapApi.js` — returns raw ZAP alert array.
3. Calls `enrichZapAlerts(alerts, targetUrl)` — attaches fallback insights.
4. Calls `generateZapOverview(enrichedAlerts, targetUrl)` — calls Groq for
   a concise overview or returns the deterministic fallback.
5. Returns `{ success: true, alerts: [...], overview: {...} }`.

---

### `POST /ai/summary` (protected)

**Auth:** `requireAuth`.

1. Destructures `{ scanResult, zapAlerts, zapOverview }` from the request body.
2. Calls `buildAiSummaryPrompt(...)` to construct the prompt.
3. If `GROQ_API_KEY` is empty → `503`.
4. `POST https://api.groq.com/openai/v1/chat/completions`:
   - `temperature: 0.3`, `max_tokens: 800`
   - No `response_format` — returns plain markdown text.
5. Extracts `choices[0].message.content`.
6. Returns `{ success: true, summary: "<markdown string>" }`.
7. On error → `502`.

---

### `POST /ai/vapt-report` (protected)

**Auth:** `requireAuth`.

1. Destructures `{ scanResult, zapAlerts }` from request body.
2. Calls `buildVaptPrompt(...)` to construct the JSON schema prompt.
3. If `GROQ_API_KEY` is empty → `503`.
4. `POST https://api.groq.com/openai/v1/chat/completions`:
   - `temperature: 0.2`, `max_tokens: 2000`
   - `response_format: { type: 'json_object' }` — enforces valid JSON output.
5. Extracts `choices[0].message.content`, strips code fences, `JSON.parse`.
6. Returns `{ success: true, report: { executiveSummary, totalFindings, findings[] } }`.
7. On error → `502`.

---

## Backend — `backend/src/zapApi.js`

Thin wrapper around the OWASP ZAP REST API running at `http://localhost:8080/JSON`.

**`startZapScan(targetUrl)`**
`GET /spider/action/scan/?url=<targetUrl>`
Returns `response.data.scan` — the numeric scan ID as a string.

**`getZapScanStatus(scanId)`**
`GET /spider/view/status/?scanId=<id>`
Returns `Number(response.data.status)` — a 0–100 progress integer.

**`getZapAlerts(targetUrl)`**
`GET /core/view/alerts/?baseurl=<targetUrl>`
Returns `response.data.alerts` array, or `[]` if none.

All three functions throw descriptive errors on Axios failure which propagate
to the Express error handlers in `server.js`.

---

## Frontend — `frontend/src/lib/supabaseClient.ts`

Creates and exports a single Supabase browser client using
`VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` from `.env.local`.
Logs a console error if either variable is missing.
Imported by `scanApi.ts`, `Scanner.tsx`, `Navbar.tsx`, `Dashboard.tsx`,
`Login.tsx`, and `Signup.tsx`.

---

## Frontend — `frontend/src/lib/scanApi.ts`

Single file containing all typed fetch helpers. Every function attaches
a JWT to requests automatically.

**`getAuthToken()`** (private)
Calls `supabase.auth.getSession()` and returns `session.access_token` or `null`.

**`buildHeaders(token?)`** (private)
Builds `{ 'Content-Type': 'application/json' }` and conditionally adds
`'Authorization': 'Bearer <token>'`. If `token` argument is undefined,
calls `getAuthToken()` to fetch it automatically.

**`apiFetch<T>(url, options)`** (private)
Generic typed fetch wrapper. Calls `fetch`, parses the JSON response,
and throws an `Error` with the backend's `error` or `message` field
if the response is not OK. Returns the parsed payload typed as `T`.

**`scanTargetUrl(url)`** (exported)
Calls `POST /scan` with `buildHeaders()` (auto-fetches JWT).
Logs the response to console for debugging.
Returns `ScanResponse`.

**`callAiSummary(scanResult, zapAlerts, zapOverview, token)`** (exported)
Calls `POST /ai/summary` passing scan data in the body and the session
token explicitly (the caller already has it from `supabase.auth.getSession()`).
Returns the `summary` string from the response.

**`callAiVaptReport(scanResult, zapAlerts, token)`** (exported)
Calls `POST /ai/vapt-report`. Returns the `report` object (typed as `unknown`
since the caller casts it to `Omit<VaptReportData, ...>`).

---

## Frontend — `frontend/src/pages/Scanner.tsx`

The main page component. Manages all scan state and orchestrates every user action.

### State variables

| Variable | Type | Purpose |
|---|---|---|
| `url` | `string` | The target URL input value |
| `scanResult` | `ScanResponse \| null` | Regular scan result |
| `status` | `string` | Status bar message |
| `error` | `string` | Error message shown below status |
| `isScanning` | `boolean` | Disables buttons during regular scan |
| `isZapScanning` | `boolean` | Disables buttons during ZAP scan |
| `zapProgress` | `number` | ZAP progress 0–100 |
| `zapAlerts` | `ZapAlert[] \| null` | ZAP alerts array |
| `zapOverview` | `ZapOverview \| null` | ZAP Groq overview |
| `scanType` | `'combined' \| 'regular' \| 'zap'` | Dropdown selection |
| `aiAnalysis` | `string \| null` | Quick AI Summary markdown |
| `isAnalyzing` | `boolean` | Disables buttons during summary generation |
| `analysisError` | `string` | Error message for AI summary |
| `vaptReport` | `VaptReportData \| null` | Generated VAPT report data |
| `isGeneratingVapt` | `boolean` | Disables buttons during VAPT generation |
| `vaptError` | `string` | Error message for VAPT generation |
| `vaptToast` | `boolean` | Controls toast visibility |

---

### `formatMarkdown(markdown)` + `applyInline(text)`

**Location:** `Scanner.tsx` (module-level, not a React hook)

Line-by-line markdown parser. Iterates every line and uses regex tests to
classify it as a heading (`#`, `##`, `###`), list item (`-`, `*`, `1.`),
horizontal rule (`---`), or paragraph. Tracks `inList` boolean to open/close
`<ul>` tags correctly. `applyInline` handles bold (`**`), italic (`*`),
and inline code (`` ` ``). Returns a concatenated HTML string.

---

### `getCertificateTone / getWhoisTone / getNmapTone`

Pure functions that return Tailwind class strings based on the status field
of each result section — used for coloring the result cards green/amber/red.

---

### `handleZapScan()`

1. Validates `url` is non-empty.
2. Calls `supabase.auth.getSession()` — if no session, shows error and returns.
3. Stores `session.access_token` as `token` and builds `authHeaders` with it.
4. Sets scanning state, clears previous ZAP results.
5. `POST /zap/start` with `authHeaders` — gets back `scanId`.
6. Starts a `setInterval` every 2000ms:
   - `GET /zap/status/:scanId` — updates `zapProgress` state.
   - When `status >= 100`: clears interval, calls `GET /zap/alerts` with `authHeaders`.
   - Sets `zapAlerts` and `zapOverview` from the response.
   - Calls `setIsZapScanning(false)`.
7. Any poll error clears the interval and sets scan interrupted status.

---

### `handleRegularScan()`

1. Validates `url`.
2. Sets scanning state.
3. Calls `scanTargetUrl(url)` from `scanApi.ts` (auto-attaches JWT).
4. Sets `scanResult` and `status` from response.
5. If user is authenticated, inserts the scan result into `supabase.from('scans')`.
6. On error: sets `error` state and clears `scanResult`.

---

### `handleScan()`

Top-level handler for the form submit button. Clears all previous AI/VAPT state,
then dispatches based on `scanType`:
- `'combined'` → `await handleRegularScan()` then `await handleZapScan()`
- `'regular'` → `await handleRegularScan()`
- `'zap'` → `await handleZapScan()`

---

### `generateAIAnalysis()`

1. Guards: requires scan data to exist, requires an active session.
2. Calls `callAiSummary(scanResult, zapAlerts, zapOverview, token)` from `scanApi.ts`.
3. The backend builds the prompt, calls Groq, and returns a markdown string.
4. Sets `aiAnalysis` state — the `formatMarkdown` converter renders it as HTML
   inside the styled div with `dangerouslySetInnerHTML`.

---

### `generateVaptReport()`

1. Guards: requires scan data, requires an active session.
2. Calls `callAiVaptReport(scanResult, zapAlerts, token)` from `scanApi.ts`.
3. The backend calls Groq with `response_format: json_object` and returns
   `{ executiveSummary, totalFindings, findings[] }`.
4. Wraps the parsed response with `targetUrl`, `scanDate`, and `methodology`
   metadata to produce a complete `VaptReportData` object.
5. Sets `vaptReport` state — renders the `<VaptReport>` component.
6. Sets `vaptToast = true` — dismissed automatically after 4 seconds.
7. `VaptReport` uses `useEffect` to scroll itself into view after 150ms.

---

### `handlePrint()`

1. Calls `buildPrintHtml(vaptReport)` — generates a complete HTML string.
2. Creates a hidden `<iframe>` (0×0, `opacity: 0`, `pointer-events: none`),
   appends it to `document.body`.
3. Opens the iframe's `document`, writes the HTML string, closes it.
4. On `iframe.onload` (guarantees browser has fully rendered the content):
   - Calls `iframe.contentWindow.focus()` then `iframe.contentWindow.print()`.
   - After 1 second, removes the iframe from the DOM.

This avoids blank PDF pages caused by calling `window.print()` before
the browser has painted the newly shown element.

---

## Frontend — `frontend/src/components/VaptReport.tsx`

### Types

**`VaptFinding`** — one finding: id, title, owasp, riskLevel, description,
evidence, impact, remediation.

**`VaptReportData`** — full report: targetUrl, scanDate, methodology,
executiveSummary, totalFindings counts, findings array.

### `esc(s)` (private)

HTML-escapes `&`, `<`, `>`, `"` to prevent XSS in the `buildPrintHtml`
output, since that string is written directly into an iframe `document.write`.

### `buildPrintHtml(report)` (exported)

Generates a complete `<!DOCTYPE html>` string that is fully self-contained.
Every style is inline in a `<style>` block — no external CSS, no Tailwind,
no dark-theme classes. Structure:

```
<html>
  <head>
    <style>
      @page { size: A4 portrait; margin: 20mm 16mm; }
      body { font-family: Arial; font-size: 10pt; background: #fff; }
      /* cover, headings, tables, finding blocks, footer styles */
    </style>
  </head>
  <body>
    <h1>VAPT Report title</h1>
    <p class="tagline">...</p>
    <table class="meta">Target, Date, Methodology, Classification</table>
    <h2>Executive Summary</h2>
    <p>summary text</p>
    <table class="counts">Total / Critical / High / Medium / Low / Info</table>
    <h2>Detailed Findings</h2>
    <div class="finding" style="border-left:4px solid #color">
      <div class="fhdr">         ← flexbox row: left column + badge
        <div class="fhdr-left">  ← ID, title, OWASP ref
        <span class="badge">     ← risk level badge (inline style colour)
      <table class="fbody">      ← Description / Evidence / Impact / Remediation
    <div class="footer">Generated by CyberP — date — target</div>
  </body>
</html>
```

The finding header uses `display: flex; justify-content: space-between`
(not `float: right`) to keep the badge and title from overlapping.

### `VaptReport` component (default export)

**`useEffect` auto-scroll:**
On mount, waits 150ms then calls `rootRef.current.scrollIntoView({ behavior: 'smooth' })`.
The 150ms delay gives React time to paint the component before scrolling.

**Screen layout:**
Dark cyber-themed Tailwind cards — Cover section, Executive Summary with
stat tiles, Detailed Findings with 2-column grid cards. No print-specific
markup here. The entire div is a standard React render.

---

## Frontend — `frontend/src/components/ZapAlerts.tsx`

Receives `alerts: ZapAlert[]` and `overview: ZapOverview | null`.

**Deduplication:**
Iterates alerts and builds a `Map<string, alert + instances + urls[]>` keyed
on the alert name. Alerts with the same name are merged — instance count
incremented and unique URLs accumulated.

**Grouping:**
Reduces unique alerts into `Record<risk, alert[]>` then renders groups in
order: High → Medium → Low → Informational.

**Overview section:**
If `overview` is provided, renders an overview card with title, summary,
impact, nextStep, recommendations list, and quickWins list before the alert cards.

**Alert cards:**
Each unique alert is a `<details>` element. The `<summary>` shows name,
CWE badge, confidence, and instance count. Expanded content shows four
sections from `insight`: What it is, Why dangerous, Example attack, Fix,
and a `<pre>` code example.

---

## Frontend — `frontend/src/App.tsx`

Wraps the app in `BrowserRouter` and defines four routes:

| Path | Component |
|---|---|
| `/` | `Scanner` |
| `/login` | `Login` |
| `/signup` | `Signup` |
| `/dashboard` | `Dashboard` |

`Navbar` is rendered above all routes and is always visible.

---

## Frontend — `frontend/src/components/Navbar.tsx`

Uses `supabase.auth.getSession()` on mount to set initial user state.
Subscribes to `supabase.auth.onAuthStateChange` to reactively update
the nav when the user logs in or out in another tab.
Unsubscribes on unmount via the returned `subscription.unsubscribe()`.

Renders: Logo → Scanner link → (if logged in) Dashboard + Logout | (if not) Login + Sign Up button.

---

## Frontend — `frontend/src/pages/Dashboard.tsx`

On mount: checks for a session; if none, redirects to `/login`.
Queries `supabase.from('scans').select('id, target_url, status, created_at')`
ordered by `created_at` descending. Renders results in a table.
Row Level Security on Supabase ensures users only see their own rows.

---

## End-to-End Data Flow Diagrams

### Regular Scan

```
User types URL → handleScan() → handleRegularScan()
  └── scanApi.scanTargetUrl(url)
        └── POST /scan  { Authorization: Bearer <jwt> }
              └── requireAuth() verifies JWT via supabase.auth.getUser()
              └── Promise.all([
                    axios.get(url),          → headers object
                    fetchWhois(url),         → WhoisReport
                    fetchCertificate(url),   → CertificateReport
                    runNmapScan(hostname)    → NmapReport
                  ])
              └── Response: ScanResponse JSON
  └── setScanResult(result)
  └── supabase.from('scans').insert(...)   ← if user is signed in
  └── Render: tiles grid
```

### ZAP Scan

```
handleZapScan()
  └── supabase.auth.getSession() → token
  └── POST /zap/start  { Authorization: Bearer <jwt> }
        └── zapApi.startZapScan(url)
              └── GET http://localhost:8080/JSON/spider/action/scan/?url=...
              └── returns scanId
  └── setInterval(2000ms):
        └── GET /zap/status/:scanId  { Authorization: Bearer <jwt> }
              └── zapApi.getZapScanStatus(scanId)
              └── updates progress bar
        └── when status >= 100:
              └── clearInterval
              └── GET /zap/alerts?url=...  { Authorization: Bearer <jwt> }
                    └── zapApi.getZapAlerts(url)
                    └── enrichZapAlerts()   → adds fallback insights
                    └── generateZapOverview() → Groq API call
                    └── returns { alerts, overview }
  └── setZapAlerts / setZapOverview
  └── Render: ZapAlerts component
```

### AI Summary

```
generateAIAnalysis()
  └── supabase.auth.getSession() → token
  └── scanApi.callAiSummary(scanResult, zapAlerts, zapOverview, token)
        └── POST /ai/summary  { Authorization: Bearer <jwt> }
              └── requireAuth()
              └── buildAiSummaryPrompt(scanResult, zapAlerts, zapOverview)
              └── POST https://api.groq.com/openai/v1/chat/completions
                    model: llama-3.3-70b-versatile
                    max_tokens: 800, temperature: 0.3
              └── returns { success: true, summary: "## Executive Summary\n..." }
  └── setAiAnalysis(summary)
  └── formatMarkdown(summary) → HTML string
  └── dangerouslySetInnerHTML renders it in styled container
```

### VAPT Report Generation + PDF Export

```
generateVaptReport()
  └── supabase.auth.getSession() → token
  └── scanApi.callAiVaptReport(scanResult, zapAlerts, token)
        └── POST /ai/vapt-report  { Authorization: Bearer <jwt> }
              └── requireAuth()
              └── buildVaptPrompt(scanResult, zapAlerts)
              └── POST https://api.groq.com/openai/v1/chat/completions
                    model: llama-3.3-70b-versatile
                    max_tokens: 2000, temperature: 0.2
                    response_format: { type: 'json_object' }
              └── JSON.parse(stripCodeFences(text))
              └── returns { success: true, report: { executiveSummary, totalFindings, findings[] } }
  └── setVaptReport({ ...parsed, targetUrl, scanDate, methodology })
  └── setVaptToast(true) → toast appears bottom-right, auto-dismisses in 4s
  └── <VaptReport> renders, useEffect scrolls it into view after 150ms

handlePrint()
  └── buildPrintHtml(vaptReport)
        └── esc() HTML-escapes all user data
        └── Generates <!DOCTYPE html> with all CSS inline
        └── Cover table, executive summary, counts table, finding blocks
  └── createElement('iframe') → 0×0, opacity 0, pointer-events none
  └── document.body.appendChild(iframe)
  └── iframe.contentDocument.open() / .write(html) / .close()
  └── iframe.onload → (browser has fully rendered)
        └── iframe.contentWindow.focus()
        └── iframe.contentWindow.print()  ← opens system print dialog
        └── setTimeout 1000ms → document.body.removeChild(iframe)
```

---

## Authentication Flow

```
User logs in via Login.tsx
  └── supabase.auth.signInWithPassword({ email, password })
  └── Supabase issues a JWT (access_token) stored in browser localStorage

Any protected backend call
  └── supabase.auth.getSession() → session.access_token
  └── Attached as Authorization: Bearer <token>

Backend requireAuth middleware
  └── Reads Authorization header
  └── supabase.auth.getUser(token) — validates against Supabase's signing key
  └── Attaches request.user on success
  └── 401 on missing / invalid / expired token

User logs out via Navbar.tsx
  └── supabase.auth.signOut()
  └── JWT removed from localStorage
  └── onAuthStateChange fires → nav updates reactively
```

---

## Environment Variables Reference

### `backend/.env`

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `3001` | Express listen port |
| `SCAN_TIMEOUT_MS` | `10000` | HTTP fetch + TLS socket timeout (ms) |
| `NMAP_TIMEOUT_MS` | `60000` | Nmap child process timeout (ms) |
| `GROQ_API_KEY` | — | Groq API key — never sent to frontend |
| `GROQ_MODEL` | `llama-3.3-70b-versatile` | Groq model ID |
| `SUPABASE_URL` | — | Supabase project URL for JWT verification |
| `SUPABASE_ANON_KEY` | — | Supabase anon key for JWT verification |

### `frontend/.env.local`

| Variable | Default | Purpose |
|---|---|---|
| `VITE_API_BASE_URL` | `http://localhost:3001` | Backend base URL |
| `VITE_SUPABASE_URL` | — | Supabase project URL for browser client |
| `VITE_SUPABASE_ANON_KEY` | — | Supabase anon key for browser client |

No AI keys exist in the frontend environment.

---

## TypeScript Interfaces — `frontend/src/types/scan.ts`

| Interface | Fields |
|---|---|
| `ScanResponse` | status, message, targetUrl, upstreamStatus, headers[], whois, certificate, nmap |
| `HeaderReport` | header, status (Present/Missing), severity, recommendation |
| `CertificateReport` | issuer, validFrom, expiryDate, daysRemaining, tlsVersion, expiryStatus, note |
| `WhoisReport` | registrar, creationDate, expiryDate, updatedDate, nameServers[], organization, whoisStatus, note |
| `NmapReport` | ports[], nmapStatus, note |
| `NmapPort` | port, protocol, state, service, version |

ZAP types live in `ZapAlerts.tsx`:

| Interface | Fields |
|---|---|
| `ZapAlert` | alert, risk, confidence, description, solution, cweid, url, insight? |
| `ZapAlertInsight` | whatItIs, whyDangerous, exampleAttack, fix, secureCodeExample, codeLanguage, source |
| `ZapOverview` | title, summary, impact, riskLevel, recommendations[], quickWins[], nextStep, source |

VAPT types live in `VaptReport.tsx`:

| Interface | Fields |
|---|---|
| `VaptFinding` | id, title, owasp, riskLevel, description, evidence, impact, remediation |
| `VaptReportData` | targetUrl, scanDate, methodology, executiveSummary, totalFindings{}, findings[] |

---

## Graceful Degradation Summary

| Failure | Backend behaviour | Frontend behaviour |
|---|---|---|
| HTTP fetch fails (Axios) | Returns `status: 'partial'`, headers all Missing | Shows partial badge on scan card |
| HTTPS not used | Certificate returns `expiryStatus: 'unavailable'` | Card shows unavailable badge |
| WHOIS private/fails | Returns `whoisStatus: 'private'` or `'unavailable'` | Card shows amber badge |
| Nmap not installed | Returns `nmapStatus: 'unavailable'` | Card shows unavailable badge |
| Nmap timeout | Returns `nmapStatus: 'error'` with timeout message | Card shows error badge |
| ZAP Docker not running | `POST /zap/start` throws, caught → `502` | Shows error in status bar |
| `GROQ_API_KEY` missing | `/zap/alerts` returns deterministic fallback overview | `source: 'fallback'` in ZAP overview |
| `GROQ_API_KEY` missing | `/ai/summary` returns `503` | Shows inline error message |
| `GROQ_API_KEY` missing | `/ai/vapt-report` returns `503` | Shows inline error message |
| Groq API error | Falls back to deterministic overview for ZAP | AI endpoints return `502` |
| User not signed in | All protected endpoints return `401` | Error shown, buttons disabled |

---

## Known Remaining Issues (Non-Blocking)

- `ZapAlerts.tsx` still shows `source: 'Gemini'` / `source: 'Fallback'` badge labels
  on alert cards because the `ZapAlertInsight.source` field still uses the string
  `'gemini'` from the legacy Gemini era. The values are correct (`'fallback'`) but
  the display label says "Gemini" — cosmetic only.
- CORS is open (`cors()` with no origin list). Should be restricted to the
  frontend domain before public deployment.
- ZAP polling has no wall-clock timeout. If the spider scan stalls below 100%,
  the frontend will poll indefinitely.
- Dashboard shows only `target_url`, `status`, `created_at` — the full JSON
  (headers, WHOIS, cert, Nmap) is stored in Supabase but not surfaced in the UI.
