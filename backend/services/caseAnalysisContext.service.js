import { getRelevantTicketContext } from './ticketContext.service.js';

const ANALYSIS_OUTPUT_SCHEMA = {
    related_to_previous_tickets: true,
    related_ticket_ids: [12345],
    relationship_assessment: 'continuation | recurrence | escalation | unrelated | inconclusive',
    historical_context_summary: 'short summary',
    investigation_needed: true,
    ticket_action: 'create_new | update_existing | reopen_existing | no_ticket',
    recommended_ticket_ids: [12345],
    confidence: 0.85,
    reasoning: [
        'point 1',
        'point 2',
    ],
    analyst_summary: 'final analyst-quality conclusion',
};

function toArray(value) {
    if (!value) {
        return [];
    }

    return Array.isArray(value) ? value : [value];
}

function buildEvidenceSummary(caseRecord = {}) {
    const sampleLogs = toArray(caseRecord.sample_logs).slice(0, 10);
    const summary = {
        first_seen: caseRecord.first_seen || null,
        last_seen: caseRecord.last_seen || null,
        log_count: caseRecord.log_count || caseRecord.new_logs_count || sampleLogs.length || 0,
        src_ip: caseRecord.src_ip || caseRecord.fingerprint?.src_ip || null,
        affected_src_ips: toArray(caseRecord.affected_src_ips),
        dest_ip: caseRecord.dest_ip || caseRecord.fingerprint?.dest_ip || null,
        affected_dest_ips: toArray(caseRecord.affected_dest_ips),
        sampled_dest_ips: toArray(caseRecord.sampled_dest_ips),
        dest_port: caseRecord.dest_port || caseRecord.fingerprint?.dest_port || null,
        observed_connection_count: caseRecord.observed_connection_count || null,
        scanned_ports: toArray(caseRecord.scanned_ports),
        max_scanned_host_count: caseRecord.max_scanned_host_count || null,
        max_scanned_port_count: caseRecord.max_scanned_port_count || null,
        target_host: caseRecord.target_host || null,
        affected_hosts: toArray(caseRecord.affected_hosts),
        target_url: caseRecord.target_url || caseRecord.fingerprint?.indicator || null,
        signature: caseRecord.signature || null,
        domain: caseRecord.domain || caseRecord.dnsQuery || caseRecord.fingerprint?.indicator || null,
        sample_logs: sampleLogs,
    };

    return summary;
}

function buildMatchedTicketSummary(ticketContext = {}) {
    return (ticketContext.matched_tickets || []).map((ticket) => ({
        id: ticket.id,
        summary: ticket.summary,
        status: ticket.status,
        created_at: ticket.created_at,
        updated_at: ticket.updated_at,
        score: ticket.score,
        matched_indicators: ticket.matched_indicators,
        ticket_url: ticket.ticket_url,
    }));
}

export async function buildCaseAnalysisContext(caseRecord = {}) {
    const ticketContext = await getRelevantTicketContext(caseRecord);
    const evidenceSummary = buildEvidenceSummary(caseRecord);

    return {
        category: String(caseRecord.category || caseRecord.fingerprint?.category || 'unknown').toLowerCase(),
        case_id: caseRecord.case_id || null,
        fingerprint: caseRecord.fingerprint || null,
        current_case: caseRecord,
        evidence_summary: evidenceSummary,
        ticket_context: {
            category: ticketContext.category,
            indicators: ticketContext.indicators,
            lookback_days: ticketContext.lookback_days,
            scanned_tickets: ticketContext.scanned_tickets,
            matched_tickets: buildMatchedTicketSummary(ticketContext),
        },
    };
}

export function buildCaseManagerAnalysisPrompt(analysisContext = {}) {
    return `
You are a senior SOC analyst performing case correlation and triage.

Your task is to analyze the CURRENT CASE using:
1. current telemetry evidence
2. previously reported Mantis tickets that match relevant indicators

You must determine:
- whether the current case is likely related to one or more previous tickets
- whether this is a continuation, recurrence, escalation, or unrelated event
- whether the case should be investigated now
- whether a new ticket should be created, an existing ticket updated, reopened, or skipped

Rules:
- Do not assume similarity means duplication.
- Distinguish repeated benign noise from meaningful recurrence.
- Treat new scope, new target, new behavior, or stronger evidence as potentially significant.
- Prefer conservative reasoning when evidence is weak.
- Explain whether historical tickets reduce or increase concern.
- If prior tickets were closed or marked false positive, explain whether current evidence changes that conclusion.

CURRENT CASE:
${JSON.stringify(analysisContext.current_case || {}, null, 2)}

CURRENT EVIDENCE SUMMARY:
${JSON.stringify(analysisContext.evidence_summary || {}, null, 2)}

MATCHED PRIOR TICKETS:
${JSON.stringify(analysisContext.ticket_context?.matched_tickets || [], null, 2)}

MATCH LOGIC USED:
${JSON.stringify({
        category: analysisContext.ticket_context?.category || analysisContext.category || 'unknown',
        indicators: analysisContext.ticket_context?.indicators || [],
        lookback_days: analysisContext.ticket_context?.lookback_days || null,
        scanned_tickets: analysisContext.ticket_context?.scanned_tickets || 0,
    }, null, 2)}

Return JSON only in this format:
${JSON.stringify(ANALYSIS_OUTPUT_SCHEMA, null, 2)}
`.trim();
}
