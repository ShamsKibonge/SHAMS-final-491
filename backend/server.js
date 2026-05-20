import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import fs from 'fs';
import OpenSearchClient from './opensearch.client.js';
import MantisClient from './mantis.client.js';
import { collectTriageData, getTriageStoragePaths } from './triage_collector.js';
import { analyzeCase, reassessCase, summarizeTicket } from './ai.service.js';
import { executePivotQuery } from './pivot_executor.js';
import * as ticketRegistry from './services/ticketRegistry.service.js';
import * as historyStore from './services/ticketHistoryStore.service.js';
import {
    getCaseManagerV1OutputFilePath,
    getCaseManagerV1Status,
    requestCaseManagerV1Stop,
    startCaseManagerV1Run,
} from './services/caseManagerV1.service.js';

dotenv.config();

const app = express();
const port = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

const opensearch = new OpenSearchClient(
    process.env.OPENSEARCH_NODE,
    process.env.OPENSEARCH_USERNAME,
    process.env.OPENSEARCH_PASSWORD,
    process.env.OPENSEARCH_MODE,
    process.env.OPENSEARCH_INDEX
);

const mantis = new MantisClient(
    process.env.MANTIS_URL,
    process.env.MANTIS_API_TOKEN
);

app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', message: 'OpenSearch backend is running' });
});

app.get('/api/tickets/test', (req, res) => {
    res.json({ status: 'ok', message: 'Endpoint reachable' });
});

app.get('/api/check-opensearch', async (req, res) => {
    try {
        const result = await opensearch.authenticate();
        res.json({
            status: 'success',
            message: 'Successfully connected to OpenSearch',
            details: typeof result === 'object' ? result : { result },
        });
    } catch (err) {
        res.status(500).json({ status: 'error', message: err.message });
    }
});

app.get('/api/check-mantis', async (req, res) => {
    try {
        const user = await mantis.checkConnection();
        res.json({
            status: 'success',
            message: `Successfully connected to Mantis as ${user.real_name || user.name}`,
        });
    } catch (err) {
        res.status(500).json({ status: 'error', message: err.message });
    }
});

async function sendTriageSummary(req, res, options = {}) {
    const dataPath = getTriageStoragePaths('opensearch', { storageSuffix: options.storageSuffix || 'v1' }).summary;
    const timeRange = req.query.timeRange;

    try {
        if (!fs.existsSync(dataPath)) {
            const data = await collectTriageData('opensearch', {
                timeRange,
                profile: options.profile || 'dashboard_v1',
                storageSuffix: options.storageSuffix || 'v1',
            });
            return res.json(data.summaryData);
        }

        res.json(JSON.parse(fs.readFileSync(dataPath, 'utf8')));
    } catch (err) {
        res.status(500).json({ status: 'error', message: err.message });
    }
}

async function sendTriageRaw(req, res, options = {}) {
    const dataPath = getTriageStoragePaths('opensearch', { storageSuffix: options.storageSuffix || 'v1' }).raw;
    const timeRange = req.query.timeRange;

    try {
        if (!fs.existsSync(dataPath)) {
            const data = await collectTriageData('opensearch', {
                timeRange,
                profile: options.profile || 'dashboard_v1',
                storageSuffix: options.storageSuffix || 'v1',
            });
            return res.json(data.triageData);
        }

        res.json(JSON.parse(fs.readFileSync(dataPath, 'utf8')));
    } catch (err) {
        res.status(500).json({ status: 'error', message: err.message });
    }
}

app.get('/api/triage-summary-v1', sendTriageSummary);
app.get('/api/triage-raw-v1', sendTriageRaw);

app.get('/api/triage-summary', sendTriageSummary);
app.get('/api/triage-raw', sendTriageRaw);

app.post('/api/refresh-triage-v1', async (req, res) => {
    try {
        const data = await collectTriageData('opensearch', {
            timeRange: req.body?.timeRange || req.query.timeRange,
            profile: 'dashboard_v1',
            storageSuffix: 'v1',
        });
        res.json({ status: 'success', data: data.summaryData });
    } catch (err) {
        res.status(500).json({ status: 'error', message: err.message });
    }
});

app.post('/api/analyze-case', async (req, res) => {
    if (!process.env.OPENAI_API_KEY) {
        return res.status(500).json({ status: 'error', message: 'OPENAI_API_KEY is not configured on the server.' });
    }

    try {
        const analysis = await analyzeCase(req.body);
        res.json({ status: 'success', analysis });
    } catch (err) {
        res.status(500).json({ status: 'error', message: err.message });
    }
});

app.post('/api/pivot-query', async (req, res) => {
    try {
        const result = await executePivotQuery(req.body.query, {
            ...(req.body.options || {}),
            source: 'opensearch',
        });
        res.json({ status: 'success', result });
    } catch (err) {
        res.status(500).json({ status: 'error', message: err.message });
    }
});

app.post('/api/reassess-case', async (req, res) => {
    const { caseData, previousAnalysis, pivotResult, totalPivotsDone } = req.body;

    if (!process.env.OPENAI_API_KEY) {
        return res.status(500).json({ status: 'error', message: 'OPENAI_API_KEY is not configured on the server.' });
    }

    try {
        const result = await reassessCase(caseData, previousAnalysis, pivotResult, totalPivotsDone);
        res.json({ status: 'success', result });
    } catch (err) {
        res.status(500).json({ status: 'error', message: err.message });
    }
});

app.post('/api/check-duplicates', async (req, res) => {
    const { caseData } = req.body;

    try {
        const duplicates = await mantis.findDuplicateTickets({
            src_ip: caseData.src_ip,
            dest_ip: caseData.dest_ip,
            target_host: caseData.target_host,
            signature: caseData.signature,
            cve: caseData.cve,
            category: caseData.category,
        });

        res.json({
            status: 'success',
            result: {
                checked: true,
                possible_duplicates: duplicates,
                match_count: duplicates.length,
            },
        });
    } catch (err) {
        res.status(500).json({ status: 'error', message: err.message });
    }
});

app.get('/api/cases-v1/status', (req, res) => {
    try {
        res.json({
            status: 'success',
            pipeline: getCaseManagerV1Status(),
            output_file_path: getCaseManagerV1OutputFilePath(),
        });
    } catch (err) {
        res.status(500).json({ status: 'error', message: err.message });
    }
});

app.post('/api/cases-v1/start', (req, res) => {
    try {
        const result = startCaseManagerV1Run({
            timeRange: req.body?.timeRange || req.query.timeRange || 'now-1h',
        });
        res.json({ status: 'success', ...result });
    } catch (err) {
        res.status(500).json({ status: 'error', message: err.message });
    }
});

app.post('/api/cases-v1/stop', (req, res) => {
    try {
        res.json({ status: 'success', pipeline: requestCaseManagerV1Stop() });
    } catch (err) {
        res.status(500).json({ status: 'error', message: err.message });
    }
});

app.get('/api/tickets/history', (req, res) => {
    try {
        res.json(historyStore.loadTicketHistory());
    } catch (err) {
        res.status(500).json({ status: 'error', message: err.message });
    }
});

app.get('/api/ticket-history', (req, res) => {
    try {
        res.json(historyStore.loadTicketHistory());
    } catch (err) {
        res.status(500).json({ status: 'error', message: err.message });
    }
});

app.post('/api/tickets/manual', (req, res) => {
    try {
        const success = ticketRegistry.addManualTicket(req.body);
        res.status(success ? 200 : 500).json(
            success
                ? { status: 'success', message: 'Ticket added manually' }
                : { status: 'error', message: 'Failed to save manual ticket' }
        );
    } catch (err) {
        res.status(500).json({ status: 'error', message: err.message });
    }
});

app.post('/api/tickets/sync', async (req, res) => {
    try {
        res.json(await ticketRegistry.syncUserTickets());
    } catch (err) {
        res.status(500).json({ status: 'error', message: err.message });
    }
});

app.post('/api/tickets/create', async (req, res) => {
    const ticketData = req.body;

    if (!ticketData || Object.keys(ticketData).length === 0) {
        return res.status(400).json({ status: 'error', message: 'Empty ticket data' });
    }

    const {
        case_id,
        project,
        category,
        reproducibility,
        severity,
        priority,
        view_status,
        summary,
        description,
        steps_to_reproduce,
        additional_information,
        fingerprint,
    } = ticketData;

    try {
        const result = await mantis.createIssue({
            summary,
            description,
            steps_to_reproduce,
            additional_information,
            project: { name: project || 'bainbridge' },
            category: { name: category || 'Bellevue College' },
            priority: { name: priority || 'normal' },
            severity: { name: severity || 'major' },
            reproducibility: { name: reproducibility || 'have not tried' },
            view_state: { name: view_status || 'public' },
        });

        if (!result || !result.issue) {
            throw new Error('Mantis API returned an unexpected response format');
        }

        const ticketId = result.issue.id;
        const mantisBase = process.env.MANTIS_URL.endsWith('/') ? process.env.MANTIS_URL.slice(0, -1) : process.env.MANTIS_URL;
        const ticketUrl = `${mantisBase}/view.php?id=${ticketId}`;
        const opensearchLinkMatch = steps_to_reproduce.match(/OpenSearch Dashboards Link:\s*(https?:\/\/[^\s]+)/i);
        const historySaved = historyStore.appendTicketRecord({
            case_id,
            ticket_id: ticketId,
            ticket_url: ticketUrl,
            created_at: new Date().toISOString(),
            project: project || 'bainbridge',
            category: fingerprint?.category,
            signature: fingerprint?.signature,
            src_ip: fingerprint?.src_ip,
            dest_ip: fingerprint?.dest_ip,
            target_host: fingerprint?.target_host,
            target_url: fingerprint?.target_url,
            dest_port: fingerprint?.dest_port,
            first_seen: fingerprint?.first_seen,
            last_seen: fingerprint?.last_seen,
            summary,
            ticket_status: 'resolved',
            source: 'created',
            opensearch_link: opensearchLinkMatch?.[1] || '',
        });

        res.json({
            status: 'success',
            ticket_id: ticketId,
            ticket_url: ticketUrl,
            history_saved: historySaved,
        });
    } catch (err) {
        res.status(500).json({ status: 'error', message: err.message });
    }
});

app.get('/api/tickets/:id', async (req, res) => {
    try {
        const result = await mantis.getIssue(req.params.id);

        if (!result || !result.issues || result.issues.length === 0) {
            return res.status(404).json({ status: 'error', message: 'Ticket not found' });
        }

        res.json({
            status: 'success',
            ticket: result.issues[0],
            ai_summary: await summarizeTicket(result.issues[0]),
        });
    } catch (err) {
        res.status(500).json({ status: 'error', message: err.message });
    }
});

app.all('/api/opensearch-url', async (req, res) => {
    const query = req.method === 'POST' ? req.body.query : req.query.query;
    const requestPayload = req.method === 'POST' ? req.body : req.query;
    const timeFrom = requestPayload.timeFrom || requestPayload.timeRange || 'now-48h';
    const timeTo = requestPayload.timeTo || 'now';

    if (!query) {
        return res.status(400).json({ status: 'error', message: 'Query parameter is required' });
    }

    if (!process.env.OPENSEARCH_NODE) {
        return res.status(500).json({ status: 'error', message: 'OPENSEARCH_NODE is not configured' });
    }

    const indexPatternId = process.env.OPENSEARCH_INDEX_PATTERN_ID || process.env.OPENSEARCH_INDEX || 'arkime_sessions3-*';
    const gState = `(filters:!(),refreshInterval:(pause:!t,value:0),time:(from:'${timeFrom}',to:'${timeTo}'))`;
    const aState = `(columns:!(_source),filters:!(),index:'${indexPatternId}',interval:auto,query:(language:lucene,query:'${query}'),sort:!())`;
    const relativeUrl = `/app/discover#/?_g=${encodeURIComponent(gState)}&_a=${encodeURIComponent(aState)}`;
    const fullUrl = `${process.env.OPENSEARCH_NODE.replace(/\/$/, '')}${relativeUrl}`;

    if (req.method === 'GET') {
        return res.redirect(fullUrl);
    }

    res.json({ status: 'success', url: fullUrl, timeFrom, timeTo });
});

app.listen(port, () => {
    console.log(`OpenSearch server is running on port ${port}`);
});
