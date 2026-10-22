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

## 📄 License
Apache-2.0
