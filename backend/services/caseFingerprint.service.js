import crypto from 'crypto';

export const CASE_FINGERPRINT_RULES = {
    webExploitationCategories: ['web_exploitation', 'exploit_attempts', 'http_protocol_anomalies'],
    dnsOrC2Categories: ['dns_tunneling', 'c2_beaconing'],
    bruteForceCategories: ['brute_force'],
    reconCategories: ['recon_scanning'],
};

function firstNonEmpty(...values) {
    for (const value of values) {
        if (Array.isArray(value)) {
            const nested = firstNonEmpty(...value);
            if (nested !== null) {
                return nested;
            }
            continue;
        }

        if (value === null || value === undefined) {
            continue;
        }

        if (typeof value === 'string') {
            const trimmed = value.trim();
            if (!trimmed || trimmed.toLowerCase() === 'unknown' || trimmed === 'N/A') {
                continue;
            }
            return trimmed;
        }

        return value;
    }

    return null;
}

function normalizeCategory(rawCategory) {
    const category = firstNonEmpty(rawCategory);
    return category ? String(category).trim().toLowerCase() : 'unknown';
}

function normalizeProtocol(normalizedLog) {
    return firstNonEmpty(
        normalizedLog.protocol,
        normalizedLog.transport,
        normalizedLog.dataset
    ) || 'unknown';
}

function normalizeNumber(value, fallback = 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function isPrivateIp(value) {
    const ip = String(value || '');
    return (
        ip.startsWith('10.') ||
        ip.startsWith('192.168.') ||
        /^172\.(1[6-9]|2\d|3[0-1])\./.test(ip)
    );
}

function firstListValue(value) {
    if (!Array.isArray(value) || value.length === 0) {
        return null;
    }

    return firstNonEmpty(...value);
}

function normalizeIndicatorValue(value) {
    const selected = firstNonEmpty(value);
    return selected ? String(selected).trim().toLowerCase() : null;
}

function buildBaseFingerprint(normalizedLog) {
    return {
        category: normalizeCategory(normalizedLog.category),
        src_ip: firstNonEmpty(normalizedLog.src_ip) || 'unknown',
        dest_ip: firstNonEmpty(normalizedLog.dest_ip) || 'unknown',
        dest_port: normalizeNumber(normalizedLog.dest_port, 0),
        protocol: String(normalizeProtocol(normalizedLog)).toLowerCase(),
    };
}

function canonicalizeValue(value) {
    if (Array.isArray(value)) {
        return value.map((item) => canonicalizeValue(item));
    }

    if (value && typeof value === 'object') {
        return Object.keys(value)
            .sort()
            .reduce((accumulator, key) => {
                accumulator[key] = canonicalizeValue(value[key]);
                return accumulator;
            }, {});
    }

    return value;
}

function buildIndicator(normalizedLog, category) {
    if (CASE_FINGERPRINT_RULES.webExploitationCategories.includes(category)) {
        return firstNonEmpty(
            normalizedLog.incident_indicator,
            normalizedLog.url,
            normalizedLog.target_url,
            normalizedLog.httpUrl,
            normalizedLog.httpPath,
            normalizedLog.http_paths,
            normalizedLog.signature
        );
    }

    if (CASE_FINGERPRINT_RULES.dnsOrC2Categories.includes(category)) {
        return firstNonEmpty(
            normalizedLog.incident_indicator,
            normalizedLog.domain,
            normalizedLog.dnsQuery,
            normalizedLog.dns_root_domains,
            normalizedLog.tlsServerName,
            normalizedLog.tls_server_names,
            normalizedLog.target_host,
            normalizedLog.httpHost,
            normalizedLog.http_hosts,
            normalizedLog.signature
        );
    }

    if (CASE_FINGERPRINT_RULES.reconCategories.includes(category)) {
        return firstNonEmpty(
            normalizedLog.incident_indicator,
            normalizedLog.notice,
            normalizedLog.notice_types,
            normalizedLog.signature
        );
    }

    return null;
}

export function buildCaseFingerprint(normalizedLog = {}) {
    const base = buildBaseFingerprint(normalizedLog);
    const { category } = base;

    if (category === 'http_protocol_anomalies' && !isPrivateIp(base.src_ip)) {
        return canonicalizeValue({
            category,
            src_ip: base.src_ip,
            dest_port: base.dest_port,
            protocol: base.protocol,
            indicator: firstNonEmpty(buildIndicator(normalizedLog, category)) || 'unknown',
        });
    }

    if (CASE_FINGERPRINT_RULES.webExploitationCategories.includes(category)) {
        return canonicalizeValue({
            category,
            src_ip: base.src_ip,
            dest_ip: base.dest_ip,
            dest_port: base.dest_port,
            protocol: base.protocol,
            indicator: firstNonEmpty(buildIndicator(normalizedLog, category)) || 'unknown',
        });
    }

    if (CASE_FINGERPRINT_RULES.dnsOrC2Categories.includes(category)) {
        return canonicalizeValue({
            category,
            dest_ip: base.dest_ip,
            protocol: base.protocol,
            indicator: normalizeIndicatorValue(buildIndicator(normalizedLog, category)) || 'unknown',
        });
    }

    if (CASE_FINGERPRINT_RULES.bruteForceCategories.includes(category)) {
        return canonicalizeValue({
            category,
            src_ip: base.src_ip,
            dest_port: base.dest_port,
            protocol: base.protocol,
            indicator: firstNonEmpty(normalizedLog.incident_indicator, normalizedLog.notice, normalizedLog.signature) || 'unknown',
        });
    }

    if (CASE_FINGERPRINT_RULES.reconCategories.includes(category)) {
        const indicator = firstNonEmpty(buildIndicator(normalizedLog, category)) || 'unknown';
        const normalizedIndicator = String(indicator).toLowerCase();

        if (['scan::random_scan', 'scan::address_scan'].includes(normalizedIndicator)) {
            return canonicalizeValue({
                category,
                indicator: normalizedIndicator,
                target_host: firstNonEmpty(normalizedLog.target_host) || 'unknown',
            });
        }

        return canonicalizeValue({
            category,
            src_ip: base.src_ip,
            dest_port: base.dest_port,
            protocol: base.protocol,
            indicator,
        });
    }

    return canonicalizeValue(base);
}

export function buildCaseIdFromFingerprint(fingerprint = {}) {
    const canonicalFingerprint = canonicalizeValue(fingerprint);
    const hash = crypto
        .createHash('sha256')
        .update(JSON.stringify(canonicalFingerprint))
        .digest('hex')
        .slice(0, 16);

    return `case_${hash}`;
}

export function buildFingerprintResult(normalizedLog = {}) {
    const fingerprint = buildCaseFingerprint(normalizedLog);
    const case_id = buildCaseIdFromFingerprint(fingerprint);

    return {
        fingerprint,
        case_id,
    };
}
