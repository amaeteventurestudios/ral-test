# Reydious Autonomy Lab — v3.0

**Governed multi-robot control dashboard · Private demo environment**

---

## Overview

Reydious Autonomy Lab (RAL) is a mission-control web application for governing 2–3 ESP32 autonomous robots. Every operator command passes through a full governance pipeline before reaching a robot:

```
Operator → Policy Engine → Safety Envelope → Handshake → Queue → Dispatch → Ack Polling → Audit Log
```

Authentication is required (demo: `operator` / `autonomy`). The site is noindex/nofollow throughout.

---

## Pages & Routes

| Path | Description |
|---|---|
| `/` or `/login` | Login screen |
| `/dashboard` | Main mission-control grid |
| `/robots` | Robot configuration and protocol testing |
| `/policies` | Governance rules editor and policy simulation |
| `/logs` | Full audit log with filters and CSV export |
| `/protocol` | ESP32 API contract documentation |
| `/about` | System info and version |

---

## Completed Features

### Navigation & Header
- Top nav: Dashboard, Robots, Policies, Logs, **Protocol**, About
- Header shows: *Reydious Autonomy Lab – **Demonstration Environment***
- Mobile hamburger drawer with all nav links
- Status strip: Policy Engine, Simulation Mode toggle, Connected Robots, Operator, Last Decision, Reset Demo

### Dashboard Panels
- **Robot Fleet** — R-01/02/03 with connection status, battery, RSSI, latency, heartbeat, mode; selection; details drawer
- **Command Console** — move/turn/stop/E-Stop buttons, speed slider, autonomy controls with operator unlock; Draft command preview; Send for Validation pipeline; **Manual Command Input** (collapsible, supports any command name + JSON parameters + target robot selection, goes through full pipeline)
- **Policy Decision** — real-time rule evaluation display, approved/blocked/would-block status
- **Telemetry** — per-robot battery, RSSI, speed, state, uptime metrics; Chart.js history charts with mobile toggle
- **Command Queue** — FIFO with pipeline header (Operator→Policy→Safety→Handshake→Execute); inline active command badge on desktop; expandable list on mobile/tablet
- **Command Audit Log** — resizable/expandable panel with drag handle; table columns: Time, Cmd ID, Robot(s), Command, Validation, Safety, Handshake, Dispatch, Ack, Rule, Operator; CSV export

### Governance Pipeline
- **Policy Engine** — max speed, indoor speed limit, autonomy unlock, disconnected robot block, low battery block; dynamic custom rules; Strict/Training modes
- **Safety Envelope** — battery floor check, speed limits, acceleration/turn rate
- **Handshake** — verified before commands; marks robot Unverified on failure
- **Command Queue** — FIFO processor (1.2 s interval, 800 ms execution)
- **Ack State Simulation** — received → executing → completed transitions; logged to audit

### /protocol Page
Full ESP32 HTTP REST API documentation:
- `POST /handshake` — firmware verification, capabilities
- `POST /command` — command dispatch with commandId, params
- `GET /command/:commandId/status` — ack polling (250–500 ms)
- `GET /telemetry` — sensor data, 1 s poll
- `GET /heartbeat` — liveness check, 5 s disconnect timeout
- `POST /estop` — safety-critical, bypasses pipeline
- Governed execution pipeline diagram
- Security/headers section (X-API-Key, noindex, Simulation Mode)

### /robots Page
- Registered Robots table with Connect/Disconnect, Ping, Edit, Remove actions
- Robot Configuration form (name, ID, connection type, IP, port, API key)
- **Robot Protocol Settings** — Test Connection runs: Handshake, Heartbeat, Telemetry, Latency tests sequentially; shows live results with OK/FAIL status

### Audit Log — Extended Columns
| Column | Description |
|---|---|
| Cmd ID | Short command ID (7 chars) |
| Validation | APPROVED / BLOCKED / WOULD_BLOCK |
| Safety | PASSED / BLOCKED / WARN / SKIPPED |
| Handshake | OK / FAIL / — |
| Dispatch | SENT / NOT DISPATCHED / REJECTED |
| Ack | received / executing / completed / failed / timeout |
| Endpoint | Robot HTTP endpoint used |

### Simulation Mode
- ON by default — all network calls mocked with realistic latency
- Ack state transitions simulated: received → executing → completed
- Protocol test panel shows simulated results
- OFF → real HTTP requests to configured ESP32 endpoints

### Security & No-Index
- Meta robots noindex/nofollow/noarchive/nosnippet on all pages
- `robots.txt` disallows all crawlers and AI bots
- `vercel.json` adds `X-Robots-Tag: noindex, nofollow` header on all routes
- Session persisted in localStorage only

---

## Data Model

```javascript
Robot {
  id, name, ipAddress, port, connectionType,
  connected, mode, battery, rssi, speed, movementState,
  uptime, lastHeartbeat, firmware,
  handshakeStatus,   // 'verified' | 'unverified'
  latency,           // ms
  capabilities,      // string[]
  apiKey,            // optional
  commands[]         // last 10 commands
}

AuditLogEntry {
  id, requestId, policyDecisionId, commandId,
  time, timestamp, robot, command,
  validation,        // APPROVED | BLOCKED | WOULD_BLOCK
  execution,         // EXECUTED | NOT EXECUTED
  safetyCheck,       // PASSED | BLOCKED | WARN | SKIPPED
  handshakeVerified, // true | false | null
  dispatchStatus,    // SENT | NOT DISPATCHED | REJECTED
  ackState,          // received | executing | completed | failed | timeout | Not Executed
  ackTimestamp,      // ms
  robotEndpoint,     // http://ip:port/command or [sim]
  rule, operator, speed, notes, mode, environment
}
```

---

## Architecture

```
index.html          Main SPA (all pages)
css/style.css       Full dark-theme stylesheet (~2100 lines)
js/app.js           Application logic (~2900 lines)
robots.txt          Disallow all crawlers
vercel.json         X-Robots-Tag headers + SPA rewrites
```

---

## Responsive Breakpoints

| Width | Layout |
|---|---|
| ≤767 px | Single-column stack |
| 768–1023 px | 2-column tablet grid |
| 1024–1439 px | 3-column desktop (240 / 1fr / 300 px) |
| ≥1440 px | Wide (260 / 1fr / 320 px, max 1600 px) |

---

## Pending / Possible Next Steps

- Real-time WebSocket connection to ESP32 robots
- Multi-operator session support
- Fleet map visualization
- Video feed integration from robot cameras
- Firmware OTA update via dashboard
- Export audit logs to remote logging service

---

## Local Preview (Static Site)

This repo is a static HTML app (no `package.json`, no framework dev server required).

Use the helper script so the server always starts from the correct folder:

```bash
./scripts/serve-static.sh 8000
```

Then open:

- `http://127.0.0.1:8000/`
- `http://127.0.0.1:8000/index.html`

### Why the previous 404 happened

`python3 -m http.server` serves the **current working directory**. If it is started from the wrong folder (for example `/workspace` instead of `/workspace/ral-test`), `/index.html` returns `404` because that directory has no app `index.html`.
