import fs from 'fs';
import path from 'path';

const HISTORY_FILE = path.resolve('data/tickets/ticket-history.json');
const SYNC_STATE_FILE = path.resolve('data/tickets/sync-state.json');

function ensureDirExists(filePath) {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
}

export function loadTicketHistory() {
    try {
        if (!fs.existsSync(HISTORY_FILE)) {
            return [];
        }
        const data = fs.readFileSync(HISTORY_FILE, 'utf8');
        return JSON.parse(data);
    } catch (err) {
        console.error('[HistoryStore] Error loading history:', err);
        return [];
    }
}

export function saveTicketHistory(records) {
    try {
        ensureDirExists(HISTORY_FILE);
        fs.writeFileSync(HISTORY_FILE, JSON.stringify(records, null, 2));
        return true;
    } catch (err) {
        console.error('[HistoryStore] Error saving history:', err);
        return false;
    }
}

export function appendTicketRecord(record) {
    const history = loadTicketHistory();
    // Avoid duplicates by ticket_id
    if (record.ticket_id) {
        const existingIndex = history.findIndex(t => t.ticket_id === record.ticket_id);
        if (existingIndex !== -1) {
            history[existingIndex] = { ...history[existingIndex], ...record, updated_at: new Date().toISOString() };
        } else {
            history.push({ ...record, created_at: record.created_at || new Date().toISOString(), updated_at: new Date().toISOString() });
        }
    } else {
        history.push({ ...record, created_at: record.created_at || new Date().toISOString(), updated_at: new Date().toISOString() });
    }
    return saveTicketHistory(history);
}

export function updateTicketRecord(ticketId, patch) {
    const history = loadTicketHistory();
    const index = history.findIndex(t => t.ticket_id === ticketId);
    if (index !== -1) {
        history[index] = { ...history[index], ...patch, updated_at: new Date().toISOString() };
        return saveTicketHistory(history);
    }
    return false;
}

export function findTicketById(ticketId) {
    const history = loadTicketHistory();
    return history.find(t => t.ticket_id === ticketId);
}

export function findTicketsByIp(ip) {
    const history = loadTicketHistory();
    return history.filter(t => t.src_ip === ip || t.dest_ip === ip);
}

export function getSyncState() {
    try {
        if (!fs.existsSync(SYNC_STATE_FILE)) {
            return { last_sync: null };
        }
        return JSON.parse(fs.readFileSync(SYNC_STATE_FILE, 'utf8'));
    } catch (err) {
        return { last_sync: null };
    }
}

export function updateSyncState(state) {
    try {
        ensureDirExists(SYNC_STATE_FILE);
        fs.writeFileSync(SYNC_STATE_FILE, JSON.stringify(state, null, 2));
        return true;
    } catch (err) {
        return false;
    }
}
