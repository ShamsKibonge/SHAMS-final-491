# S.H.A.M.S OpenSearch Workable Copy

This trimmed copy keeps only:

- Dashboard v1
- Case Manager v1
- Ticket Registry
- OpenSearch telemetry collection and evidence links
- Mantis ticket creation, duplicate checks, and ticket sync
- OpenAI-based case analysis, reassessment, and automated Case Manager v1 investigation

## Run

Backend:

```powershell
cd backend
npm install
npm start
```

Frontend:

```powershell
cd frontend
npm install
npm start
```

## Required Environment

Create `backend/.env` with the values for your environment:

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

Runtime data starts empty in `backend/data/` and will be populated by the app.
