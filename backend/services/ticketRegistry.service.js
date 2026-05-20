import * as historyStore from './ticketHistoryStore.service.js';
import * as mantisService from './mantis.service.js';
import dotenv from 'dotenv';

dotenv.config();

/**
 * Normalizes a Mantis ticket into our local registry format.
 */
function normalizeMantisTicket(mantisTicket) {
    const mantisBase = process.env.MANTIS_URL.endsWith('/') ? process.env.MANTIS_URL.slice(0, -1) : process.env.MANTIS_URL;
    
    // Try to extract some fields from description or summary if possible
    const content = `${mantisTicket.summary} ${mantisTicket.description || ''} ${mantisTicket.additional_information || ''}`;
    
    // Better IP extraction
    const srcIpLabelMatch = content.match(/Source IP:\s*([a-fA-F0-9:.]+)/i);
    const allIps = content.match(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g) || [];
    
    const destIpLabelMatch = content.match(/Destination IP:\s*([a-fA-F0-9:.]+)/i);
    const hostMatch = content.match(/Target Host:\s*([^\n\s,]+)/i);
    const urlMatch = content.match(/Target URL:\s*([^\n\s,]+)/i);
    const portMatch = content.match(/Destination Port:\s*(\d+)/i);
    const opensearchLinkMatch = content.match(/OpenSearch Dashboards Link:\s*(https?:\/\/[^\n\s]+)/i);
    const signatureMatch = content.match(/Signature:\s*([^\n]+)/i);

    return {
        ticket_id: mantisTicket.id,
        ticket_url: `${mantisBase}/view.php?id=${mantisTicket.id}`,
        summary: mantisTicket.summary,
        project: mantisTicket.project?.name || 'unknown',
        reporter: mantisTicket.reporter?.name || 'unknown',
        source: 'synced',
        category: mantisTicket.category?.name || 'General',
        ticket_status: mantisTicket.status?.name || 'new',
        created_at: mantisTicket.created_at,
        updated_at: mantisTicket.updated_at,
        // Extracted fields
        src_ip: srcIpLabelMatch ? srcIpLabelMatch[1] : (allIps.length > 0 ? allIps[0] : null),
        dest_ip: destIpLabelMatch ? destIpLabelMatch[1] : (allIps.length > 1 ? allIps[1] : null),
        signature: signatureMatch ? signatureMatch[1] : mantisTicket.summary,
        target_host: hostMatch ? hostMatch[1] : null,
        target_url: urlMatch ? urlMatch[1] : null,
        dest_port: portMatch ? parseInt(portMatch[1]) : null,
        opensearch_link: opensearchLinkMatch ? opensearchLinkMatch[1] : null,
        notes: (mantisTicket.notes || []).map(n => ({
            id: n.id,
            reporter: n.reporter?.name || 'unknown',
            text: n.text,
            created_at: n.created_at
        }))
    };
}

export async function syncUserTickets() {
    const username = process.env.MANTIS_USERNAME || 'papy.shamirani';
    const mantisTickets = await mantisService.fetchTicketsForUser(username);
    
    const currentHistory = historyStore.loadTicketHistory();
    let updatedCount = 0;
    let createdCount = 0;

    for (const mantisTicket of mantisTickets) {
        const normalized = normalizeMantisTicket(mantisTicket);
        const existingIndex = currentHistory.findIndex(t => t.ticket_id === normalized.ticket_id);

        if (existingIndex !== -1) {
            // Merge: preserve local analyst fields
            const existing = currentHistory[existingIndex];
            currentHistory[existingIndex] = {
                ...normalized,
                // Preserve memory fields
                case_id: existing.case_id || normalized.case_id,
                decision: existing.decision || normalized.decision,
                decision_reason: existing.decision_reason || normalized.decision_reason,
                reuse_note: existing.reuse_note || normalized.reuse_note,
                reviewed_by: existing.reviewed_by || normalized.reviewed_by,
                // If it was already in history, keep its original source if it wasn't 'synced'
                source: existing.source !== 'synced' ? existing.source : 'synced',
                // Keep explicitly set IPs/etc if they exist
                src_ip: existing.src_ip || normalized.src_ip,
                dest_ip: existing.dest_ip || normalized.dest_ip,
                signature: existing.signature || normalized.signature,
                target_host: existing.target_host || normalized.target_host,
                target_url: existing.target_url || normalized.target_url,
                dest_port: existing.dest_port || normalized.dest_port,
                opensearch_link: existing.opensearch_link || normalized.opensearch_link
            };
            updatedCount++;
        } else {
            currentHistory.push(normalized);
            createdCount++;
        }
    }

    historyStore.saveTicketHistory(currentHistory);
    historyStore.updateSyncState({ last_sync: new Date().toISOString() });

    return {
        success: true,
        synced: mantisTickets.length,
        updated: updatedCount,
        created: createdCount
    };
}

export function addManualTicket(ticketData) {
    const record = {
        ...ticketData,
        source: ticketData.source || 'manual',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
    };
    
    return historyStore.appendTicketRecord(record);
}

export function getTicketHistory() {
    return historyStore.loadTicketHistory();
}
