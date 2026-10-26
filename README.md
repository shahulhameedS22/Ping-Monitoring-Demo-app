# Regional Ping Monitor

A professional, enterprise-grade network connectivity monitoring dashboard for regional data centers (**IN-DC01**, **IN-DC02**, **LK-DC01**, and **SG-DC01**) executing concurrent ping tests against `8.8.8.8` with Cloud Firestore session persistence.

---

## 🚀 Key Features

- **Direct Dashboard Access**: Opens directly to the main monitoring dashboard without any authentication barrier or login screen.
- **Enterprise Light-Blue Theme**: High-contrast, clean UI with white cards, subtle borders, soft shadows, and professional blue accents.
- **Four Regional Data Centers**:
  - **IN-DC01**: India Primary Data Center (Mumbai)
  - **IN-DC02**: India Secondary Data Center (Chennai)
  - **LK-DC01**: Sri Lanka Data Center (Colombo)
  - **SG-DC01**: Singapore Regional Hub (Jurong)
- **Zero Mock / Fake Telemetry**: Unexecuted nodes display neutral "Not Tested" states with dashes (`—`). No fabricated latency or simulated measurements.
- **Concurrent Regional Testing Architecture**: Ready to dispatch ICMP tests across all 4 regions in parallel with isolated fault handling when regional endpoints are configured.
- **Clear Unconfigured API Warning**: If regional endpoints are not yet set up, clicking "Run All Ping Tests" alerts the operator to connect authorized regional servers.
- **Ping Test Results Table**: Searchable, filterable, and sortable by region name, status, and average latency.
- **Cloud Firestore Persistence**: Genuine completed sessions, aggregate summaries, and individual DC metrics are saved securely under `/pingSessions`.
- **Test Session History**: Searchable and filterable audit log of historical tests with date and status filters.

---

## 🛠️ Technology Stack

- **Frontend**: React 19, TypeScript, Vite 8, Tailwind CSS v4, Lucide React icons
- **Backend / Persistence**: Cloud Firestore (Public Dashboard Mode with schema validation)
- **Security**: Hardened `firestore.rules` allowing public creation & query with immutable records

---

## 📦 Local Installation & Startup

1. **Install dependencies**:
   ```bash
   npm install
   ```

2. **Start the local development server**:
   ```bash
   npm run dev
   ```
   The application will be accessible at `http://localhost:3000`.

---

## 🌐 Deploying to Vercel

1. Push your repository to GitHub / GitLab.
2. Log into [Vercel](https://vercel.com/) and click **Add New > Project**.
3. Import your repository.
4. Set the build settings:
   - **Framework Preset**: Vite
   - **Build Command**: `npm run build`
   - **Output Directory**: `dist`
   - **Install Command**: `npm install`
5. Under **Environment Variables**, provide your regional API configuration variables (refer to `.env.example`).
6. Click **Deploy**.

---

## 📡 Regional Ping API Integration

Real regional ICMP ping tests will be executed by authorized network daemons residing on regional servers in Mumbai, Chennai, Colombo, and Singapore:

```
[Browser Client]
       │
       ▼ (HTTPS with API Key / Token)
[Regional API Gateway / Daemon]
       │ (Input sanitization: regex IPv4 & bounded count)
       ▼
[OS Subprocess: ping 8.8.8.8 -n 30]
       │
       ▼ (Structured JSON telemetry)
[Browser UI Dashboard]
```

### Security Directives for Regional Endpoints
1. **Never Allow Raw Shell Execution**: Daemons must use `execFile('ping', [targetIp, '-n', String(count)])` with explicit argument arrays, preventing shell interpolation exploits.
2. **Strict Regex Validation**: Ensure target IP matches `^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$`.
3. **Bound Request Range**: Clamp ping count between 1 and 100 packets.
4. **Rate Limiting**: Enforce a maximum of 10 ping sessions per minute per client.

The typed client interface is implemented in `src/services/regionalApi.ts` and can be configured via environment variables.

---

## 🏛️ Central Backend Architecture & Regional VM Integration

To keep regional network infrastructure secure and eliminate browser CORS / Mixed Content issues, this application employs a secure full-stack Node.js / Express central proxy backend (`server.ts`).

### 1. File Changes Summary
* **New Files**:
  * `server.ts`: Central Express backend providing `/api/health`, `/api/regions`, `/api/regions/:regionId/health`, and `/api/regions/:regionId/ping`. Integrates Vite middleware in dev and serves static production build on Cloud Run.
* **Modified Files**:
  * `src/services/regionalApi.ts`: Updated to call same-origin relative `/api/regions/${regionId}/*` routes instead of direct browser-to-agent URLs.
  * `package.json`: Updated `"dev": "tsx server.ts"` and added `"start": "tsx server.ts"` for containerized deployment.
  * `tsconfig.json`: Added `"node"` to `compilerOptions.types` to support Node.js and Express APIs in TypeScript.
  * `.env.example`: Added server-side environment variables for regional agent endpoints and authentication.

---

### 2. Required Environment Variables
Server-side environment variables (never prefix with `VITE_` or expose in client bundles):

| Variable | Description | Default / Example |
| :--- | :--- | :--- |
| `PORT` | Listening port for Express / Cloud Run | `3000` (or `8080` in Cloud Run) |
| `REQUIRE_AUTH` | Enforce auth tokens on `/api/*` routes | `false` (dev) / `true` (prod) |
| `CENTRAL_API_KEY` | Secret key for central API access | `your-secret-api-key` |
| `REGIONAL_IN_DC02_URL` | Endpoint for Test-In-dc02 Ubuntu VM | `http://10.202.202.61:8080` |
| `REGIONAL_IN_DC01_URL` | Endpoint for IN-DC01 | *(Unconfigured by default)* |
| `REGIONAL_LK_DC01_URL` | Endpoint for LK-DC01 | *(Unconfigured by default)* |
| `REGIONAL_SG_DC01_URL` | Endpoint for SG-DC01 | *(Unconfigured by default)* |
| `REGIONAL_API_KEY` | Shared secret forwarded to regional daemons | `your-agent-auth-token` |

---

### 3. How to Run the App Locally
```bash
# 1. Install dependencies
npm install

# 2. Start the full-stack development server (Express + Vite middleware)
npm run dev
```
Open [http://localhost:3000](http://localhost:3000) in your browser.

---

### 4. How to Test the Backend Routes
You can test the central backend API routes directly using `curl`:

```bash
# General central health check
curl http://localhost:3000/api/health

# List supported regions and configuration status
curl http://localhost:3000/api/regions

# Health check on IN-DC02 (Test-In-dc02)
curl http://localhost:3000/api/regions/IN-DC02/health

# Health check on unconfigured region (e.g. IN-DC01)
curl http://localhost:3000/api/regions/IN-DC01/health

# Execute 30 pings to 8.8.8.8 via IN-DC02
curl -X POST http://localhost:3000/api/regions/IN-DC02/ping \
  -H "Content-Type: application/json" \
  -d '{"targetIp": "8.8.8.8", "count": 30}'

# Test security guard: Attempting an arbitrary IP is strictly rejected
curl -X POST http://localhost:3000/api/regions/IN-DC02/ping \
  -H "Content-Type: application/json" \
  -d '{"targetIp": "1.1.1.1", "count": 30}'
# Response: HTTP 400 Bad Request: Only fixed target 8.8.8.8 is permitted.
```

---

### 5. Why the Private VM (`10.202.202.61`) Cannot Be Reached Directly Without a Network Connection
* **Private Subnet Isolation**: `10.202.202.61` is an RFC 1918 private IPv4 address residing on the isolated local subnet of the `Test-In-dc02` Ubuntu VM.
* **No Default Internet Route**: Any machine outside that private network (including development containers or standard Cloud Run environments) cannot route packets to `10.202.202.61` without a private gateway or tunnel.
* **Safe Degradation**: When connectivity is absent, the central backend fails safely with a clear, sanitized error message (`502 Bad Gateway / Network unreachable`) rather than hanging or crashing.

---

### 6. What Must Be Configured Before Deployment to Cloud Run
1. **Serverless VPC Access Connector / Direct VPC Egress**:
   * Attach Cloud Run to the same Google Cloud Virtual Private Cloud (VPC) where `Test-In-dc02` resides.
   * Enable private VPC routing so Cloud Run can route `10.x.x.x` traffic to the VM.
2. **VM Firewall Rules**:
   * On Google Cloud (or on-premise firewall), allow ingress on TCP port `8080` from the VPC connector IP range or Cloud Run subnet only.
   * Do not open port `8080` to `0.0.0.0/0` (public internet).
3. **Agent Bind Address**:
   * Ensure the Python ping daemon on `Test-In-dc02` listens on `0.0.0.0:8080` (or its private network interface), NOT solely on loopback `127.0.0.1:8080`.
4. **Production Authentication**:
   * Set `REQUIRE_AUTH=true` and configure `CENTRAL_API_KEY` on Cloud Run.
   * Set `REGIONAL_API_KEY` to authenticate backend-to-agent requests.
5. **Container Start Script**:
   * Ensure `npm start` runs `tsx server.ts` (configured in `package.json`).

---

## 📄 License
Apache-2.0

