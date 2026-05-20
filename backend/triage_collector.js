import fs from 'fs';
import crypto from 'crypto';
import dotenv from 'dotenv';
import OpenSearchClient from './opensearch.client.js';

dotenv.config();

const opensearch = new OpenSearchClient(
    process.env.OPENSEARCH_NODE,
    process.env.OPENSEARCH_USERNAME,
    process.env.OPENSEARCH_PASSWORD,
    process.env.OPENSEARCH_MODE,
    process.env.OPENSEARCH_INDEX
);

const DEFAULT_SOURCE = 'opensearch';
const OPENSEARCH_DATASETS = ['alert', 'dns', 'http', 'notice', 'conn', 'ssl'];
const OPENSEARCH_PAGE_SIZE = 250;
const OPENSEARCH_MAX_PAGES_PER_CATEGORY = 40;
const DASHBOARD_V1_PROFILE = 'dashboard_v1';
const OPENSEARCH_TEXT_FIELDS = [
    'rule.name',
    'rule.category',
    'dns.host',
    'zeek.dns.query',
    'http.host',
    'http.uri',
    'url.full',
    'url.original',
    'url.domain',
    'url.path',
    'zeek.http.host',
    'zeek.http.uri',
    'zeek.notice.note',
    'zeek.notice.msg',
    'zeek.notice.sub',
    'zeek.ssl.server_name',
];

const CATEGORIES = [
    {
        id: 'c2_beaconing',
        name: 'C2 / Beaconing',
        tier: 'Tier 1 - Highest Value',
        filter: 'alert.signature:("ET CNC*" OR "ET MALWARE CnC*" OR "ET TROJAN*")',
        opensearchFilter:
            'dataset in [alert,dns,http,notice,conn,ssl] and detail contains beacon, command and control, cnc, c2, or trojan',
        suggestedTicketType: 'Possible Compromised Host - Suspected C2 Beaconing',
    },
    {
        id: 'dual_use_abused_infrastructure',
        name: 'Dual-Use / Abused Infrastructure',
        tier: 'Tier 2 - Investigate',
        filter: 'alert.signature:("ET INFO Abused Hosting Domain*" OR "ET INFO Discord*" OR "ET DYN_DNS*")',
        opensearchFilter:
            'dataset in [alert,dns,ssl,http] and detail contains abused hosting, discord, dynamic dns, no-ip, pastebin, or cloud hosting',
        suggestedTicketType: 'Suspicious Use of Dual-Use or Abused Infrastructure',
    },
    {
        id: 'exploit_attempts',
        name: 'Exploit Attempts',
        tier: 'Tier 1 - Highest Value',
        filter: 'alert.signature:"ET EXPLOIT*"',
        opensearchFilter:
            'dataset in [alert,dns,http,notice,conn,ssl] and detail contains exploit or cve-',
        suggestedTicketType: 'Exploit Attempt Against Public-Facing Service',
    },
    {
        id: 'dns_tunneling',
        name: 'DNS Tunneling',
        tier: 'Tier 1 - Highest Value',
        filter: 'event_type:dns AND dns.rrname.keyword:*.*',
        opensearchFilter:
            'event.dataset=dns and (dnsQuery has 4+ labels or any label length >= 25), excluding known vendor/CDN domains',
        suggestedTicketType: 'Suspicious DNS Activity - Possible DNS Tunneling or Malware C2',
    },
    {
        id: 'lateral_movement',
        name: 'Lateral Movement',
        tier: 'Tier 1 - Highest Value',
        filter: 'src_ip:10.* AND dest_ip:10.* AND event_type:flow AND dest_port:(445 OR 3389 OR 22 OR 135 OR 139)',
        opensearchFilter:
            'source.ip and destination.ip are private and destination.port in [22,135,139,445,3389]',
        suggestedTicketType: 'Suspicious Internal Lateral Movement',
    },
    {
        id: 'malware_activity',
        name: 'Malware Activity',
        tier: 'Tier 1 - Highest Value',
        filter: 'alert.signature:("ET MALWARE*" OR "ET TROJAN*")',
        opensearchFilter:
            'dataset in [alert,dns,http,notice,conn,ssl] and detail contains malware, ransomware, backdoor, or trojan',
        suggestedTicketType: 'Potential Malware Activity Detected',
    },
    {
        id: 'brute_force',
        name: 'Brute Force Attempts',
        tier: 'Tier 2 - Strong',
        filter: 'dest_port:(22 OR 25 OR 3389 OR 21) AND event_type:alert',
        opensearchFilter:
            'dataset in [alert,dns,http,notice,conn,ssl] and detail contains brute, failed login, authentication failure, login attempt, or password guessing',
        suggestedTicketType: 'Brute Force Authentication Attempt',
    },
    {
        id: 'recon_scanning',
        name: 'Network Recon / Scanning',
        tier: 'Tier 2 - Strong',
        filter: 'alert.signature:"ET SCAN*"',
        opensearchFilter:
            'dataset in [alert,dns,http,notice,conn,ssl] and detail contains scan, probe, recon, address_scan, or random_scan, excluding external IP lookup checks',
        suggestedTicketType: 'External Host Performing Port Scanning',
    },
    {
        id: 'external_ip_discovery',
        name: 'External IP Discovery',
        tier: 'Tier 3 - Monitor',
        filter: 'alert.signature:"ET INFO External IP Lookup*"',
        opensearchFilter:
            'dataset in [alert,dns,ssl,http] and detail contains external ip lookup, checkip, ipify, ip-api, ipwho, or myip.opendns',
        suggestedTicketType: 'Host Performing External IP Discovery',
    },
    {
        id: 'web_exploitation',
        name: 'Web Exploitation',
        tier: 'Tier 2 - Strong',
        filter: 'alert.signature:("ET WEB_SERVER*" OR "ET EXPLOIT*")',
        opensearchFilter:
            'dataset in [alert,dns,http,notice,conn,ssl] and detail contains sql injection, webshell, xss, remote code, command injection, directory traversal, or web exploit',
        suggestedTicketType: 'Suspicious Web Exploitation Activity',
    },
    {
        id: 'http_protocol_anomalies',
        name: 'HTTP Protocol Anomalies',
        tier: 'Tier 2 - Investigate',
        filter: 'zeek.notice.note:HTTPATTACKS* OR alert.signature:"*HTTP Smuggling*"',
        opensearchFilter:
            'dataset in [notice,alert,http] and detail contains HTTPATTACKS, HTTP smuggling, GET request with body, or multiple HTTP host headers',
        suggestedTicketType: 'HTTP Protocol Anomaly - Possible Request Smuggling',
    },
];

const CATEGORY_BY_ID = Object.fromEntries(CATEGORIES.map((category) => [category.id, category]));

const NOISY_SURICATA_RULE_PATTERNS = [
    'suricata stream established packet out of window',
    'suricata stream packet with invalid ack',
    'suricata stream established invalid ack',
];

const NOISY_SURICATA_CATEGORIES = [
    'generic protocol command decode',
    'not suspicious traffic',
];

const BENIGN_DNS_ROOT_DOMAINS = [
    'microsoft.com',
    'cloud.microsoft',
    'trafficmanager.net',
    'azure.com',
    'windows.com',
    'office.com',
    'office.net',
    'adobe.com',
    'usgovcloudapi.net',
    'cloudapp.azure.com',
    'pool.ntp.org',
    'akamai.net',
    'akamaiedge.net',
    'akadns.net',
    'amazonaws.com',
    'microsoftonline.com',
];

const DNS_TUNNELING_KNOWN_SERVICE_ROOT_DOMAINS = [
    'a2z.com',
    'akadns.net',
    'akamai.net',
    'akamaiedge.net',
    'amazonaws.com',
    'aws.dev',
    'azure.com',
    'azurefd.net',
    'cloud.microsoft',
    'fastly.net',
    'google.com',
    'googleapis.com',
    'googlevideo.com',
    'logicnow.us',
    'microsoft.com',
    'microsoft.us',
    'microsoftonline.com',
    'msappproxy.net',
    'n-able.com',
    'office.com',
    'office.net',
    'office365.us',
    'onmicrosoft.com',
    'paloaltonetworks.com',
    'sharepoint.com',
    'sonicwall.com',
    'trafficmanager.net',
    'usgovcloudapi.net',
    'usgovtrafficmanager.net',
    'watchguard.com',
    'windows.com',
    'windows.net',
];

const BENIGN_DNS_QUERY_PATTERNS = [
    '.local',
    '.localdomain',
    'in-addr.arpa',
    'ip6.arpa',
    'kubernetes',
    '_tcp.local',
    '_udp.local',
    '.svc.',
    '.elb.amazonaws.com',
];

const BENIGN_DNS_DEST_IPS = ['224.0.0.252', 'ff02::1:3'];

const REMOTE_ADMIN_TOOL_ROOT_DOMAINS = [
    'action1.com',
    'anydesk.com',
    'beyondtrustcloud.com',
    'connectwise.com',
    'datto.com',
    'gotoassist.com',
    'logmein.com',
    'n-able.com',
    'ninjarmm.com',
    'screenconnect.com',
    'splashtop.com',
    'system-monitor.com',
    'teamviewer.com',
    'zoho.com',
    'zohoassist.com',
];

const REMOTE_ADMIN_TOOL_PATTERNS = [
    'anydesk',
    'beyondtrust',
    'connectwise',
    'datto rmm',
    'hostedrmm',
    'logmein',
    'mspa .n-able',
    'mspa.n-able',
    'n-able',
    'ninjarmm',
    'observed rmm domain',
    'remote_access observed',
    'screenconnect',
    'splashtop',
    'teamviewer',
    'zoho assist',
];

const STRONG_C2_SIGNAL_PATTERNS = [
    'beacon',
    'cobalt strike',
    'command and control',
    'command_and_control',
    'et cnc',
    'et malware cnc',
    'meterpreter',
    'metasploit',
    'sliver',
    'trojan',
];

const DUAL_USE_INFRA_ROOT_DOMAINS = [
    'azurewebsites.net',
    'cloudns.net',
    'discord.com',
    'discord.gg',
    'duckdns.org',
    'github.io',
    'ngrok.io',
    'no-ip.com',
    'pastebin.com',
    'replit.app',
];

const DUAL_USE_INFRA_PATTERNS = [
    'abused hosting domain',
    'azurewebsites .net',
    'azurewebsites.net',
    'discord .com',
    'discord .gg',
    'discord chat service',
    'dynamic_dns',
    'dynamic dns',
    'github.io',
    'ngrok',
    'no-ip',
    'pastebin',
];

const EXTERNAL_IP_DISCOVERY_PATTERNS = [
    'external ip lookup',
    'checkip',
    'geolocation-db',
    'ip-api',
    'ipapi',
    'ipify',
    'ipwho',
    'myip.opendns',
];

const HTTP_PROTOCOL_ANOMALY_PATTERNS = [
    'get request with body',
    'http get request with body',
    'http smuggling',
    'httpattacks',
    'multiple http host headers',
    'request smuggling',
];

function getStoragePaths(source, suffix = '') {
    const suffixPart = suffix ? `_${suffix}` : '';

    if (source === 'kibana') {
        return {
            raw: `./soc_triage_data${suffixPart}.json`,
            summary: `./soc_triage_summary${suffixPart}.json`,
        };
    }

    return {
        raw: `./soc_triage_data_${source}${suffixPart}.json`,
        summary: `./soc_triage_summary_${source}${suffixPart}.json`,
    };
}

export function resolveTelemetrySource(rawSource) {
    return 'opensearch';
}

export function getTriageStoragePaths(rawSource, options = {}) {
    return getStoragePaths(resolveTelemetrySource(rawSource), options.storageSuffix || '');
}

function getCategoryFilter(category, source = DEFAULT_SOURCE) {
    if (source === 'opensearch') {
        return category.opensearchFilter || category.filter;
    }

    return category.filter;
}

function getTopItems(map, limit = 5) {
    return Object.entries(map)
        .sort((left, right) => right[1] - left[1])
        .slice(0, limit)
        .map(([key]) => key);
}

function getHitCount(total) {
    if (typeof total === 'number') {
        return total;
    }

    if (total && typeof total === 'object' && typeof total.value === 'number') {
        return total.value;
    }

    return 0;
}

function firstScalar(value) {
    if (Array.isArray(value)) {
        return firstScalar(value[0]);
    }

    if (value && typeof value === 'object') {
        return null;
    }

    return value ?? null;
}

function normalizeList(value) {
    if (Array.isArray(value)) {
        return value;
    }

    return value == null ? [] : [value];
}

function getRootDomain(hostname) {
    if (!hostname) {
        return 'unknown';
    }

    const parts = String(hostname)
        .toLowerCase()
        .split('.')
        .map((part) => part.trim())
        .filter(Boolean);

    if (parts.length <= 2) {
        return parts.join('.') || 'unknown';
    }

    return parts.slice(-2).join('.');
}

function matchesDomainSuffix(hostname, rootDomain) {
    const normalizedHostname = String(hostname || '').toLowerCase().replace(/\.$/, '');
    const normalizedRoot = String(rootDomain || '').toLowerCase().replace(/\.$/, '');

    return normalizedHostname === normalizedRoot || normalizedHostname.endsWith(`.${normalizedRoot}`);
}

function extractIpAddresses(text) {
    const matches = String(text || '').match(/\b\d{1,3}(?:\.\d{1,3}){3}\b/g) || [];
    return Array.from(new Set(matches));
}

function parseSeenConnectionCount(text) {
    const match = String(text || '').match(/\bseen in\s+(\d+)\s+connections?\b/i);
    return match ? Number(match[1]) : 0;
}

function parseZeekPasswordGuessingDetails(noticeMessage, noticeSub, eventOriginal) {
    const combined = [noticeMessage, noticeSub, eventOriginal].filter(Boolean).join(' ');
    const sampledServers = extractIpAddresses(noticeSub || eventOriginal);

    return {
        sampledServers,
        observedConnectionCount: parseSeenConnectionCount(combined),
    };
}

function extractPorts(text) {
    const matches = String(text || '').match(/\b\d{1,5}\/(?:tcp|udp|icmp)\b/gi) || [];
    return Array.from(new Set(matches.map((value) => value.toLowerCase())));
}

function parseZeekScanNoticeDetails(noticeMessage, eventOriginal) {
    const combined = [noticeMessage, eventOriginal].filter(Boolean).join(' ');
    const hostCountMatch = combined.match(/\bscanned at least\s+(\d+)\s+(?:unique\s+)?hosts?\b/i);
    const portCountMatch = combined.match(/\bon\s+(\d+)\s+ports?\b/i);

    return {
        scannedPorts: extractPorts(combined),
        scannedHostCount: hostCountMatch ? Number(hostCountMatch[1]) : 0,
        scannedPortCount: portCountMatch ? Number(portCountMatch[1]) : 0,
    };
}

function isExternalIpDiscoveryText(text) {
    return includesAny(String(text || '').toLowerCase().replace(/\s*\.\s*/g, '.'), EXTERNAL_IP_DISCOVERY_PATTERNS);
}

function isHttpProtocolAnomaly(event, detailText = '') {
    const detail = [
        detailText,
        event.signature,
        event.ruleCategory,
        event.notice,
        event.noticeMessage,
        event.noticeSub,
        event.httpPath,
        event.httpHost,
        event.httpUrl,
    ].filter(Boolean).join(' ').toLowerCase();

    return includesAny(detail, HTTP_PROTOCOL_ANOMALY_PATTERNS);
}

function getSignature(source) {
    return (
        firstScalar(
        source.alert?.signature ??
            source.suricata?.eve?.alert?.signature ??
            source.rule?.name ??
            source.zeek?.notice?.note ??
            source.message
        ) ||
        firstScalar(source.dns?.rrname ?? source.zeek?.dns?.query) ||
        firstScalar(source.http?.url ?? source.url?.full ?? source.url?.original) ||
        firstScalar(source.url?.domain ?? source.zeek?.http?.host) ||
        firstScalar(source.event?.dataset) ||
        'unknown'
    );
}

function getDnsQuery(source) {
    return firstScalar(source.dns?.rrname ?? source.dns?.host ?? source.zeek?.dns?.query) || '';
}

function buildTargetUrl(source) {
    const explicitUrl = firstScalar(source.http?.url ?? source.url?.full ?? source.url?.original);
    if (explicitUrl) {
        return explicitUrl;
    }

    const host = firstScalar(source.http?.host ?? source.url?.domain ?? source.zeek?.http?.host);
    const path = firstScalar(source.http?.uri ?? source.url?.path ?? source.zeek?.http?.uri) || '';
    return host ? `${host}${path}` : '';
}

function isPrivateIp(ip) {
    if (!ip) {
        return false;
    }

    return (
        ip.startsWith('10.') ||
        ip.startsWith('192.168.') ||
        /^172\.(1[6-9]|2\d|3[0-1])\./.test(ip)
    );
}

function buildOpenSearchTimeFilter(timeRange = 'now-48h') {
    const rangeBounds =
        timeRange && typeof timeRange === 'object'
            ? {
                ...(timeRange.gte ? { gte: timeRange.gte } : {}),
                ...(timeRange.lte ? { lte: timeRange.lte } : {}),
            }
            : {
                gte: timeRange,
                lte: 'now',
            };

    return {
        bool: {
            should: [
                {
                    range: {
                        'event.ingested': {
                            ...rangeBounds,
                        },
                    },
                },
                {
                    range: {
                        '@timestamp': {
                            ...rangeBounds,
                        },
                    },
                },
            ],
            minimum_should_match: 1,
        },
    };
}

async function fetchLatestOpenSearchTimestamp(index) {
    const result = await opensearch.search(index, {
        size: 1,
        track_total_hits: false,
        _source: ['event.ingested', '@timestamp'],
        query: {
            bool: {
                filter: [
                    {
                        terms: {
                            'event.dataset': OPENSEARCH_DATASETS,
                        },
                    },
                ],
            },
        },
        sort: [
            { 'event.ingested': { order: 'desc', unmapped_type: 'date', missing: '_last' } },
            { '@timestamp': { order: 'desc', unmapped_type: 'date', missing: '_last' } },
        ],
    });

    const source = result.hits?.hits?.[0]?._source || {};
    return source.event?.ingested || source['@timestamp'] || null;
}

function shiftToLatestAvailableHour(latestTimestamp) {
    const latestMs = new Date(latestTimestamp).getTime();
    if (Number.isNaN(latestMs)) {
        return null;
    }

    return {
        gte: new Date(latestMs - (60 * 60 * 1000)).toISOString(),
        lte: new Date(latestMs).toISOString(),
    };
}

function buildOpenSearchBaseQuery({ timeRange = 'now-48h', size = 0, from = 0 } = {}) {
    return {
        size,
        from,
        track_total_hits: true,
        query: {
            bool: {
                filter: [
                    buildOpenSearchTimeFilter(timeRange),
                    {
                        terms: {
                            'event.dataset': OPENSEARCH_DATASETS,
                        },
                    },
                ],
            },
        },
    };
}

function buildKeywordQuery(query) {
    return {
        query_string: {
            query,
            fields: OPENSEARCH_TEXT_FIELDS,
            default_operator: 'OR',
            analyze_wildcard: true,
            lenient: true,
        },
    };
}

function buildWildcardClause(field, value) {
    return {
        wildcard: {
            [field]: {
                value,
                case_insensitive: true,
            },
        },
    };
}

function buildTermClause(field, value) {
    return {
        term: {
            [field]: value,
        },
    };
}

function buildRemoteAdminToolingClauses() {
    const fields = [
        'rule.name',
        'dns.host',
        'zeek.dns.query',
        'zeek.ssl.server_name',
        'http.host',
        'url.domain',
    ];
    const values = [
        ...REMOTE_ADMIN_TOOL_ROOT_DOMAINS,
        ...REMOTE_ADMIN_TOOL_PATTERNS,
    ];

    return values.flatMap((value) =>
        fields.map((field) => buildWildcardClause(field, `*${value}*`))
    );
}

function buildDualUseInfrastructureClauses() {
    const fields = [
        'rule.name',
        'dns.host',
        'zeek.dns.query',
        'zeek.ssl.server_name',
        'http.host',
        'url.domain',
    ];
    const values = [
        ...DUAL_USE_INFRA_ROOT_DOMAINS,
        ...DUAL_USE_INFRA_PATTERNS,
    ];

    return values.flatMap((value) =>
        fields.map((field) => buildWildcardClause(field, `*${value}*`))
    );
}

function buildCategorySignalClauses(categoryId) {
    switch (categoryId) {
        case 'c2_beaconing':
            return [
                buildTermClause('rule.category', 'Command_And_Control'),
                buildTermClause('zeek.notice.note', 'ATTACK::Command_And_Control'),
                buildWildcardClause('rule.name', '*trojan*'),
                buildWildcardClause('rule.name', '*cnc*'),
                buildWildcardClause('rule.name', '*command*control*'),
                buildWildcardClause('rule.name', '*beacon*'),
            ];
        case 'dual_use_abused_infrastructure':
            return buildDualUseInfrastructureClauses();
        case 'external_ip_discovery':
            return [
                buildWildcardClause('rule.name', '*external*ip*lookup*'),
                buildWildcardClause('rule.name', '*checkip*'),
                buildWildcardClause('rule.name', '*ipify*'),
                buildWildcardClause('rule.name', '*ip-api*'),
                buildWildcardClause('rule.name', '*ipwho*'),
                buildWildcardClause('rule.name', '*myip*opendns*'),
                buildWildcardClause('zeek.dns.query', '*checkip*'),
                buildWildcardClause('zeek.dns.query', '*ipify*'),
                buildWildcardClause('zeek.dns.query', '*ip-api*'),
                buildWildcardClause('zeek.dns.query', '*ipwho*'),
                buildWildcardClause('zeek.dns.query', '*myip.opendns*'),
                buildWildcardClause('zeek.ssl.server_name', '*checkip*'),
                buildWildcardClause('zeek.ssl.server_name', '*ipify*'),
                buildWildcardClause('zeek.ssl.server_name', '*ip-api*'),
                buildWildcardClause('zeek.ssl.server_name', '*ipwho*'),
            ];
        case 'exploit_attempts':
            return [
                buildWildcardClause('rule.name', '*cve*'),
                buildWildcardClause('rule.name', '*exploit*'),
                buildWildcardClause('rule.name', '*log4j*'),
                buildWildcardClause('zeek.notice.note', '*CVE*'),
                buildWildcardClause('zeek.notice.sub', '*CVE*'),
                buildTermClause('rule.category', 'Attempted Administrator Privilege Gain'),
            ];
        case 'malware_activity':
            return [
                buildTermClause('rule.category', 'A Network Trojan was detected'),
                buildWildcardClause('rule.name', '*trojan*'),
                buildWildcardClause('rule.name', '*malware*'),
                buildWildcardClause('rule.name', '*ransomware*'),
                buildWildcardClause('rule.name', '*backdoor*'),
            ];
        case 'brute_force':
            return [
                buildTermClause('zeek.notice.note', 'SSH::Password_Guessing'),
                buildWildcardClause('rule.name', '*password*guess*'),
                buildWildcardClause('zeek.notice.msg', '*password*guess*'),
                buildWildcardClause('zeek.notice.sub', '*password*guess*'),
            ];
        case 'recon_scanning':
            return [
                buildTermClause('zeek.notice.note', 'Scan::Random_Scan'),
                buildTermClause('zeek.notice.note', 'Scan::Address_Scan'),
                buildTermClause('zeek.notice.note', 'Scan::Port_Scan'),
                buildTermClause('rule.category', 'Reconnaissance'),
                buildTermClause('rule.category', 'Detection of a Network Scan'),
                buildWildcardClause('rule.name', '*scan*'),
            ];
        case 'web_exploitation':
            return [
                buildTermClause('rule.category', 'Web Application Attack'),
                buildTermClause('rule.category', 'access to a potentially vulnerable web application'),
                buildWildcardClause('rule.name', '*web*'),
                buildWildcardClause('rule.name', '*sql*'),
                buildWildcardClause('rule.name', '*xss*'),
                buildWildcardClause('rule.name', '*directory*traversal*'),
                buildWildcardClause('rule.name', '*command*injection*'),
            ];
        case 'http_protocol_anomalies':
            return [
                buildWildcardClause('zeek.notice.note', 'HTTPATTACKS*'),
                buildWildcardClause('zeek.notice.msg', '*HTTP*smuggling*'),
                buildWildcardClause('zeek.notice.msg', '*GET request with body*'),
                buildWildcardClause('zeek.notice.msg', '*multiple HTTP host headers*'),
                buildWildcardClause('zeek.notice.sub', '*HTTP*smuggling*'),
                buildWildcardClause('rule.name', '*HTTP*Smuggling*'),
                buildWildcardClause('rule.name', '*HTTPATTACKS*'),
                buildWildcardClause('message', '*HTTP*smuggling*'),
            ];
        case 'lateral_movement':
            return [
                buildTermClause('rule.category', 'Lateral_Movement'),
                buildTermClause('zeek.notice.note', 'ATTACK::Lateral_Movement'),
                buildWildcardClause('zeek.notice.note', 'ATTACK::Lateral_Movement*'),
            ];
        default:
            return [];
    }
}

function buildOpenSearchCategoryCandidateQuery(categoryId, { timeRange = 'now-48h', size = OPENSEARCH_PAGE_SIZE, from = 0 } = {}) {
    const query = buildOpenSearchBaseQuery({ timeRange, size, from });
    query.sort = [
        { 'event.ingested': { order: 'desc', unmapped_type: 'date' } },
        { '@timestamp': { order: 'desc', unmapped_type: 'date' } },
    ];
    query._source = [
        '@timestamp',
        'event.ingested',
        'event.dataset',
        'event.original',
        'source.ip',
        'src_ip',
        'destination.ip',
        'dest_ip',
        'destination.port',
        'dest_port',
        'destination.domain',
        'host.name',
        'host.hostname',
        'alert.severity',
        'alert.category',
        'suricata.eve.alert.severity',
        'suricata.eve.alert.category',
        'rule.name',
        'rule.category',
        'message',
        'dns.host',
        'dns.answers.data',
        'http.host',
        'http.uri',
        'http.request.method',
        'url.full',
        'url.original',
        'url.domain',
        'url.path',
        'zeek.dns.query',
        'zeek.http.host',
        'zeek.http.method',
        'zeek.http.uri',
        'zeek.notice.note',
        'zeek.notice.msg',
        'zeek.notice.sub',
        'zeek.ssl.server_name',
        'network.application',
        'network.direction',
        'network.protocol',
        'network.transport',
    ];

    const categoryClauses = [];

    switch (categoryId) {
        case 'c2_beaconing':
            query.query.bool.must_not = [
                ...(query.query.bool.must_not || []),
                {
                    bool: {
                        should: buildRemoteAdminToolingClauses(),
                        minimum_should_match: 1,
                    },
                },
            ];
            break;
        case 'dns_tunneling':
            query.query.bool.filter.push({
                term: {
                    'event.dataset': 'dns',
                },
            });
            query.query.bool.must_not = [
                ...(query.query.bool.must_not || []),
                {
                    terms: {
                        'destination.ip': BENIGN_DNS_DEST_IPS,
                    },
                },
                ...BENIGN_DNS_QUERY_PATTERNS.map((pattern) => buildWildcardClause('zeek.dns.query', `*${pattern}*`)),
                ...BENIGN_DNS_ROOT_DOMAINS.map((domain) => buildWildcardClause('zeek.dns.query', `*.${domain}`)),
                ...BENIGN_DNS_ROOT_DOMAINS.map((domain) => buildTermClause('zeek.dns.query', domain)),
                ...DNS_TUNNELING_KNOWN_SERVICE_ROOT_DOMAINS.map((domain) => buildWildcardClause('zeek.dns.query', `*.${domain}`)),
                ...DNS_TUNNELING_KNOWN_SERVICE_ROOT_DOMAINS.map((domain) => buildTermClause('zeek.dns.query', domain)),
            ];
            break;
        case 'lateral_movement':
            query.query.bool.filter.push({
                terms: {
                    'event.dataset': ['conn', 'notice', 'alert'],
                },
            });
            query.query.bool.filter.push({
                terms: {
                    'destination.port': [22, 135, 139, 445, 3389],
                },
            });
            query.query.bool.filter.push({
                term: {
                    'network.direction': 'internal',
                },
            });
            break;
        default:
            break;
    }

    categoryClauses.push(...buildCategorySignalClauses(categoryId));

    if (categoryClauses.length > 0) {
        query.query.bool.must = [...(query.query.bool.must || []), {
            bool: {
                should: categoryClauses,
                minimum_should_match: 1,
            },
        }];
    }

    return query;
}

function includesAny(text, needles) {
    return needles.some((needle) => text.includes(needle));
}

function isLowValueSuricataNoise(event, profile) {
    if (profile !== DASHBOARD_V1_PROFILE || event.dataset !== 'alert') {
        return false;
    }

    const signature = String(event.signature || '').toLowerCase();
    const ruleCategory = String(event.ruleCategory || '').toLowerCase();
    const severity = Number(event.severity || 0);

    if (includesAny(signature, NOISY_SURICATA_RULE_PATTERNS)) {
        return true;
    }

    if (NOISY_SURICATA_CATEGORIES.includes(ruleCategory) && (severity === 0 || severity >= 3)) {
        return true;
    }

    return false;
}

function isLikelyBenignDnsNoise(event, profile) {
    if (profile !== DASHBOARD_V1_PROFILE || event.dataset !== 'dns') {
        return false;
    }

    const dnsQuery = String(event.dnsQuery || '').toLowerCase();
    const rootDomain = getRootDomain(dnsQuery);
    const destIp = String(event.dest_ip || '').toLowerCase();

    if (!dnsQuery) {
        return true;
    }

    if (BENIGN_DNS_DEST_IPS.includes(destIp)) {
        return true;
    }

    if (BENIGN_DNS_QUERY_PATTERNS.some((pattern) => dnsQuery.includes(pattern))) {
        return true;
    }

    if (BENIGN_DNS_ROOT_DOMAINS.includes(rootDomain)) {
        return true;
    }

    return false;
}

function isKnownServiceDnsTunnelingNoise(event, profile) {
    if (profile !== DASHBOARD_V1_PROFILE || event.dataset !== 'dns') {
        return false;
    }

    if (hasStrongC2Signal(event) || isDualUseAbusedInfrastructure(event)) {
        return false;
    }

    const dnsQuery = String(event.dnsQuery || '').toLowerCase();
    if (!dnsQuery) {
        return false;
    }

    return DNS_TUNNELING_KNOWN_SERVICE_ROOT_DOMAINS.some((domain) => matchesDomainSuffix(dnsQuery, domain));
}

function isKnownRemoteAdminTooling(event) {
    const signature = String(event.signature || '').toLowerCase();
    const ruleCategory = String(event.ruleCategory || '').toLowerCase();
    const dnsQuery = String(event.dnsQuery || '').toLowerCase();
    const tlsServerName = String(event.tlsServerName || '').toLowerCase();
    const httpHost = String(event.httpHost || '').toLowerCase();
    const targetHost = String(event.target_host || '').toLowerCase();
    const indicatorText = [
        signature,
        ruleCategory,
        dnsQuery,
        tlsServerName,
        httpHost,
        targetHost,
        event.notice,
        event.noticeMessage,
        event.noticeSub,
    ].filter(Boolean).join(' ').toLowerCase();

    const observedDomain =
        getRootDomain(dnsQuery) ||
        getRootDomain(tlsServerName) ||
        getRootDomain(httpHost) ||
        getRootDomain(targetHost);

    return (
        REMOTE_ADMIN_TOOL_ROOT_DOMAINS.includes(observedDomain) ||
        includesAny(indicatorText, REMOTE_ADMIN_TOOL_PATTERNS)
    );
}

function hasStrongC2Signal(event) {
    const detail = [
        event.signature,
        event.notice,
        event.noticeMessage,
        event.noticeSub,
    ].filter(Boolean).join(' ').toLowerCase();

    return includesAny(detail, STRONG_C2_SIGNAL_PATTERNS);
}

function isLikelyRemoteAdminToolingNoise(event, profile) {
    if (profile !== DASHBOARD_V1_PROFILE) {
        return false;
    }

    if (!isKnownRemoteAdminTooling(event)) {
        return false;
    }

    return !hasStrongC2Signal(event);
}

function extractKnownRootDomainFromText(text, knownDomains) {
    const normalized = String(text || '')
        .toLowerCase()
        .replace(/\s*\.\s*/g, '.')
        .replace(/\s+/g, ' ');

    return knownDomains.find((domain) => normalized.includes(domain)) || '';
}

function firstKnownRootDomain(knownDomains, ...values) {
    for (const value of values) {
        const rootDomain = getRootDomain(value);
        if (rootDomain && rootDomain !== 'unknown' && knownDomains.includes(rootDomain)) {
            return rootDomain;
        }
    }

    return '';
}

function getDualUseInfrastructureIndicator(event) {
    const directIndicator = firstKnownRootDomain(
        DUAL_USE_INFRA_ROOT_DOMAINS,
        event.tlsServerName,
        event.dnsQuery,
        event.httpHost,
        event.target_host
    );

    if (directIndicator) {
        return directIndicator;
    }

    const detail = [
        event.signature,
        event.notice,
        event.noticeMessage,
        event.noticeSub,
        event.dnsQuery,
        event.tlsServerName,
        event.httpHost,
        event.target_host,
    ].filter(Boolean).join(' ');

    return extractKnownRootDomainFromText(detail, DUAL_USE_INFRA_ROOT_DOMAINS);
}

function isDualUseAbusedInfrastructure(event) {
    if (hasStrongC2Signal(event)) {
        return false;
    }

    const detail = [
        event.signature,
        event.ruleCategory,
        event.notice,
        event.noticeMessage,
        event.noticeSub,
        event.dnsQuery,
        event.tlsServerName,
        event.httpHost,
        event.target_host,
    ].filter(Boolean).join(' ').toLowerCase();

    return Boolean(getDualUseInfrastructureIndicator(event)) || includesAny(detail, DUAL_USE_INFRA_PATTERNS);
}

function inferOpenSearchCategory(event, options = {}) {
    const profile = options.profile || null;

    if (isLowValueSuricataNoise(event, profile)) {
        return null;
    }

    if (isLikelyBenignDnsNoise(event, profile)) {
        return null;
    }

    if (isLikelyRemoteAdminToolingNoise(event, profile)) {
        return null;
    }

    const detail = [
        event.signature,
        event.ruleCategory,
        event.noticeMessage,
        event.noticeSub,
        event.notice,
        event.httpUrl,
        event.httpPath,
        event.httpHost,
        event.dnsQuery,
        event.networkApplication,
        event.tlsServerName,
        event.protocol,
        event.transport,
    ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();

    const tags = normalizeList(event.tags)
        .map((tag) => String(tag).toLowerCase());
    const ruleCategory = String(event.ruleCategory || '').toLowerCase();
    const signature = String(event.signature || '').toLowerCase();
    const notice = String(event.notice || '').toLowerCase();
    const noticeMessage = String(event.noticeMessage || '').toLowerCase();
    const noticeSub = String(event.noticeSub || '').toLowerCase();
    const httpPath = String(event.httpPath || '').toLowerCase();
    const tlsServerName = String(event.tlsServerName || '').toLowerCase();
    const dnsQuery = String(event.dnsQuery || '').toLowerCase();

    const internalMovement =
        isPrivateIp(event.src_ip) &&
        isPrivateIp(event.dest_ip) &&
        [22, 135, 139, 445, 3389].includes(Number(event.dest_port));

    if (internalMovement) {
        return 'lateral_movement';
    }

    if (
        detail.includes('lateral_movement') ||
        detail.includes('attack::lateral_movement')
    ) {
        return 'lateral_movement';
    }

    if (isDualUseAbusedInfrastructure(event)) {
        return 'dual_use_abused_infrastructure';
    }

    if (isExternalIpDiscoveryText(detail)) {
        return 'external_ip_discovery';
    }

    if (isHttpProtocolAnomaly(event, detail)) {
        return 'http_protocol_anomalies';
    }

    if (event.dataset === 'alert') {
        if (
            ruleCategory.includes('command_and_control') ||
            tags.some((tag) => ['rat', 'compromised'].includes(tag))
        ) {
            return 'c2_beaconing';
        }

        if (
            ruleCategory.includes('web application attack') ||
            includesAny(signature, ['sql injection', 'xss', 'webshell', 'directory traversal', 'command injection'])
        ) {
            return 'web_exploitation';
        }

        if (
            tags.some((tag) => ['exploit', 'possible_exploitation'].includes(tag)) ||
            ruleCategory.includes('attempted administrator privilege gain')
        ) {
            return 'exploit_attempts';
        }

        if (
            ruleCategory.includes('reconnaissance') ||
            ruleCategory.includes('detection of a network scan')
        ) {
            return 'recon_scanning';
        }
    }

    if (event.dataset === 'notice') {
        if (notice.startsWith('scan::')) {
            return 'recon_scanning';
        }

        if (notice.includes('password_guessing')) {
            return 'brute_force';
        }

    }

    if (
        event.dataset === 'http' &&
        includesAny(`${httpPath} ${detail}`, ['sql injection', 'xss', 'webshell', 'directory traversal', 'command injection', 'wp-admin', '/admin', '/.env'])
    ) {
        return 'web_exploitation';
    }

    if (
        detail.includes('beacon') ||
        detail.includes('command and control') ||
        detail.includes('command_and_control') ||
        detail.includes(' cnc') ||
        detail.includes(' c2') ||
        detail.includes('trojan')
    ) {
        return 'c2_beaconing';
    }

    if (
        detail.includes('malware') ||
        detail.includes('ransomware') ||
        detail.includes('backdoor') ||
        detail.includes('trojan')
    ) {
        return 'malware_activity';
    }

    if (
        detail.includes('sql injection') ||
        detail.includes('webshell') ||
        detail.includes('xss') ||
        detail.includes('httpattacks') ||
        detail.includes('remote code') ||
        detail.includes('command injection') ||
        detail.includes('directory traversal') ||
        detail.includes('web exploit')
    ) {
        return 'web_exploitation';
    }

    if (
        detail.includes('exploit') ||
        detail.includes('cve-') ||
        detail.includes('cve_') ||
        detail.includes('log4j')
    ) {
        return 'exploit_attempts';
    }

    if (
        detail.includes('brute') ||
        detail.includes('password_guess') ||
        detail.includes('failed login') ||
        detail.includes('authentication failure') ||
        detail.includes('login attempt') ||
        detail.includes('password guessing')
    ) {
        return 'brute_force';
    }

    if (
        detail.includes('scan') ||
        detail.includes('probe') ||
        detail.includes('recon') ||
        detail.includes('address_scan') ||
        detail.includes('random_scan') ||
        detail.includes('port_scan') ||
        detail.includes('detection of a network scan')
    ) {
        return 'recon_scanning';
    }

    if (event.dataset === 'dns') {
        const labels = String(event.dnsQuery || '')
            .split('.')
            .filter(Boolean);
        const longestLabel = labels.reduce((max, label) => Math.max(max, label.length), 0);
        if (labels.length >= 5 || longestLabel >= 28) {
            if (isKnownServiceDnsTunnelingNoise(event, profile)) {
                return null;
            }

            return 'dns_tunneling';
        }
    }

    return null;
}

function normalizeOpenSearchHit(hit, options = {}) {
    const source = hit._source || {};
    const signature = getSignature(source);
    const dnsQuery = getDnsQuery(source);
    const httpHost = firstScalar(source.http?.host ?? source.url?.domain ?? source.zeek?.http?.host) || '';
    const httpPath = firstScalar(source.http?.uri ?? source.url?.path ?? source.zeek?.http?.uri) || '';
    const targetUrl = buildTargetUrl(source);
    const notice = firstScalar(source.zeek?.notice?.note ?? source.message) || '';
    const ruleCategory = normalizeList(source.rule?.category).filter(Boolean).join(', ');
    const noticeMessage = firstScalar(source.zeek?.notice?.msg) || '';
    const noticeSub = firstScalar(source.zeek?.notice?.sub) || '';
    const eventOriginal = firstScalar(source.event?.original) || '';
    const passwordGuessingDetails = parseZeekPasswordGuessingDetails(noticeMessage, noticeSub, eventOriginal);
    const isSshPasswordGuessing = notice === 'SSH::Password_Guessing' || signature === 'Password_Guessing';
    const sampledSshServer = isSshPasswordGuessing ? passwordGuessingDetails.sampledServers[0] : null;
    const scanDetails = notice.startsWith('Scan::') ? parseZeekScanNoticeDetails(noticeMessage, eventOriginal) : null;
    const sampledScanPort = scanDetails?.scannedPorts?.[0]
        ? Number(String(scanDetails.scannedPorts[0]).split('/')[0])
        : 0;

    const normalized = {
        rawHit: hit,
        timestamp: source['@timestamp'] || source.event?.ingested || '',
        ingested_at: source.event?.ingested || source['@timestamp'] || '',
        dataset: firstScalar(source.event?.dataset) || 'unknown',
        src_ip: firstScalar(source.source?.ip) || firstScalar(source.src_ip) || 'unknown',
        dest_ip: firstScalar(source.destination?.ip) || firstScalar(source.dest_ip) || sampledSshServer || 'unknown',
        dest_port:
            Number(firstScalar(source.destination?.port) ?? firstScalar(source.dest_port) ?? 0) ||
            (isSshPasswordGuessing ? 22 : 0) ||
            sampledScanPort,
        signature,
        target_host:
            httpHost ||
            firstScalar(source.destination?.domain) ||
            firstScalar(source.destination?.ip) ||
            sampledSshServer ||
            firstScalar(source.host?.name) ||
            firstScalar(source.host?.hostname) ||
            'unknown',
        target_url: targetUrl,
        dnsQuery,
        protocol: normalizeList(source.network?.protocol).join(', '),
        transport: normalizeList(source.network?.transport).join(', '),
        networkApplication: firstScalar(source.network?.application) || '',
        httpHost,
        httpPath,
        httpUrl: targetUrl,
        notice,
        noticeMessage,
        noticeSub,
        sampled_dest_ips: isSshPasswordGuessing ? passwordGuessingDetails.sampledServers : [],
        observed_connection_count: isSshPasswordGuessing ? passwordGuessingDetails.observedConnectionCount : 0,
        scanned_ports: scanDetails?.scannedPorts || [],
        scanned_host_count: scanDetails?.scannedHostCount || 0,
        scanned_port_count: scanDetails?.scannedPortCount || 0,
        ruleCategory,
        ruleId: firstScalar(source.rule?.id) || '',
        tlsServerName: firstScalar(source.zeek?.ssl?.server_name) || '',
        httpMethod: firstScalar(source.http?.request?.method ?? source.zeek?.http?.method) || '',
        riskScoreNorm: Number(firstScalar(source.event?.risk_score_norm) ?? 0) || 0,
        tags: normalizeList(source.tags).filter(Boolean),
        severity:
            firstScalar(source.alert?.severity) ??
            firstScalar(source.suricata?.eve?.alert?.severity) ??
            null,
        alertCategory:
            ruleCategory ||
            normalizeList(source.alert?.category).filter(Boolean).join(', ') ||
            normalizeList(source.suricata?.eve?.alert?.category).filter(Boolean).join(', ') ||
            null,
    };

    normalized.category = inferOpenSearchCategory(normalized, options);
    return normalized;
}

function buildGroupKey(categoryId, event, options = {}) {
    const profile = options.profile || null;

    if (profile === DASHBOARD_V1_PROFILE) {
        switch (categoryId) {
            case 'web_exploitation':
                if (event.dataset === 'http') {
                    return `${event.src_ip}|${event.dest_ip}|${event.httpHost || event.target_host}|${event.httpPath || event.target_url || event.signature}`;
                }
                if (event.dataset === 'notice') {
                    return `${event.src_ip}|${event.notice || event.noticeMessage || event.signature}|${event.dest_ip}`;
                }
                if (event.dataset === 'alert') {
                    return `${event.src_ip}|${event.dest_ip}|${event.ruleId || event.signature}`;
                }
                return `${event.src_ip}|${event.dest_ip}|${event.signature}`;
            case 'http_protocol_anomalies':
                if (event.dataset === 'notice' && !isPrivateIp(event.src_ip)) {
                    return `external-rollup|${event.notice || event.signature}|${normalizeIndicatorText(event.noticeMessage || event.noticeSub || event.signature)}`;
                }
                return `${event.src_ip}|${event.dest_ip}|${event.notice || event.noticeMessage || event.signature}`;
            case 'exploit_attempts':
                return `${event.src_ip}|${event.dest_ip}|${event.ruleId || event.noticeSub || event.signature}`;
            case 'brute_force':
                return `${event.src_ip}|${event.dest_port || 0}|${event.ruleId || event.notice || event.signature}`;
            case 'recon_scanning':
                if (event.dataset === 'notice') {
                    if (['Scan::Random_Scan', 'Scan::Address_Scan'].includes(event.notice)) {
                        return `rollup|${event.notice}|${event.target_host || 'unknown'}`;
                    }
                    return `${event.src_ip}|${event.notice || event.noticeMessage}`;
                }
                return `${event.src_ip}|${event.ruleId || event.signature}|${event.dest_port}`;
            case 'dns_tunneling':
                return `${event.src_ip}|${getRootDomain(event.dnsQuery)}|${event.dest_ip}`;
            case 'dual_use_abused_infrastructure':
                return `${getDualUseInfrastructureIndicator(event) || normalizeIndicatorText(event.signature) || 'dual-use'}|${event.dataset}`;
            case 'c2_beaconing':
                if (event.dataset === 'ssl') {
                    return `${event.src_ip}|${event.tlsServerName || event.dest_ip}|${event.dest_port}`;
                }
                if (event.dataset === 'dns') {
                    return `${event.src_ip}|${getRootDomain(event.dnsQuery)}`;
                }
                return `${event.src_ip}|${event.dest_ip}|${event.ruleId || event.signature}`;
            case 'malware_activity':
                return `${event.src_ip}|${event.dest_ip}|${event.ruleId || event.signature}`;
            case 'lateral_movement':
                return `${event.src_ip}|${event.dest_ip}|${event.dest_port}|${event.dataset}`;
            default:
                return `${event.signature}|${event.src_ip}|${event.dest_ip}`;
        }
    }

    switch (categoryId) {
        case 'web_exploitation':
        case 'exploit_attempts':
            return `${event.src_ip}|${event.dest_ip}`;
        case 'http_protocol_anomalies':
            if (event.dataset === 'notice' && !isPrivateIp(event.src_ip)) {
                return `external-rollup|${event.notice || event.signature}|${normalizeIndicatorText(event.noticeMessage || event.noticeSub || event.signature)}`;
            }

            return `${event.src_ip}|${event.dest_ip}|${event.notice || event.signature}`;
        case 'brute_force':
            return `${event.src_ip}|${event.dest_port || 0}|${event.notice || event.signature}`;
        case 'recon_scanning':
            if (['Scan::Random_Scan', 'Scan::Address_Scan'].includes(event.notice)) {
                return `rollup|${event.notice}|${event.target_host || 'unknown'}`;
            }
            return `${event.src_ip}|${event.signature}`;
        case 'dns_tunneling':
            return `${event.src_ip}|${getRootDomain(event.dnsQuery)}`;
        case 'dual_use_abused_infrastructure':
            return `${getDualUseInfrastructureIndicator(event) || normalizeIndicatorText(event.signature) || 'dual-use'}|${event.dataset}`;
        case 'c2_beaconing':
            return `${event.src_ip}|${event.dest_ip}|${event.dest_port}`;
        default:
            return `${event.signature}|${event.src_ip}|${event.dest_ip}`;
    }
}

function buildCaseId(categoryId, groupKey) {
    const digest = crypto.createHash('sha1').update(String(groupKey)).digest('hex').slice(0, 16);
    return `case_${categoryId}_${digest}`;
}

function deriveCaseSignature(categoryId, event) {
    if (event.dataset === 'alert' && event.ruleId) {
        return `${event.ruleId} ${event.signature}`.trim();
    }

    if (event.dataset === 'notice') {
        return event.notice || event.noticeMessage || event.signature || 'notice activity';
    }

    if (event.dataset === 'http' && (event.httpHost || event.httpPath)) {
        return `${event.httpMethod || 'HTTP'} ${event.httpHost || ''}${event.httpPath || ''}`.trim();
    }

    if (event.signature && event.signature !== 'unknown') {
        return event.signature;
    }

    if (categoryId === 'dns_tunneling') {
        return getRootDomain(event.dnsQuery) || event.dnsQuery || 'dns activity';
    }

    if (categoryId === 'dual_use_abused_infrastructure') {
        return getDualUseInfrastructureIndicator(event) || event.signature || 'dual-use infrastructure';
    }

    if (categoryId === 'recon_scanning') {
        return event.notice || event.signature || event.dataset || 'scan activity';
    }

    if (event.target_url) {
        return event.target_url;
    }

    if (event.httpHost) {
        return event.httpHost;
    }

    if (event.notice) {
        return event.notice;
    }

    if (event.dnsQuery) {
        return event.dnsQuery;
    }

    if (event.dataset && event.dataset !== 'unknown') {
        return event.dataset;
    }

    return 'unknown';
}

function deriveCaseTargetHost(event) {
    return (
        event.httpHost ||
        event.target_host ||
        event.dest_ip ||
        event.src_ip ||
        'unknown'
    );
}

function pushUniqueValue(list, value) {
    if (!value) {
        return;
    }

    if (!list.includes(value)) {
        list.push(value);
    }
}

function normalizeIndicatorText(value) {
    return String(value || '')
        .toLowerCase()
        .replace(/\b\d{1,3}(?:\.\d{1,3}){3}\b/g, '')
        .replace(/\s+/g, ' ')
        .trim();
}

function extractCve(text) {
    const match = String(text || '').match(/cve[-_ ]?\d{4}[-_ ]?\d+/i);
    return match ? match[0].replace(/[_ ]+/g, '-').toUpperCase() : '';
}

function normalizePathStem(value) {
    const pathOnly = String(value || '')
        .split('?')[0]
        .trim()
        .toLowerCase();

    return pathOnly || '';
}

function deriveIncidentIndicator(categoryId, event) {
    const signatureText = [
        event.signature,
        event.notice,
        event.noticeMessage,
        event.noticeSub,
        event.ruleCategory,
    ].filter(Boolean).join(' ');

    switch (categoryId) {
        case 'c2_beaconing':
            return (
                getRootDomain(event.tlsServerName) ||
                getRootDomain(event.dnsQuery) ||
                event.ruleId ||
                normalizeIndicatorText(event.signature) ||
                event.dataset
            );
        case 'dns_tunneling':
            return (
                getRootDomain(event.dnsQuery) ||
                event.ruleId ||
                normalizeIndicatorText(event.signature) ||
                'dns'
            );
        case 'dual_use_abused_infrastructure':
            return (
                getDualUseInfrastructureIndicator(event) ||
                normalizeIndicatorText(signatureText) ||
                'dual-use-infrastructure'
            );
        case 'web_exploitation':
            return (
                event.ruleId ||
                extractCve(signatureText) ||
                normalizePathStem(event.httpPath || event.target_url) ||
                normalizeIndicatorText(signatureText) ||
                'web'
            );
        case 'http_protocol_anomalies':
            return (
                normalizeIndicatorText(event.noticeMessage || event.noticeSub || signatureText) ||
                event.ruleId ||
                'http-protocol-anomaly'
            );
        case 'exploit_attempts':
            return (
                event.ruleId ||
                extractCve(signatureText) ||
                normalizeIndicatorText(signatureText) ||
                'exploit'
            );
        case 'brute_force':
            return (
                event.ruleId ||
                normalizeIndicatorText(signatureText) ||
                `port:${event.dest_port || 0}`
            );
        case 'recon_scanning':
            return (
                normalizeIndicatorText(event.notice || event.noticeMessage || event.signature) ||
                event.ruleId ||
                'scan'
            );
        case 'malware_activity':
            return (
                event.ruleId ||
                normalizeIndicatorText(signatureText) ||
                'malware'
            );
        case 'lateral_movement':
            return (
                event.ruleId ||
                normalizeIndicatorText(signatureText) ||
                `port:${event.dest_port || 0}`
            );
        default:
            return normalizeIndicatorText(signatureText) || event.dataset || 'activity';
    }
}

function buildIncidentKey(categoryId, caseRecord) {
    if (['dns_tunneling', 'c2_beaconing', 'dual_use_abused_infrastructure'].includes(categoryId)) {
        return [
            categoryId,
            caseRecord.incident_indicator || normalizeIndicatorText(caseRecord.signature) || 'dual-use-infrastructure',
            caseRecord.dest_ip || 'unknown',
        ].join('|');
    }

    if (
        categoryId === 'recon_scanning' &&
        ['scan::random_scan', 'scan::address_scan'].includes(normalizeIndicatorText(caseRecord.signature))
    ) {
        return [
            categoryId,
            normalizeIndicatorText(caseRecord.signature),
            caseRecord.target_host || 'unknown',
        ].join('|');
    }

    if (
        categoryId === 'http_protocol_anomalies' &&
        !isPrivateIp(caseRecord.src_ip)
    ) {
        return [
            categoryId,
            'external-rollup',
            caseRecord.incident_indicator || normalizeIndicatorText(caseRecord.signature) || 'http-protocol-anomaly',
        ].join('|');
    }

    const baseParts = [
        categoryId,
        caseRecord.src_ip || 'unknown',
        caseRecord.incident_indicator || normalizeIndicatorText(caseRecord.signature) || 'activity',
    ];

    switch (categoryId) {
        case 'brute_force':
        case 'lateral_movement':
            baseParts.push(String(caseRecord.dest_port || 0));
            break;
        case 'exploit_attempts':
            if (caseRecord.rule_ids?.[0]) {
                baseParts.push(String(caseRecord.rule_ids[0]));
            }
            break;
        default:
            break;
    }

    return baseParts.join('|');
}

function consolidateIncidentCases(categoryId, groupedCases, options = {}) {
    const profile = options.profile || null;
    if (profile !== DASHBOARD_V1_PROFILE) {
        return groupedCases;
    }

    const incidentMap = new Map();

    for (const caseRecord of groupedCases) {
        const incidentKey = buildIncidentKey(categoryId, caseRecord);
        const consolidatedCaseId = buildCaseId(categoryId, `incident|${incidentKey}`);

        if (!incidentMap.has(consolidatedCaseId)) {
            incidentMap.set(consolidatedCaseId, {
                ...caseRecord,
                case_id: consolidatedCaseId,
                source_case_ids: [caseRecord.case_id],
                child_group_count: 1,
            });
            continue;
        }

        const consolidated = incidentMap.get(consolidatedCaseId);
        consolidated.log_count += caseRecord.log_count || 0;
        consolidated.first_seen =
            consolidated.first_seen && caseRecord.first_seen
                ? [consolidated.first_seen, caseRecord.first_seen].sort()[0]
                : consolidated.first_seen || caseRecord.first_seen;
        consolidated.last_seen =
            consolidated.last_seen && caseRecord.last_seen
                ? [consolidated.last_seen, caseRecord.last_seen].sort().at(-1)
                : consolidated.last_seen || caseRecord.last_seen;
        consolidated.priority_score = Math.max(consolidated.priority_score || 0, caseRecord.priority_score || 0);
        consolidated.child_group_count += 1;
        pushUniqueValue(consolidated.source_case_ids, caseRecord.case_id);

        for (const key of [
            'datasets',
            'rule_ids',
            'notice_types',
            'dns_root_domains',
            'tls_server_names',
            'http_hosts',
            'http_paths',
            'sampled_dest_ips',
            'scanned_ports',
            'affected_src_ips',
            'affected_dest_ips',
            'affected_hosts',
            'affected_urls',
        ]) {
            const values = Array.isArray(caseRecord[key]) ? caseRecord[key] : [];
            const target = Array.isArray(consolidated[key]) ? consolidated[key] : [];
            values.forEach((value) => pushUniqueValue(target, value));
            consolidated[key] = target;
        }

        if (consolidated.sample_logs.length < 10) {
            for (const sample of caseRecord.sample_logs || []) {
                if (consolidated.sample_logs.length >= 10) {
                    break;
                }
                consolidated.sample_logs.push(sample);
            }
        }

        if ((!consolidated.target_url || consolidated.target_url === '') && caseRecord.target_url) {
            consolidated.target_url = caseRecord.target_url;
        }
        if ((!consolidated.target_host || consolidated.target_host === 'unknown') && caseRecord.target_host) {
            consolidated.target_host = caseRecord.target_host;
        }
        if ((!consolidated.dest_ip || consolidated.dest_ip === 'unknown') && caseRecord.dest_ip) {
            consolidated.dest_ip = caseRecord.dest_ip;
        }
        consolidated.observed_connection_count =
            Number(consolidated.observed_connection_count || 0) + Number(caseRecord.observed_connection_count || 0);
        consolidated.max_scanned_host_count = Math.max(
            Number(consolidated.max_scanned_host_count || 0),
            Number(caseRecord.max_scanned_host_count || 0)
        );
        consolidated.max_scanned_port_count = Math.max(
            Number(consolidated.max_scanned_port_count || 0),
            Number(caseRecord.max_scanned_port_count || 0)
        );
    }

    return Array.from(incidentMap.values()).sort((left, right) => {
        if ((right.priority_score || 0) !== (left.priority_score || 0)) {
            return (right.priority_score || 0) - (left.priority_score || 0);
        }

        return (right.log_count || 0) - (left.log_count || 0);
    });
}

function deriveEventPriorityScore(event, options = {}) {
    const profile = options.profile || null;
    let score = 0;

    if (profile === DASHBOARD_V1_PROFILE) {
        score += Number(event.riskScoreNorm || 0);

        if (event.severity != null) {
            const severity = Number(event.severity);
            if (severity === 1) {
                score += 40;
            } else if (severity === 2) {
                score += 20;
            } else if (severity === 3) {
                score += 5;
            }
        }

        const tags = normalizeList(event.tags).map((tag) => String(tag).toLowerCase());
        if (tags.some((tag) => ['cisa_kev', 'exploit', 'possible_exploitation', 'compromised'].includes(tag))) {
            score += 25;
        }
    }

    return score;
}

function groupNormalizedEventsIntoCases(categoryId, events, options = {}) {
    const caseMap = new Map();

    for (const event of events) {
        const groupKey = buildGroupKey(categoryId, event, options);
        const caseId = buildCaseId(categoryId, groupKey);
        const priorityScore = deriveEventPriorityScore(event, options);

        if (!caseMap.has(caseId)) {
            caseMap.set(caseId, {
                case_id: caseId,
                category: categoryId,
                signature: deriveCaseSignature(categoryId, event),
                incident_indicator: deriveIncidentIndicator(categoryId, event),
                src_ip: event.src_ip,
                dest_ip: event.dest_ip,
                dest_port: event.dest_port,
                target_host: deriveCaseTargetHost(event),
                target_url: event.target_url || '',
                log_count: 0,
                first_seen: event.timestamp,
                last_seen: event.timestamp,
                priority_score: priorityScore,
                datasets: [],
                rule_ids: [],
                notice_types: [],
                dns_root_domains: [],
                tls_server_names: [],
                http_hosts: [],
                http_paths: [],
                sampled_dest_ips: [],
                observed_connection_count: 0,
                scanned_ports: [],
                max_scanned_host_count: 0,
                max_scanned_port_count: 0,
                affected_src_ips: [],
                affected_dest_ips: [],
                affected_hosts: [],
                affected_urls: [],
                sample_logs: [],
            });
        }

        const currentCase = caseMap.get(caseId);
        currentCase.log_count += 1;
        currentCase.first_seen =
            currentCase.first_seen && event.timestamp
                ? [currentCase.first_seen, event.timestamp].sort()[0]
                : currentCase.first_seen || event.timestamp;
        currentCase.last_seen =
            currentCase.last_seen && event.timestamp
                ? [currentCase.last_seen, event.timestamp].sort().at(-1)
                : currentCase.last_seen || event.timestamp;

        if (!currentCase.signature || currentCase.signature === 'unknown') {
            currentCase.signature = deriveCaseSignature(categoryId, event);
        }
        if ((!currentCase.target_url || currentCase.target_url === '') && event.target_url) {
            currentCase.target_url = event.target_url;
        }
        if (!currentCase.target_host || currentCase.target_host === 'unknown') {
            currentCase.target_host = deriveCaseTargetHost(event);
        }
        if (priorityScore > (currentCase.priority_score || 0)) {
            currentCase.priority_score = priorityScore;
        }
        pushUniqueValue(currentCase.datasets, event.dataset);
        pushUniqueValue(currentCase.rule_ids, event.ruleId);
        pushUniqueValue(currentCase.notice_types, event.notice);
        pushUniqueValue(currentCase.dns_root_domains, getRootDomain(event.dnsQuery));
        pushUniqueValue(currentCase.tls_server_names, getRootDomain(event.tlsServerName) || event.tlsServerName);
        pushUniqueValue(currentCase.http_hosts, event.httpHost);
        pushUniqueValue(currentCase.http_paths, normalizePathStem(event.httpPath || event.target_url));
        for (const sampledDestIp of event.sampled_dest_ips || []) {
            pushUniqueValue(currentCase.sampled_dest_ips, sampledDestIp);
            pushUniqueValue(currentCase.affected_dest_ips, sampledDestIp);
            pushUniqueValue(currentCase.affected_hosts, sampledDestIp);
        }
        currentCase.observed_connection_count += Number(event.observed_connection_count || 0);
        for (const scannedPort of event.scanned_ports || []) {
            pushUniqueValue(currentCase.scanned_ports, scannedPort);
        }
        currentCase.max_scanned_host_count = Math.max(
            Number(currentCase.max_scanned_host_count || 0),
            Number(event.scanned_host_count || 0)
        );
        currentCase.max_scanned_port_count = Math.max(
            Number(currentCase.max_scanned_port_count || 0),
            Number(event.scanned_port_count || 0)
        );
        pushUniqueValue(currentCase.affected_src_ips, event.src_ip);
        pushUniqueValue(currentCase.affected_dest_ips, event.dest_ip);
        pushUniqueValue(currentCase.affected_hosts, deriveCaseTargetHost(event));
        pushUniqueValue(currentCase.affected_urls, event.target_url);
        if (currentCase.sample_logs.length < 10) {
            currentCase.sample_logs.push(event.rawHit);
        }
    }

    const groupedCases = Array.from(caseMap.values()).sort((left, right) => {
        if ((right.priority_score || 0) !== (left.priority_score || 0)) {
            return (right.priority_score || 0) - (left.priority_score || 0);
        }

        return (right.log_count || 0) - (left.log_count || 0);
    });

    return consolidateIncidentCases(categoryId, groupedCases, options);
}

function summarizeKibanaCategory(category, hits, totalMatches) {
    if (!hits || hits.length === 0) {
        return {
            ...category,
            totalMatches: 0,
            retrievedCount: 0,
            firstSeen: null,
            lastSeen: null,
            topSignatures: [],
            topSrcIps: [],
            topDestIps: [],
            topDestPorts: [],
            affectedHosts: [],
            topUrls: [],
            topDnsQueries: [],
            uniqueSrcCount: 0,
            uniqueDestCount: 0,
            topSeverities: [],
            topCategories: [],
            suggestedPriority: 'Low',
            caseCandidates: 0,
            cases: [],
        };
    }

    const stats = {
        src_ips: {},
        dest_ips: {},
        dest_ports: {},
        signatures: {},
        hostnames: {},
        urls: {},
        dns_queries: {},
        severities: {},
        categories: {},
    };
    let firstSeen = hits[0]._source['@timestamp'];
    let lastSeen = hits[0]._source['@timestamp'];

    hits.forEach((hit) => {
        const source = hit._source;
        if (source['@timestamp'] < firstSeen) {
            firstSeen = source['@timestamp'];
        }
        if (source['@timestamp'] > lastSeen) {
            lastSeen = source['@timestamp'];
        }

        const srcIp = source.source?.ip || source.src_ip;
        const destIp = source.destination?.ip || source.dest_ip;
        const destPort = source.destination?.port || source.dest_port;
        if (srcIp) {
            stats.src_ips[srcIp] = (stats.src_ips[srcIp] || 0) + 1;
        }
        if (destIp) {
            stats.dest_ips[destIp] = (stats.dest_ips[destIp] || 0) + 1;
        }
        if (destPort) {
            stats.dest_ports[destPort] = (stats.dest_ports[destPort] || 0) + 1;
        }

        const hostname = source.host?.name || source.host?.hostname;
        if (hostname) {
            stats.hostnames[hostname] = (stats.hostnames[hostname] || 0) + 1;
        }

        const alert = source.alert || source.suricata?.eve?.alert;
        if (alert) {
            if (alert.signature) {
                stats.signatures[alert.signature] = (stats.signatures[alert.signature] || 0) + 1;
            }
            if (alert.severity) {
                stats.severities[alert.severity] = (stats.severities[alert.severity] || 0) + 1;
            }
            if (alert.category) {
                stats.categories[alert.category] = (stats.categories[alert.category] || 0) + 1;
            }
        }

        if (source.http?.url) {
            stats.urls[source.http.url] = (stats.urls[source.http.url] || 0) + 1;
        }
        if (source.dns?.rrname) {
            stats.dns_queries[source.dns.rrname] = (stats.dns_queries[source.dns.rrname] || 0) + 1;
        }
    });

    const cases = groupKibanaHitsIntoCases(category.id, hits);
    return {
        id: category.id,
        name: category.name,
        tier: category.tier,
        filter: category.filter,
        totalMatches,
        retrievedCount: hits.length,
        firstSeen,
        lastSeen,
        topSignatures: getTopItems(stats.signatures),
        topSrcIps: getTopItems(stats.src_ips),
        topDestIps: getTopItems(stats.dest_ips),
        topDestPorts: getTopItems(stats.dest_ports),
        affectedHosts: getTopItems(stats.hostnames),
        topUrls: getTopItems(stats.urls),
        topDnsQueries: getTopItems(stats.dns_queries),
        uniqueSrcCount: Object.keys(stats.src_ips).length,
        uniqueDestCount: Object.keys(stats.dest_ips).length,
        topSeverities: getTopItems(stats.severities),
        topCategories: getTopItems(stats.categories),
        suggestedPriority: totalMatches > 100 ? 'High' : totalMatches > 10 ? 'Medium' : 'Low',
        suggestedTicketType: category.suggestedTicketType,
        caseCandidates: cases.length,
        cases,
    };
}

function groupKibanaHitsIntoCases(categoryId, hits) {
    const caseMap = new Map();

    hits.forEach((hit) => {
        const source = hit._source;
        const alert = source.alert || source.suricata?.eve?.alert || {};
        const srcIp = source.source?.ip || source.src_ip || 'unknown';
        const destIp = source.destination?.ip || source.dest_ip || 'unknown';
        const destPort = source.destination?.port || source.dest_port || 0;
        const signature = alert.signature || 'unknown';
        const url = source.http?.url || '';
        const dnsQuery = source.dns?.rrname || '';

        let groupKey = '';
        switch (categoryId) {
            case 'web_exploitation':
            case 'exploit_attempts':
                groupKey = `${srcIp}|${destIp}`;
                break;
            case 'brute_force':
                groupKey = `${srcIp}|${destIp}|${destPort}`;
                break;
            case 'recon_scanning':
                groupKey = `${srcIp}|${signature}`;
                break;
            case 'dns_tunneling':
                groupKey = `${srcIp}|${getRootDomain(dnsQuery)}`;
                break;
            case 'c2_beaconing':
                groupKey = `${srcIp}|${destIp}|${destPort}`;
                break;
            default:
                groupKey = `${signature}|${srcIp}|${destIp}`;
        }

        const caseId = `case_${categoryId}_${caseMap.size + 1}_${Buffer.from(groupKey).toString('base64url').slice(0, 8)}`;
        if (!caseMap.has(groupKey)) {
            caseMap.set(groupKey, {
                case_id: caseId,
                category: categoryId,
                signature,
                src_ip: srcIp,
                dest_ip: destIp,
                dest_port: destPort,
                target_host: source.host?.name || source.host?.hostname || 'unknown',
                target_url: url,
                log_count: 0,
                first_seen: source['@timestamp'],
                last_seen: source['@timestamp'],
                sample_logs: [],
            });
        }

        const currentCase = caseMap.get(groupKey);
        currentCase.log_count += 1;
        if (source['@timestamp'] < currentCase.first_seen) {
            currentCase.first_seen = source['@timestamp'];
        }
        if (source['@timestamp'] > currentCase.last_seen) {
            currentCase.last_seen = source['@timestamp'];
        }
        if (currentCase.sample_logs.length < 10) {
            currentCase.sample_logs.push(hit);
        }
    });

    return Array.from(caseMap.values()).sort((left, right) => right.log_count - left.log_count);
}

async function collectKibanaTriageData(timeRange = 'now-48h') {
    console.log('--- Starting S.H.A.M.S. Kibana Data Collection & Summarization ---');
    await kibana.authenticate();

    const index = process.env.KIBANA_INDEX || 'suricata*';
    const totalResult = await kibana.search(index, {
        size: 0,
        query: { range: { '@timestamp': { gte: timeRange } } },
    });
    const totalLogs48h = getHitCount(totalResult.hits?.total);

    const rawCategories = [];
    const summaries = [];

    for (const category of CATEGORIES) {
        console.log(`Processing Kibana category: ${category.name}...`);
        const categoryResult = await kibana.search(index, {
            size: 100,
            query: {
                bool: {
                    must: [
                        { query_string: { query: category.filter } },
                        { range: { '@timestamp': { gte: timeRange } } },
                    ],
                },
            },
            sort: [{ '@timestamp': { order: 'desc' } }],
        });

        const hits = categoryResult.hits?.hits || [];
        const totalMatches = getHitCount(categoryResult.hits?.total);
        rawCategories.push({ ...category, totalMatches, sampleLogs: hits.slice(0, 10) });
        summaries.push(summarizeKibanaCategory(category, hits, totalMatches));
    }

    return {
        triageData: {
            source: 'kibana',
            lastUpdated: new Date().toISOString(),
            totalLogs48h,
            categories: rawCategories,
        },
        summaryData: {
            source: 'kibana',
            lastUpdated: new Date().toISOString(),
            totalLogs48h,
            summaries,
        },
    };
}

async function collectOpenSearchEventsForCategory(index, categoryId, timeRange = 'now-48h', options = {}) {
    const profile = options.profile || null;
    const verifiedEvents = [];
    const verifiedHits = [];
    let page = 0;
    let pageFrom = 0;

    while (page < OPENSEARCH_MAX_PAGES_PER_CATEGORY) {
        const result = await opensearch.search(
            index,
            buildOpenSearchCategoryCandidateQuery(categoryId, {
                timeRange,
                size: OPENSEARCH_PAGE_SIZE,
                from: pageFrom,
            })
        );

        const hits = result.hits?.hits || [];
        if (hits.length === 0) {
            break;
        }

        const pageEvents = hits
            .map((hit) => normalizeOpenSearchHit(hit, { profile }))
            .filter((event) => event.category === categoryId);

        for (const event of pageEvents) {
            verifiedEvents.push(event);
            verifiedHits.push(event.rawHit);
        }

        if (hits.length < OPENSEARCH_PAGE_SIZE) {
            break;
        }

        page += 1;
        pageFrom += OPENSEARCH_PAGE_SIZE;
    }

    return {
        events: verifiedEvents,
        rawHits: verifiedHits,
        truncated: page === OPENSEARCH_MAX_PAGES_PER_CATEGORY,
    };
}

async function collectOpenSearchTriageData(timeRange = 'now-48h', options = {}) {
    const onProgress = typeof options.onProgress === 'function' ? options.onProgress : null;
    const shouldStop = typeof options.shouldStop === 'function' ? options.shouldStop : null;
    const profile = options.profile || null;
    const alignToLatestAvailableWindow = Boolean(options.alignToLatestAvailableWindow);
    let effectiveTimeRange = timeRange;

    console.log('--- Starting S.H.A.M.S. OpenSearch Data Collection & Summarization ---');
    onProgress?.({
        stage: 'authenticating',
        message: 'Authenticating to OpenSearch',
        time_range: timeRange,
    });
    await opensearch.authenticate();

    const index = process.env.OPENSEARCH_INDEX || '*';
    let totalResult = await opensearch.search(index, buildOpenSearchBaseQuery({ timeRange: effectiveTimeRange, size: 0 }));
    let totalLogs48h = getHitCount(totalResult.hits?.total);

    if (alignToLatestAvailableWindow && totalLogs48h === 0 && typeof timeRange === 'string' && timeRange === 'now-1h') {
        const latestTimestamp = await fetchLatestOpenSearchTimestamp(index);
        const shiftedWindow = latestTimestamp ? shiftToLatestAvailableHour(latestTimestamp) : null;

        if (shiftedWindow) {
            effectiveTimeRange = shiftedWindow;
            onProgress?.({
                stage: 'window_shifted',
                message: `No logs found in now-1h. Replaying latest available hour ending ${latestTimestamp}.`,
                time_range: effectiveTimeRange,
            });
            totalResult = await opensearch.search(index, buildOpenSearchBaseQuery({ timeRange: effectiveTimeRange, size: 0 }));
            totalLogs48h = getHitCount(totalResult.hits?.total);
        }
    }

    onProgress?.({
        stage: 'authenticated',
        message: 'OpenSearch authenticated, starting category grouping',
        total_logs: totalLogs48h,
        time_range: effectiveTimeRange,
    });

    const rawCategories = [];
    const summaries = [];

    for (const category of CATEGORIES) {
        if (shouldStop?.()) {
            const stopError = new Error('OpenSearch triage stopped by operator request');
            stopError.code = 'CASE_MANAGER_V1_STOPPED';
            throw stopError;
        }

        onProgress?.({
            stage: 'categorizing',
            category_id: category.id,
            category_name: category.name,
            message: `Categorizing ${category.name}`,
        });

        const { events, rawHits, truncated } = await collectOpenSearchEventsForCategory(index, category.id, effectiveTimeRange, { profile });
        const stats = {
            src_ips: {},
            dest_ips: {},
            dest_ports: {},
            signatures: {},
            hostnames: {},
            urls: {},
            dns_queries: {},
            severities: {},
            categories: {},
        };

        let firstSeen = null;
        let lastSeen = null;

        for (const event of events) {
            const timestamp = event.timestamp || event.ingested_at;
            if (!firstSeen || timestamp < firstSeen) {
                firstSeen = timestamp;
            }
            if (!lastSeen || timestamp > lastSeen) {
                lastSeen = timestamp;
            }

            if (event.src_ip && event.src_ip !== 'unknown') {
                stats.src_ips[event.src_ip] = (stats.src_ips[event.src_ip] || 0) + 1;
            }
            if (event.dest_ip && event.dest_ip !== 'unknown') {
                stats.dest_ips[event.dest_ip] = (stats.dest_ips[event.dest_ip] || 0) + 1;
            }
            if (event.dest_port) {
                stats.dest_ports[event.dest_port] = (stats.dest_ports[event.dest_port] || 0) + 1;
            }
            if (event.signature && event.signature !== 'unknown') {
                stats.signatures[event.signature] = (stats.signatures[event.signature] || 0) + 1;
            }
            if (event.target_host && event.target_host !== 'unknown') {
                stats.hostnames[event.target_host] = (stats.hostnames[event.target_host] || 0) + 1;
            }
            if (event.target_url) {
                stats.urls[event.target_url] = (stats.urls[event.target_url] || 0) + 1;
            }
            if (event.dnsQuery) {
                stats.dns_queries[event.dnsQuery] = (stats.dns_queries[event.dnsQuery] || 0) + 1;
            }
            if (event.severity != null) {
                stats.severities[String(event.severity)] = (stats.severities[String(event.severity)] || 0) + 1;
            }
            if (event.alertCategory) {
                stats.categories[event.alertCategory] = (stats.categories[event.alertCategory] || 0) + 1;
            }
        }

        const cases = groupNormalizedEventsIntoCases(category.id, events, { profile });
        rawCategories.push({
            ...category,
            filter: getCategoryFilter(category, 'opensearch'),
            totalMatches: events.length,
            sampleLogs: rawHits.slice(0, 10),
        });
        summaries.push({
            id: category.id,
            name: category.name,
            tier: category.tier,
            filter: getCategoryFilter(category, 'opensearch'),
            totalMatches: events.length,
            retrievedCount: events.length,
            firstSeen,
            lastSeen,
            topSignatures: getTopItems(stats.signatures),
            topSrcIps: getTopItems(stats.src_ips),
            topDestIps: getTopItems(stats.dest_ips),
            topDestPorts: getTopItems(stats.dest_ports),
            affectedHosts: getTopItems(stats.hostnames),
            topUrls: getTopItems(stats.urls),
            topDnsQueries: getTopItems(stats.dns_queries),
            uniqueSrcCount: Object.keys(stats.src_ips).length,
            uniqueDestCount: Object.keys(stats.dest_ips).length,
            topSeverities: getTopItems(stats.severities),
            topCategories: getTopItems(stats.categories),
            suggestedPriority: events.length > 100 ? 'High' : events.length > 10 ? 'Medium' : 'Low',
            suggestedTicketType: category.suggestedTicketType,
            caseCandidates: cases.length,
            cases,
        });

        onProgress?.({
            stage: 'categorized',
            category_id: category.id,
            category_name: category.name,
            message: `Categorized ${category.name}`,
            total_matches: events.length,
            grouped_cases: cases.length,
            truncated,
        });

        if (truncated) {
            console.warn(`[OpenSearch] Category ${category.id} hit the pagination ceiling (${OPENSEARCH_PAGE_SIZE * OPENSEARCH_MAX_PAGES_PER_CATEGORY} candidates scanned). Counts may be incomplete.`);
        }
    }

    return {
        triageData: {
            source: 'opensearch',
            lastUpdated: new Date().toISOString(),
            totalLogs48h,
            timeRange: effectiveTimeRange,
            categories: rawCategories,
        },
        summaryData: {
            source: 'opensearch',
            lastUpdated: new Date().toISOString(),
            totalLogs48h,
            timeRange: effectiveTimeRange,
            summaries,
        },
    };
}

export async function collectTriageData(rawSource = DEFAULT_SOURCE, options = {}) {
    const source = resolveTelemetrySource(rawSource);
    const paths = getStoragePaths(source, options.storageSuffix || '');
    const timeRange = options.timeRange || 'now-48h';

    try {
        const data = source === 'opensearch'
            ? await collectOpenSearchTriageData(timeRange, options)
            : await collectKibanaTriageData(timeRange);
        fs.writeFileSync(paths.raw, JSON.stringify(data.triageData, null, 2));
        fs.writeFileSync(paths.summary, JSON.stringify(data.summaryData, null, 2));
        console.log(`Saved ${source} triage data to ${paths.raw} and ${paths.summary}`);
        return data;
    } catch (err) {
        console.error(`Collection failed for ${source}:`, err.message);
        throw err;
    }
}

if (process.argv[1] && import.meta.url === `file:///${process.argv[1].replace(/\\/g, '/')}`) {
    const source = process.argv[2] || DEFAULT_SOURCE;
    const timeRange = process.argv[3] || 'now-48h';
    collectTriageData(source, { timeRange });
}
