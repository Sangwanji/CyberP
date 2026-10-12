# CyberP

An AI-powered web vulnerability scanner. Enter a target URL and the Express backend runs multiple reconnaissance checks in parallel. The React frontend renders the results as a unified dashboard. Authenticated users get persistent scan history via Supabase. After any scan, Groq AI can generate a quick executive summary or a full printable security report containing headers, SSL, WHOIS, port scan, ZAP alerts, and AI-generated findings.

## Live Demo

- **Web App:** [https://web-vulnerability-platform.vercel.app](https://web-vulnerability-platform.vercel.app)
- **Credentials:** Request demo access from the project maintainer.

---

## Features

- **Combined scan mode** — one button runs both a regular scan and an OWASP ZAP scan sequentially, or each can be triggered individually
- **Security header analysis** — checks six headers (CSP, HSTS, X-Frame-Options, Referrer-Policy, Permissions-Policy, X-Content-Type-Options) with severity ratings and remediation advice
- **SSL/TLS certificate inspection** — issuer, TLS version, expiry date, and days remaining via a raw TLS socket
- **WHOIS lookup** — registrar, organization, creation/expiry dates, name servers, with graceful handling of private records
- **Nmap port scanning** — unprivileged TCP connect scan spawned as a child process, XML output parsed to a structured port list
- **OWASP ZAP integration** — spider scan via ZAP REST API, frontend polls progress every 2s with a timeout guard, alerts grouped by risk level
- **Groq AI ZAP overview** — backend calls Groq to generate a concise scan summary with impact, recommendations, and quick wins
- **Quick AI Summary** — proxies scan data through the backend to Groq and returns a markdown executive summary
- **Full Security Report generator** — combines Groq AI findings with raw scan data (headers, SSL, WHOIS, ports, ZAP alerts) into a single structured report
- **Print / Export PDF** — the report renders a fully isolated A4 print layout that exports cleanly from any browser
- **Authentication-protected API** — all scan, ZAP, and AI endpoints require a valid Supabase JWT
- **Groq key never leaves the server** — all AI calls are proxied through backend endpoints; no API keys in the browser bundle
- **Supabase authentication** — email/password login, signup, and session management
- **Persistent scan history** — regular scan results saved to Supabase Postgres with Row Level Security

---

## Tech Stack

### Frontend

| Technology | Version | Purpose |
|---|---|---|
| React | 19 | UI and component logic |
| TypeScript | 6 | Type safety |
| Vite | 8 | Dev server and build tool |
| React Router | v7 | Client-side routing |
| Tailwind CSS | v3 | Utility-first styling with custom dark cyber theme |
| Supabase JS | v2 | Authentication, database client, and JWT retrieval |

### Backend

| Technology | Version | Purpose |
|---|---|---|
| Node.js (ESM) | 20 | Runtime |
| Express | 5 | API server |
| @supabase/supabase-js | v2 | JWT verification |
| axios | v1 | HTTP fetch of target page and ZAP REST API calls |
| whois-json | v2 | WHOIS domain lookups |
| xml2js | v0.6 | Nmap XML output parsing |
| ws | v8 | WebSocket polyfill for Supabase on Node.js 20 |
| dotenv | v17 | Environment variable loading |

### External Services

| Service | Purpose |
|---|---|
| Supabase | Postgres + Row Level Security + Auth |
| OWASP ZAP | Spider scan and vulnerability discovery |
| Nmap | Port scanning (TCP connect, unprivileged) |
| Groq | ZAP overview, Quick AI Summary, VAPT report (server-side only) |

---

## Project Structure

```
cyberp/
├── backend/
│   ├── src/
│   │   ├── server.js         # Express app bootstrap and router mounting
│   │   ├── controllers/      # HTTP request/response handlers
│   │   ├── middleware/       # Authentication and error handling
│   │   ├── routes/           # Scan and ZAP endpoint definitions
│   │   ├── services/         # Scan, ZAP, and Groq integrations
│   ├── Dockerfile            # node:20-bookworm-slim + nmap baked in
│   ├── .dockerignore
│   ├── package.json
│   ├── .env                  # Local secrets — never committed
│   └── .env.example
├── frontend/
│   ├── src/
│   │   ├── App.tsx            # BrowserRouter and route definitions
│   │   ├── pages/
│   │   │   ├── Scanner.tsx    # Main page — scan controls, results, AI reports, PDF export
│   │   │   ├── Dashboard.tsx  # Authenticated scan history table
│   │   │   ├── Login.tsx      # Email/password sign-in
│   │   │   └── Signup.tsx     # New account registration
│   │   ├── components/
│   │   │   ├── Navbar.tsx     # Reactive nav — adapts to auth state
│   │   │   ├── ZapAlerts.tsx  # ZAP results grouped by risk with expandable cards
│   │   │   └── VaptReport.tsx # Full security report — screen UI + PDF print layout
│   │   ├── lib/
│   │   │   ├── scanApi.ts     # Typed fetch helpers — attaches JWT to every backend call
│   │   │   └── supabaseClient.ts
│   │   └── types/
│   │       └── scan.ts        # TypeScript interfaces for scan responses
│   ├── tailwind.config.ts
│   ├── vite.config.ts
│   ├── .env.local             # Local env vars — never committed
│   └── .env.example
├── BACKEND_ARCHITECTURE.md    # Detailed backend data-flow documentation
├── README.md
└── notes.md
```

---

## Backend Architecture

A detailed walkthrough lives in [`BACKEND_ARCHITECTURE.md`](./BACKEND_ARCHITECTURE.md). Here is the high-level picture.

### Request flow

```
Browser (React)
    │  HTTPS · Authorization: Bearer <jwt>
    ▼
┌──────────────────────────────────────────────────────────────┐
│                     Express Backend                          │
│                                                              │
│  requireAuth ──► supabase.auth.getUser(token)                │
│                                                              │
│  POST /scan           Promise.all([                          │
│                         axios.get()    → HTTP headers        │
│                         fetchWhois()   → WHOIS data          │
│                         fetchCert()    → SSL/TLS cert        │
│                         runNmap()      → open ports          │
│                       ])                                     │
│                                                              │
│  POST /zap/start      ZAP spider scan (depth 3, children 10) │
│  GET  /zap/status/:id ZAP progress (0–100)                   │
│  GET  /zap/alerts     ZAP alerts (capped 100) + Groq overview│
│                                                              │
│  POST /ai/summary     scan data → Groq → markdown summary    │
│  POST /ai/vapt-report scan data → Groq → JSON findings       │
└──────┬───────────────────────────────────────────────────────┘
       ├──► Supabase  (JWT verify only)
       ├──► OWASP ZAP (localhost:8080 or Railway private)
       ├──► Nmap      (child process, XML stdout → xml2js)
       └──► Groq API  (GROQ_API_KEY never in browser)
```

### Regular scan — parallel execution

```
POST /scan
  └── Promise.all([
        axios.get(url)        → reads live HTTP response headers
        fetchWhois(url)       → DNS + WHOIS lookup, normalised across registrars
        fetchCertificate(url) → raw tls.connect() socket, getPeerCertificate()
        runNmapScan(hostname) → execFile('nmap', ['--unprivileged','-sT',...,'-oX','-'])
      ])
```

Each module fails independently — if the HTTP fetch times out, SSL/WHOIS/Nmap still return data and the response uses `status: "partial"`.

### ZAP scan flow

```
POST /zap/start
  ├── clearZapSession()          wipes stale alerts from previous scans
  ├── setOptionMaxDepth(3)       prevents endless crawling on large sites
  ├── setOptionMaxChildren(10)
  └── GET /JSON/spider/action/scan/ → scanId

Frontend polls GET /zap/status/:id every 2s
  └── stops at 100% or after 90 polls (3-minute timeout)

GET /zap/alerts
  ├── GET /JSON/core/view/alerts/?start=0&count=100
  ├── enrichZapAlerts()          attaches fallback insight to each alert
  └── generateZapOverview()      calls Groq for a concise summary
```

### AI report generation

```
POST /ai/vapt-report
  ├── buildVaptPrompt(scanResult, zapAlerts)
  │     packs: target, SSL, WHOIS, open ports, missing headers, ZAP CWEs
  └── Groq (temperature 0.2, response_format: json_object)
        └── { executiveSummary, totalFindings, findings[] }

Frontend assembles final report:
  setVaptReport({
    ...groqData,
    scanResult,   ← raw scan (headers, SSL, WHOIS, ports)
    zapAlerts,    ← raw ZAP alerts
  })

PDF export:
  buildPrintHtml(report)
    ├── pure inline CSS, A4 @page
    ├── all values HTML-escaped via esc()
    └── sections: cover · summary · headers · SSL · WHOIS · ports · ZAP · findings
  → hidden <iframe> → iframe.contentWindow.print()
```

### Graceful degradation

| Module | On failure | Behaviour |
|---|---|---|
| HTTP headers fetch | network error | all headers marked Missing, `status: "partial"` |
| SSL/TLS | socket error | `expiryStatus: "unavailable"` with note |
| WHOIS | lookup fails | `whoisStatus: "unavailable"` with note |
| Nmap | not installed or timeout | `nmapStatus: "unavailable"` or `"error"` |
| ZAP | connection refused | 502 with descriptive message |
| ZAP alerts | 20s timeout | error returned, frontend shows partial results |
| Groq ZAP overview | any error | deterministic fallback built from alert data |
| Groq AI endpoints | key missing | 503 `"AI service is not configured"` |

---

## Deployment Architecture

```
┌─────────────────────────────────────────┐
│  Vercel (Frontend)                      │
│  React + Vite static build              │
└──────────────┬──────────────────────────┘
               │ HTTPS API calls
               ▼
┌─────────────────────────────────────────┐     ┌──────────────────────────┐
│  Railway / VPS (Backend)                │────▶│  OWASP ZAP               │
│  Express + nmap (Dockerfile)            │     │  zaproxy/zap-stable      │
└──────────────┬──────────────────────────┘     │  :8080 (private only)    │
               │                                └──────────────────────────┘
               ▼
┌─────────────────────────────────────────┐
│  Supabase                               │
│  Postgres + Auth + JWT verification     │
└─────────────────────────────────────────┘
```

ZAP has no public domain — only the backend can reach it.

---

## Running Locally

### Prerequisites

- Node.js 20+
- nmap (`sudo apt install nmap` / `brew install nmap` / `winget install nmap`)
- Docker (for OWASP ZAP)

### 1. Backend

```bash
cd backend
cp .env.example .env
# fill in your keys — see Environment Variables below
npm install
npm run dev
```

### 2. Frontend

```bash
cd frontend
cp .env.example .env.local
# set VITE_API_BASE_URL=http://localhost:3001
npm install
npm run dev
```

### 3. OWASP ZAP

```bash
docker run -d --name owasp-zap \
  -p 8080:8080 \
  zaproxy/zap-stable \
  zap.sh -daemon \
  -host 0.0.0.0 \
  -port 8080 \
  -config api.disablekey=true \
  -config "api.addrs.addr.name=.*" \
  -config api.addrs.addr.regex=true
```

Wait ~60 seconds for ZAP to boot, then open **http://localhost:5173**.

---

## Environment Variables

### Backend (`backend/.env`)

```env
PORT=3001
SCAN_TIMEOUT_MS=10000
NMAP_TIMEOUT_MS=30000
GROQ_API_KEY=your_groq_api_key
GROQ_MODEL=llama-3.3-70b-versatile
SUPABASE_URL=your_supabase_project_url
SUPABASE_ANON_KEY=your_supabase_anon_key
ALLOWED_ORIGINS=http://localhost:5173
ZAP_API_URL=http://localhost:8080
ZAP_TIMEOUT_MS=120000
```

In production set `ALLOWED_ORIGINS` to your frontend URL and `ZAP_API_URL` to the ZAP container address.

### Frontend (`frontend/.env.local`)

```env
VITE_API_BASE_URL=http://localhost:3001
VITE_SUPABASE_URL=your_supabase_project_url
VITE_SUPABASE_ANON_KEY=your_supabase_anon_key
```

Get a free Groq API key at [console.groq.com](https://console.groq.com).

---

## API Reference

All endpoints except `/health` require `Authorization: Bearer <supabase_jwt>`.

| Method | Path | Description |
|---|---|---|
| GET | `/health` | Public health check |
| POST | `/scan` 🔒 | Headers + SSL + WHOIS + Nmap in parallel |
| POST | `/zap/start` 🔒 | Start ZAP spider scan |
| GET | `/zap/status/:id` 🔒 | ZAP scan progress (0–100) |
| GET | `/zap/alerts?url=` 🔒 | ZAP alerts + Groq overview |
| POST | `/ai/summary` 🔒 | Groq markdown executive summary |
| POST | `/ai/vapt-report` 🔒 | Groq structured JSON findings |

### `POST /scan` response shape

```json
{
  "status": "success",
  "targetUrl": "https://example.com",
  "upstreamStatus": 200,
  "headers": [
    { "header": "Content-Security-Policy", "status": "Missing", "severity": "high", "recommendation": "..." }
  ],
  "certificate": {
    "issuer": "Let's Encrypt", "tlsVersion": "TLSv1.3",
    "daysRemaining": 64, "expiryStatus": "valid"
  },
  "whois": {
    "registrar": "Namecheap", "creationDate": "2020-01-01T00:00:00.000Z",
    "nameServers": ["ns1.example.com"], "whoisStatus": "available"
  },
  "nmap": {
    "ports": [{ "port": 443, "protocol": "tcp", "state": "open", "service": "https", "version": "unknown" }],
    "nmapStatus": "success"
  }
}
```

### `POST /ai/vapt-report` response shape

```json
{
  "success": true,
  "report": {
    "executiveSummary": "...",
    "totalFindings": { "critical": 0, "high": 1, "medium": 2, "low": 1, "informational": 0 },
    "findings": [{
      "id": "VAPT-01",
      "title": "Missing Content Security Policy",
      "owasp": "A05:2021 – Security Misconfiguration",
      "riskLevel": "HIGH",
      "description": "...",
      "evidence": "Header absent in HTTP response",
      "impact": "...",
      "remediation": "..."
    }]
  }
}
```

---

## Database Schema

```sql
CREATE TABLE scans (
  id            UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id       UUID REFERENCES auth.users NOT NULL,
  target_url    TEXT NOT NULL,
  status        TEXT NOT NULL,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  upstream_status INT,
  headers       JSONB,
  whois         JSONB,
  certificate   JSONB,
  nmap          JSONB
);

ALTER TABLE scans ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can insert their own scans"
  ON scans FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can view their own scans"
  ON scans FOR SELECT USING (auth.uid() = user_id);
```

---

## Known Limitations

- **SSRF protection is scheme-only** — `validateTargetUrl` rejects non-http/https but does not resolve the hostname to block private IP ranges (192.168.x, 10.x, 127.x)
- **Nmap service versions always `unknown`** — `-sV` requires `CAP_NET_RAW` which is unavailable in Docker without `--privileged`; TCP connect scan works but skips version detection
- **No dashboard drill-down** — full scan JSON is stored in Supabase but the Dashboard only shows target URL and status; a detail view is not implemented
- **No protected route component** — Dashboard auth check runs in `useEffect`, causing a brief loading flash before redirect to login
- **ZAP scan history accumulates** — `clearZapSession()` is called before each scan to wipe the ZAP database, but a ZAP restart is needed if the container accumulates too much state
