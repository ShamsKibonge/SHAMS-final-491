import OpenSearchClient from './opensearch.client.js';
import dotenv from 'dotenv';

dotenv.config();

const opensearch = new OpenSearchClient(
    process.env.OPENSEARCH_NODE,
    process.env.OPENSEARCH_USERNAME,
    process.env.OPENSEARCH_PASSWORD,
    process.env.OPENSEARCH_MODE,
    process.env.OPENSEARCH_INDEX
);

function getSource(rawSource) {
    return 'opensearch';
}

function getTimestampRangeClause(source, timeFrom, timeTo = 'now') {
    if (source === 'opensearch') {
        return {
            bool: {
                should: [
                    { range: { firstPacket: { gte: timeFrom, lte: timeTo } } },
                    { range: { 'event.ingested': { gte: timeFrom, lte: timeTo } } },
                    { range: { '@timestamp': { gte: timeFrom, lte: timeTo } } },
                ],
                minimum_should_match: 1,
            },
        };
    }

    return { range: { '@timestamp': { gte: timeFrom, lte: timeTo } } };
}

function summarizeHits(query, hits, source) {
    if (hits.length === 0) {
        return {
            query,
            total_hits: 0,
            sample_logs: [],
            source,
        };
    }

    const stats = {
        signatures: {},
        src_ips: {},
        dest_ips: {},
        hosts: {},
    };

    let firstSeen = hits[0]._source['@timestamp'] || hits[0]._source?.event?.ingested;
    let lastSeen = hits[0]._source['@timestamp'] || hits[0]._source?.event?.ingested;

    hits.forEach((hit) => {
        const s = hit._source || {};
        const timestamp = s['@timestamp'] || s.event?.ingested;
        if (timestamp && (!firstSeen || timestamp < firstSeen)) {
            firstSeen = timestamp;
        }
        if (timestamp && (!lastSeen || timestamp > lastSeen)) {
            lastSeen = timestamp;
        }

        const alert = s.alert || s.suricata?.eve?.alert || {};
        const sig = alert.signature || s.rule?.name || s.zeek?.notice?.note;
        const src = s.source?.ip || s.src_ip;
        const dest = s.destination?.ip || s.dest_ip;
        const host = s.host?.name || s.host?.hostname || s.agent?.name;

        if (sig) stats.signatures[sig] = (stats.signatures[sig] || 0) + 1;
        if (src) stats.src_ips[src] = (stats.src_ips[src] || 0) + 1;
        if (dest) stats.dest_ips[dest] = (stats.dest_ips[dest] || 0) + 1;
        if (host) stats.hosts[host] = (stats.hosts[host] || 0) + 1;
    });

    const getTop = (obj, limit = 5) =>
        Object.entries(obj)
            .sort((a, b) => b[1] - a[1])
            .slice(0, limit)
            .map(([key]) => key);

    return {
        query,
        total_hits: hits.length,
        first_seen: firstSeen,
        last_seen: lastSeen,
        top_signatures: getTop(stats.signatures),
        top_src_ips: getTop(stats.src_ips),
        top_dest_ips: getTop(stats.dest_ips),
        top_hosts: getTop(stats.hosts),
        sample_logs: hits,
        source,
    };
}

export async function executePivotQuery(query, options = {}) {
    const maxLogs = options.maxLogs || 10;
    const timeFrom = options.timeFrom || options.timeRange || 'now-48h';
    const timeTo = options.timeTo || 'now';
    const source = getSource(options.source);
    const index = process.env.OPENSEARCH_INDEX || 'arkime_sessions3-*';

    console.log(`[PivotExecutor] Executing ${source} query: ${query} (time: ${timeFrom} to ${timeTo})`);

    try {
        await opensearch.authenticate();

        const searchBody = {
            size: maxLogs,
            query: {
                bool: {
                    must: [
                        { query_string: { query: query } },
                        getTimestampRangeClause(source, timeFrom, timeTo)
                    ]
                }
            },
            sort: [
                { 'event.ingested': { order: 'desc', unmapped_type: 'date' } },
                { '@timestamp': { order: 'desc', unmapped_type: 'date' } }
            ]
        };

        const result = await opensearch.search(index, searchBody);
        const hits = result.hits?.hits || [];
        const totalHits = result.hits?.total?.value || result.hits?.total || 0;

        if (hits.length === 0) {
            return {
                query: query,
                total_hits: 0,
                sample_logs: [],
                source,
            };
        }

        const summary = summarizeHits(query, hits, source);
        summary.total_hits = totalHits;
        return summary;

    } catch (err) {
        console.error(`[PivotExecutor] Error:`, err.message);
        throw err;
    }
}
