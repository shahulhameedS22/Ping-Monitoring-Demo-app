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
- **Concurrent Regional Testing Architecture**: Dispatches ICMP tests across all 4 regions in parallel with isolated fault handling when regional endpoints are configured.
- **Clear Unconfigured API Warning**: If regional endpoints are not yet set up, clicking "Run All Ping Tests" alerts the operator with descriptive errors rather than fake data.
- **Ping Test Results Table**: Searchable, filterable, and sortable by region name, status, and average latency.
- **Cloud Firestore Persistence**: Genuine completed sessions, aggregate summaries, and individual DC metrics are saved securely under `/pingSessions`.
- **Test Session History**: Searchable and filterable audit log of historical tests with date and status filters.

---

## 🛠️ Technology Stack

- **Frontend**: React 19, TypeScript, Vite 8, Tailwind CSS v4, Lucide React icons
- **Backend / Serverless**: Express 4, Node.js 22 runtime, Vercel Serverless Functions (`api/index.ts`)
- **Persistence**: Cloud Firestore (Public Dashboard Mode with schema validation)
- **Security**: Hardened `firestore.rules`, constant-time token comparison for `CENTRAL_API_KEY`, fixed target `8.8.8.8` enforcement.

---

## 🌐 Deploying to Vercel

The application is structured for seamless zero-configuration deployment on **Vercel** as a hybrid static web app with serverless API functions.

### Architecture Overview on Vercel
```
┌────────────────────────────────────────────────────────┐
│                   Vercel Edge Network                  │
└───────────────┬────────────────────────┬───────────────┘
                │                        │
       Static Assets & SPA        /api/* Routes
                │                        │
                ▼                        ▼
        Vite Build (dist/)      api/index.ts (Serverless)
        - index.html            - Express API (src/server/app.ts)
        - JS/CSS bundles        - GET  /api/health
                                - GET  /api/regions
                                - GET  /api/regions/:regionId/health
                                - POST /api/regions/:regionId/ping
```

### Step-by-Step Vercel Setup

1. **Import Repository**:
   - Push your code to GitHub, GitLab, or Bitbucket.
   - In Vercel, click **Add New > Project** and import the repository.

2. **Build Settings**:
   - Vercel automatically detects `vercel.json` and Vite:
     - **Framework Preset**: `Vite`
     - **Build Command**: `vite build`
     - **Output Directory**: `dist`
     - **Install Command**: `npm install`

3. **Configure Environment Variables** (in Vercel Project Settings > Environment Variables):
   - `REQUIRE_AUTH`: Set to `true` (enforced by default in production).
   - `CENTRAL_API_KEY`: Secret string for authenticating API requests to `/api/*`.
   - `REGIONAL_API_KEY`: Optional shared secret forwarded to regional ping daemons.
   - `REGIONAL_IN_DC02_URL`: URL of the IN-DC02 agent (leave blank until a secure tunnel/gateway is connected).
   - `REGIONAL_IN_DC01_URL`: URL of the IN-DC01 agent (leave blank until deployed).
   - `REGIONAL_LK_DC01_URL`: URL of the LK-DC01 agent (leave blank until deployed).
   - `REGIONAL_SG_DC01_URL`: URL of the SG-DC01 agent (leave blank until deployed).

4. **Deploy**:
   - Trigger deployment via Vercel dashboard or CLI (`vercel --prod`).

---

## 🔒 Security & Authentication Directives

1. **Production Token Verification**:
   - In production or when `REQUIRE_AUTH=true`, the API enforces constant-time string comparison (`crypto.timingSafeEqual`) against `CENTRAL_API_KEY`.
   - Requests must provide `Authorization: Bearer <CENTRAL_API_KEY>` or `X-API-Key: <CENTRAL_API_KEY>`.
   - Arbitrary or generic Bearer tokens are strictly rejected.
   - If `REQUIRE_AUTH=true` and `CENTRAL_API_KEY` is missing in the environment, the backend responds with HTTP 500 configuration error.
2. **Fixed Target Enforcement**:
   - The central backend strictly permits ping tests targeting `8.8.8.8`. Requests attempting to target arbitrary IP addresses are rejected with HTTP 400.
3. **No Secret Leakage**:
   - `CENTRAL_API_KEY`, `REGIONAL_API_KEY`, and internal IP configurations are strictly server-side environment variables and are never bundled into client-side `VITE_` variables.

---

## 📡 Private VM Networking Notice (`10.202.202.61`)

- **Why Vercel Cannot Directly Reach `10.202.202.61`**:
  `10.202.202.61` is an RFC 1918 private IPv4 address on the `Test-In-dc02` Ubuntu VM. Vercel serverless functions execute in dynamic public cloud environments and have no default route into private subnets.
- **Handling on Vercel**:
  `REGIONAL_IN_DC02_URL` is intentionally unconfigured by default on Vercel. Attempting to test IN-DC02 returns a clean HTTP 503 error stating that the regional endpoint requires a secure VPC or tunnel connection.
- **Connecting the Private VM**:
  To enable Vercel to reach the test VM securely without exposing port 8080 publicly:
  1. **Tailscale / WireGuard Subnet Router**: Run a Tailscale node on the VM and route traffic via an authorized gateway.
  2. **Cloudflare Tunnel (cloudflared)**: Run `cloudflared` on the Ubuntu VM to expose an encrypted, authenticated HTTPS hostname (e.g. `https://in-dc02.internal.example.com`) without opening any inbound ports on the firewall.
  3. **Vercel Secure Compute / VPC Peering**: Connect Vercel to your cloud provider's VPC.

---

## 💻 Local Development & Testing

1. **Install Dependencies**:
   ```bash
   npm install
   ```

2. **Start Local Full-Stack Server** (Express + Vite Middleware):
   ```bash
   npm run dev
   ```
   Open `http://localhost:3000` in your browser.

3. **Production Build**:
   ```bash
   npm run build
   ```
   Generates optimized static assets in `dist/`.

4. **Verify TypeScript & Lint**:
   ```bash
   npm run lint
   ```

---

## 📄 License
Apache-2.0
