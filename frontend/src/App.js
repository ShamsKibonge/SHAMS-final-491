import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useState, useEffect, useCallback } from 'react';
import './App.css';
import shamsLogo from './shams-logo.svg';
import TicketsPage from './TicketsPage';
import CaseManagerV1Page from './CaseManagerV1Page';
const BACKEND_URL = process.env.REACT_APP_BACKEND_URL || 'http://localhost:5000';
function getCountValue(total) {
    if (typeof total === 'number') {
        return total;
    }
    if (total && typeof total === 'object' && typeof total.value === 'number') {
        return total.value;
    }
    return 0;
}
function App() {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o, _p, _q, _r, _s, _t, _u, _v;
    const [currentView, setCurrentView] = useState('dashboard-v1');
    const [telemetrySource] = useState('opensearch');
    const [data, setData] = useState(null);
    const [rawData, setRawData] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [selectedCategory, setSelectedCategory] = useState(null);
    const [selectedCase, setSelectedCase] = useState(null);
    const [aiAnalyses, setAiAnalyses] = useState({});
    const [aiLoading, setAiLoading] = useState({});
    // New Pivot & Reassessment State
    const [executedPivots, setExecutedPivots] = useState({});
    const [pivotLoading, setPivotLoading] = useState({});
    const [pivotError, setPivotError] = useState({});
    const [latestAiAssessments, setLatestAiAssessments] = useState({});
    const [reassessLoading, setReassessLoading] = useState({});
    const [duplicateResults, setDuplicateResults] = useState({});
    const [duplicateLoading, setDuplicateLoading] = useState({});
    const [ticketPreview, setTicketPreview] = useState(null);
    const [ticketLoading, setTicketLoading] = useState(false);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [createdTickets, setCreatedTickets] = useState({});
    const isDashboardView = currentView === 'dashboard-v1';
    const triageApiSuffix = currentView === 'dashboard-v1' ? '-v1' : '';
    const sourceQuery = `source=${telemetrySource}`;
    const fetchData = useCallback(async () => {
        setLoading(true);
        const startTime = Date.now();
        try {
            const ts = Date.now();
            const summaryRes = await fetch(`${BACKEND_URL}/api/triage-summary${triageApiSuffix}?${sourceQuery}&t=${ts}`);
            if (!summaryRes.ok)
                throw new Error(`Summary API failed (${summaryRes.status})`);
            const contentType = summaryRes.headers.get('content-type');
            if (!contentType || !contentType.includes('application/json')) {
                throw new Error('Summary API returned non-JSON response (likely an HTML error page)');
            }
            const summaryResult = await summaryRes.json();
            const rawRes = await fetch(`${BACKEND_URL}/api/triage-raw${triageApiSuffix}?${sourceQuery}&t=${ts}`);
            if (!rawRes.ok)
                throw new Error(`Raw API failed (${rawRes.status})`);
            const rawResult = await rawRes.json();
            setData(summaryResult);
            setRawData(rawResult);
            // 2. Fetch Ticket History to populate createdTickets state
            const historyRes = await fetch(`${BACKEND_URL}/api/ticket-history`);
            if (historyRes.ok) {
                const historyContentType = historyRes.headers.get('content-type');
                if (historyContentType && historyContentType.includes('application/json')) {
                    const historyData = await historyRes.json();
                    const mapping = {};
                    historyData.forEach((h) => {
                        mapping[h.case_id] = { id: h.ticket_id, url: h.ticket_url };
                    });
                    setCreatedTickets(mapping);
                }
            }
            setError(null);
        }
        catch (err) {
            console.error('Fetch error:', err);
            setError(err.message);
        }
        finally {
            // Force loading for at least 5 seconds
            const elapsedTime = Date.now() - startTime;
            const remainingTime = Math.max(0, 5000 - elapsedTime);
            if (remainingTime > 0) {
                await new Promise(resolve => setTimeout(resolve, remainingTime));
            }
            setLoading(false);
        }
    }, [sourceQuery, triageApiSuffix]);
    const refreshData = async () => {
        setLoading(true);
        const startTime = Date.now();
        setError(null);
        try {
            const response = await fetch(`${BACKEND_URL}/api/refresh-triage${triageApiSuffix}?${sourceQuery}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ source: telemetrySource }),
            });
            if (response.ok) {
                const result = await response.json();
                setData(result.data);
                await fetchData();
            }
            else {
                let errorMsg = `Refresh failed (${response.status})`;
                try {
                    const result = await response.json();
                    errorMsg = result.message || errorMsg;
                }
                catch (e) {
                    errorMsg = "Refresh failed and returned an HTML error page. Check backend logs.";
                }
                throw new Error(errorMsg);
            }
        }
        catch (err) {
            setError(err.message);
        }
        finally {
            const elapsedTime = Date.now() - startTime;
            const remainingTime = Math.max(0, 5000 - elapsedTime);
            if (remainingTime > 0) {
                await new Promise(resolve => setTimeout(resolve, remainingTime));
            }
            setLoading(false);
        }
    };
    useEffect(() => {
        setSelectedCategory(null);
        setSelectedCase(null);
        setError(null);
    }, [telemetrySource]);
    const normalizeProjectValue = (value) => String(value || '')
        .trim()
        .replace(/^hedgehog[-_]/i, '');
    const firstProjectValue = (...values) => {
        for (const value of values) {
            if (Array.isArray(value)) {
                const nested = firstProjectValue(...value);
                if (nested)
                    return nested;
                continue;
            }
            if (value && typeof value === 'object') {
                const nested = firstProjectValue(value.name, value.id, value.keyword);
                if (nested)
                    return nested;
                continue;
            }
            if (typeof value === 'string' && value.trim()) {
                return normalizeProjectValue(value);
            }
        }
        return '';
    };
    const resolveCaseProject = (caseData) => {
        const sampleSources = (caseData.sample_logs || []).map(log => (log === null || log === void 0 ? void 0 : log._source) || log || {});
        return firstProjectValue(caseData.project, caseData.city, caseData.clientID, caseData.client_id, caseData.client?.id, caseData.client?.name, caseData.organization?.name, caseData.host?.name, caseData.host?.hostname, ...sampleSources.flatMap(source => [
            source.project,
            source.city,
            source.clientID,
            source.client_id,
            source.client?.id,
            source.client?.name,
            source.organization?.name,
            source.host?.name,
            source.host?.hostname,
            source.host?.clientID,
            source.host?.client?.id,
            source.host?.client?.name
        ])) || 'bainbridge';
    };
    const buildCaseFingerprint = (caseData) => {
        return {
            case_id: caseData.case_id,
            category: caseData.category,
            signature: caseData.signature,
            src_ip: caseData.src_ip,
            dest_ip: caseData.dest_ip,
            target_host: caseData.target_host,
            target_url: caseData.target_url || '',
            dest_port: caseData.dest_port,
            first_seen: caseData.first_seen,
            last_seen: caseData.last_seen
        };
    };
    const isUsefulValue = (value) => {
        if (value === null || value === undefined) {
            return false;
        }
        const text = String(value).trim();
        return text && !['unknown', 'n/a', 'na', 'null', 'undefined', '0'].includes(text.toLowerCase());
    };
    const luceneValue = (value) => `"${String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"').trim()}"`;
    const addTerm = (parts, field, value) => {
        if (isUsefulValue(value)) {
            parts.push(`${field}:${luceneValue(value)}`);
        }
    };
    const firstUseful = (...values) => values.find(isUsefulValue);
    const firstArrayValue = (value) => Array.isArray(value) ? value.find(isUsefulValue) : null;
    const isGenericSignature = (signature) => {
        const normalized = String(signature || '').trim().toLowerCase();
        return !normalized || ['alert', 'dns', 'ssl', 'http', 'conn', 'notice', 'unknown', 'n/a'].includes(normalized);
    };
    const buildEvidenceTimeBounds = () => {
        return {
            timeFrom: 'now-30d',
            timeTo: 'now',
        };
    };
    const buildSignatureClause = (signature) => {
        if (!isUsefulValue(signature) || isGenericSignature(signature)) {
            return null;
        }
        const quoted = luceneValue(signature);
        return `(rule.name:${quoted} OR alert.signature:${quoted} OR zeek.notice.note:${quoted} OR zeek.notice.msg:${quoted} OR event.original:${quoted})`;
    };
    const buildAnyFieldClause = (fields, value) => {
        if (!isUsefulValue(value)) {
            return null;
        }
        const quoted = luceneValue(value);
        return `(${fields.map(field => `${field}:${quoted}`).join(' OR ')})`;
    };
    const buildEvidenceFilter = (caseData, source) => {
        const parts = [];
        const srcField = source === 'opensearch' ? 'source.ip' : 'src_ip';
        const destField = source === 'opensearch' ? 'destination.ip' : 'dest_ip';
        const portField = source === 'opensearch' ? 'destination.port' : 'dest_port';
        const category = String(caseData.category || '').toLowerCase();
        const indicator = firstUseful(
            caseData.incident_indicator,
            firstArrayValue(caseData.dns_root_domains),
            firstArrayValue(caseData.tls_server_names),
            firstArrayValue(caseData.http_hosts),
            caseData.target_host,
            caseData.signature
        );
        const signatureClause = buildSignatureClause(caseData.signature);

        addTerm(parts, srcField, caseData.src_ip);

        if (!['brute_force', 'recon_scanning'].includes(category)) {
            addTerm(parts, destField, caseData.dest_ip);
        }

        if (Number(caseData.dest_port) > 0 && category !== 'recon_scanning') {
            parts.push(`${portField}:${caseData.dest_port}`);
        }

        if (source !== 'opensearch') {
            if (signatureClause) {
                parts.push(signatureClause);
            }
            return parts.length > 0 ? parts.join(' AND ') : '*';
        }

        if (category === 'brute_force') {
            addTerm(parts, 'zeek.notice.note', firstUseful(firstArrayValue(caseData.notice_types), caseData.signature));
            return parts.length > 0 ? parts.join(' AND ') : '*';
        }

        if (category === 'recon_scanning') {
            addTerm(parts, 'zeek.notice.note', firstUseful(firstArrayValue(caseData.notice_types), caseData.signature));
            const hostClause = buildAnyFieldClause(['host.name', 'host.hostname', 'agent.name'], caseData.target_host);
            if (hostClause) {
                parts.push(hostClause);
            }
            return parts.length > 0 ? parts.join(' AND ') : '*';
        }

        if (category === 'dns_tunneling' || category === 'dual_use_abused_infrastructure') {
            if (Number(caseData.dest_port) === 53 || category === 'dns_tunneling') {
                const dnsClause = buildAnyFieldClause(['zeek.dns.query', 'dns.host'], indicator);
                if (dnsClause) {
                    parts.push(dnsClause);
                }
            }
            else {
                const tlsClause = buildAnyFieldClause(['zeek.ssl.server_name', 'url.domain', 'server.domain'], firstUseful(firstArrayValue(caseData.tls_server_names), indicator));
                if (tlsClause) {
                    parts.push(tlsClause);
                }
            }
        }

        if (category === 'http_protocol_anomalies') {
            addTerm(parts, 'zeek.notice.note', firstUseful(firstArrayValue(caseData.notice_types), caseData.signature));
        }

        if (category === 'web_exploitation' || category === 'exploit_attempts' || category === 'malware_activity' || category === 'lateral_movement' || category === 'c2_beaconing') {
            if (signatureClause && parts.length < 2) {
                parts.push(signatureClause);
            }
        }

        return parts.length > 0 ? parts.join(' AND ') : '*';
    };
    const handleCheckDuplicates = async (caseData) => {
        const caseId = caseData.case_id;
        if (duplicateLoading[caseId])
            return;
        setDuplicateLoading(prev => ({ ...prev, [caseId]: true }));
        try {
            const fingerprint = buildCaseFingerprint(caseData);
            const response = await fetch(`${BACKEND_URL}/api/check-duplicates`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ caseData: fingerprint }),
            });
            if (!response.ok)
                throw new Error('Duplicate check failed');
            const result = await response.json();
            setDuplicateResults(prev => ({ ...prev, [caseId]: result.result }));
        }
        catch (err) {
            console.error('Duplicate check error:', err);
        }
        finally {
            setDuplicateLoading(prev => ({ ...prev, [caseId]: false }));
        }
    };
    const buildTicketPreview = (caseData, aiAssessment, duplicateCheck, queryFilter = '', opensearchUrl = '', pivots = [], source = 'opensearch') => {
        // 1. Severity / Priority Mapping
        let severity = 'minor';
        let priority = 'normal';
        const isEscalate = aiAssessment.verdict === 'ESCALATE';
        const confidence = aiAssessment.confidence;
        const classification = aiAssessment.attack_classification || aiAssessment.classification || '';
        const category = caseData.category;
        const project = resolveCaseProject(caseData);
        if (isEscalate) {
            if (confidence > 0.8 || ['c2_beaconing', 'exploit_attempts', 'malware_activity'].includes(category)) {
                severity = 'major';
                priority = 'high';
            }
            else if (confidence > 0.5) {
                severity = 'major';
                priority = 'normal';
            }
        }
        // 2. Summary Generation
        const cleanCategory = category.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
        const signature = caseData.signature;
        const cveMatch = signature.match(/CVE-\d{4}-\d+/);
        const summary = `${cleanCategory} Attempt - ${signature.split(' ').slice(0, 5).join(' ')}${cveMatch ? ` (${cveMatch[0]})` : ''}`;
        // 3. Description Formatting
        const mainAssessment = aiAssessment.updated_assessment || aiAssessment.threat_assessment || '';
        const reasoningPoints = aiAssessment.reasoning ? `\n\n**Detailed Investigation Findings:**\n` + aiAssessment.reasoning.map((r) => `- ${r}`).join('\n') : '';
        const analystReasoning = aiAssessment.analyst_reasoning ? `\n\n**Investigator Side Note:**\n${aiAssessment.analyst_reasoning}` : '';
        // Add Pivot Results to description
        let pivotSection = '';
        if (pivots.length > 0) {
            pivotSection = `\n\n## Investigation Data (Pivots):\n`;
            pivots.forEach((p, idx) => {
                var _a, _b, _c, _d;
                pivotSection += `\n### Pivot ${idx + 1}: ${p.query}\n`;
                pivotSection += `- Hits Found: ${p.total_hits}\n`;
                if ((_a = p.top_signatures) === null || _a === void 0 ? void 0 : _a.length)
                    pivotSection += `- Top Signatures: ${p.top_signatures.join(', ')}\n`;
                if ((_b = p.top_src_ips) === null || _b === void 0 ? void 0 : _b.length)
                    pivotSection += `- Top Source IPs: ${p.top_src_ips.join(', ')}\n`;
                if ((_c = p.top_dest_ips) === null || _c === void 0 ? void 0 : _c.length)
                    pivotSection += `- Top Destination IPs: ${p.top_dest_ips.join(', ')}\n`;
                if ((_d = p.top_hosts) === null || _d === void 0 ? void 0 : _d.length)
                    pivotSection += `- Top Affected Hosts: ${p.top_hosts.join(', ')}\n`;
            });
        }
        const description = `## Analyst Notes:

Analyzing the ${signature}: ${mainAssessment}${reasoningPoints}${analystReasoning}${pivotSection}

## Evidence Summary:

source ip: ${caseData.src_ip}
destination ip: ${caseData.dest_ip}
target host: ${caseData.target_host}
destination port: ${caseData.dest_port}
signature: ${caseData.signature}
first seen: ${new Date(caseData.first_seen).toLocaleString()}
last seen: ${new Date(caseData.last_seen).toLocaleString()}
log count: ${caseData.log_count}
category: ${category}
confidence: ${Math.round(confidence * 100)}%
verdict: ${aiAssessment.verdict}

## Recommendations:

- Verify whether the activity was blocked by existing security controls (IPS/Firewall).
- Review system and application logs on ${caseData.target_host} for signs of successful compromise.
- If successful, isolate the host and initiate the standard incident response procedure.
- Monitor for any follow-up activity or lateral movement from ${caseData.src_ip}.`;
        // 4. Steps to Reproduce / Evidence Link
        const evidenceLabel = source === 'opensearch' ? 'OpenSearch Dashboards' : 'OpenSearch';
        const evidenceLinkSection = opensearchUrl
            ? `${evidenceLabel} Link: ${opensearchUrl}`
            : source === 'opensearch'
                ? `OpenSearch Dashboards Link: [NOT GENERATED] This ticket was created from OpenSearch mode. Use the query below inside OpenSearch Dashboards or Discover.`
                : `OpenSearch Dashboards Link: [ERROR] Direct permalink generation failed. Please use the manual query provided below.`;
        const steps_to_reproduce = `All traffic associated with this case can be reviewed in ${evidenceLabel}.

${evidenceLinkSection}
Investigation Query: ${queryFilter}`;
        // 5. Additional Information
        const additional_information = `Case ID: ${caseData.case_id}
Project: ${project}
MITRE: ${classification}
Duplicate Check: ${(duplicateCheck === null || duplicateCheck === void 0 ? void 0 : duplicateCheck.match_count) || 0} matches found
Source IP: ${caseData.src_ip}
Destination IP: ${caseData.dest_ip}
Target Host: ${caseData.target_host}
Target URL: ${caseData.target_url || 'N/A'}
Destination Port: ${caseData.dest_port}`;
        // 6. API Payload
        const api_payload = {
            summary,
            description,
            steps_to_reproduce,
            additional_information,
            project: { name: project },
            category: { name: "Bellevue College" },
            severity: { name: severity },
            priority: { name: priority },
            reproducibility: { name: "have not tried" },
            view_state: { name: "public" }
        };
        return {
            source,
            project,
            category: "Bellevue College",
            reproducibility: "have not tried",
            severity,
            priority,
            view_status: "public",
            summary,
            description,
            steps_to_reproduce,
            additional_information,
            api_payload
        };
    };
    const handleCreateTicket = async (caseData) => {
        const aiAssessment = latestAiAssessments[caseData.case_id] || aiAnalyses[caseData.case_id];
        const duplicateCheck = duplicateResults[caseData.case_id];
        const categorySummary = selectedCategorySummary;
        if (!aiAssessment)
            return;
        const queryFilter = buildEvidenceFilter(caseData, telemetrySource) || (categorySummary === null || categorySummary === void 0 ? void 0 : categorySummary.filter) || caseData.signature;
        const casePivots = executedPivots[caseData.case_id] || [];
        setTicketLoading(true);
        if (telemetrySource === 'opensearch') {
            try {
                const response = await fetch(`${BACKEND_URL}/api/opensearch-url`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ query: queryFilter, ...buildEvidenceTimeBounds(caseData, casePivots) }),
                });
                const data = await response.json();
                const preview = buildTicketPreview(caseData, aiAssessment, duplicateCheck, queryFilter, data.url || '', casePivots, telemetrySource);
                setTicketPreview(preview);
            }
            catch (err) {
                console.error('Failed to generate OpenSearch link:', err);
                const preview = buildTicketPreview(caseData, aiAssessment, duplicateCheck, queryFilter, '', casePivots, telemetrySource);
                setTicketPreview(preview);
            }
            finally {
                setTicketLoading(false);
            }
            return;
        }
        // Fetch the direct, long OpenSearch URL from the backend
        try {
            const response = await fetch(`${BACKEND_URL}/api/opensearch-url`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ query: queryFilter, ...buildEvidenceTimeBounds(caseData, casePivots) }),
            });
            const data = await response.json();
            const preview = buildTicketPreview(caseData, aiAssessment, duplicateCheck, queryFilter, data.url, // Use the direct OPENSEARCH_NODE from the backend
            casePivots, telemetrySource);
            setTicketPreview(preview);
        }
        catch (err) {
            console.error('Failed to generate direct OpenSearch URL:', err);
            // Fallback if API fails
            const preview = buildTicketPreview(caseData, aiAssessment, duplicateCheck, queryFilter, '', casePivots, telemetrySource);
            setTicketPreview(preview);
        }
        finally {
            setTicketLoading(false);
        }
    };
    const handleSubmitTicket = async () => {
        if (!ticketPreview || !selectedCaseData)
            return;
        setIsSubmitting(true);
        try {
            const url = `${BACKEND_URL}/api/tickets/create`;
            const response = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    ...ticketPreview,
                    case_id: selectedCaseData.case_id,
                    fingerprint: buildCaseFingerprint(selectedCaseData)
                }),
            });
            const contentType = response.headers.get('content-type');
            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`Server returned ${response.status}: ${errorText.substring(0, 100)}`);
            }
            if (!contentType || !contentType.includes('application/json')) {
                const text = await response.text();
                console.error('Non-JSON response:', text.substring(0, 500));
                throw new Error('Server returned an HTML error page instead of JSON. Please ensure the backend is running the latest code and has been restarted.');
            }
            const result = await response.json();
            if (result.status === 'success') {
                setCreatedTickets(prev => ({
                    ...prev,
                    [selectedCaseData.case_id]: { id: result.ticket_id, url: result.ticket_url }
                }));
                setTicketPreview(null);
                alert(`Ticket #${result.ticket_id} created successfully!`);
            }
            else {
                throw new Error(result.message || 'Failed to create ticket');
            }
        }
        catch (err) {
            console.error('Submit ticket error:', err);
            alert(`Error creating ticket: ${err.message}`);
        }
        finally {
            setIsSubmitting(false);
        }
    };
    const handleAIAnalysis = async (caseData) => {
        if (aiLoading[caseData.case_id])
            return;
        setAiLoading(prev => ({ ...prev, [caseData.case_id]: true }));
        try {
            const response = await fetch(`${BACKEND_URL}/api/analyze-case`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(caseData),
            });
            if (!response.ok)
                throw new Error('Investigation failed');
            const result = await response.json();
            setAiAnalyses(prev => ({ ...prev, [caseData.case_id]: result.analysis }));
            // Auto-run duplicate check if final verdict is ESCALATE
            if (result.analysis.status === 'final_verdict' && result.analysis.verdict === 'ESCALATE') {
                handleCheckDuplicates(caseData);
            }
        }
        catch (err) {
            console.error('Investigation error:', err);
        }
        finally {
            setAiLoading(prev => ({ ...prev, [caseData.case_id]: false }));
        }
    };
    const executePivotQuery = async (caseId, pivot) => {
        if (pivotLoading[caseId])
            return;
        const pivotCase = selectedCaseData && selectedCaseData.case_id === caseId ? selectedCaseData : null;
        setPivotLoading(prev => ({ ...prev, [caseId]: true }));
        setPivotError(prev => ({ ...prev, [caseId]: null }));
        try {
            const response = await fetch(`${BACKEND_URL}/api/pivot-query`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    query: pivot.query,
                    options: {
                        maxLogs: 10,
                        source: telemetrySource,
                        ...(pivotCase ? buildEvidenceTimeBounds(pivotCase, executedPivots[caseId] || []) : { timeRange: 'now-48h' }),
                    }
                }),
            });
            if (!response.ok)
                throw new Error(`Pivot query failed: ${response.statusText}`);
            const result = await response.json();
            setExecutedPivots(prev => ({
                ...prev,
                [caseId]: [...(prev[caseId] || []), result.result]
            }));
        }
        catch (err) {
            console.error('Pivot error:', err);
            setPivotError(prev => ({ ...prev, [caseId]: err.message }));
        }
        finally {
            setPivotLoading(prev => ({ ...prev, [caseId]: false }));
        }
    };
    const handleReassessCase = async (caseData, pivotResult) => {
        var _a;
        const caseId = caseData.case_id;
        if (reassessLoading[caseId])
            return;
        const totalPivotsDone = (((_a = executedPivots[caseId]) === null || _a === void 0 ? void 0 : _a.length) || 0);
        setReassessLoading(prev => ({ ...prev, [caseId]: true }));
        try {
            const previousAnalysis = aiAnalyses[caseId];
            const response = await fetch(`${BACKEND_URL}/api/reassess-case`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    caseData,
                    previousAnalysis,
                    pivotResult,
                    totalPivotsDone
                }),
            });
            if (!response.ok)
                throw new Error(`AI reassessment failed: ${response.statusText}`);
            const result = await response.json();
            setLatestAiAssessments(prev => ({ ...prev, [caseId]: result.result }));
            // Auto-run duplicate check if final verdict is ESCALATE
            if (result.result.status === 'final_verdict' && result.result.verdict === 'ESCALATE') {
                handleCheckDuplicates(caseData);
            }
        }
        catch (err) {
            console.error('Reassessment error:', err);
        }
        finally {
            setReassessLoading(prev => ({ ...prev, [caseId]: false }));
        }
    };
    const generateOpenSearchFilter = (caseData) => {
        return buildEvidenceFilter(caseData, 'opensearch');
    };
    const copyToClipboard = async (text) => {
        try {
            await navigator.clipboard.writeText(text);
            alert('OpenSearch filter copied to clipboard!');
        }
        catch (err) {
            console.error('Failed to copy!', err);
            alert('Failed to copy to clipboard.');
        }
    };
    useEffect(() => {
        fetchData();
    }, [fetchData]);
    const getSampleLogs = (categoryId) => {
        var _a, _b;
        return ((_b = (_a = rawData === null || rawData === void 0 ? void 0 : rawData.categories) === null || _a === void 0 ? void 0 : _a.find(c => c.id === categoryId)) === null || _b === void 0 ? void 0 : _b.sampleLogs) || [];
    };
    // Get freshest summary for the selected category ID
    const selectedCategorySummary = (_a = data === null || data === void 0 ? void 0 : data.summaries) === null || _a === void 0 ? void 0 : _a.find(s => s.id === (selectedCategory === null || selectedCategory === void 0 ? void 0 : selectedCategory.id));
    // Get freshest case data for the investigation view
    const selectedCaseData = (_b = selectedCategorySummary === null || selectedCategorySummary === void 0 ? void 0 : selectedCategorySummary.cases) === null || _b === void 0 ? void 0 : _b.find(c => c.case_id === (selectedCase === null || selectedCase === void 0 ? void 0 : selectedCase.case_id));
    const latestAiAssessment = selectedCaseData ? latestAiAssessments[selectedCaseData.case_id] : null;
    const initialAiAnalysis = selectedCaseData ? aiAnalyses[selectedCaseData.case_id] : null;
    const currentStatus = (latestAiAssessment === null || latestAiAssessment === void 0 ? void 0 : latestAiAssessment.status) || (initialAiAnalysis === null || initialAiAnalysis === void 0 ? void 0 : initialAiAnalysis.status);
    const handleOpenOpenSearch = async (query) => {
        try {
            const casePivots = selectedCaseData ? (executedPivots[selectedCaseData.case_id] || []) : [];
            const response = await fetch(`${BACKEND_URL}/api/opensearch-url`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    query,
                    ...(selectedCaseData ? buildEvidenceTimeBounds(selectedCaseData, casePivots) : { timeFrom: 'now-30d', timeTo: 'now' }),
                }),
            });
            const data = await response.json();
            if (data.url) {
                window.open(data.url, '_blank');
            }
        }
        catch (err) {
            console.error('Failed to get OpenSearch URL:', err);
        }
    };
    if (loading) {
        return (_jsx("div", { className: "shams-loader-container", children: _jsxs("div", { className: "shams-loader-content", children: [_jsx("img", { src: shamsLogo, className: "shams-logo", alt: "SHAMS Logo" }), _jsxs("div", { className: "shams-status", children: [_jsx("span", { className: "shams-pulse" }), "BROADCASTING: INITIALIZING SOC HUNTING AND MITIGATION SYSTEM..."] }), _jsxs("div", { className: "shams-terminal", children: [_jsxs("p", { children: ["> Connecting to ", 'OpenSearch Telemetry Lake', "..."] }), _jsx("p", { children: "> Pulling telemetry for the last 48h..." }), _jsx("p", { children: "> Executing AI Triage Engine..." }), _jsx("p", { children: "> Analyzing threat patterns & attack vectors..." })] })] }) }));
    }
    return (_jsxs("div", { className: "App dark-theme", children: [_jsxs("header", { className: "Dashboard-header", children: [_jsxs("div", { className: "header-left", children: [_jsxs("div", { className: "logo-container", children: [_jsx("img", { src: shamsLogo, className: "header-logo", alt: "SHAMS Logo" }), _jsx("h1", { children: "SOC Hunting And Mitigation System" })] }), _jsxs("span", { className: "last-updated", children: ["Last Updated: ", (data === null || data === void 0 ? void 0 : data.lastUpdated) ? new Date(data.lastUpdated).toLocaleString() : 'Never'] })] }), _jsxs("nav", { className: "header-nav", children: [ _jsx("button", { className: `nav-btn ${currentView === 'dashboard-v1' ? 'active' : ''}`, onClick: () => setCurrentView('dashboard-v1'), children: "Dashboard v1" }),  _jsx("button", { className: `nav-btn ${currentView === 'cases-v1' ? 'active' : ''}`, onClick: () => setCurrentView('cases-v1'), children: "Case Manager v1" }), _jsx("button", { className: `nav-btn ${currentView === 'tickets' ? 'active' : ''}`, onClick: () => setCurrentView('tickets'), children: "Ticket Registry" })] }), _jsxs("div", { className: "header-stats", children: [_jsxs("div", { className: "telemetry-switch", children: [_jsx("span", { className: "stat-label", children: "SOURCE" }), _jsx("div", { className: "switch-buttons", children: _jsx("button", { className: "nav-btn active", children: "OpenSearch" }) })] }), _jsxs("div", { className: "stat-box", children: [_jsx("span", { className: "stat-label", children: "TOTAL LOGS (48H)" }), _jsx("span", { className: "stat-value", children: getCountValue(data === null || data === void 0 ? void 0 : data.totalLogs48h).toLocaleString() })] }), _jsx("button", { className: "sync-btn", onClick: async () => {
                                    try {
                                        const res = await fetch(`${BACKEND_URL}/api/tickets/test`);
                                        const d = await res.json();
                                        alert(`Sync OK: ${d.message}`);
                                    }
                                    catch (e) {
                                        alert('Sync FAILED: Route not found. Please RESTART your backend server to apply new routes.');
                                    }
                                }, children: "Sync" }), _jsx("button", { className: "refresh-btn", onClick: refreshData, disabled: loading || !isDashboardView, children: isDashboardView && loading ? 'Analyzing...' : 'Analyze Now' })] })] }), error && _jsxs("div", { className: "error-banner", children: ["\u26A0\uFE0F Error: ", error] }), _jsx("main", { className: "Dashboard-content", children: isDashboardView ? (_jsxs(_Fragment, { children: [_jsx("div", { className: "category-grid", children: (_d = data === null || data === void 0 ? void 0 : data.summaries) === null || _d === void 0 ? void 0 : _d.map((cat) => {
                                var _a, _b;
                                return (_jsxs("div", { className: `category-card ${cat.totalMatches > 0 ? 'active' : 'inactive'} ${(selectedCategory === null || selectedCategory === void 0 ? void 0 : selectedCategory.id) === cat.id ? 'selected' : ''}`, onClick: () => {
                                        var _a;
                                        console.log('Selected Category:', cat.name, 'Case Count:', cat.caseCandidates, 'Cases Array Length:', (_a = cat.cases) === null || _a === void 0 ? void 0 : _a.length);
                                        setSelectedCategory(cat);
                                        setSelectedCase(null);
                                    }, children: [_jsxs("div", { className: "card-top", children: [_jsxs("span", { className: `priority-badge ${(_a = cat.suggestedPriority) === null || _a === void 0 ? void 0 : _a.toLowerCase()}`, children: [cat.suggestedPriority, " Priority"] }), _jsx("span", { className: "card-tier", children: cat.tier })] }), _jsx("h3", { children: cat.name }), _jsxs("div", { className: "card-main", children: [_jsxs("div", { className: "main-stat", children: [_jsx("span", { className: "match-count", children: ((_b = cat.totalMatches) === null || _b === void 0 ? void 0 : _b.toLocaleString()) || '0' }), _jsx("span", { className: "match-label", children: "Total Events" })] }), cat.totalMatches > 0 && (_jsxs("div", { className: "mini-stats", children: [_jsxs("div", { className: "mini-stat", children: [_jsx("strong", { children: cat.uniqueSrcCount }), _jsx("span", { children: "Attacker IPs" })] }), _jsxs("div", { className: "mini-stat", children: [_jsx("strong", { children: cat.caseCandidates }), _jsx("span", { children: "Case Candidates" })] })] }))] }), _jsx("div", { className: "card-footer", children: _jsx("span", { className: "view-link", children: "View Analysis \u2192" }) })] }, cat.id));
                            }) }), selectedCategorySummary && (_jsxs("section", { className: "details-pane", children: [_jsxs("div", { className: "details-header", children: [_jsxs("div", { className: "title-group", children: [_jsxs("h2", { children: [selectedCategorySummary.name, " Analysis"] }), _jsxs("span", { className: "ticket-type", children: ["Suggested Ticket: ", selectedCategorySummary.suggestedTicketType] })] }), _jsx("button", { className: "close-btn", onClick: () => {
                                                setSelectedCategory(null);
                                                setSelectedCase(null);
                                            }, children: "\u00D7" })] }), _jsxs("div", { className: "summary-overview", children: [_jsx("div", { className: "overview-row", children: _jsxs("div", { className: "overview-item", children: [_jsx("label", { children: "Time Window" }), _jsxs("span", { children: [selectedCategorySummary.firstSeen ? new Date(selectedCategorySummary.firstSeen).toLocaleString() : 'N/A', " -", selectedCategorySummary.lastSeen ? new Date(selectedCategorySummary.lastSeen).toLocaleString() : 'N/A'] })] }) }), _jsxs("div", { className: "stats-row", children: [_jsxs("div", { className: "stat-group", children: [_jsx("h4", { children: "Top Signatures" }), _jsx("ul", { children: (_e = selectedCategorySummary.topSignatures) === null || _e === void 0 ? void 0 : _e.map((s, i) => _jsx("li", { title: s, children: s }, i)) })] }), _jsxs("div", { className: "stat-group", children: [_jsx("h4", { children: "Top Attacker IPs" }), _jsx("ul", { children: (_f = selectedCategorySummary.topSrcIps) === null || _f === void 0 ? void 0 : _f.map((s, i) => _jsx("li", { title: s, children: s }, i)) })] }), _jsxs("div", { className: "stat-group", children: [_jsx("h4", { children: "Affected Hosts" }), _jsx("ul", { children: (_g = selectedCategorySummary.affectedHosts) === null || _g === void 0 ? void 0 : _g.map((s, i) => _jsx("li", { title: s, children: s }, i)) })] })] })] }), _jsxs("div", { className: "case-candidates-section", children: [_jsxs("h3", { children: ["Case Candidates (", ((_h = selectedCategorySummary.cases) === null || _h === void 0 ? void 0 : _h.length) || 0, ")"] }), (() => {
                                            var _a;
                                            console.log(`Panel Debug [${selectedCategorySummary.name}]:`, {
                                                prop_caseCandidates: selectedCategorySummary.caseCandidates,
                                                array_length: (_a = selectedCategorySummary.cases) === null || _a === void 0 ? void 0 : _a.length
                                            });
                                            return null;
                                        })(), _jsx("div", { className: "case-list", children: (_j = selectedCategorySummary.cases) === null || _j === void 0 ? void 0 : _j.map((c) => (_jsxs("div", { className: "case-card", onClick: () => setSelectedCase(c), children: [_jsxs("div", { className: "case-card-header", children: [_jsx("span", { className: "case-id", children: c.case_id }), _jsxs("span", { className: "case-log-count", children: [c.log_count, " Logs"] })] }), _jsxs("div", { className: "case-card-body", children: [_jsx("div", { className: "case-signature", title: c.signature, children: c.signature }), _jsxs("div", { className: "case-ips", children: [_jsxs("span", { children: [_jsx("strong", { children: "Src:" }), " ", c.src_ip] }), _jsxs("span", { children: [_jsx("strong", { children: "Target:" }), " ", c.target_host] })] }), c.target_url && _jsxs("div", { className: "case-url", title: c.target_url, children: [_jsx("strong", { children: "URL:" }), " ", c.target_url] })] }), _jsx("button", { className: "analyze-case-btn", children: "Analyze Case" })] }, c.case_id))) })] }), _jsxs("div", { className: "log-samples", children: [_jsx("h3", { children: "Category Logs (Last 10)" }), ((_k = getSampleLogs(selectedCategorySummary.id)) === null || _k === void 0 ? void 0 : _k.length) > 0 ? (getSampleLogs(selectedCategorySummary.id).map((log) => (_jsxs("div", { className: "log-entry", children: [_jsxs("div", { className: "log-meta", children: [_jsx("span", { className: "log-time", children: log._source['@timestamp'] ? new Date(log._source['@timestamp']).toLocaleString() : 'N/A' }), _jsxs("span", { className: "log-id", children: ["ID: ", log._id] })] }), _jsx("pre", { className: "log-json", children: JSON.stringify(log._source, null, 2) })] }, log._id)))) : (_jsx("p", { children: "No sample logs available for this category." }))] })] })), selectedCaseData && (_jsx("div", { className: "case-investigation-overlay", children: _jsxs("div", { className: "case-investigation-view", children: [_jsxs("header", { className: "case-header", children: [_jsxs("div", { className: "case-title-group", children: [_jsxs("h2", { children: ["Case Investigation: ", selectedCaseData.case_id] }), _jsx("span", { className: "case-category", children: (_l = selectedCaseData.category) === null || _l === void 0 ? void 0 : _l.replace('_', ' ') }), _jsx("button", { className: "view-kibana-link-btn", onClick: () => {
                                                            const filter = generateOpenSearchFilter(selectedCaseData);
                                                            handleOpenOpenSearch(filter);
                                                        }, children: "View in OpenSearch \uD83D\uDD17" }), _jsx("button", { className: "copy-kibana-filter-btn", onClick: () => {
                                                            const filter = generateOpenSearchFilter(selectedCaseData);
                                                            copyToClipboard(filter);
                                                        }, title: "Copy Lucene filter to clipboard", children: "Copy Filter \uD83D\uDCCB" })] }), _jsx("button", { className: "close-btn", onClick: () => setSelectedCase(null), children: "\u00D7" })] }), _jsxs("div", { className: "case-content", children: [_jsxs("section", { className: "case-overview-section", children: [_jsx("h3", { children: "CASE OVERVIEW" }), _jsxs("div", { className: "overview-grid", children: [_jsxs("div", { className: "overview-field", children: [_jsx("label", { children: "Signature" }), _jsx("span", { children: selectedCaseData.signature })] }), _jsxs("div", { className: "overview-field", children: [_jsx("label", { children: "Source IP" }), _jsx("span", { children: selectedCaseData.src_ip })] }), _jsxs("div", { className: "overview-field", children: [_jsx("label", { children: "Destination IP" }), _jsx("span", { children: selectedCaseData.dest_ip })] }), _jsxs("div", { className: "overview-field", children: [_jsx("label", { children: "Target Host" }), _jsx("span", { children: selectedCaseData.target_host })] }), selectedCaseData.target_url && (_jsxs("div", { className: "overview-field", children: [_jsx("label", { children: "Target URL" }), _jsx("span", { children: selectedCaseData.target_url })] })), _jsxs("div", { className: "overview-field", children: [_jsx("label", { children: "Log Count" }), _jsx("span", { children: selectedCaseData.log_count })] }), _jsxs("div", { className: "overview-field", children: [_jsx("label", { children: "First Seen" }), _jsx("span", { children: selectedCaseData.first_seen ? new Date(selectedCaseData.first_seen).toLocaleString() : 'N/A' })] }), _jsxs("div", { className: "overview-field", children: [_jsx("label", { children: "Last Seen" }), _jsx("span", { children: selectedCaseData.last_seen ? new Date(selectedCaseData.last_seen).toLocaleString() : 'N/A' })] })] })] }), _jsxs("section", { className: "case-attack-context", children: [_jsx("h3", { children: "ATTACK CONTEXT" }), _jsxs("div", { className: "context-info", children: [_jsxs("div", { className: "context-item", children: [_jsx("strong", { children: "Attacker:" }), " ", selectedCaseData.src_ip] }), _jsxs("div", { className: "context-item", children: [_jsx("strong", { children: "Target:" }), " ", selectedCaseData.target_host, " (", selectedCaseData.dest_ip, ")"] }), _jsxs("div", { className: "context-item", children: [_jsx("strong", { children: "Port:" }), " ", selectedCaseData.dest_port] })] })] }), _jsxs("section", { className: "case-ai-analysis", children: [_jsx("h3", { children: "AUTOMATED INVESTIGATION" }), _jsxs("div", { className: "ai-analysis-container", children: [!initialAiAnalysis && !aiLoading[selectedCaseData.case_id] && (_jsxs("button", { className: "ai-analyze-btn", onClick: () => handleAIAnalysis(selectedCaseData), children: [_jsx("span", { className: "ai-icon", children: "\uD83D\uDD0D" }), "Start Investigation"] })), aiLoading[selectedCaseData.case_id] && (_jsxs("div", { className: "ai-loading", children: [_jsx("div", { className: "spinner" }), _jsx("p", { children: "Automated investigation in progress..." })] })), initialAiAnalysis && (_jsxs("div", { className: "ai-response", children: [latestAiAssessment && _jsx("h4", { className: "analysis-phase-label", children: "Initial Automated Analysis" }), _jsxs("div", { className: "ai-header-row", children: [_jsx("span", { className: "ai-badge", children: initialAiAnalysis.attack_classification }), _jsxs("div", { className: "ai-score", children: [_jsx("span", { className: "score-label", children: "Confidence:" }), _jsxs("span", { className: `score-value ${(initialAiAnalysis.confidence * 100) > 80 ? 'high' : (initialAiAnalysis.confidence * 100) > 50 ? 'medium' : 'low'}`, children: [Math.round(initialAiAnalysis.confidence * 100), "%"] })] })] }), initialAiAnalysis.status === 'final_verdict' && (_jsxs("div", { className: "final-verdict-banner", children: [_jsx("label", { children: "Final Verdict" }), _jsx("span", { className: `verdict-value ${initialAiAnalysis.verdict}`, children: (_m = initialAiAnalysis.verdict) === null || _m === void 0 ? void 0 : _m.replace(/_/g, ' ') })] })), _jsxs("div", { className: "ai-field", children: [_jsx("h4", { children: "Threat Assessment" }), _jsx("p", { children: initialAiAnalysis.threat_assessment })] }), initialAiAnalysis.analyst_reasoning && (_jsxs("div", { className: "ai-field analyst-reasoning-box", children: [_jsx("h4", { children: "Analyst Reasoning (Side Note)" }), _jsxs("div", { className: "reasoning-content", children: [_jsx("span", { className: "info-icon", children: "\uD83D\uDCA1" }), _jsx("p", { children: initialAiAnalysis.analyst_reasoning })] })] })), initialAiAnalysis.status === 'final_verdict' && (_jsxs("div", { className: "ai-field recommendation-summary", children: [_jsx("h4", { children: "Ticket Recommendation" }), initialAiAnalysis.verdict === 'ESCALATE' && (_jsx("p", { className: "rec-text escalate", children: "Escalate for immediate investigation." })), initialAiAnalysis.verdict === 'SUSPICIOUS_MONITOR' && (_jsx("p", { className: "rec-text monitor", children: "No ticket recommended at this time. Continue monitoring only if new evidence appears." })), initialAiAnalysis.verdict === 'LIKELY_FALSE_POSITIVE' && (_jsx("p", { className: "rec-text fp", children: "No ticket recommended. Case appears to be a likely false positive." }))] })), initialAiAnalysis.status === 'pivot_required' && !latestAiAssessment && (_jsxs("div", { className: "ai-field", children: [_jsx("h4", { children: "Recommended Pivot Queries" }), _jsx("div", { className: "pivot-buttons-container", children: initialAiAnalysis.recommended_pivot_queries.map((pivot) => (_jsxs("div", { className: "pivot-button-wrapper", children: [_jsx("button", { className: "pivot-execute-btn", onClick: () => executePivotQuery(selectedCaseData.case_id, pivot), disabled: pivotLoading[selectedCaseData.case_id], children: pivot.label }), _jsx("p", { className: "pivot-reason", children: pivot.reason })] }, pivot.pivot_id))) })] })), initialAiAnalysis.status === 'final_verdict' && initialAiAnalysis.verdict === 'ESCALATE' && (_jsxs("div", { className: "escalation-actions", children: [_jsxs("div", { className: "duplicate-check-section", children: [_jsx("h4", { children: "Duplicate Ticket Check" }), duplicateLoading[selectedCaseData.case_id] ? (_jsxs("div", { className: "duplicate-status checking", children: [_jsx("div", { className: "spinner mini" }), _jsx("span", { children: "Checking duplicates in Mantis..." })] })) : duplicateResults[selectedCaseData.case_id] ? (_jsx("div", { className: "duplicate-results-container", children: duplicateResults[selectedCaseData.case_id].match_count > 0 ? (_jsxs(_Fragment, { children: [_jsx("div", { className: "duplicate-alert warning", children: _jsx("span", { children: "\u26A0\uFE0F Possible duplicate tickets found" }) }), _jsx("div", { className: "duplicate-list", children: duplicateResults[selectedCaseData.case_id].possible_duplicates.map((ticket) => (_jsxs("div", { className: "duplicate-item", children: [_jsxs("div", { className: "duplicate-item-info", children: [_jsxs("span", { className: "ticket-id", children: ["Ticket #", ticket.id] }), _jsx("span", { className: "ticket-summary", children: ticket.summary }), _jsx("span", { className: `ticket-status ${ticket.status.toLowerCase()}`, children: ticket.status })] }), _jsx("a", { href: `${process.env.REACT_APP_MANTIS_URL || 'https://wa-mantis.cyberrangepoulsbo.com'}/view.php?id=${ticket.id}`, target: "_blank", rel: "noopener noreferrer", className: "view-ticket-link", children: "View Ticket" })] }, ticket.id))) })] })) : (_jsx("div", { className: "duplicate-alert success", children: _jsx("span", { children: "\u2714 No duplicates found in the last 7 days" }) })) })) : (_jsx("button", { className: "check-duplicates-btn", onClick: () => handleCheckDuplicates(selectedCaseData), children: "Run Duplicate Check" }))] }), createdTickets[selectedCaseData.case_id] ? (_jsxs("div", { className: "ticket-status-success", children: [_jsx("span", { className: "success-icon", children: "\u2705" }), _jsxs("div", { className: "ticket-info", children: [_jsx("label", { children: "Ticket Created" }), _jsxs("a", { href: createdTickets[selectedCaseData.case_id].url, target: "_blank", rel: "noopener noreferrer", className: "ticket-link", children: ["View Ticket #", createdTickets[selectedCaseData.case_id].id, " \uD83D\uDD17"] })] })] })) : (_jsx("button", { className: "create-ticket-btn", onClick: () => handleCreateTicket(selectedCaseData), disabled: !duplicateResults[selectedCaseData.case_id] || duplicateResults[selectedCaseData.case_id].match_count > 0, title: ((_o = duplicateResults[selectedCaseData.case_id]) === null || _o === void 0 ? void 0 : _o.match_count) > 0 ? "Resolve duplicate tickets before creating a new one" : "", children: "Create Ticket" })), "                          "] }))] })), latestAiAssessment && (_jsxs("div", { className: "ai-response reassessment", children: [_jsx("h4", { className: "analysis-phase-label", children: "Latest Automated Reassessment" }), _jsxs("div", { className: "ai-header-row", children: [_jsx("span", { className: "ai-badge", children: latestAiAssessment.classification }), _jsxs("div", { className: "ai-score", children: [_jsx("span", { className: "score-label", children: "Confidence:" }), _jsxs("span", { className: `score-value ${(latestAiAssessment.confidence * 100) > 80 ? 'high' : (latestAiAssessment.confidence * 100) > 50 ? 'medium' : 'low'}`, children: [Math.round(latestAiAssessment.confidence * 100), "%"] })] })] }), latestAiAssessment.status === 'final_verdict' && (_jsxs("div", { className: "final-verdict-banner", children: [_jsx("label", { children: "Final Verdict" }), _jsx("span", { className: `verdict-value ${latestAiAssessment.verdict}`, children: (_p = latestAiAssessment.verdict) === null || _p === void 0 ? void 0 : _p.replace(/_/g, ' ') })] })), _jsxs("div", { className: "ai-field", children: [_jsx("h4", { children: "Updated Assessment" }), _jsx("p", { children: latestAiAssessment.updated_assessment })] }), latestAiAssessment.analyst_reasoning && (_jsxs("div", { className: "ai-field analyst-reasoning-box", children: [_jsx("h4", { children: "Analyst Reasoning (Side Note)" }), _jsxs("div", { className: "reasoning-content", children: [_jsx("span", { className: "info-icon", children: "\uD83D\uDCA1" }), _jsx("p", { children: latestAiAssessment.analyst_reasoning })] })] })), latestAiAssessment.status === 'final_verdict' && (_jsxs("div", { className: "ai-field recommendation-summary", children: [_jsx("h4", { children: "Ticket Recommendation" }), latestAiAssessment.verdict === 'ESCALATE' && (_jsx("p", { className: "rec-text escalate", children: "Escalate for immediate investigation." })), latestAiAssessment.verdict === 'SUSPICIOUS_MONITOR' && (_jsx("p", { className: "rec-text monitor", children: "No ticket recommended at this time. Continue monitoring only if new evidence appears." })), latestAiAssessment.verdict === 'LIKELY_FALSE_POSITIVE' && (_jsx("p", { className: "rec-text fp", children: "No ticket recommended. Case appears to be a likely false positive." }))] })), _jsxs("div", { className: "ai-field", children: [_jsx("h4", { children: "Reasoning" }), _jsx("ul", { className: "ai-reasoning-list", children: latestAiAssessment.reasoning.map((r, i) => _jsx("li", { children: r }, i)) })] }), latestAiAssessment.status === 'pivot_required' && (_jsxs(_Fragment, { children: [_jsxs("div", { className: "ai-field", children: [_jsx("h4", { children: "Recommended Actions" }), _jsx("ul", { className: "ai-actions-list", children: latestAiAssessment.recommended_actions.map((a, i) => _jsx("li", { children: a }, i)) })] }), _jsxs("div", { className: "ai-field", children: [_jsx("h4", { children: "Follow-up Pivots" }), _jsx("div", { className: "pivot-buttons-container", children: latestAiAssessment.recommended_pivots.map((pivot) => (_jsxs("div", { className: "pivot-button-wrapper", children: [_jsx("button", { className: "pivot-execute-btn", onClick: () => executePivotQuery(selectedCaseData.case_id, pivot), disabled: pivotLoading[selectedCaseData.case_id], children: pivot.label }), _jsx("p", { className: "pivot-reason", children: pivot.reason })] }, pivot.pivot_id))) })] })] })), latestAiAssessment.status === 'final_verdict' && latestAiAssessment.verdict === 'ESCALATE' && (_jsxs("div", { className: "escalation-actions", children: [_jsxs("div", { className: "duplicate-check-section", children: [_jsx("h4", { children: "Duplicate Ticket Check" }), duplicateLoading[selectedCaseData.case_id] ? (_jsxs("div", { className: "duplicate-status checking", children: [_jsx("div", { className: "spinner mini" }), _jsx("span", { children: "Checking duplicates in Mantis..." })] })) : duplicateResults[selectedCaseData.case_id] ? (_jsx("div", { className: "duplicate-results-container", children: duplicateResults[selectedCaseData.case_id].match_count > 0 ? (_jsxs(_Fragment, { children: [_jsx("div", { className: "duplicate-alert warning", children: _jsx("span", { children: "\u26A0\uFE0F Possible duplicate tickets found" }) }), _jsx("div", { className: "duplicate-list", children: duplicateResults[selectedCaseData.case_id].possible_duplicates.map((ticket) => (_jsxs("div", { className: "duplicate-item", children: [_jsxs("div", { className: "duplicate-item-info", children: [_jsxs("span", { className: "ticket-id", children: ["Ticket #", ticket.id] }), _jsx("span", { className: "ticket-summary", children: ticket.summary }), _jsx("span", { className: `ticket-status ${ticket.status.toLowerCase()}`, children: ticket.status })] }), _jsx("a", { href: `${process.env.REACT_APP_MANTIS_URL || 'https://wa-mantis.cyberrangepoulsbo.com'}/view.php?id=${ticket.id}`, target: "_blank", rel: "noopener noreferrer", className: "view-ticket-link", children: "View Ticket" })] }, ticket.id))) })] })) : (_jsx("div", { className: "duplicate-alert success", children: _jsx("span", { children: "\u2714 No duplicates found in the last 7 days" }) })) })) : (_jsx("button", { className: "check-duplicates-btn", onClick: () => handleCheckDuplicates(selectedCaseData), children: "Run Duplicate Check" }))] }), createdTickets[selectedCaseData.case_id] ? (_jsxs("div", { className: "ticket-status-success", children: [_jsx("span", { className: "success-icon", children: "\u2705" }), _jsxs("div", { className: "ticket-info", children: [_jsx("label", { children: "Ticket Created" }), _jsxs("a", { href: createdTickets[selectedCaseData.case_id].url, target: "_blank", rel: "noopener noreferrer", className: "ticket-link", children: ["View Ticket #", createdTickets[selectedCaseData.case_id].id, " \uD83D\uDD17"] })] })] })) : (_jsx("button", { className: "create-ticket-btn", onClick: () => handleCreateTicket(selectedCaseData), disabled: !duplicateResults[selectedCaseData.case_id] || duplicateResults[selectedCaseData.case_id].match_count > 0, title: ((_q = duplicateResults[selectedCaseData.case_id]) === null || _q === void 0 ? void 0 : _q.match_count) > 0 ? "Resolve duplicate tickets before creating a new one" : "", children: "Create Ticket" })), "                          "] })), (latestAiAssessment === null || latestAiAssessment === void 0 ? void 0 : latestAiAssessment.status) === 'pivot_required' && (_jsx("div", { className: `recommendation-box ${latestAiAssessment.ticket_recommended ? 'escalate' : ''}`, children: _jsxs("div", { className: "ai-field", children: [_jsx("h4", { children: "Initial Verdict Recommendation" }), _jsx("p", { children: latestAiAssessment.ticket_recommended ? 'ESCALATE: This case is ticket-worthy.' : 'CLOSE: No further action recommended.' }), _jsx("span", { className: "status-badge", children: latestAiAssessment.status.replace(/_/g, ' ') })] }) }))] })), reassessLoading[selectedCaseData.case_id] && (_jsxs("div", { className: "ai-loading", children: [_jsx("div", { className: "spinner" }), _jsx("p", { children: "Investigation in progress with new data..." })] }))] })] }), pivotLoading[selectedCaseData.case_id] && (_jsxs("div", { className: "pivot-loading-overlay", children: [_jsx("div", { className: "spinner" }), _jsx("p", { children: "Executing pivot query..." })] })), pivotError[selectedCaseData.case_id] && (_jsxs("div", { className: "pivot-error-message", children: ["\u26A0\uFE0F Pivot Failed: ", pivotError[selectedCaseData.case_id]] })), (((_r = executedPivots[selectedCaseData.case_id]) === null || _r === void 0 ? void 0 : _r.length) || 0) > 0 && (_jsxs("section", { className: "case-pivot-results", children: [_jsxs("h3", { children: ["PIVOT RESULTS (", (((_s = executedPivots[selectedCaseData.case_id]) === null || _s === void 0 ? void 0 : _s.length) || 0), ")"] }), _jsx("div", { className: "pivot-results-list", children: (_t = executedPivots[selectedCaseData.case_id]) === null || _t === void 0 ? void 0 : _t.map((pivotResult, idx) => {
                                                            var _a, _b, _c;
                                                            return (_jsxs("div", { className: "pivot-result-card", children: [_jsxs("header", { className: "pivot-result-header", children: [_jsxs("div", { className: "query-info", children: [_jsx("label", { children: "Query:" }), _jsx("code", { children: pivotResult.query })] }), _jsxs("div", { className: "hits-info", children: [_jsx("strong", { children: pivotResult.total_hits }), " hits found", _jsx("button", { className: "view-kibana-mini-btn", onClick: () => handleOpenOpenSearch(pivotResult.query), title: "View these results in OpenSearch", children: "\uD83D\uDD17" })] }), currentStatus === 'pivot_required' && !reassessLoading[selectedCaseData.case_id] && (_jsx("button", { className: "reassess-btn", onClick: () => handleReassessCase(selectedCaseData, pivotResult), children: "Reassess with AI" })), "                          "] }), pivotResult.total_hits > 0 ? (_jsxs("div", { className: "pivot-result-content", children: [_jsxs("div", { className: "pivot-summary-grid", children: [_jsxs("div", { className: "pivot-summary-item", children: [_jsx("label", { children: "Top Signatures" }), _jsx("ul", { children: (_a = pivotResult.top_signatures) === null || _a === void 0 ? void 0 : _a.map((s, i) => _jsx("li", { children: s }, i)) })] }), _jsxs("div", { className: "pivot-summary-item", children: [_jsx("label", { children: "Top Sources" }), _jsx("ul", { children: (_b = pivotResult.top_src_ips) === null || _b === void 0 ? void 0 : _b.map((s, i) => _jsx("li", { children: s }, i)) })] }), _jsxs("div", { className: "pivot-summary-item", children: [_jsx("label", { children: "Top Destinations" }), _jsx("ul", { children: (_c = pivotResult.top_dest_ips) === null || _c === void 0 ? void 0 : _c.map((s, i) => _jsx("li", { children: s }, i)) })] })] }), _jsxs("div", { className: "pivot-logs", children: [_jsx("label", { children: "Sample Evidence (Last 10)" }), _jsx("div", { className: "evidence-list mini", children: pivotResult.sample_logs.map((log) => (_jsx("div", { className: "log-entry mini", children: _jsx("pre", { className: "log-json", children: JSON.stringify(log._source, null, 2) }) }, log._id))) })] })] })) : (_jsx("div", { className: "empty-pivot-result", children: "No logs found for this query." }))] }, idx));
                                                        }) })] })), _jsxs("section", { className: "case-evidence", children: [_jsxs("h3", { children: ["EVIDENCE (Last ", ((_u = selectedCaseData.sample_logs) === null || _u === void 0 ? void 0 : _u.length) || 0, ")"] }), _jsx("div", { className: "evidence-list", children: (_v = selectedCaseData.sample_logs) === null || _v === void 0 ? void 0 : _v.map((log) => (_jsxs("div", { className: "log-entry", children: [_jsxs("div", { className: "log-meta", children: [_jsx("span", { className: "log-time", children: log._source['@timestamp'] ? new Date(log._source['@timestamp']).toLocaleString() : 'N/A' }), _jsxs("span", { className: "log-id", children: ["ID: ", log._id] })] }), _jsx("pre", { className: "log-json", children: JSON.stringify(log._source, null, 2) })] }, log._id))) })] })] })] }) })), ticketLoading && (_jsx("div", { className: "ticket-loading-overlay", children: _jsxs("div", { className: "ticket-loading-modal", children: [_jsx("div", { className: "spinner" }), _jsx("h3", { children: "Preparing Ticket Evidence..." }), _jsx("p", { children: telemetrySource === 'opensearch'
                                            ? 'Preparing OpenSearch-backed ticket details.'
                                            : 'Please wait while we secure a direct OpenSearch link for your ticket.' })] }) })), isSubmitting && (_jsx("div", { className: "ticket-loading-overlay", children: _jsxs("div", { className: "ticket-loading-modal", children: [_jsx("div", { className: "spinner" }), _jsx("h3", { children: "Creating Mantis Ticket..." }), _jsx("p", { children: "Submitting investigation details and saving to local history." })] }) })), ticketPreview && (_jsx("div", { className: "ticket-preview-overlay", children: _jsxs("div", { className: "ticket-preview-modal", children: [_jsxs("header", { className: "ticket-preview-header", children: [_jsxs("div", { className: "title-group", children: [_jsx("h2", { children: "Mantis Ticket Preview" }), _jsx("span", { className: "subtitle", children: "Review ticket details before final submission" })] }), _jsx("button", { className: "close-btn", onClick: () => setTicketPreview(null), children: "\u00D7" })] }), _jsxs("div", { className: "ticket-preview-content", children: [_jsxs("section", { className: "preview-section", children: [_jsx("h3", { children: "MANTIS FIELDS" }), _jsxs("div", { className: "preview-grid", children: [_jsxs("div", { className: "preview-field", children: [_jsx("label", { children: "Project" }), _jsx("input", { type: "text", className: "preview-input", value: ticketPreview.project, onChange: (e) => {
                                                                            const val = e.target.value;
                                                                            setTicketPreview(prev => prev ? {
                                                                                ...prev,
                                                                                project: val,
                                                                                api_payload: { ...prev.api_payload, project: { name: val } }
                                                                            } : null);
                                                                        } })] }), _jsxs("div", { className: "preview-field", children: [_jsx("label", { children: "Category" }), _jsx("input", { type: "text", className: "preview-input", value: ticketPreview.category, onChange: (e) => {
                                                                            const val = e.target.value;
                                                                            setTicketPreview(prev => prev ? {
                                                                                ...prev,
                                                                                category: val,
                                                                                api_payload: { ...prev.api_payload, category: { name: val } }
                                                                            } : null);
                                                                        } })] }), _jsxs("div", { className: "preview-field", children: [_jsx("label", { children: "Reproducibility" }), _jsxs("select", { className: "preview-input", value: ticketPreview.reproducibility, onChange: (e) => {
                                                                            const val = e.target.value;
                                                                            setTicketPreview(prev => prev ? {
                                                                                ...prev,
                                                                                reproducibility: val,
                                                                                api_payload: { ...prev.api_payload, reproducibility: { name: val } }
                                                                            } : null);
                                                                        }, children: [_jsx("option", { value: "have not tried", children: "have not tried" }), _jsx("option", { value: "always", children: "always" }), _jsx("option", { value: "sometimes", children: "sometimes" }), _jsx("option", { value: "random", children: "random" }), _jsx("option", { value: "unable to reproduce", children: "unable to reproduce" }), _jsx("option", { value: "N/A", children: "N/A" })] })] }), _jsxs("div", { className: "preview-field", children: [_jsx("label", { children: "Severity" }), _jsxs("select", { className: "preview-input", value: ticketPreview.severity, onChange: (e) => {
                                                                            const val = e.target.value;
                                                                            setTicketPreview(prev => prev ? {
                                                                                ...prev,
                                                                                severity: val,
                                                                                api_payload: { ...prev.api_payload, severity: { name: val } }
                                                                            } : null);
                                                                        }, children: [_jsx("option", { value: "feature", children: "feature" }), _jsx("option", { value: "trivial", children: "trivial" }), _jsx("option", { value: "text", children: "text" }), _jsx("option", { value: "tweak", children: "tweak" }), _jsx("option", { value: "minor", children: "minor" }), _jsx("option", { value: "major", children: "major" }), _jsx("option", { value: "crash", children: "crash" }), _jsx("option", { value: "block", children: "block" })] })] }), _jsxs("div", { className: "preview-field", children: [_jsx("label", { children: "Priority" }), _jsxs("select", { className: "preview-input", value: ticketPreview.priority, onChange: (e) => {
                                                                            const val = e.target.value;
                                                                            setTicketPreview(prev => prev ? {
                                                                                ...prev,
                                                                                priority: val,
                                                                                api_payload: { ...prev.api_payload, priority: { name: val } }
                                                                            } : null);
                                                                        }, children: [_jsx("option", { value: "none", children: "none" }), _jsx("option", { value: "low", children: "low" }), _jsx("option", { value: "normal", children: "normal" }), _jsx("option", { value: "high", children: "high" }), _jsx("option", { value: "urgent", children: "urgent" }), _jsx("option", { value: "immediate", children: "immediate" })] })] }), _jsxs("div", { className: "preview-field", children: [_jsx("label", { children: "View Status" }), _jsxs("select", { className: "preview-input", value: ticketPreview.view_status, onChange: (e) => {
                                                                            const val = e.target.value;
                                                                            setTicketPreview(prev => prev ? {
                                                                                ...prev,
                                                                                view_status: val,
                                                                                api_payload: { ...prev.api_payload, view_state: { name: val } }
                                                                            } : null);
                                                                        }, children: [_jsx("option", { value: "public", children: "public" }), _jsx("option", { value: "private", children: "private" })] })] })] }), _jsxs("div", { className: "preview-field full-width", children: [_jsx("label", { children: "Summary" }), _jsx("input", { type: "text", className: "preview-input summary-input", value: ticketPreview.summary, onChange: (e) => {
                                                                    const val = e.target.value;
                                                                    setTicketPreview(prev => prev ? {
                                                                        ...prev,
                                                                        summary: val,
                                                                        api_payload: { ...prev.api_payload, summary: val }
                                                                    } : null);
                                                                } })] }), _jsxs("div", { className: "preview-field full-width", children: [_jsx("label", { children: "Description" }), _jsx("textarea", { className: "preview-textarea", rows: 10, value: ticketPreview.description, onChange: (e) => {
                                                                    const val = e.target.value;
                                                                    setTicketPreview(prev => prev ? {
                                                                        ...prev,
                                                                        description: val,
                                                                        api_payload: { ...prev.api_payload, description: val }
                                                                    } : null);
                                                                } })] }), _jsxs("div", { className: "preview-field full-width", children: [_jsx("label", { children: "Steps To Reproduce" }), _jsx("textarea", { className: "preview-textarea", rows: 4, value: ticketPreview.steps_to_reproduce, placeholder: telemetrySource === 'opensearch'
                                                                    ? 'Paste OpenSearch Dashboards link or manual reproduction steps here...'
                                                                    : 'Paste OpenSearch Link or manual reproduction steps here...', onChange: (e) => {
                                                                    const val = e.target.value;
                                                                    setTicketPreview(prev => prev ? {
                                                                        ...prev,
                                                                        steps_to_reproduce: val,
                                                                        api_payload: { ...prev.api_payload, steps_to_reproduce: val }
                                                                    } : null);
                                                                } })] }), _jsxs("div", { className: "preview-field full-width", children: [_jsx("label", { children: "Additional Information" }), _jsx("textarea", { className: "preview-textarea", rows: 6, value: ticketPreview.additional_information, onChange: (e) => {
                                                                    const val = e.target.value;
                                                                    setTicketPreview(prev => prev ? {
                                                                        ...prev,
                                                                        additional_information: val,
                                                                        api_payload: { ...prev.api_payload, additional_information: val }
                                                                    } : null);
                                                            } })] })] }), _jsxs("section", { className: "preview-section payload-section", children: [_jsx("h3", { children: "API PAYLOAD PREVIEW (JSON)" }), _jsx("pre", { className: "payload-json", children: JSON.stringify(ticketPreview.api_payload, null, 2) })] })] }), _jsxs("footer", { className: "ticket-preview-footer", children: [_jsx("button", { className: "preview-secondary-btn", onClick: () => setTicketPreview(null), disabled: isSubmitting, children: "Close Preview" }), _jsx("button", { className: "preview-primary-btn", onClick: handleSubmitTicket, disabled: isSubmitting, children: isSubmitting ? 'Submitting...' : 'Confirm & Submit Ticket' })] })] }) }))] })) : currentView === 'cases-v1' ? (_jsx(CaseManagerV1Page, {})) : (_jsx(TicketsPage, {})) })] }));
}
export default App;
