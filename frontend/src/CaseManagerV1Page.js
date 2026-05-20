import React, { useEffect, useRef, useState } from 'react';

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL || 'http://localhost:5000';
const LAST_HOUR_RANGE = 'now-1h';

function formatDateTime(value) {
    if (!value) {
        return 'N/A';
    }

    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString();
}

function buildCaseSummaryBits(caseItem) {
    const affectedSources = Array.isArray(caseItem.affected_src_ips) ? caseItem.affected_src_ips.length : 0;

    return [
        caseItem.local_rank ? `AI Rank #${caseItem.local_rank}` : null,
        typeof caseItem.local_rank_score === 'number' ? `Local ${caseItem.local_rank_score}` : null,
        affectedSources > 1 ? `${affectedSources} sources` : (caseItem.src_ip ? `Src ${caseItem.src_ip}` : null),
        caseItem.dest_port ? `Port ${caseItem.dest_port}` : null,
        caseItem.child_group_count ? `${caseItem.child_group_count} groups` : null,
        caseItem.priority_score ? `Score ${caseItem.priority_score}` : null,
    ].filter(Boolean);
}

function buildCaseContextLine(caseItem) {
    const affectedSources = Array.isArray(caseItem.affected_src_ips) ? caseItem.affected_src_ips.length : 0;
    const affectedIps = Array.isArray(caseItem.affected_dest_ips) ? caseItem.affected_dest_ips.length : 0;
    const affectedHosts = Array.isArray(caseItem.affected_hosts) ? caseItem.affected_hosts.length : 0;

    return [
        affectedSources > 0 ? `${affectedSources} source IPs` : null,
        affectedIps > 0 ? `${affectedIps} IPs` : null,
        affectedHosts > 0 ? `${affectedHosts} hosts` : null,
        caseItem.last_seen ? `Last ${formatDateTime(caseItem.last_seen)}` : null,
    ].filter(Boolean).join('  •  ');
}

function isActiveStage(stage) {
    return [
        'starting',
        'authenticating',
        'authenticated',
        'window_shifted',
        'categorizing',
        'investigation_queue',
        'investigating_case',
        'executing_pivot',
        'reassessing_case',
    ].includes(stage);
}

function buildInvestigationLabel(caseItem) {
    const investigation = caseItem.auto_investigation;
    if (!investigation) {
        return null;
    }

    if (investigation.verdict) {
        return `${investigation.verdict} • ${investigation.pivots_executed || 0} pivots`;
    }

    return `${investigation.status || 'investigated'} • ${investigation.pivots_executed || 0} pivots`;
}

function formatConfidence(value) {
    if (typeof value !== 'number') {
        return null;
    }

    return `${Math.round(value * 100)}%`;
}

export default function CaseManagerV1Page() {
    const [cases, setCases] = useState([]);
    const [loading, setLoading] = useState(false);
    const [stopRequested, setStopRequested] = useState(false);
    const [error, setError] = useState(null);
    const [lastUpdated, setLastUpdated] = useState(null);
    const [liveEvents, setLiveEvents] = useState([]);
    const [currentMessage, setCurrentMessage] = useState('No Case Manager v1 run has been started');
    const [currentStage, setCurrentStage] = useState('idle');
    const [currentCaseId, setCurrentCaseId] = useState(null);
    const [currentCaseSignature, setCurrentCaseSignature] = useState(null);
    const [activeWindow, setActiveWindow] = useState(LAST_HOUR_RANGE);
    const abortRef = useRef(null);
    const isRunActive = loading || stopRequested || isActiveStage(currentStage);

    useEffect(() => {
        let mounted = true;

        const loadStatus = async () => {
            try {
                const response = await fetch(`${BACKEND_URL}/api/cases-v1/status`);
                if (!response.ok) {
                    return;
                }

                const payload = await response.json();
                const pipeline = payload.pipeline || {};
                if (!mounted) {
                    return;
                }

                setLoading(Boolean(pipeline.is_running) || isActiveStage(pipeline.current_stage || 'idle'));
                setStopRequested(Boolean(pipeline.stop_requested));
                setCurrentStage(pipeline.current_stage || 'idle');
                setCurrentMessage(pipeline.current_message || 'No Case Manager v1 run has been started');
                setCurrentCaseId(pipeline.current_case_id || null);
                setCurrentCaseSignature(pipeline.current_case_signature || null);
                setActiveWindow(pipeline.time_range || LAST_HOUR_RANGE);
                setLastUpdated(pipeline.last_saved_output_at || pipeline.last_completed_at || pipeline.last_started_at || null);
                setLiveEvents(Array.isArray(pipeline.recent_events) ? pipeline.recent_events.slice(0, 16) : []);
                setError(null);

                const nextCases = Array.isArray(pipeline.result?.cases) ? pipeline.result.cases : [];
                setCases(nextCases);
            } catch (err) {
                if (mounted) {
                    setError((current) => current || 'Unable to load Case Manager v1 status');
                }
            }
        };

        loadStatus();
        const intervalId = window.setInterval(loadStatus, 2000);

        return () => {
            mounted = false;
            window.clearInterval(intervalId);
            if (abortRef.current) {
                abortRef.current.abort();
            }
        };
    }, []);

    const handleLaunch = async () => {
        if (abortRef.current) {
            abortRef.current.abort();
        }

        const controller = new AbortController();
        abortRef.current = controller;
        setLoading(true);
        setStopRequested(false);
        setError(null);
        setCurrentStage('starting');
        setCurrentMessage('Starting last-hour OpenSearch grouping run');
        setCurrentCaseId(null);
        setCurrentCaseSignature(null);
        setActiveWindow(LAST_HOUR_RANGE);
        setLiveEvents([]);

        try {
            const response = await fetch(`${BACKEND_URL}/api/cases-v1/start`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    timeRange: LAST_HOUR_RANGE,
                }),
                signal: controller.signal,
            });

            const payload = await response.json().catch(() => ({}));
            if (!response.ok) {
                throw new Error(payload.message || 'Failed to launch automated agent');
            }
        } catch (err) {
            if (err.name === 'AbortError') {
                setError('Launch request was interrupted.');
            } else {
                setError(err.message);
                setLoading(false);
            }
        } finally {
            if (abortRef.current === controller) {
                abortRef.current = null;
            }
        }
    };

    const handleSafetyStop = async () => {
        setStopRequested(true);
        setCurrentMessage('Safety stop requested. Waiting for current checkpoint.');

        if (abortRef.current) {
            abortRef.current.abort();
            abortRef.current = null;
        }

        try {
            await fetch(`${BACKEND_URL}/api/cases-v1/stop`, {
                method: 'POST',
            });
        } catch (err) {
            setError('Safety stop request failed');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="CaseManagerV1Page">
            <section className="cmv1-shell">
                <div className="cmv1-hero">
                    <span className="cmv1-kicker">Case Manager v1</span>
                    <h2>Last-Hour OpenSearch Cases</h2>
                    <p>
                        Launch uses the same OpenSearch triage grouping path as the dashboard analyze flow,
                        but restricts it to the last hour and shows each grouped case directly.
                    </p>
                </div>

                <div className="cmv1-actions">
                    <button
                        type="button"
                        className="cmv1-launch"
                        onClick={handleLaunch}
                        disabled={isRunActive}
                    >
                        {isRunActive ? 'Agent Running...' : 'Launch Automated Agent'}
                    </button>
                    <button
                        type="button"
                        className="cmv1-stop"
                        onClick={handleSafetyStop}
                        disabled={!isRunActive && !abortRef.current}
                    >
                        {stopRequested ? 'Stopping...' : 'Safety Stop'}
                    </button>
                </div>

                <div className="cmv1-status">
                    <div className="cmv1-status-item">
                        <span>Window</span>
                        <strong>{typeof activeWindow === 'string' ? activeWindow : `${activeWindow.gte || 'N/A'} -> ${activeWindow.lte || 'N/A'}`}</strong>
                    </div>
                    <div className="cmv1-status-item">
                        <span>Cases</span>
                        <strong>{cases.length}</strong>
                    </div>
                    <div className="cmv1-status-item">
                        <span>Last Updated</span>
                        <strong>{formatDateTime(lastUpdated)}</strong>
                    </div>
                </div>

                {error && <div className="cmv1-error">{error}</div>}

                <div className="cmv1-layout">
                    <aside className="cmv1-feed-panel">
                        <div className="cmv1-results-header">
                            <h3>Live Feed</h3>
                            <span>{liveEvents.length} event(s)</span>
                        </div>

                        <div className="cmv1-feed-current">
                            <span>Current Stage</span>
                            <strong>{currentStage}</strong>
                            <p>{currentMessage}</p>
                            {currentCaseId && (
                                <div className="cmv1-current-case">
                                    <span>Active Case</span>
                                    <strong>{currentCaseId}</strong>
                                    {currentCaseSignature && (
                                        <p title={currentCaseSignature}>{currentCaseSignature}</p>
                                    )}
                                </div>
                            )}
                        </div>

                        <div className="cmv1-feed-list">
                            {liveEvents.length === 0 ? (
                                <div className="cmv1-empty">
                                    {isRunActive
                                        ? 'Waiting for category progress events...'
                                        : 'No live feed entries yet.'}
                                </div>
                            ) : (
                                liveEvents.map((event) => (
                                    <article key={`${event.at}-${event.stage}-${event.message}`} className="cmv1-feed-event">
                                        <div className="cmv1-feed-event-top">
                                            <span>{event.stage}</span>
                                            <time>{formatDateTime(event.at)}</time>
                                        </div>
                                        <p>{event.message}</p>
                                        {event.category_name && (
                                            <div className="cmv1-feed-meta">
                                                <span>{event.category_name}</span>
                                                {typeof event.grouped_cases === 'number' && <span>{event.grouped_cases} case(s)</span>}
                                                {typeof event.total_matches === 'number' && <span>{event.total_matches} matches</span>}
                                            </div>
                                        )}
                                    </article>
                                ))
                            )}
                        </div>
                    </aside>

                    <section className="cmv1-results">
                        <div className="cmv1-results-header">
                            <h3>Grouped Cases</h3>
                            <span>{cases.length} case(s)</span>
                        </div>

                        {cases.length === 0 ? (
                            <div className="cmv1-empty">
                                {isRunActive
                                    ? 'Collecting and grouping last-hour OpenSearch cases...'
                                    : 'No grouped cases loaded yet.'}
                            </div>
                        ) : (
                                <div className="cmv1-case-list">
                                    {cases.map((caseItem) => (
                                    <article
                                        key={caseItem.case_id}
                                        className={`cmv1-case-card${currentCaseId === caseItem.case_id ? ' cmv1-case-card-active' : ''}`}
                                    >
                                        <div className="cmv1-case-top">
                                            <div className="cmv1-case-title">
                                                <span className="cmv1-case-category">{caseItem.category_name}</span>
                                                <h4 title={caseItem.signature || 'Unknown Signature'}>{caseItem.signature || 'Unknown Signature'}</h4>
                                            </div>
                                            <div className="cmv1-case-count">{caseItem.log_count || 0} logs</div>
                                        </div>

                                        <div className="cmv1-case-summary">
                                            {buildCaseSummaryBits(caseItem).map((bit) => (
                                                <span key={`${caseItem.case_id}-${bit}`} className="cmv1-case-pill">{bit}</span>
                                            ))}
                                            {buildInvestigationLabel(caseItem) && (
                                                <span className="cmv1-case-pill cmv1-case-pill-investigation">
                                                    {buildInvestigationLabel(caseItem)}
                                                </span>
                                            )}
                                        </div>

                                        <p className="cmv1-case-context">
                                            {buildCaseContextLine(caseItem)}
                                        </p>

                                        {caseItem.auto_investigation && (
                                            <div className="cmv1-investigation-result">
                                                <div className="cmv1-investigation-top">
                                                    <span className={`cmv1-verdict-badge cmv1-verdict-${String(caseItem.auto_investigation.verdict || 'unknown').toLowerCase()}`}>
                                                        {caseItem.auto_investigation.verdict || caseItem.auto_investigation.status || 'Investigated'}
                                                    </span>
                                                    <span className="cmv1-investigation-meta">
                                                        {caseItem.auto_investigation.classification || 'Unclassified'}
                                                        {formatConfidence(caseItem.auto_investigation.confidence) && ` • ${formatConfidence(caseItem.auto_investigation.confidence)}`}
                                                        {` • ${caseItem.auto_investigation.pivots_executed || 0} pivots`}
                                                    </span>
                                                </div>
                                                {caseItem.auto_investigation.assessment && (
                                                    <p className="cmv1-investigation-text" title={caseItem.auto_investigation.assessment}>
                                                        {caseItem.auto_investigation.assessment}
                                                    </p>
                                                )}
                                            </div>
                                        )}
                                    </article>
                                ))}
                            </div>
                        )}
                    </section>
                </div>
            </section>

            <style>{`
                .CaseManagerV1Page {
                    width: 100%;
                    height: 100%;
                    min-height: 0;
                    box-sizing: border-box;
                    padding: 20px 24px 24px;
                    overflow: hidden;
                    background:
                        radial-gradient(circle at top left, rgba(80, 164, 255, 0.12), transparent 30%),
                        linear-gradient(180deg, #08111b 0%, #0c1725 100%);
                    color: var(--text-primary);
                }

                .cmv1-shell {
                    height: 100%;
                    min-height: 0;
                    max-width: 1320px;
                    margin: 0 auto;
                    display: grid;
                    grid-template-rows: auto auto auto minmax(0, 1fr);
                    gap: 16px;
                }

                .cmv1-hero,
                .cmv1-status,
                .cmv1-feed-panel,
                .cmv1-results,
                .cmv1-error {
                    border: 1px solid rgba(255, 255, 255, 0.08);
                    border-radius: 18px;
                    background: rgba(7, 15, 24, 0.84);
                    box-shadow: 0 20px 40px rgba(0, 0, 0, 0.24);
                }

                .cmv1-hero,
                .cmv1-results {
                    padding: 24px;
                }

                .cmv1-feed-panel {
                    min-height: 0;
                    padding: 20px;
                    display: flex;
                    flex-direction: column;
                    overflow: hidden;
                }

                .cmv1-kicker {
                    display: inline-block;
                    margin-bottom: 10px;
                    font-size: 11px;
                    letter-spacing: 0.16em;
                    text-transform: uppercase;
                    color: #7bb5ff;
                }

                .cmv1-hero h2 {
                    margin: 0 0 10px;
                    font-size: 30px;
                    line-height: 1.08;
                }

                .cmv1-hero p {
                    margin: 0;
                    max-width: 860px;
                    color: var(--text-secondary);
                    line-height: 1.6;
                }

                .cmv1-actions {
                    display: grid;
                    grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
                    gap: 16px;
                }

                .cmv1-launch,
                .cmv1-stop {
                    min-height: 68px;
                    border-radius: 16px;
                    font-size: 17px;
                    font-weight: 700;
                    cursor: pointer;
                    transition: transform 0.18s ease, box-shadow 0.18s ease, opacity 0.18s ease;
                }

                .cmv1-launch {
                    border: none;
                    background: linear-gradient(135deg, #2c9bff 0%, #135dc1 100%);
                    color: #ffffff;
                    box-shadow: 0 18px 32px rgba(19, 93, 193, 0.34);
                }

                .cmv1-stop {
                    border: 1px solid rgba(255, 148, 92, 0.3);
                    background: linear-gradient(135deg, #5d2a13 0%, #9f4614 100%);
                    color: #ffe7d5;
                    box-shadow: 0 18px 32px rgba(120, 54, 17, 0.24);
                }

                .cmv1-launch:hover:not(:disabled),
                .cmv1-stop:hover:not(:disabled) {
                    transform: translateY(-1px);
                }

                .cmv1-launch:disabled,
                .cmv1-stop:disabled {
                    opacity: 0.64;
                    cursor: default;
                }

                .cmv1-status {
                    display: grid;
                    grid-template-columns: repeat(3, minmax(0, 1fr));
                    overflow: hidden;
                }

                .cmv1-status-item {
                    padding: 18px 20px;
                    border-right: 1px solid rgba(255, 255, 255, 0.06);
                }

                .cmv1-status-item:last-child {
                    border-right: none;
                }

                .cmv1-status-item span,
                .cmv1-case-grid span {
                    display: block;
                    margin-bottom: 8px;
                    font-size: 11px;
                    text-transform: uppercase;
                    letter-spacing: 0.12em;
                    color: var(--text-secondary);
                }

                .cmv1-status-item strong,
                .cmv1-case-grid strong {
                    display: block;
                    line-height: 1.45;
                }

                .cmv1-error {
                    padding: 14px 16px;
                    color: #ffb3b3;
                    border-color: rgba(248, 81, 73, 0.28);
                    background: rgba(82, 18, 18, 0.55);
                }

                .cmv1-layout {
                    display: grid;
                    min-height: 0;
                    grid-template-columns: minmax(320px, 0.72fr) minmax(0, 1.28fr);
                    gap: 18px;
                    align-items: stretch;
                }

                .cmv1-results {
                    min-height: 0;
                    display: flex;
                    flex-direction: column;
                    overflow: hidden;
                    min-width: 0;
                }

                .cmv1-results-header {
                    display: flex;
                    align-items: center;
                    justify-content: space-between;
                    gap: 12px;
                    margin-bottom: 16px;
                }

                .cmv1-results-header h3 {
                    margin: 0;
                    color: #7bb5ff;
                }

                .cmv1-results-header span {
                    font-size: 12px;
                    color: var(--text-secondary);
                    text-transform: uppercase;
                    letter-spacing: 0.08em;
                }

                .cmv1-empty {
                    padding: 18px;
                    border-radius: 14px;
                    border: 1px solid rgba(255, 255, 255, 0.07);
                    background: rgba(255, 255, 255, 0.03);
                    color: var(--text-secondary);
                }

                .cmv1-feed-current {
                    flex: 0 0 auto;
                    margin-bottom: 14px;
                    padding: 14px 16px;
                    border-radius: 14px;
                    border: 1px solid rgba(255, 255, 255, 0.07);
                    background: rgba(255, 255, 255, 0.03);
                }

                .cmv1-feed-current span,
                .cmv1-feed-event-top span {
                    display: block;
                    margin-bottom: 8px;
                    font-size: 11px;
                    text-transform: uppercase;
                    letter-spacing: 0.12em;
                    color: var(--text-secondary);
                }

                .cmv1-feed-current strong {
                    display: block;
                    margin-bottom: 8px;
                    color: #7bb5ff;
                }

                .cmv1-feed-current p,
                .cmv1-feed-event p {
                    margin: 0;
                    line-height: 1.55;
                }

                .cmv1-current-case {
                    margin-top: 12px;
                    padding-top: 12px;
                    border-top: 1px solid rgba(255, 255, 255, 0.08);
                }

                .cmv1-current-case p {
                    margin-top: 6px;
                    color: #d9e8fb;
                    font-size: 12px;
                    line-height: 1.45;
                    display: -webkit-box;
                    -webkit-line-clamp: 2;
                    -webkit-box-orient: vertical;
                    overflow: hidden;
                }

                .cmv1-feed-list {
                    display: grid;
                    gap: 12px;
                    min-height: 0;
                    flex: 1;
                    height: 100%;
                    overflow-y: auto;
                    padding-right: 4px;
                }

                .cmv1-feed-event {
                    padding: 14px 16px;
                    border-radius: 14px;
                    border: 1px solid rgba(255, 255, 255, 0.07);
                    background: rgba(255, 255, 255, 0.03);
                }

                .cmv1-feed-event-top {
                    display: flex;
                    justify-content: space-between;
                    gap: 12px;
                    margin-bottom: 8px;
                }

                .cmv1-feed-event-top time {
                    color: var(--text-secondary);
                    font-size: 11px;
                }

                .cmv1-feed-meta {
                    display: flex;
                    flex-wrap: wrap;
                    gap: 8px;
                    margin-top: 10px;
                }

                .cmv1-feed-meta span {
                    padding: 6px 10px;
                    border-radius: 999px;
                    border: 1px solid rgba(123, 181, 255, 0.16);
                    background: rgba(88, 166, 255, 0.08);
                    color: #cfe5ff;
                    font-size: 11px;
                }

                .cmv1-case-list {
                    display: grid;
                    min-height: 0;
                    flex: 1;
                    height: 100%;
                    gap: 14px;
                    overflow-y: auto;
                    overflow-x: hidden;
                    padding-right: 4px;
                    min-width: 0;
                }

                .cmv1-case-card {
                    border-radius: 16px;
                    border: 1px solid rgba(255, 255, 255, 0.07);
                    background: rgba(255, 255, 255, 0.03);
                    padding: 14px 16px;
                    min-width: 0;
                    transition: border-color 0.18s ease, background 0.18s ease, box-shadow 0.18s ease;
                }

                .cmv1-case-card-active {
                    border-color: rgba(80, 200, 120, 0.34);
                    background: linear-gradient(180deg, rgba(80, 200, 120, 0.12) 0%, rgba(255, 255, 255, 0.04) 100%);
                    box-shadow: 0 0 0 1px rgba(80, 200, 120, 0.12), 0 14px 28px rgba(0, 0, 0, 0.18);
                }

                .cmv1-case-top {
                    display: flex;
                    justify-content: space-between;
                    gap: 12px;
                    align-items: flex-start;
                    margin-bottom: 8px;
                    min-width: 0;
                }

                .cmv1-case-title {
                    min-width: 0;
                    flex: 1 1 auto;
                }

                .cmv1-case-category {
                    display: inline-block;
                    margin-bottom: 4px;
                    font-size: 10px;
                    text-transform: uppercase;
                    letter-spacing: 0.12em;
                    color: #7bb5ff;
                }

                .cmv1-case-top h4 {
                    margin: 0;
                    font-size: 15px;
                    line-height: 1.3;
                    white-space: nowrap;
                    text-overflow: ellipsis;
                    overflow: hidden;
                }

                .cmv1-case-count {
                    white-space: nowrap;
                    font-size: 12px;
                    color: #cfe5ff;
                    border: 1px solid rgba(123, 181, 255, 0.18);
                    background: rgba(88, 166, 255, 0.08);
                    border-radius: 999px;
                    padding: 6px 10px;
                    flex: 0 0 auto;
                }

                .cmv1-case-summary {
                    display: flex;
                    flex-wrap: wrap;
                    gap: 8px;
                    margin-bottom: 8px;
                }

                .cmv1-case-pill {
                    padding: 5px 9px;
                    border-radius: 999px;
                    border: 1px solid rgba(255, 255, 255, 0.08);
                    background: rgba(255, 255, 255, 0.04);
                    color: #d9e8fb;
                    font-size: 11px;
                    line-height: 1.2;
                }

                .cmv1-case-pill-investigation {
                    border-color: rgba(123, 181, 255, 0.18);
                    background: rgba(88, 166, 255, 0.1);
                    color: #cfe5ff;
                }

                .cmv1-case-context {
                    margin: 0;
                    color: var(--text-secondary);
                    font-size: 12px;
                    line-height: 1.45;
                    white-space: nowrap;
                    overflow: hidden;
                    text-overflow: ellipsis;
                }

                .cmv1-investigation-result {
                    margin-top: 10px;
                    padding-top: 10px;
                    border-top: 1px solid rgba(255, 255, 255, 0.06);
                }

                .cmv1-investigation-top {
                    display: flex;
                    align-items: center;
                    justify-content: space-between;
                    gap: 10px;
                    min-width: 0;
                }

                .cmv1-verdict-badge {
                    flex: 0 0 auto;
                    padding: 5px 9px;
                    border-radius: 999px;
                    font-size: 11px;
                    font-weight: 700;
                    letter-spacing: 0.04em;
                    text-transform: uppercase;
                    border: 1px solid rgba(255, 255, 255, 0.08);
                }

                .cmv1-verdict-escalate {
                    background: rgba(248, 81, 73, 0.14);
                    border-color: rgba(248, 81, 73, 0.3);
                    color: #ffb3ae;
                }

                .cmv1-verdict-suspicious_monitor {
                    background: rgba(240, 173, 78, 0.14);
                    border-color: rgba(240, 173, 78, 0.3);
                    color: #ffd69a;
                }

                .cmv1-verdict-likely_false_positive {
                    background: rgba(46, 160, 67, 0.14);
                    border-color: rgba(46, 160, 67, 0.3);
                    color: #9fe3ae;
                }

                .cmv1-investigation-meta {
                    min-width: 0;
                    color: var(--text-secondary);
                    font-size: 11px;
                    text-align: right;
                    white-space: nowrap;
                    overflow: hidden;
                    text-overflow: ellipsis;
                }

                .cmv1-investigation-text {
                    margin: 8px 0 0;
                    color: #d9e8fb;
                    font-size: 12px;
                    line-height: 1.45;
                    display: -webkit-box;
                    -webkit-line-clamp: 2;
                    -webkit-box-orient: vertical;
                    overflow: hidden;
                }

                @media (max-width: 860px) {
                    .CaseManagerV1Page {
                        height: auto;
                        min-height: 100%;
                        overflow-y: auto;
                    }

                    .cmv1-shell {
                        height: auto;
                        min-height: 0;
                        grid-template-rows: auto;
                    }

                    .cmv1-status {
                        grid-template-columns: 1fr;
                    }

                    .cmv1-layout {
                        grid-template-columns: 1fr;
                        min-height: auto;
                    }

                    .cmv1-status-item {
                        border-right: none;
                        border-bottom: 1px solid rgba(255, 255, 255, 0.06);
                    }

                    .cmv1-status-item:last-child {
                        border-bottom: none;
                    }
                }

                @media (max-width: 700px) {
                    .CaseManagerV1Page {
                        padding: 16px 14px 24px;
                    }

                    .cmv1-hero,
                    .cmv1-results,
                    .cmv1-feed-panel {
                        padding: 18px;
                    }

                    .cmv1-hero h2 {
                        font-size: 26px;
                    }

                    .cmv1-case-top {
                        flex-direction: column;
                    }
                }
            `}</style>
        </div>
    );
}
