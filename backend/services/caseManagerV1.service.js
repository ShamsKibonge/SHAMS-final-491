import fs from 'fs';
import path from 'path';
import { collectTriageData } from '../triage_collector.js';
import { analyzeCase, reassessCase } from '../ai.service.js';
import { executePivotQuery } from '../pivot_executor.js';
import { syncCaseCandidatesIntoRegistry } from './caseCandidateSync.service.js';

const STATUS_FILE_PATH = path.resolve('data/case-manager-v1-status.json');
const OUTPUT_FILE_PATH = path.resolve('data/case-manager-v1-last-hour.json');
const DEFAULT_TIME_RANGE = 'now-1h';
const CASE_MANAGER_V1_PROFILE = 'dashboard_v1';
const DEFAULT_MAX_AUTOMATED_CASES = 5;
const DEFAULT_MAX_AUTOMATED_PIVOTS = 2;

function readPositiveIntegerEnv(name, fallback) {
    const rawValue = process.env[name];
    if (rawValue == null || rawValue === '') {
        return fallback;
    }

    const parsed = Number(rawValue);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

const MAX_AUTOMATED_CASES = readPositiveIntegerEnv('CASE_MANAGER_V1_MAX_AI_CASES', DEFAULT_MAX_AUTOMATED_CASES);
const MAX_AUTOMATED_PIVOTS = readPositiveIntegerEnv('CASE_MANAGER_V1_MAX_PIVOTS', DEFAULT_MAX_AUTOMATED_PIVOTS);

let activeRunPromise = null;

function ensureDir(filePath) {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
}

function buildInitialStatus() {
    return {
        is_running: false,
        stop_requested: false,
        current_stage: 'idle',
        current_message: 'No Case Manager v1 run has been started',
        current_case_id: null,
        current_case_signature: null,
        source: 'opensearch',
        time_range: DEFAULT_TIME_RANGE,
        last_started_at: null,
        last_completed_at: null,
        last_saved_output_at: null,
        recent_events: [],
        summary: {
            total_cases: 0,
            total_logs: 0,
            categories_completed: 0,
            investigated_cases: 0,
        },
        result: {
            cases: [],
            summaries: [],
            output_file_path: OUTPUT_FILE_PATH,
            investigation_results: [],
            registry_sync: null,
        },
    };
}

function reconcileStatus(status) {
    if (status.is_running && !activeRunPromise) {
        return {
            ...status,
            is_running: false,
            stop_requested: false,
            current_stage: status.last_completed_at ? 'interrupted' : 'idle',
            current_message: status.last_completed_at
                ? 'Recovered from a stale Case Manager v1 run state'
                : 'No Case Manager v1 run is active',
        };
    }

    return status;
}

function ensureStatusFile() {
    ensureDir(STATUS_FILE_PATH);
    if (!fs.existsSync(STATUS_FILE_PATH)) {
        fs.writeFileSync(STATUS_FILE_PATH, JSON.stringify(buildInitialStatus(), null, 2), 'utf8');
    }
}

function loadStatus() {
    ensureStatusFile();
    try {
        const raw = fs.readFileSync(STATUS_FILE_PATH, 'utf8');
        const parsed = JSON.parse(raw);
        const merged = {
            ...buildInitialStatus(),
            ...parsed,
            recent_events: Array.isArray(parsed.recent_events) ? parsed.recent_events : [],
            summary: parsed.summary || {},
            result: parsed.result || {},
        };
        const reconciled = reconcileStatus(merged);

        if (JSON.stringify(reconciled) !== JSON.stringify(merged)) {
            fs.writeFileSync(STATUS_FILE_PATH, JSON.stringify(reconciled, null, 2), 'utf8');
        }

        return reconciled;
    } catch {
        const fallback = buildInitialStatus();
        fs.writeFileSync(STATUS_FILE_PATH, JSON.stringify(fallback, null, 2), 'utf8');
        return fallback;
    }
}

function saveStatus(status) {
    ensureStatusFile();
    fs.writeFileSync(STATUS_FILE_PATH, JSON.stringify(status, null, 2), 'utf8');
    return status;
}

function appendEvent(event) {
    const current = loadStatus();
    return saveStatus({
        ...current,
        recent_events: [
            {
                at: new Date().toISOString(),
                ...event,
            },
            ...current.recent_events,
        ].slice(0, 100),
    });
}

function flattenCases(summaryData) {
    const summaries = Array.isArray(summaryData?.summaries) ? summaryData.summaries : [];

    return summaries
        .flatMap((summary) => {
            const cases = Array.isArray(summary?.cases) ? summary.cases : [];
            return cases.map((caseItem) => ({
                ...caseItem,
                category_name: summary.name || caseItem.category,
                category_id: summary.id || caseItem.category,
            }));
        })
        .sort((left, right) => {
            if ((right.priority_score || 0) !== (left.priority_score || 0)) {
                return (right.priority_score || 0) - (left.priority_score || 0);
            }

            if ((right.child_group_count || 0) !== (left.child_group_count || 0)) {
                return (right.child_group_count || 0) - (left.child_group_count || 0);
            }

            if ((right.log_count || 0) !== (left.log_count || 0)) {
                return (right.log_count || 0) - (left.log_count || 0);
            }

            return String(right.last_seen || '').localeCompare(String(left.last_seen || ''));
        });
}

function clampScore(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

function normalizeText(value) {
    return String(value || '').toLowerCase();
}

function countArrayValues(value) {
    return Array.isArray(value) ? value.filter(Boolean).length : 0;
}

function addReason(reasons, label, points) {
    if (points !== 0) {
        reasons.push({ label, points });
    }
}

export function scoreCaseLocally(caseRecord = {}) {
    const category = normalizeText(caseRecord.category || caseRecord.category_id);
    const signature = normalizeText(caseRecord.signature);
    const destPort = Number(caseRecord.dest_port);
    const logCount = Number(caseRecord.log_count || 0);
    const childGroupCount = Number(caseRecord.child_group_count || 0);
    const priorityScore = Number(caseRecord.priority_score || 0);
    const affectedDestCount = countArrayValues(caseRecord.affected_dest_ips);
    const affectedHostCount = countArrayValues(caseRecord.affected_hosts);
    const reasons = [];
    let score = 0;

    const categoryWeights = {
        c2_beaconing: 90,
        malware_activity: 85,
        exploit_attempts: 80,
        web_attacks: 70,
        lateral_movement: 70,
        credential_attacks: 55,
        dns_tunneling: 50,
        reconnaissance: 20,
    };
    const categoryPoints = categoryWeights[category] || 25;
    score += categoryPoints;
    addReason(reasons, `Category ${caseRecord.category_name || caseRecord.category || 'unknown'}`, categoryPoints);

    if (/cve-\d{4}-\d{4,7}/i.test(caseRecord.signature || '')) {
        score += 35;
        addReason(reasons, 'CVE signature', 35);
    }

    if (/(rce|remote code|command injection|webshell|powershell|mimikatz|ransom|backdoor|trojan|cobalt|beacon|cnc|c2)/i.test(caseRecord.signature || '')) {
        score += 30;
        addReason(reasons, 'High-risk signature keyword', 30);
    }

    const logPoints = clampScore(Math.ceil(Math.log10(logCount + 1) * 12), 0, 36);
    score += logPoints;
    addReason(reasons, `${logCount} matching log(s)`, logPoints);

    const groupPoints = clampScore(childGroupCount * 4, 0, 24);
    score += groupPoints;
    addReason(reasons, `${childGroupCount} child group(s)`, groupPoints);

    const spreadPoints = clampScore((affectedDestCount + affectedHostCount) * 3, 0, 30);
    score += spreadPoints;
    addReason(reasons, 'Destination or host spread', spreadPoints);

    const inheritedPriorityPoints = clampScore(Math.round(priorityScore / 10), 0, 30);
    score += inheritedPriorityPoints;
    addReason(reasons, 'Collector priority score', inheritedPriorityPoints);

    if ([22, 23, 135, 139, 389, 445, 3389, 5985, 5986].includes(destPort)) {
        score += 15;
        addReason(reasons, `Sensitive destination port ${destPort}`, 15);
    }

    if (/(scan|scanner|probe|recon|masscan|zmap|nmap|crawler|bot)/i.test(signature)) {
        score -= 25;
        addReason(reasons, 'Likely scanning/noise keyword', -25);
    }

    if (caseRecord.auto_investigation || caseRecord.investigation?.last_investigated_at) {
        score -= 60;
        addReason(reasons, 'Already investigated', -60);
    }

    return {
        score,
        reasons: reasons.sort((left, right) => Math.abs(right.points) - Math.abs(left.points)),
    };
}

export function rankCasesForAutomatedInvestigation(cases = []) {
    return cases
        .map((caseRecord) => {
            const ranking = scoreCaseLocally(caseRecord);
            return {
                ...caseRecord,
                local_rank_score: ranking.score,
                local_rank_reasons: ranking.reasons,
            };
        })
        .sort((left, right) => {
            if ((right.local_rank_score || 0) !== (left.local_rank_score || 0)) {
                return (right.local_rank_score || 0) - (left.local_rank_score || 0);
            }

            if ((right.priority_score || 0) !== (left.priority_score || 0)) {
                return (right.priority_score || 0) - (left.priority_score || 0);
            }

            if ((right.log_count || 0) !== (left.log_count || 0)) {
                return (right.log_count || 0) - (left.log_count || 0);
            }

            return String(right.last_seen || '').localeCompare(String(left.last_seen || ''));
        })
        .map((caseRecord, index) => ({
            ...caseRecord,
            local_rank: index + 1,
        }));
}

function saveOutput(resultPayload) {
    ensureDir(OUTPUT_FILE_PATH);
    fs.writeFileSync(OUTPUT_FILE_PATH, JSON.stringify(resultPayload, null, 2), 'utf8');
}

function updateCurrentStage(stage, message, extra = {}) {
    const current = loadStatus();
    saveStatus({
        ...current,
        current_stage: stage,
        current_message: message,
        ...extra,
    });
}

function markStarted(timeRange) {
    return saveStatus({
        ...loadStatus(),
        is_running: true,
        stop_requested: false,
        current_stage: 'starting',
        current_message: 'Starting Case Manager v1 OpenSearch grouping run',
        current_case_id: null,
        current_case_signature: null,
        source: 'opensearch',
        time_range: timeRange,
        last_started_at: new Date().toISOString(),
        recent_events: [],
        summary: {
            total_cases: 0,
            total_logs: 0,
            categories_completed: 0,
            investigated_cases: 0,
        },
    });
}

function updateProgress(event) {
    const current = loadStatus();
    const categoriesCompleted = current.recent_events.filter((item) => item.stage === 'categorized').length
        + (event.stage === 'categorized' ? 1 : 0);

    saveStatus({
        ...current,
        current_stage: event.stage,
        current_message: event.message,
        time_range: event.time_range || current.time_range,
        summary: {
            ...current.summary,
            total_logs: event.total_logs ?? current.summary.total_logs ?? 0,
            categories_completed: categoriesCompleted,
            investigated_cases: current.summary.investigated_cases ?? 0,
        },
    });

    appendEvent(event);
}

function getRecommendedPivots(analysis = {}) {
    if (Array.isArray(analysis.recommended_pivot_queries) && analysis.recommended_pivot_queries.length > 0) {
        return analysis.recommended_pivot_queries;
    }

    if (Array.isArray(analysis.recommended_pivots) && analysis.recommended_pivots.length > 0) {
        return analysis.recommended_pivots;
    }

    return [];
}

function summarizeInvestigationResult(caseRecord, analysis, pivotHistory = []) {
    const verdict = analysis?.verdict || null;
    const normalizedTicketRecommendation =
        analysis?.status === 'final_verdict'
            ? verdict === 'ESCALATE'
            : Boolean(analysis?.ticket_recommended);

    return {
        case_id: caseRecord.case_id,
        status: analysis?.status || 'unknown',
        verdict,
        confidence: analysis?.confidence ?? null,
        classification: analysis?.classification || analysis?.attack_classification || null,
        assessment: analysis?.updated_assessment || analysis?.threat_assessment || null,
        analyst_reasoning: analysis?.analyst_reasoning || null,
        reasoning: Array.isArray(analysis?.reasoning) ? analysis.reasoning : [],
        ticket_recommended: normalizedTicketRecommendation,
        pivots_executed: pivotHistory.length,
        pivots: pivotHistory,
    };
}

async function runAutoInvestigationForCase(caseRecord, options = {}) {
    const shouldStop = typeof options.shouldStop === 'function' ? options.shouldStop : null;
    const pivotTimeRange = options.pivotTimeRange || 'now-48h';

    if (shouldStop?.()) {
        const stopError = new Error('OpenSearch triage stopped by operator request');
        stopError.code = 'CASE_MANAGER_V1_STOPPED';
        throw stopError;
    }

    updateCurrentStage('investigating_case', `Analyzing ${caseRecord.case_id}`, {
        current_case_id: caseRecord.case_id,
        current_case_signature: caseRecord.signature || null,
    });
    appendEvent({
        stage: 'investigating_case',
        message: `Analyzing ${caseRecord.case_id}`,
        case_id: caseRecord.case_id,
        signature: caseRecord.signature,
    });

    let analysis = await analyzeCase(caseRecord);
    const pivotHistory = [];

    appendEvent({
        stage: 'analysis_completed',
        message: `Initial AI analysis completed for ${caseRecord.case_id}`,
        case_id: caseRecord.case_id,
        verdict: analysis?.verdict || null,
        status: analysis?.status || null,
        confidence: analysis?.confidence ?? null,
    });

    while (analysis?.status === 'pivot_required' && pivotHistory.length < MAX_AUTOMATED_PIVOTS) {
        if (shouldStop?.()) {
            const stopError = new Error('OpenSearch triage stopped by operator request');
            stopError.code = 'CASE_MANAGER_V1_STOPPED';
            throw stopError;
        }

        const nextPivot = getRecommendedPivots(analysis)[0];
        if (!nextPivot || !nextPivot.query) {
            break;
        }

        updateCurrentStage('executing_pivot', `Executing pivot for ${caseRecord.case_id}: ${nextPivot.label || nextPivot.type || 'pivot'}`, {
            current_case_id: caseRecord.case_id,
            current_case_signature: caseRecord.signature || null,
        });
        appendEvent({
            stage: 'pivot_requested',
            message: `Auto-accepted pivot for ${caseRecord.case_id}: ${nextPivot.label || nextPivot.type || 'pivot'}`,
            case_id: caseRecord.case_id,
            pivot_label: nextPivot.label || nextPivot.type || 'pivot',
            pivot_query: nextPivot.query,
        });

        const pivotResult = await executePivotQuery(nextPivot.query, {
            source: 'opensearch',
            timeRange: pivotTimeRange,
            maxLogs: 10,
        });

        pivotHistory.push({
            label: nextPivot.label || nextPivot.type || 'pivot',
            type: nextPivot.type || null,
            query: nextPivot.query,
            reason: nextPivot.reason || null,
            total_hits: pivotResult.total_hits || 0,
            first_seen: pivotResult.first_seen || null,
            last_seen: pivotResult.last_seen || null,
            top_signatures: pivotResult.top_signatures || [],
            top_src_ips: pivotResult.top_src_ips || [],
            top_dest_ips: pivotResult.top_dest_ips || [],
            top_hosts: pivotResult.top_hosts || [],
        });

        appendEvent({
            stage: 'pivot_completed',
            message: `Pivot completed for ${caseRecord.case_id}`,
            case_id: caseRecord.case_id,
            pivot_label: nextPivot.label || nextPivot.type || 'pivot',
            total_hits: pivotResult.total_hits || 0,
        });

        updateCurrentStage('reassessing_case', `Reassessing ${caseRecord.case_id} after pivot`, {
            current_case_id: caseRecord.case_id,
            current_case_signature: caseRecord.signature || null,
        });
        analysis = await reassessCase(caseRecord, analysis, pivotResult, pivotHistory.length);

        appendEvent({
            stage: 'reassessment_completed',
            message: `Reassessment completed for ${caseRecord.case_id}`,
            case_id: caseRecord.case_id,
            verdict: analysis?.verdict || null,
            status: analysis?.status || null,
            confidence: analysis?.confidence ?? null,
        });
    }

    const finalResult = summarizeInvestigationResult(caseRecord, analysis, pivotHistory);
    appendEvent({
        stage: 'case_investigation_completed',
        message: `Investigation completed for ${caseRecord.case_id}`,
        case_id: caseRecord.case_id,
        verdict: finalResult.verdict,
        pivots_executed: finalResult.pivots_executed,
    });

    return finalResult;
}

export function getCaseManagerV1Status() {
    return {
        ...loadStatus(),
        output_file_path: OUTPUT_FILE_PATH,
    };
}

export function getCaseManagerV1OutputFilePath() {
    return OUTPUT_FILE_PATH;
}

export function isCaseManagerV1Running() {
    return Boolean(activeRunPromise);
}

export function requestCaseManagerV1Stop() {
    const current = loadStatus();
    if (!activeRunPromise) {
        return saveStatus({
            ...current,
            is_running: false,
            stop_requested: false,
            current_stage: 'stopped',
            current_message: 'Case Manager v1 is stopped',
        });
    }

    return saveStatus({
        ...current,
        stop_requested: true,
        current_message: current.is_running
            ? 'Safety stop requested. Waiting for current checkpoint.'
            : 'Case Manager v1 is stopped',
        recent_events: [
            {
                at: new Date().toISOString(),
                stage: 'stop_requested',
                message: 'Safety stop requested by operator',
            },
            ...current.recent_events,
        ].slice(0, 100),
    });
}

export function startCaseManagerV1Run(options = {}) {
    if (activeRunPromise) {
        return {
            started: false,
            already_running: true,
        };
    }

    const timeRange = options.timeRange || DEFAULT_TIME_RANGE;
    markStarted(timeRange);

    activeRunPromise = (async () => {
        try {
            const data = await collectTriageData('opensearch', {
                timeRange,
                profile: CASE_MANAGER_V1_PROFILE,
                alignToLatestAvailableWindow: true,
                onProgress: updateProgress,
                shouldStop: () => loadStatus().stop_requested,
            });

            const effectiveTimeRange = data.summaryData?.timeRange || timeRange;
            const cases = rankCasesForAutomatedInvestigation(flattenCases(data.summaryData));
            const casesToInvestigate = cases.slice(0, MAX_AUTOMATED_CASES);
            const investigationResults = [];

            appendEvent({
                stage: 'investigation_queue_ready',
                message: `Ranked ${cases.length} OpenSearch case(s) locally; prepared top ${casesToInvestigate.length} for AI investigation`,
                total_ranked_cases: cases.length,
                case_count: casesToInvestigate.length,
                max_ai_cases: MAX_AUTOMATED_CASES,
            });

            for (let index = 0; index < casesToInvestigate.length; index += 1) {
                const caseRecord = casesToInvestigate[index];
                if (loadStatus().stop_requested) {
                    const stopError = new Error('OpenSearch triage stopped by operator request');
                    stopError.code = 'CASE_MANAGER_V1_STOPPED';
                    throw stopError;
                }

                updateCurrentStage(
                    'investigation_queue',
                    `Investigating case ${index + 1} of ${casesToInvestigate.length}: ${caseRecord.case_id}`,
                    {
                        current_case_id: caseRecord.case_id,
                        current_case_signature: caseRecord.signature || null,
                    }
                );
                appendEvent({
                    stage: 'investigation_started',
                    message: `Investigating case ${index + 1} of ${casesToInvestigate.length}`,
                    case_id: caseRecord.case_id,
                    signature: caseRecord.signature,
                });

                const investigation = await runAutoInvestigationForCase(caseRecord, {
                    shouldStop: () => loadStatus().stop_requested,
                    pivotTimeRange: 'now-48h',
                });
                investigationResults.push(investigation);

                const current = loadStatus();
                saveStatus({
                    ...current,
                    summary: {
                        ...current.summary,
                        investigated_cases: investigationResults.length,
                    },
                });
            }

            const investigatedByCaseId = Object.fromEntries(
                investigationResults.map((result) => [result.case_id, result])
            );
            const casesWithInvestigation = cases.map((caseRecord) => ({
                ...caseRecord,
                auto_investigation: investigatedByCaseId[caseRecord.case_id] || null,
            }));
            updateCurrentStage('syncing_registry', 'Syncing grouped cases into persistent case registry', {
                current_case_id: null,
                current_case_signature: null,
            });
            const registrySync = syncCaseCandidatesIntoRegistry(casesWithInvestigation);
            appendEvent({
                stage: 'registry_sync_completed',
                message: `Registry sync completed: ${registrySync.created_cases} created, ${registrySync.updated_cases} updated, ${registrySync.unchanged_cases} unchanged`,
                created_cases: registrySync.created_cases,
                updated_cases: registrySync.updated_cases,
                unchanged_cases: registrySync.unchanged_cases,
            });
            const resultPayload = {
                source: 'opensearch',
                requested_time_range: timeRange,
                time_range: effectiveTimeRange,
                saved_at: new Date().toISOString(),
                total_cases: casesWithInvestigation.length,
                total_logs: data.summaryData?.totalLogs48h || 0,
                summaries: data.summaryData?.summaries || [],
                cases: casesWithInvestigation,
                investigation_scope: {
                    max_cases: MAX_AUTOMATED_CASES,
                    ranked_cases: cases.length,
                    investigated_cases: investigationResults.length,
                    max_pivots_per_case: MAX_AUTOMATED_PIVOTS,
                    pivot_time_range: 'now-48h',
                    ranking: 'local_score_desc_then_collector_priority_log_count_last_seen',
                },
                investigation_results: investigationResults,
                registry_sync: registrySync,
            };

            saveOutput(resultPayload);

            saveStatus({
                ...loadStatus(),
                is_running: false,
                stop_requested: false,
                current_stage: 'completed',
                current_message: 'Case Manager v1 grouping and auto-investigation completed',
                current_case_id: null,
                current_case_signature: null,
                last_completed_at: new Date().toISOString(),
                last_saved_output_at: resultPayload.saved_at,
                time_range: effectiveTimeRange,
                summary: {
                    total_cases: casesWithInvestigation.length,
                    total_logs: resultPayload.total_logs,
                    categories_completed: (data.summaryData?.summaries || []).length,
                    investigated_cases: investigationResults.length,
                },
                result: {
                    cases: casesWithInvestigation,
                    summaries: data.summaryData?.summaries || [],
                    output_file_path: OUTPUT_FILE_PATH,
                    investigation_results: investigationResults,
                    registry_sync: registrySync,
                },
            });

            appendEvent({
                stage: 'saved_output',
                message: 'Saved grouped last-hour cases to JSON output',
                total_cases: casesWithInvestigation.length,
                output_file_path: OUTPUT_FILE_PATH,
            });
        } catch (error) {
            if (error.code === 'CASE_MANAGER_V1_STOPPED') {
                saveStatus({
                    ...loadStatus(),
                    is_running: false,
                    stop_requested: false,
                    current_stage: 'stopped',
                    current_message: 'Case Manager v1 run stopped safely',
                    current_case_id: null,
                    current_case_signature: null,
                    last_completed_at: new Date().toISOString(),
                });
                appendEvent({
                    stage: 'stopped',
                    message: 'Case Manager v1 run stopped safely',
                });
            } else {
                saveStatus({
                    ...loadStatus(),
                    is_running: false,
                    current_stage: 'failed',
                    current_message: error.message,
                    current_case_id: null,
                    current_case_signature: null,
                    last_completed_at: new Date().toISOString(),
                });
                appendEvent({
                    stage: 'failed',
                    message: 'Case Manager v1 run failed',
                    details: error.message,
                });
            }
        } finally {
            activeRunPromise = null;
        }
    })();

    return {
        started: true,
        already_running: false,
    };
}
