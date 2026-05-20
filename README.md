# S.H.A.M.S - SOC Hunting And Mitigation System

S.H.A.M.S is an AI-assisted SOC triage platform built for the Bellevue College SEC490/491 Senior Capstone. It turns high-volume OpenSearch security telemetry into grouped, explainable investigation cases, helps analysts pivot through evidence, and connects final decisions to MantisBT ticket workflows.

The project started from a Kibana/ELK-style SOC workflow, where analysts manually searched Suricata alerts, filtered noise, pivoted across IPs and signatures, and wrote tickets by hand. The final working version uses OpenSearch as the telemetry backend and adds an automated investigation layer on top of it.

## What S.H.A.M.S Solves

SOC analysts do not only need more logs. They need faster answers to practical questions:

- Which alerts are actually worth investigating?
- Are multiple logs part of the same case?
- What evidence supports escalation or closure?
- What pivot should be checked next?
- Has this source, destination, host, or behavior appeared in prior tickets?
- Can a ticket be drafted with enough context for another analyst to understand it?

S.H.A.M.S focuses on that workflow. It groups telemetry into case candidates, ranks the most important cases, uses OpenAI to reason over the evidence, executes follow-up pivots when needed, and preserves ticket/case history for analyst review.

## Core Capabilities

- **OpenSearch telemetry collection**
  - Queries Suricata, Zeek, HTTP, DNS, SSL, notice, connection, and alert datasets.
  - Uses OpenSearch fields verified against the working environment instead of relying on generic Kibana assumptions.
  - Generates evidence links back into OpenSearch Dashboards.

- **SOC case grouping**
  - Groups related logs into deterministic case records.
  - Uses category-aware fingerprints for C2, DNS tunneling, exploit attempts, brute force, recon, web exploitation, lateral movement, and malware.
  - Tracks first seen, last seen, log count, affected hosts, ports, indicators, and sample evidence.

- **AI-assisted investigation**
  - Sends structured case evidence to OpenAI.
  - Returns JSON verdicts, confidence, reasoning, classifications, ticket recommendations, and pivot requests.
  - Supports reassessment after pivot results are collected.

- **Automated Case Manager v1**
  - Launches a last-hour OpenSearch grouping run.
  - Ranks cases locally before spending AI calls.
  - Investigates the highest-value cases automatically.
  - Shows live progress, current stage, active case, events, and final investigation output.

- **Pivot execution**
  - Executes AI-recommended OpenSearch pivots.
  - Supports pivots over source IP, destination IP, signatures, CVEs, destination ports, HTTP URLs, target hosts, DNS names, TLS SNI, and extended time ranges.

- **MantisBT ticket workflow**
  - Checks for possible duplicate tickets.
  - Creates evidence-backed Mantis tickets.
  - Syncs user ticket history from Mantis.
  - Stores analyst memory locally so prior decisions can inform future triage.

## Architecture

```text
Network telemetry
      |
      v
Suricata / Zeek style security events
      |
      v
Fluent Bit / ingestion pipeline
      |
      v
OpenSearch indexes and dashboards
      |
      v
S.H.A.M.S Backend
  - OpenSearch collector
  - case grouping and fingerprinting
  - AI investigation service
  - pivot executor
  - Mantis integration
  - local JSON case/ticket stores
      |
      v
S.H.A.M.S React Frontend
  - Dashboard v1
  - Case Manager v1
  - Ticket Registry
```

## Application Views

### Dashboard v1

The dashboard presents grouped OpenSearch case candidates by SOC category. Analysts can inspect case evidence, run AI analysis, execute pivots, check duplicates, and create tickets from the same workflow.

### Case Manager v1

Case Manager v1 is the autonomous investigation console. It runs a last-hour OpenSearch grouping job, ranks cases, investigates the highest-value candidates with OpenAI, executes limited pivots, and displays live status as the run progresses.

### Ticket Registry

The ticket registry is the analyst memory layer. It stores created, synced, and manually added Mantis tickets, including network indicators, ticket status, OpenSearch context, analyst decisions, and reuse notes.

## High-Value Investigation Categories

S.H.A.M.S prioritizes categories that commonly produce actionable SOC work:

- Command and control / beaconing
- Exploit attempts
- DNS tunneling and suspicious DNS behavior
- Lateral movement
- Malware and Trojan activity
- Brute force authentication attempts
- Network reconnaissance and scanning
- Web exploitation
- HTTP protocol anomalies
- Dual-use or abused infrastructure
- External IP discovery

The collector combines broad OpenSearch queries with post-query classification and noise reduction. This was an important part of the final project because several expected fields from the original Kibana approach were empty or low-value in the live OpenSearch environment. The final version uses fields such as `rule.name`, `rule.category`, `dns.host`, `zeek.dns.query`, `http.host`, `http.uri`, `url.full`, `zeek.notice.note`, `zeek.notice.msg`, and `zeek.ssl.server_name`.

## Repository Layout

```text
.
|-- backend/
|   |-- server.js
|   |-- triage_collector.js
|   |-- opensearch.client.js
|   |-- mantis.client.js
|   |-- ai.service.js
|   |-- pivot_executor.js
|   `-- services/
|       |-- caseManagerV1.service.js
|       |-- caseCandidateSync.service.js
|       |-- caseFingerprint.service.js
|       |-- caseStore.service.js
|       |-- ticketContext.service.js
|       |-- ticketHistoryStore.service.js
|       |-- ticketRegistry.service.js
|       `-- mantis.service.js
|
|-- frontend/
|   |-- src/App.js
|   |-- src/CaseManagerV1Page.js
|   |-- src/TicketsPage.js
|   `-- src/App.css
|
`-- README.md
```

## Environment Configuration

Create `backend/.env`:

```env
PORT=5000

OPENSEARCH_NODE=https://your-opensearch-dashboards-or-node
OPENSEARCH_USERNAME=your_username
OPENSEARCH_PASSWORD=your_password
OPENSEARCH_MODE=direct
OPENSEARCH_INDEX=arkime_sessions3-*
OPENSEARCH_INDEX_PATTERN_ID=arkime_sessions3-*

MANTIS_URL=https://your-mantis
MANTIS_API_TOKEN=your_token
MANTIS_USERNAME=your_reporter_username

OPENAI_API_KEY=your_openai_key
OPENAI_CASE_MANAGER_MODEL=gpt-4o
CASE_MANAGER_V1_MAX_AI_CASES=5
CASE_MANAGER_V1_MAX_PIVOTS=2
```

Optional frontend environment:

```env
REACT_APP_BACKEND_URL=http://localhost:5000
REACT_APP_MANTIS_URL=https://your-mantis
```

Runtime data is stored locally under `backend/data/` and is intentionally ignored by Git. This keeps ticket history, run status, and local case state out of the public repository.

## Running Locally

Install and start the backend:

```powershell
cd backend
npm install
npm start
```

Install and start the frontend:

```powershell
cd frontend
npm install
npm start
```

Default local URLs:

```text
Backend:  http://localhost:5000
Frontend: http://localhost:3000
```

Health check:

```text
GET http://localhost:5000/api/health
```

## Key API Areas

- `GET /api/triage-summary-v1` - load grouped OpenSearch summary data.
- `POST /api/refresh-triage-v1` - refresh OpenSearch telemetry collection.
- `POST /api/analyze-case` - run AI analysis for a case.
- `POST /api/pivot-query` - execute an OpenSearch pivot.
- `POST /api/reassess-case` - reassess after pivot evidence.
- `POST /api/check-duplicates` - search Mantis for possible duplicates.
- `POST /api/tickets/create` - create a Mantis ticket.
- `GET /api/tickets/history` - load local ticket registry.
- `POST /api/tickets/sync` - sync Mantis tickets into local history.
- `GET /api/cases-v1/status` - load Case Manager v1 run status.
- `POST /api/cases-v1/start` - start the automated last-hour investigation agent.
- `POST /api/cases-v1/stop` - request a safe stop.

## Final Project Status

This repository is the final OpenSearch-workable version of S.H.A.M.S. It includes the stable capstone workflow:

- OpenSearch-backed telemetry collection
- Dashboard v1 case review
- AI case analysis and reassessment
- Automated Case Manager v1 investigation
- Evidence pivots
- Mantis duplicate checks, ticket creation, and ticket sync
- Local analyst memory through case and ticket history stores

The project demonstrates how a SOC workflow can move beyond raw alert dashboards into a case-centered, AI-assisted investigation process while keeping the analyst in control of final ticket submission.

## Security Notes

- Do not commit `backend/.env`.
- Do not commit runtime ticket/case JSON files from `backend/data/`.
- Keep Mantis API tokens, OpenSearch credentials, and OpenAI keys in environment variables.
- Review AI-generated ticket content before submitting to Mantis.

## Capstone Summary

S.H.A.M.S shows how OpenSearch, security telemetry, AI analysis, and ticketing can be combined into one analyst-focused workflow. The system reduces repetitive triage work, preserves investigation context, and helps turn noisy alerts into clear, evidence-backed cases.
