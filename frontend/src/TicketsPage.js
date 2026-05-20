import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import React, { useState, useEffect } from 'react';
const BACKEND_URL = process.env.REACT_APP_BACKEND_URL || 'http://localhost:5000';
const TicketsPage = () => {
    const [tickets, setTickets] = useState([]);
    const [loading, setLoading] = useState(true);
    const [syncing, setSyncing] = useState(false);
    const [error, setError] = useState(null);
    const [search, setSearch] = useState('');
    const [filterSource, setFilterSource] = useState('all');
    const [filterStatus, setFilterStatus] = useState('all');
    const [showManualModal, setShowManualModal] = useState(false);
    const [expandedTicketId, setExpandedTicketId] = useState(null);
    // Form state for manual add
    const [manualForm, setManualForm] = useState({
        ticket_id: 0,
        summary: '',
        project: 'bainbridge',
        category: 'General',
        source: 'manual',
        ticket_status: 'new'
    });
    const fetchHistory = async () => {
        setLoading(true);
        try {
            const response = await fetch(`${BACKEND_URL}/api/tickets/history`);
            if (!response.ok)
                throw new Error('Failed to fetch ticket history');
            const data = await response.json();
            setTickets(data);
            setError(null);
        }
        catch (err) {
            setError(err.message);
        }
        finally {
            setLoading(false);
        }
    };
    useEffect(() => {
        fetchHistory();
    }, []);
    const handleSync = async () => {
        setSyncing(true);
        try {
            const response = await fetch(`${BACKEND_URL}/api/tickets/sync`, { method: 'POST' });
            if (!response.ok)
                throw new Error('Sync failed');
            const result = await response.json();
            alert(`Sync complete! Synced: ${result.synced}, Created: ${result.created}, Updated: ${result.updated}`);
            fetchHistory();
        }
        catch (err) {
            alert('Error syncing tickets: ' + err.message);
        }
        finally {
            setSyncing(false);
        }
    };
    const handleManualSubmit = async (e) => {
        e.preventDefault();
        try {
            const response = await fetch(`${BACKEND_URL}/api/tickets/manual`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(manualForm)
            });
            if (!response.ok)
                throw new Error('Failed to save manual ticket');
            setShowManualModal(false);
            fetchHistory();
            setManualForm({
                ticket_id: 0,
                summary: '',
                project: 'bainbridge',
                category: 'General',
                source: 'manual',
                ticket_status: 'new'
            });
        }
        catch (err) {
            alert('Error saving ticket: ' + err.message);
        }
    };
    const filteredTickets = tickets.filter(t => {
        const matchesSearch = t.summary.toLowerCase().includes(search.toLowerCase()) ||
            t.ticket_id.toString().includes(search) ||
            (t.src_ip && t.src_ip.includes(search)) ||
            (t.dest_ip && t.dest_ip.includes(search));
        const matchesSource = filterSource === 'all' || t.source === filterSource;
        const matchesStatus = filterStatus === 'all' || t.ticket_status === filterStatus;
        return matchesSearch && matchesSource && matchesStatus;
    }).sort((a, b) => b.ticket_id - a.ticket_id);
    const getStatusColor = (status) => {
        if (!status)
            return 'var(--text-secondary)';
        switch (status.toLowerCase()) {
            case 'resolved':
            case 'closed':
                return 'var(--success-color)';
            case 'new':
            case 'assigned':
                return 'var(--accent-color)';
            case 'feedback':
                return 'var(--warning-color)';
            default:
                return 'var(--text-secondary)';
        }
    };
    const generateOpenSearchFilter = (ticket) => {
        const parts = [];
        if (ticket.src_ip && ticket.src_ip !== 'unknown' && ticket.src_ip !== 'N/A') {
            parts.push(`src_ip:"${ticket.src_ip}"`);
        }
        if (ticket.dest_ip && ticket.dest_ip !== 'unknown' && ticket.dest_ip !== 'N/A') {
            parts.push(`dest_ip:"${ticket.dest_ip}"`);
        }
        if (ticket.dest_port) {
            parts.push(`dest_port:${ticket.dest_port}`);
        }
        if (ticket.signature && ticket.signature !== 'unknown' && ticket.signature !== 'N/A') {
            const cleanSig = ticket.signature.replace(/"/g, '\\"').trim();
            parts.push(`alert.signature:"${cleanSig}"`);
        }
        return parts.length > 0 ? parts.join(' AND ') : '*';
    };
    const copyToClipboard = async (text) => {
        try {
            await navigator.clipboard.writeText(text);
            alert('OpenSearch filter copied to clipboard!');
        }
        catch (err) {
            console.error('Failed to copy!', err);
            alert('Failed to copy to clipboard.');
        }
    };
    return (_jsxs("div", { className: "TicketsPage", children: [_jsxs("header", { className: "page-header", children: [_jsxs("div", { className: "header-info", children: [_jsx("h2", { children: "Ticket Registry" }), _jsxs("p", { className: "subtitle", children: [tickets.length, " tickets in local history"] })] }), _jsxs("div", { className: "header-actions", children: [_jsx("button", { className: "secondary-btn", onClick: () => setShowManualModal(true), children: "+ Add Manually" }), _jsx("button", { className: "primary-btn", onClick: handleSync, disabled: syncing, children: syncing ? 'Syncing...' : 'Sync My Tickets' })] })] }), _jsxs("div", { className: "filters-bar", children: [_jsx("div", { className: "search-box", children: _jsx("input", { type: "text", placeholder: "Search ID, summary, IP...", value: search, onChange: (e) => setSearch(e.target.value) }) }), _jsxs("div", { className: "select-group", children: [_jsxs("select", { value: filterSource, onChange: (e) => setFilterSource(e.target.value), children: [_jsx("option", { value: "all", children: "All Sources" }), _jsx("option", { value: "created", children: "Created" }), _jsx("option", { value: "manual", children: "Manual" }), _jsx("option", { value: "synced", children: "Synced" })] }), _jsxs("select", { value: filterStatus, onChange: (e) => setFilterStatus(e.target.value), children: [_jsx("option", { value: "all", children: "All Statuses" }), _jsx("option", { value: "new", children: "New" }), _jsx("option", { value: "resolved", children: "Resolved" }), _jsx("option", { value: "closed", children: "Closed" })] })] })] }), loading ? (_jsx("div", { className: "loading-state", children: "Loading ticket history..." })) : error ? (_jsxs("div", { className: "error-state", children: ["Error: ", error] })) : filteredTickets.length === 0 ? (_jsx("div", { className: "empty-state", children: "No tickets found matching your filters." })) : (_jsx("div", { className: "tickets-table-container", children: _jsxs("table", { className: "tickets-table", children: [_jsx("thead", { children: _jsxs("tr", { children: [_jsx("th", { children: "ID" }), _jsx("th", { children: "Summary" }), _jsx("th", { children: "Project" }), _jsx("th", { children: "Source IP" }), _jsx("th", { children: "Dest IP" }), _jsx("th", { children: "Status" }), _jsx("th", { children: "Source" }), _jsx("th", { children: "Updated" }), _jsx("th", { children: "Action" })] }) }), _jsx("tbody", { children: filteredTickets.map(t => (_jsxs(React.Fragment, { children: [_jsxs("tr", { className: expandedTicketId === t.ticket_id ? 'expanded' : '', onClick: () => setExpandedTicketId(expandedTicketId === t.ticket_id ? null : t.ticket_id), children: [_jsx("td", { className: "id-col", children: t.ticket_id }), _jsx("td", { className: "summary-col", children: t.summary }), _jsx("td", { children: t.project }), _jsx("td", { children: t.src_ip || '-' }), _jsx("td", { children: t.dest_ip || '-' }), _jsx("td", { children: _jsx("span", { className: "status-pill", style: { backgroundColor: getStatusColor(t.ticket_status) + '22', color: getStatusColor(t.ticket_status), borderColor: getStatusColor(t.ticket_status) + '44' }, children: t.ticket_status }) }), _jsx("td", { className: "source-col", children: _jsx("span", { className: `source-tag tag-${t.source}`, children: t.source }) }), _jsx("td", { className: "date-col", children: new Date(t.updated_at).toLocaleDateString() }), _jsx("td", { children: _jsx("button", { className: "view-btn", children: "View" }) })] }), expandedTicketId === t.ticket_id && (_jsx("tr", { className: "detail-row", children: _jsx("td", { colSpan: 9, children: _jsx("div", { className: "ticket-details", children: _jsxs("div", { className: "detail-grid", children: [_jsxs("div", { className: "detail-section", children: [_jsx("h4", { children: "Ticket Info" }), _jsxs("div", { className: "detail-info-list", children: [_jsxs("div", { className: "detail-item", children: [_jsx("span", { className: "detail-label", children: "Case ID:" }), _jsx("span", { className: "detail-value", children: t.case_id || 'N/A' })] }), _jsxs("div", { className: "detail-item", children: [_jsx("span", { className: "detail-label", children: "Project:" }), _jsx("span", { className: "detail-value", children: t.project })] }), _jsxs("div", { className: "detail-item", children: [_jsx("span", { className: "detail-label", children: "Category:" }), _jsx("span", { className: "detail-value", children: t.category })] }), _jsxs("div", { className: "detail-item", children: [_jsx("span", { className: "detail-label", children: "Reporter:" }), _jsx("span", { className: "detail-value", children: t.reporter })] }), _jsxs("div", { className: "detail-item", children: [_jsx("span", { className: "detail-label", children: "Created At:" }), _jsx("span", { className: "detail-value", children: new Date(t.created_at).toLocaleString() })] })] })] }), _jsxs("div", { className: "detail-section", children: [_jsx("h4", { children: "Network Context" }), _jsxs("div", { className: "detail-info-list", children: [_jsxs("div", { className: "detail-item", children: [_jsx("span", { className: "detail-label", children: "Source IP:" }), _jsx("span", { className: "detail-value code", children: t.src_ip || 'N/A' })] }), _jsxs("div", { className: "detail-item", children: [_jsx("span", { className: "detail-label", children: "Dest IP:" }), _jsx("span", { className: "detail-value code", children: t.dest_ip || 'N/A' })] }), _jsxs("div", { className: "detail-item", children: [_jsx("span", { className: "detail-label", children: "Dest Port:" }), _jsx("span", { className: "detail-value", children: t.dest_port || 'N/A' })] }), _jsxs("div", { className: "detail-item", children: [_jsx("span", { className: "detail-label", children: "Target Host:" }), _jsx("span", { className: "detail-value", children: t.target_host || 'N/A' })] }), _jsxs("div", { className: "detail-item", children: [_jsx("span", { className: "detail-label", children: "Target URL:" }), _jsx("span", { className: "detail-value", children: t.target_url || 'N/A' })] })] })] }), _jsxs("div", { className: "detail-section", children: [_jsx("h4", { children: "Signature & Time" }), _jsxs("div", { className: "detail-info-list", children: [_jsxs("div", { className: "detail-item", children: [_jsx("span", { className: "detail-label", children: "Signature:" }), _jsx("span", { className: "detail-value", children: t.signature || 'N/A' })] }), _jsxs("div", { className: "detail-item", children: [_jsx("span", { className: "detail-label", children: "First Seen:" }), _jsx("span", { className: "detail-value", children: t.first_seen ? new Date(t.first_seen).toLocaleString() : 'N/A' })] }), _jsxs("div", { className: "detail-item", children: [_jsx("span", { className: "detail-label", children: "Last Seen:" }), _jsx("span", { className: "detail-value", children: t.last_seen ? new Date(t.last_seen).toLocaleString() : 'N/A' })] }), _jsxs("div", { className: "detail-item", children: [_jsx("span", { className: "detail-label", children: "Source:" }), _jsx("span", { className: `source-tag tag-${t.source}`, children: t.source })] })] })] }), _jsxs("div", { className: "detail-section", children: [_jsx("h4", { children: "Analyst Memory" }), _jsxs("div", { className: "detail-info-list", children: [_jsxs("div", { className: "detail-item", children: [_jsx("span", { className: "detail-label", children: "Decision:" }), _jsx("span", { className: "detail-value", style: { color: 'var(--accent-color)', fontWeight: 'bold' }, children: t.decision || 'No decision recorded' })] }), _jsxs("div", { className: "detail-item", children: [_jsx("span", { className: "detail-label", children: "Reason:" }), _jsx("span", { className: "detail-value", children: t.decision_reason || 'N/A' })] }), _jsxs("div", { className: "detail-item", children: [_jsx("span", { className: "detail-label", children: "Reuse Note:" }), _jsx("span", { className: "detail-value", children: t.reuse_note || 'N/A' })] }), _jsxs("div", { className: "detail-item", children: [_jsx("span", { className: "detail-label", children: "Reviewed By:" }), _jsx("span", { className: "detail-value", children: t.reviewed_by || 'N/A' })] })] })] }), _jsxs("div", { className: "detail-section actions", children: [_jsx("h4", { children: "Investigation Links" }), _jsxs("div", { className: "link-buttons", children: [_jsx("a", { href: t.ticket_url, target: "_blank", rel: "noreferrer", className: "link-btn mantis", children: _jsx("span", { children: "Mantis Ticket" }) }), t.opensearch_link && (_jsx("a", { href: t.opensearch_link, target: "_blank", rel: "noreferrer", className: "link-btn opensearch", children: _jsx("span", { children: "OpenSearch Context" }) })), _jsx("button", { className: "link-btn copy-filter", onClick: (e) => {
                                                                                e.stopPropagation();
                                                                                const filter = generateOpenSearchFilter(t);
                                                                                copyToClipboard(filter);
                                                                            }, children: _jsx("span", { children: "Copy Filter" }) })] })] }), t.notes && t.notes.length > 0 && (_jsxs("div", { className: "notes-section", children: [_jsxs("h4", { children: ["Ticket Notes (", t.notes.length, ")"] }), _jsx("div", { className: "notes-list", children: t.notes.map((note, idx) => (_jsxs("div", { className: "note-item", children: [_jsxs("div", { className: "note-header", children: [_jsx("span", { className: "note-reporter", children: note.reporter }), _jsx("span", { className: "note-date", children: new Date(note.created_at).toLocaleString() })] }), _jsx("div", { className: "note-text", children: note.text })] }, note.id || idx))) })] }))] }) }) }) }))] }, t.ticket_id))) })] }) })), showManualModal && (_jsx("div", { className: "modal-overlay", children: _jsxs("div", { className: "modal-content", children: [_jsxs("header", { children: [_jsx("h3", { children: "Add Ticket Manually" }), _jsx("button", { className: "close-btn", onClick: () => setShowManualModal(false), children: "\u00D7" })] }), _jsxs("form", { onSubmit: handleManualSubmit, children: [_jsxs("div", { className: "form-grid", children: [_jsxs("div", { className: "form-group", children: [_jsx("label", { children: "Ticket ID *" }), _jsx("input", { type: "number", required: true, value: manualForm.ticket_id || '', onChange: e => setManualForm({ ...manualForm, ticket_id: parseInt(e.target.value) }) })] }), _jsxs("div", { className: "form-group", children: [_jsx("label", { children: "Project *" }), _jsx("input", { type: "text", required: true, value: manualForm.project, onChange: e => setManualForm({ ...manualForm, project: e.target.value }) })] }), _jsxs("div", { className: "form-group full-width", children: [_jsx("label", { children: "Summary *" }), _jsx("input", { type: "text", required: true, value: manualForm.summary, onChange: e => setManualForm({ ...manualForm, summary: e.target.value }) })] }), _jsxs("div", { className: "form-group", children: [_jsx("label", { children: "Category" }), _jsx("input", { type: "text", value: manualForm.category, onChange: e => setManualForm({ ...manualForm, category: e.target.value }) })] }), _jsxs("div", { className: "form-group", children: [_jsx("label", { children: "Status" }), _jsxs("select", { value: manualForm.ticket_status, onChange: e => setManualForm({ ...manualForm, ticket_status: e.target.value }), children: [_jsx("option", { value: "new", children: "New" }), _jsx("option", { value: "assigned", children: "Assigned" }), _jsx("option", { value: "feedback", children: "Feedback" }), _jsx("option", { value: "resolved", children: "Resolved" }), _jsx("option", { value: "closed", children: "Closed" })] })] }), _jsxs("div", { className: "form-group", children: [_jsx("label", { children: "Reporter" }), _jsx("input", { type: "text", value: manualForm.reporter || '', onChange: e => setManualForm({ ...manualForm, reporter: e.target.value }) })] }), _jsxs("div", { className: "form-group", children: [_jsx("label", { children: "Source IP" }), _jsx("input", { type: "text", value: manualForm.src_ip || '', onChange: e => setManualForm({ ...manualForm, src_ip: e.target.value }) })] }), _jsxs("div", { className: "form-group", children: [_jsx("label", { children: "Dest IP" }), _jsx("input", { type: "text", value: manualForm.dest_ip || '', onChange: e => setManualForm({ ...manualForm, dest_ip: e.target.value }) })] }), _jsxs("div", { className: "form-group", children: [_jsx("label", { children: "Dest Port" }), _jsx("input", { type: "number", value: manualForm.dest_port || '', onChange: e => setManualForm({ ...manualForm, dest_port: parseInt(e.target.value) }) })] }), _jsxs("div", { className: "form-group", children: [_jsx("label", { children: "Target Host" }), _jsx("input", { type: "text", value: manualForm.target_host || '', onChange: e => setManualForm({ ...manualForm, target_host: e.target.value }) })] }), _jsxs("div", { className: "form-group span-2", children: [_jsx("label", { children: "Target URL" }), _jsx("input", { type: "text", value: manualForm.target_url || '', onChange: e => setManualForm({ ...manualForm, target_url: e.target.value }) })] }), _jsxs("div", { className: "form-group full-width", children: [_jsx("label", { children: "Signature" }), _jsx("input", { type: "text", value: manualForm.signature || '', onChange: e => setManualForm({ ...manualForm, signature: e.target.value }) })] }), _jsxs("div", { className: "form-group full-width", children: [_jsx("label", { children: "OpenSearch Link" }), _jsx("input", { type: "text", value: manualForm.opensearch_link || '', onChange: e => setManualForm({ ...manualForm, opensearch_link: e.target.value }) })] }), _jsxs("div", { className: "form-group", children: [_jsx("label", { children: "Decision" }), _jsx("input", { type: "text", value: manualForm.decision || '', onChange: e => setManualForm({ ...manualForm, decision: e.target.value }) })] }), _jsxs("div", { className: "form-group", children: [_jsx("label", { children: "Reviewed By" }), _jsx("input", { type: "text", value: manualForm.reviewed_by || '', onChange: e => setManualForm({ ...manualForm, reviewed_by: e.target.value }) })] }), _jsxs("div", { className: "form-group", children: [_jsx("label", { children: "Case ID (Internal)" }), _jsx("input", { type: "text", value: manualForm.case_id || '', onChange: e => setManualForm({ ...manualForm, case_id: e.target.value }) })] }), _jsxs("div", { className: "form-group full-width", children: [_jsx("label", { children: "Decision Reason" }), _jsx("textarea", { value: manualForm.decision_reason || '', onChange: e => setManualForm({ ...manualForm, decision_reason: e.target.value }), rows: 2 })] }), _jsxs("div", { className: "form-group full-width", children: [_jsx("label", { children: "Reuse Note" }), _jsx("textarea", { value: manualForm.reuse_note || '', onChange: e => setManualForm({ ...manualForm, reuse_note: e.target.value }), rows: 2 })] })] }), _jsxs("footer", { children: [_jsx("button", { type: "button", className: "secondary-btn", onClick: () => setShowManualModal(false), children: "Cancel" }), _jsx("button", { type: "submit", className: "primary-btn", children: "Save Ticket" })] })] })] }) })), _jsx("style", { children: `
                :root {
                    --bg-dark: #0d1117;
                    --bg-card: #161b22;
                    --bg-card-hover: #21262d;
                    --border-color: #30363d;
                    --text-primary: #f0f6fc;
                    --text-secondary: #8b949e;
                    --accent-color: #58a6ff;
                    --success-color: #238636;
                    --warning-color: #d29922;
                    --error-color: #f85149;
                    --header-bg: #161b22;
                }

                .TicketsPage {
                    padding: 20px 30px;
                    background-color: var(--bg-dark);
                    color: var(--text-primary);
                    flex: 1;
                    overflow-y: auto;
                    min-height: 100%;
                }
                .page-header {
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    margin-bottom: 25px;
                }
                .header-info h2 { margin: 0; font-size: 24px; color: var(--accent-color); }
                .subtitle { color: var(--text-secondary); margin: 5px 0 0; font-size: 14px; }
                .header-actions { display: flex; gap: 12px; }
                
                .filters-bar {
                    display: flex;
                    gap: 15px;
                    margin-bottom: 20px;
                    padding: 15px;
                    background-color: var(--bg-card);
                    border-radius: 8px;
                    border: 1px solid var(--border-color);
                }
                .search-box { flex: 1; }
                .search-box input {
                    width: 100%;
                    background: var(--bg-dark);
                    border: 1px solid var(--border-color);
                    padding: 10px 12px;
                    border-radius: 6px;
                    color: white;
                    outline: none;
                }
                .search-box input:focus { border-color: var(--accent-color); }
                .select-group { display: flex; gap: 10px; }
                .select-group select {
                    background: var(--bg-dark);
                    border: 1px solid var(--border-color);
                    padding: 10px;
                    border-radius: 6px;
                    color: white;
                    outline: none;
                }

                .tickets-table-container {
                    background-color: var(--bg-card);
                    border-radius: 8px;
                    border: 1px solid var(--border-color);
                    overflow: hidden;
                }
                .tickets-table {
                    width: 100%;
                    border-collapse: collapse;
                    text-align: left;
                }
                .tickets-table th {
                    background-color: var(--header-bg);
                    padding: 12px 15px;
                    font-size: 12px;
                    color: var(--text-secondary);
                    text-transform: uppercase;
                    border-bottom: 1px solid var(--border-color);
                    letter-spacing: 0.5px;
                }
                .tickets-table td {
                    padding: 14px 15px;
                    border-bottom: 1px solid var(--border-color);
                    font-size: 14px;
                }
                .tickets-table tbody tr { cursor: pointer; transition: background 0.2s; }
                .tickets-table tbody tr:hover { background-color: var(--bg-card-hover); }
                .tickets-table tbody tr.expanded { background-color: rgba(88, 166, 255, 0.05); }
                
                .id-col { color: var(--accent-color); font-weight: 600; font-family: monospace; }
                .summary-col { max-width: 350px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
                .status-pill {
                    padding: 3px 10px;
                    border-radius: 20px;
                    font-size: 11px;
                    font-weight: 600;
                    text-transform: uppercase;
                    border: 1px solid transparent;
                }
                .source-tag {
                    padding: 3px 8px;
                    border-radius: 4px;
                    font-size: 11px;
                    background-color: #30363d;
                    color: #c9d1d9;
                    font-weight: 600;
                    text-transform: capitalize;
                }
                .tag-manual { color: #f2cc60; background-color: rgba(242, 204, 96, 0.1); }
                .tag-created { color: #a371f7; background-color: rgba(163, 113, 247, 0.1); }
                .tag-synced { color: #58a6ff; background-color: rgba(88, 166, 255, 0.1); }
                
                .detail-row { background-color: #0d1117; }
                .ticket-details { padding: 25px; border-top: 2px solid var(--accent-color); }
                .detail-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 30px; }
                .detail-section h4 { margin: 0 0 15px; color: var(--accent-color); border-bottom: 1px solid #30363d; padding-bottom: 8px; font-size: 15px; text-transform: uppercase; letter-spacing: 1px; }
                .detail-info-list { display: flex; flex-direction: column; gap: 10px; }
                .detail-item { display: flex; font-size: 13px; line-height: 1.5; }
                .detail-label { color: var(--text-secondary); width: 130px; min-width: 130px; font-weight: 500; }
                .detail-value { color: var(--text-primary); overflow-wrap: break-word; word-break: break-all; }
                .detail-value.code { font-family: monospace; background: #21262d; padding: 2px 4px; border-radius: 3px; }
                
                .notes-section {
                    grid-column: span 3;
                    margin-top: 10px;
                    background: rgba(0,0,0,0.2);
                    padding: 15px;
                    border-radius: 8px;
                    border: 1px solid var(--border-color);
                }
                .note-item {
                    padding-bottom: 12px;
                    margin-bottom: 12px;
                    border-bottom: 1px solid var(--border-color);
                }
                .note-item:last-child {
                    border-bottom: none;
                    margin-bottom: 0;
                    padding-bottom: 0;
                }
                .note-header {
                    display: flex;
                    justify-content: space-between;
                    font-size: 11px;
                    color: var(--text-secondary);
                    margin-bottom: 5px;
                }
                .note-reporter { font-weight: 700; color: var(--accent-color); }
                .note-text { font-size: 13px; line-height: 1.6; color: var(--text-primary); white-space: pre-wrap; }
                
                .link-buttons { display: flex; gap: 12px; margin-top: 15px; }
                .link-btn {
                    padding: 10px 18px;
                    border-radius: 6px;
                    text-align: center;
                    text-decoration: none;
                    font-size: 13px;
                    font-weight: 600;
                    display: inline-flex;
                    align-items: center;
                    gap: 8px;
                    transition: opacity 0.2s;
                }
                .link-btn:hover { opacity: 0.9; }
                .link-btn.mantis { background-color: #238636; color: white; }
                .link-btn.opensearch { background-color: #1f6feb; color: white; }
                .link-btn.copy-filter { background-color: #6e7681; color: white; border: none; cursor: pointer; }
                .link-btn.copy-filter:hover { background-color: #8b949e; }

                /* Common buttons */
                .primary-btn { background-color: #238636; color: white; border: none; padding: 10px 20px; border-radius: 6px; cursor: pointer; font-weight: 600; font-size: 14px; }
                .secondary-btn { background-color: transparent; color: var(--text-primary); border: 1px solid var(--border-color); padding: 10px 20px; border-radius: 6px; cursor: pointer; font-weight: 600; font-size: 14px; }
                .primary-btn:hover { background-color: #2ea043; }
                .secondary-btn:hover { border-color: #8b949e; background-color: #21262d; }
                .primary-btn:disabled { opacity: 0.6; cursor: not-allowed; }
                
                .view-btn { background: #21262d; color: var(--text-primary); border: 1px solid var(--border-color); padding: 5px 12px; border-radius: 4px; font-size: 12px; cursor: pointer; }
                .view-btn:hover { border-color: var(--accent-color); }

                /* Modal */
                .modal-overlay {
                    position: fixed;
                    top: 0; left: 0; right: 0; bottom: 0;
                    background: rgba(0,0,0,0.85);
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    z-index: 1000;
                    backdrop-filter: blur(4px);
                }
                .modal-content {
                    background: var(--bg-card);
                    width: 750px;
                    max-width: 95vw;
                    max-height: 90vh;
                    border-radius: 12px;
                    border: 1px solid var(--border-color);
                    display: flex;
                    flex-direction: column;
                    box-shadow: 0 20px 50px rgba(0,0,0,0.5);
                }
                .modal-content header {
                    padding: 20px 25px;
                    border-bottom: 1px solid var(--border-color);
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                }
                .modal-content header h3 { margin: 0; font-size: 20px; color: var(--accent-color); }
                .close-btn { background: none; border: none; color: var(--text-secondary); font-size: 28px; cursor: pointer; line-height: 1; }
                .modal-content form { padding: 25px; overflow-y: auto; }
                .form-grid { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 20px; }
                .form-group { display: flex; flex-direction: column; gap: 8px; }
                .span-2 { grid-column: span 2; }
                .full-width { grid-column: span 3; }
                .form-group label { font-size: 13px; color: var(--text-secondary); font-weight: 500; }
                .form-group input, .form-group select, .form-group textarea {
                    background: var(--bg-dark);
                    border: 1px solid var(--border-color);
                    padding: 10px;
                    border-radius: 6px;
                    color: white;
                    font-size: 14px;
                    outline: none;
                }
                .form-group input:focus, .form-group select:focus, .form-group textarea:focus { border-color: var(--accent-color); }
                .modal-content footer {
                    padding: 20px 25px;
                    border-top: 1px solid var(--border-color);
                    display: flex;
                    justify-content: flex-end;
                    gap: 15px;
                }
            ` })] }));
};
export default TicketsPage;
