import fs from 'fs';
import { collectTriageData, getTriageStoragePaths, resolveTelemetrySource } from '../triage_collector.js';
import { buildFingerprintResult } from './caseFingerprint.service.js';
import { loadCases, saveCases } from './caseStore.service.js';

export const CASE_CANDIDATE_SYNC_CONFIG = {
    newDataStrategy: 'last_seen_change',
    newLogsCountMode: 'replace_with_candidate_log_count',
};

function toIsoTimestamp(value) {
    if (!value) {
        return new Date().toISOString();
    }

    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? new Date().toISOString() : parsed.toISOString();
}

function normalizeCandidate(caseCandidate = {}) {
    const sourceSummaryCaseId = caseCandidate.case_id || null;
    const { fingerprint, case_id } = buildFingerprintResult(caseCandidate);

    return {
        ...caseCandidate,
        case_id,
        source_summary_case_id: sourceSummaryCaseId,
        category: String(caseCandidate.category || fingerprint.category || 'unknown').toLowerCase(),
        fingerprint,
        first_seen: toIsoTimestamp(caseCandidate.first_seen),
        last_seen: toIsoTimestamp(caseCandidate.last_seen),
        log_count: Number(caseCandidate.log_count || 0),
        priority_score: Number(caseCandidate.priority_score || 0),
        child_group_count: Number(caseCandidate.child_group_count || 1),
        incident_indicator: caseCandidate.incident_indicator || null,
        category_name: caseCandidate.category_name || null,
        source_case_ids: Array.isArray(caseCandidate.source_case_ids) ? caseCandidate.source_case_ids : [],
        datasets: Array.isArray(caseCandidate.datasets) ? caseCandidate.datasets : [],
        rule_ids: Array.isArray(caseCandidate.rule_ids) ? caseCandidate.rule_ids : [],
        notice_types: Array.isArray(caseCandidate.notice_types) ? caseCandidate.notice_types : [],
        dns_root_domains: Array.isArray(caseCandidate.dns_root_domains) ? caseCandidate.dns_root_domains : [],
        tls_server_names: Array.isArray(caseCandidate.tls_server_names) ? caseCandidate.tls_server_names : [],
        http_hosts: Array.isArray(caseCandidate.http_hosts) ? caseCandidate.http_hosts : [],
        http_paths: Array.isArray(caseCandidate.http_paths) ? caseCandidate.http_paths : [],
        sampled_dest_ips: Array.isArray(caseCandidate.sampled_dest_ips) ? caseCandidate.sampled_dest_ips : [],
        observed_connection_count: Number(caseCandidate.observed_connection_count || 0),
        scanned_ports: Array.isArray(caseCandidate.scanned_ports) ? caseCandidate.scanned_ports : [],
        max_scanned_host_count: Number(caseCandidate.max_scanned_host_count || 0),
        max_scanned_port_count: Number(caseCandidate.max_scanned_port_count || 0),
        affected_src_ips: Array.isArray(caseCandidate.affected_src_ips) ? caseCandidate.affected_src_ips : [],
        affected_dest_ips: Array.isArray(caseCandidate.affected_dest_ips) ? caseCandidate.affected_dest_ips : [],
        affected_hosts: Array.isArray(caseCandidate.affected_hosts) ? caseCandidate.affected_hosts : [],
        affected_urls: Array.isArray(caseCandidate.affected_urls) ? caseCandidate.affected_urls : [],
        auto_investigation: caseCandidate.auto_investigation || null,
        sample_logs: Array.isArray(caseCandidate.sample_logs) ? caseCandidate.sample_logs.slice(0, 10) : [],
    };
}

function mergeUniqueValues(existingValues = [], nextValues = []) {
    return Array.from(new Set([...(Array.isArray(existingValues) ? existingValues : []), ...(Array.isArray(nextValues) ? nextValues : [])]));
}

function buildHistoryEntry(action, caseCandidate = {}, extra = {}) {
    return {
        action,
        at: new Date().toISOString(),
        source_case_id: caseCandidate.source_summary_case_id || caseCandidate.case_id || null,
        candidate_last_seen: caseCandidate.last_seen || null,
        candidate_log_count: Number(caseCandidate.log_count || 0),
        ...extra,
    };
}

function buildCaseRecordFromCandidate(caseCandidate) {
    const hasInvestigation = Boolean(caseCandidate.auto_investigation);
    const investigationVerdict = caseCandidate.auto_investigation?.verdict || null;

    return {
        case_id: caseCandidate.case_id,
        category: caseCandidate.category,
        category_name: caseCandidate.category_name,
        fingerprint: caseCandidate.fingerprint,
        first_seen: caseCandidate.first_seen,
        last_seen: caseCandidate.last_seen,
        status: 'new',
        has_new_data: true,
        new_logs_count: caseCandidate.log_count,
        latest_observed_log_count: caseCandidate.log_count,
        log_refs: [],
        last_investigated_at: null,
        current_verdict: investigationVerdict,
        target_host: caseCandidate.target_host || null,
        target_url: caseCandidate.target_url || null,
        signature: caseCandidate.signature || null,
        incident_indicator: caseCandidate.incident_indicator,
        priority_score: caseCandidate.priority_score,
        child_group_count: caseCandidate.child_group_count,
        source_case_ids: caseCandidate.source_case_ids,
        datasets: caseCandidate.datasets,
        rule_ids: caseCandidate.rule_ids,
        notice_types: caseCandidate.notice_types,
        dns_root_domains: caseCandidate.dns_root_domains,
        tls_server_names: caseCandidate.tls_server_names,
        http_hosts: caseCandidate.http_hosts,
        http_paths: caseCandidate.http_paths,
        sampled_dest_ips: caseCandidate.sampled_dest_ips,
        observed_connection_count: caseCandidate.observed_connection_count,
        scanned_ports: caseCandidate.scanned_ports,
        max_scanned_host_count: caseCandidate.max_scanned_host_count,
        max_scanned_port_count: caseCandidate.max_scanned_port_count,
        affected_src_ips: caseCandidate.affected_src_ips,
        affected_dest_ips: caseCandidate.affected_dest_ips,
        affected_hosts: caseCandidate.affected_hosts,
        affected_urls: caseCandidate.affected_urls,
        source_summary_case_id: caseCandidate.source_summary_case_id,
        latest_investigation: caseCandidate.auto_investigation,
        sample_logs: caseCandidate.sample_logs,
        registry_last_synced_at: new Date().toISOString(),
        last_investigated_at: hasInvestigation ? new Date().toISOString() : null,
        history: [
            buildHistoryEntry('created_from_summary_case', caseCandidate, {
                reason: 'Persistent case created from summary case candidate',
            }),
            ...(hasInvestigation ? [
                buildHistoryEntry('auto_investigated_from_summary_case', caseCandidate, {
                    reason: 'Case Manager v1 automated investigation persisted into registry',
                    verdict: investigationVerdict,
                }),
            ] : []),
        ],
    };
}

function mergeCaseRecord(existingCase, caseCandidate) {
    const incomingLastSeen = new Date(caseCandidate.last_seen).getTime();
    const existingLastSeen = new Date(existingCase.last_seen || 0).getTime();
    const hasMeaningfulNewData = incomingLastSeen > existingLastSeen;
    const hasInvestigation = Boolean(caseCandidate.auto_investigation);
    const investigationVerdict = caseCandidate.auto_investigation?.verdict || null;
    const mergedHistory = [
        ...(existingCase.history || []),
        buildHistoryEntry(
            hasMeaningfulNewData ? 'updated_from_summary_case' : 'summary_case_seen_again',
            caseCandidate,
            {
                reason: hasMeaningfulNewData
                    ? 'Summary case candidate last_seen advanced'
                    : 'Summary case candidate was observed again with no new last_seen',
            }
        ),
        ...(hasInvestigation ? [
            buildHistoryEntry('auto_reinvestigated_from_summary_case', caseCandidate, {
                reason: 'Case Manager v1 automated investigation refreshed registry case',
                verdict: investigationVerdict,
            }),
        ] : []),
    ];

    return {
        ...existingCase,
        category: caseCandidate.category,
        category_name: caseCandidate.category_name || existingCase.category_name || null,
        fingerprint: caseCandidate.fingerprint,
        first_seen: existingCase.first_seen && existingCase.first_seen < caseCandidate.first_seen
            ? existingCase.first_seen
            : caseCandidate.first_seen,
        last_seen: incomingLastSeen > existingLastSeen ? caseCandidate.last_seen : existingCase.last_seen,
        has_new_data: hasMeaningfulNewData ? true : existingCase.has_new_data,
        new_logs_count: hasMeaningfulNewData
            ? caseCandidate.log_count
            : existingCase.new_logs_count,
        latest_observed_log_count: caseCandidate.log_count,
        target_host: caseCandidate.target_host || existingCase.target_host || null,
        target_url: caseCandidate.target_url || existingCase.target_url || null,
        signature: caseCandidate.signature || existingCase.signature || null,
        incident_indicator: caseCandidate.incident_indicator || existingCase.incident_indicator || null,
        priority_score: Math.max(Number(existingCase.priority_score || 0), Number(caseCandidate.priority_score || 0)),
        child_group_count: Number(caseCandidate.child_group_count || existingCase.child_group_count || 1),
        source_case_ids: mergeUniqueValues(existingCase.source_case_ids, caseCandidate.source_case_ids),
        datasets: mergeUniqueValues(existingCase.datasets, caseCandidate.datasets),
        rule_ids: mergeUniqueValues(existingCase.rule_ids, caseCandidate.rule_ids),
        notice_types: mergeUniqueValues(existingCase.notice_types, caseCandidate.notice_types),
        dns_root_domains: mergeUniqueValues(existingCase.dns_root_domains, caseCandidate.dns_root_domains),
        tls_server_names: mergeUniqueValues(existingCase.tls_server_names, caseCandidate.tls_server_names),
        http_hosts: mergeUniqueValues(existingCase.http_hosts, caseCandidate.http_hosts),
        http_paths: mergeUniqueValues(existingCase.http_paths, caseCandidate.http_paths),
        sampled_dest_ips: mergeUniqueValues(existingCase.sampled_dest_ips, caseCandidate.sampled_dest_ips),
        observed_connection_count: Math.max(
            Number(existingCase.observed_connection_count || 0),
            Number(caseCandidate.observed_connection_count || 0)
        ),
        scanned_ports: mergeUniqueValues(existingCase.scanned_ports, caseCandidate.scanned_ports),
        max_scanned_host_count: Math.max(
            Number(existingCase.max_scanned_host_count || 0),
            Number(caseCandidate.max_scanned_host_count || 0)
        ),
        max_scanned_port_count: Math.max(
            Number(existingCase.max_scanned_port_count || 0),
            Number(caseCandidate.max_scanned_port_count || 0)
        ),
        affected_src_ips: mergeUniqueValues(existingCase.affected_src_ips, caseCandidate.affected_src_ips),
        affected_dest_ips: mergeUniqueValues(existingCase.affected_dest_ips, caseCandidate.affected_dest_ips),
        affected_hosts: mergeUniqueValues(existingCase.affected_hosts, caseCandidate.affected_hosts),
        affected_urls: mergeUniqueValues(existingCase.affected_urls, caseCandidate.affected_urls),
        source_summary_case_id: caseCandidate.source_summary_case_id || existingCase.source_summary_case_id || null,
        latest_investigation: caseCandidate.auto_investigation || existingCase.latest_investigation || null,
        current_verdict: investigationVerdict || existingCase.current_verdict || null,
        last_investigated_at: hasInvestigation ? new Date().toISOString() : existingCase.last_investigated_at || null,
        sample_logs: caseCandidate.sample_logs.length > 0 ? caseCandidate.sample_logs : (existingCase.sample_logs || []),
        registry_last_synced_at: new Date().toISOString(),
        history: mergedHistory,
    };
}

export function extractCaseCandidatesFromSummary(summaryData = {}) {
    const summaries = Array.isArray(summaryData.summaries) ? summaryData.summaries : [];

    return summaries.flatMap((summary) => {
        const cases = Array.isArray(summary.cases) ? summary.cases : [];
        return cases.map((caseCandidate) => ({
            ...caseCandidate,
            category: caseCandidate.category || summary.id,
        }));
    });
}

export function syncCaseCandidatesIntoRegistry(caseCandidates = []) {
    const normalizedCandidates = caseCandidates.map(normalizeCandidate);
    const existingCases = loadCases();
    const caseMap = new Map(existingCases.map((caseRecord) => [caseRecord.case_id, caseRecord]));
    const results = [];
    let created = 0;
    let updated = 0;
    let unchanged = 0;

    for (const caseCandidate of normalizedCandidates) {
        const existingCase = caseMap.get(caseCandidate.case_id);

        if (!existingCase) {
            const createdCase = buildCaseRecordFromCandidate(caseCandidate);
            caseMap.set(createdCase.case_id, createdCase);
            created += 1;
            results.push({
                action: 'created',
                case_id: createdCase.case_id,
                category: createdCase.category,
                last_seen: createdCase.last_seen,
            });
            continue;
        }

        const mergedCase = mergeCaseRecord(existingCase, caseCandidate);
        caseMap.set(mergedCase.case_id, mergedCase);

        if (new Date(mergedCase.last_seen).getTime() > new Date(existingCase.last_seen || 0).getTime()) {
            updated += 1;
            results.push({
                action: 'updated',
                case_id: mergedCase.case_id,
                category: mergedCase.category,
                last_seen: mergedCase.last_seen,
            });
        } else {
            unchanged += 1;
            results.push({
                action: 'unchanged',
                case_id: mergedCase.case_id,
                category: mergedCase.category,
                last_seen: mergedCase.last_seen,
            });
        }
    }

    saveCases(Array.from(caseMap.values()));

    return {
        sync_config: CASE_CANDIDATE_SYNC_CONFIG,
        created_cases: created,
        updated_cases: updated,
        unchanged_cases: unchanged,
        total_candidates_processed: normalizedCandidates.length,
        results,
    };
}

export async function syncTelemetrySourceCases(options = {}) {
    const source = resolveTelemetrySource(options.source || 'opensearch');
    const shouldRefresh = Boolean(options.refresh);
    const summaryPath = getTriageStoragePaths(source).summary;

    const summaryData = shouldRefresh || !fs.existsSync(summaryPath)
        ? (await collectTriageData(source)).summaryData
        : JSON.parse(fs.readFileSync(summaryPath, 'utf8'));

    const caseCandidates = extractCaseCandidatesFromSummary(summaryData);
    const syncResult = syncCaseCandidatesIntoRegistry(caseCandidates);

    return {
        source,
        refreshed: shouldRefresh,
        summary_last_updated: summaryData.lastUpdated || null,
        summary_case_candidates: caseCandidates.length,
        ...syncResult,
    };
}
