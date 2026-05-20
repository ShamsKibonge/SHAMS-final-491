import MantisClient from '../mantis.client.js';
import dotenv from 'dotenv';

dotenv.config();

const mantisClient = new MantisClient(
    process.env.MANTIS_URL,
    process.env.MANTIS_API_TOKEN
);

const DEFAULT_PAGE_SIZE = Number(process.env.MANTIS_SYNC_PAGE_SIZE || 100);
const DEFAULT_MAX_PAGES = Number(process.env.MANTIS_SYNC_MAX_PAGES || 50);

function normalizeIdentityValue(value) {
    return String(value || '').trim().toLowerCase();
}

function buildUserIdentitySet(...users) {
    const identities = new Set();

    for (const user of users) {
        if (!user) continue;

        if (typeof user === 'string') {
            const normalized = normalizeIdentityValue(user);
            if (normalized) identities.add(normalized);
            continue;
        }

        [
            user.id,
            user.name,
            user.username,
            user.real_name,
            user.email,
            user.email_address,
        ].forEach((value) => {
            const normalized = normalizeIdentityValue(value);
            if (normalized) identities.add(normalized);
        });
    }

    return identities;
}

function principalMatchesUser(principal, userIdentities) {
    if (!principal || userIdentities.size === 0) return false;

    return [
        principal.id,
        principal.name,
        principal.username,
        principal.real_name,
        principal.email,
        principal.email_address,
    ].some((value) => userIdentities.has(normalizeIdentityValue(value)));
}

function issueMatchesUser(issue, userIdentities, scope) {
    const checks = [];

    if (scope === 'reported' || scope === 'both') {
        checks.push(principalMatchesUser(issue.reporter, userIdentities));
    }

    if (scope === 'assigned' || scope === 'both') {
        checks.push(principalMatchesUser(issue.handler, userIdentities));
        checks.push(principalMatchesUser(issue.assigned_to, userIdentities));

        const monitors = Array.isArray(issue.monitors) ? issue.monitors : [];
        checks.push(monitors.some((monitor) => principalMatchesUser(monitor, userIdentities)));
    }

    return checks.some(Boolean);
}

async function fetchVisibleIssues({ pageSize = DEFAULT_PAGE_SIZE, maxPages = DEFAULT_MAX_PAGES } = {}) {
    let allTickets = [];
    let page = 1;
    let hasMore = true;

    while (hasMore) {
        const url = `${mantisClient.baseUrl}/api/rest/issues?page_size=${pageSize}&page=${page}`;
        const response = await fetch(url, {
            headers: await mantisClient.getHeader()
        });
        
        if (!response.ok) {
            throw new Error(`Mantis search failed: ${response.status}`);
        }
        
        const text = await response.text();
        let data;
        try {
            data = JSON.parse(text);
        } catch (e) {
            const first = text.indexOf('{');
            const last = text.lastIndexOf('}');
            data = JSON.parse(text.substring(first, last + 1));
        }

        const issues = data.issues || [];
        allTickets = allTickets.concat(issues);
        
        if (issues.length < pageSize || page >= maxPages) {
            hasMore = false;
        } else {
            page++;
        }
    }

    return allTickets;
}

export async function fetchTicketsForUser(username, options = {}) {
    const currentUser = await mantisClient.checkConnection();
    const userIdentities = buildUserIdentitySet(username, currentUser);
    const scope = options.scope || process.env.MANTIS_SYNC_SCOPE || 'both';

    console.log(`[MantisService] Fetching ${scope} tickets for user identities: ${Array.from(userIdentities).join(', ')}`);

    const allTickets = await fetchVisibleIssues(options);
    const userTickets = allTickets.filter((issue) => issueMatchesUser(issue, userIdentities, scope));

    console.log(`[MantisService] Found ${userTickets.length} ${scope} tickets from ${allTickets.length} visible Mantis issues`);
    return userTickets;
}

export async function fetchTicketsReportedByUser(username) {
    return fetchTicketsForUser(username, { scope: 'reported' });
}


export async function getTicketDetails(ticketId) {
    return await mantisClient.getIssue(ticketId);
}
