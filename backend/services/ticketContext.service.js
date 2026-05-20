import dotenv from 'dotenv';
import MantisClient from '../mantis.client.js';

dotenv.config();

const mantisClient = new MantisClient(
    process.env.MANTIS_URL,
    process.env.MANTIS_API_TOKEN
);

const TICKET_CONTEXT_CONFIG = {
    maxPages: Number(process.env.MANTIS_CONTEXT_MAX_PAGES || 5),
    pageSize: Number(process.env.MANTIS_CONTEXT_PAGE_SIZE || 100),
    minScore: Number(process.env.MANTIS_CONTEXT_MIN_SCORE || 2),
    lookbackDays: Number(process.env.MANTIS_CONTEXT_LOOKBACK_DAYS || 30),
};

function getCaseCategory(caseRecord = {}) {
    return String(caseRecord.category || caseRecord.fingerprint?.category || '').toLowerCase();
}

function normalizeValue(value) {
    if (value === null || value === undefined) {
        return null;
    }

    if (typeof value === 'number') {
        return String(value);
    }

    const normalized = String(value).trim();
    if (!normalized) {
        return null;
    }

    const lowered = normalized.toLowerCase();
    if (['n/a', 'na', 'unknown', 'null', 'none'].includes(lowered)) {
        return null;
    }

    return normalized;
}

function normalizePortValue(value) {
    const normalized = normalizeValue(value);
    if (!normalized) {
        return null;
    }

    const port = Number(normalized);
    if (!Number.isFinite(port) || port <= 0) {
        return null;
    }

    return String(port);
}

function buildTicketSearchText(ticket = {}) {
    return [
        ticket.summary,
        ticket.description,
        ticket.additional_information,
        ticket.steps_to_reproduce,
        ticket.category?.name,
    ]
        .filter(Boolean)
        .join('\n')
        .toLowerCase();
}

function buildIndicatorEntry(field, value, weight, label = value) {
    const normalized = normalizeValue(value);
    if (!normalized) {
        return null;
    }

    return {
        field,
        value: normalized,
        weight,
        label: normalizeValue(label) || normalized,
    };
}

function buildPortIndicatorEntry(field, value, weight, label = value) {
    const normalized = normalizePortValue(value);
    if (!normalized) {
        return null;
    }

    return {
        field,
        value: normalized,
        weight,
        label: normalizePortValue(label) || normalized,
    };
}

function getCaseIndicators(caseRecord = {}) {
    const category = getCaseCategory(caseRecord);
    const fingerprint = caseRecord.fingerprint || {};
    const source = {
        ...caseRecord,
        ...fingerprint,
    };

    const domainLike = source.domain || source.dnsQuery || source.target_host || source.indicator;

    const categorySpecific = {
        web_exploitation: [
            buildIndicatorEntry('src_ip', source.src_ip, 3),
            buildIndicatorEntry('dest_ip', source.dest_ip, 3),
            buildPortIndicatorEntry('dest_port', source.dest_port, 2),
            buildIndicatorEntry('target_host', source.target_host, 2),
            buildIndicatorEntry('target_url', source.target_url || source.indicator, 4),
        ],
        http_protocol_anomalies: [
            buildIndicatorEntry('src_ip', source.src_ip, 3),
            buildIndicatorEntry('dest_ip', source.dest_ip, 3),
            buildPortIndicatorEntry('dest_port', source.dest_port, 2),
            buildIndicatorEntry('target_host', source.target_host, 2),
            buildIndicatorEntry('signature', source.signature, 2),
        ],
        exploit_attempts: [
            buildIndicatorEntry('src_ip', source.src_ip, 3),
            buildIndicatorEntry('dest_ip', source.dest_ip, 3),
            buildPortIndicatorEntry('dest_port', source.dest_port, 2),
            buildIndicatorEntry('target_host', source.target_host, 2),
            buildIndicatorEntry('target_url', source.target_url || source.indicator, 4),
            buildIndicatorEntry('signature', source.signature, 2),
        ],
        dns_tunneling: [
            buildIndicatorEntry('src_ip', source.src_ip, 3),
            buildIndicatorEntry('dest_ip', source.dest_ip, 2),
            buildIndicatorEntry('domain', domainLike, 4),
        ],
        c2_beaconing: [
            buildIndicatorEntry('src_ip', source.src_ip, 3),
            buildIndicatorEntry('dest_ip', source.dest_ip, 3),
            buildIndicatorEntry('domain', domainLike, 4),
            buildPortIndicatorEntry('dest_port', source.dest_port, 1),
        ],
        brute_force: [
            buildIndicatorEntry('src_ip', source.src_ip, 3),
            buildIndicatorEntry('dest_ip', source.dest_ip, 3),
            buildPortIndicatorEntry('dest_port', source.dest_port, 3),
            buildIndicatorEntry('target_host', source.target_host, 2),
        ],
        recon_scanning: [
            buildIndicatorEntry('src_ip', source.src_ip, 4),
            buildPortIndicatorEntry('dest_port', source.dest_port, 2),
            buildIndicatorEntry('target_host', source.target_host, 1),
            buildIndicatorEntry('signature', source.signature, 1),
        ],
    };

    const fallback = [
        buildIndicatorEntry('src_ip', source.src_ip, 3),
        buildIndicatorEntry('dest_ip', source.dest_ip, 3),
        buildPortIndicatorEntry('dest_port', source.dest_port, 2),
        buildIndicatorEntry('signature', source.signature, 2),
        buildIndicatorEntry('target_host', source.target_host, 1),
    ];

    return (categorySpecific[category] || fallback).filter(Boolean);
}

async function fetchRecentTickets() {
    mantisClient.ensureConfigured();

    const tickets = [];
    let page = 1;

    while (page <= TICKET_CONTEXT_CONFIG.maxPages) {
        const url = `${mantisClient.baseUrl}/api/rest/issues?page_size=${TICKET_CONTEXT_CONFIG.pageSize}&page=${page}`;
        const response = await fetch(url, {
            headers: await mantisClient.getHeader(),
        });

        const text = await response.text();
        if (!response.ok) {
            throw new Error(`Mantis context fetch failed: ${response.status} - ${text}`);
        }

        let payload;
        try {
            payload = JSON.parse(text);
        } catch (err) {
            const firstBrace = text.indexOf('{');
            const lastBrace = text.lastIndexOf('}');
            payload = JSON.parse(text.substring(firstBrace, lastBrace + 1));
        }

        const issues = payload.issues || [];
        tickets.push(...issues);

        if (issues.length < TICKET_CONTEXT_CONFIG.pageSize) {
            break;
        }

        page += 1;
    }

    return tickets;
}

function isWithinLookback(ticket = {}) {
    const createdAt = ticket.created_at ? new Date(ticket.created_at) : null;
    if (!createdAt || Number.isNaN(createdAt.getTime())) {
        return true;
    }

    const lookbackStart = new Date();
    lookbackStart.setDate(lookbackStart.getDate() - TICKET_CONTEXT_CONFIG.lookbackDays);
    return createdAt >= lookbackStart;
}

function scoreTicketAgainstCase(ticket, caseRecord) {
    const searchText = buildTicketSearchText(ticket);
    const indicators = getCaseIndicators(caseRecord);
    const matches = [];
    let score = 0;

    for (const indicator of indicators) {
        const needle = indicator.value.toLowerCase();
        if (searchText.includes(needle)) {
            matches.push({
                field: indicator.field,
                value: indicator.label,
                weight: indicator.weight,
            });
            score += indicator.weight;
        }
    }

    return {
        score,
        matches,
    };
}

export async function getRelevantTicketContext(caseRecord = {}) {
    const indicators = getCaseIndicators(caseRecord);
    const recentTickets = await fetchRecentTickets();

    const matchedTickets = recentTickets
        .filter(isWithinLookback)
        .map((ticket) => {
            const scored = scoreTicketAgainstCase(ticket, caseRecord);
            return {
                ticket,
                score: scored.score,
                matches: scored.matches,
            };
        })
        .filter((entry) => entry.score >= TICKET_CONTEXT_CONFIG.minScore)
        .sort((left, right) => right.score - left.score)
        .slice(0, 20)
        .map((entry) => ({
            id: entry.ticket.id,
            summary: entry.ticket.summary,
            status: entry.ticket.status?.name || 'unknown',
            created_at: entry.ticket.created_at,
            updated_at: entry.ticket.updated_at,
            score: entry.score,
            matched_indicators: entry.matches,
            ticket_url: `${mantisClient.baseUrl}/view.php?id=${entry.ticket.id}`,
        }));

    return {
        category: getCaseCategory(caseRecord),
        indicators,
        lookback_days: TICKET_CONTEXT_CONFIG.lookbackDays,
        scanned_tickets: recentTickets.length,
        matched_tickets: matchedTickets,
    };
}
