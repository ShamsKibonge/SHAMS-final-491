import { useState, useEffect, useCallback } from "react";
import "./App.css";
import shamsLogo from "./shams-logo.svg";
import TicketsPage from "./TicketsPage";
import CaseManagerV1Page from "./CaseManagerV1Page";
const BACKEND_URL =
  process.env.REACT_APP_BACKEND_URL || "http://localhost:5000";
function getCountValue(total) {
  if (typeof total === "number") {
    return total;
  }
  if (total && typeof total === "object" && typeof total.value === "number") {
    return total.value;
  }
  return 0;
}
function App() {
  var _a,
    _b,
    _d,
    _e,
    _f,
    _g,
    _h,
    _j,
    _k,
    _l,
    _m,
    _o,
    _p,
    _q,
    _r,
    _s,
    _t,
    _u,
    _v;
  const [currentView, setCurrentView] = useState("dashboard-v1");
  const [telemetrySource] = useState("opensearch");
  const [data, setData] = useState(null);
  const [rawData, setRawData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selectedCategory, setSelectedCategory] = useState(null);
  const [selectedCase, setSelectedCase] = useState(null);
  const [aiAnalyses, setAiAnalyses] = useState({});
  const [aiLoading, setAiLoading] = useState({});
  // New Pivot & Reassessment State
  const [executedPivots, setExecutedPivots] = useState({});
  const [pivotLoading, setPivotLoading] = useState({});
  const [pivotError, setPivotError] = useState({});
  const [latestAiAssessments, setLatestAiAssessments] = useState({});
  const [reassessLoading, setReassessLoading] = useState({});
  const [duplicateResults, setDuplicateResults] = useState({});
  const [duplicateLoading, setDuplicateLoading] = useState({});
  const [ticketPreview, setTicketPreview] = useState(null);
  const [ticketLoading, setTicketLoading] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [createdTickets, setCreatedTickets] = useState({});
  const isDashboardView = currentView === "dashboard-v1";
  const triageApiSuffix = currentView === "dashboard-v1" ? "-v1" : "";
  const sourceQuery = `source=${telemetrySource}`;
  const fetchData = useCallback(async () => {
    setLoading(true);
    const startTime = Date.now();
    try {
      const ts = Date.now();
      const summaryRes = await fetch(
        `${BACKEND_URL}/api/triage-summary${triageApiSuffix}?${sourceQuery}&t=${ts}`,
      );
      if (!summaryRes.ok)
        throw new Error(`Summary API failed (${summaryRes.status})`);
      const contentType = summaryRes.headers.get("content-type");
      if (!contentType || !contentType.includes("application/json")) {
        throw new Error(
          "Summary API returned non-JSON response (likely an HTML error page)",
        );
      }
      const summaryResult = await summaryRes.json();
      const rawRes = await fetch(
        `${BACKEND_URL}/api/triage-raw${triageApiSuffix}?${sourceQuery}&t=${ts}`,
      );
      if (!rawRes.ok) throw new Error(`Raw API failed (${rawRes.status})`);
      const rawResult = await rawRes.json();
      setData(summaryResult);
      setRawData(rawResult);
      // 2. Fetch Ticket History to populate createdTickets state
      const historyRes = await fetch(`${BACKEND_URL}/api/ticket-history`);
      if (historyRes.ok) {
        const historyContentType = historyRes.headers.get("content-type");
        if (
          historyContentType &&
          historyContentType.includes("application/json")
        ) {
          const historyData = await historyRes.json();
          const mapping = {};
          historyData.forEach((h) => {
            mapping[h.case_id] = {
              id: h.ticket_id,
              url: h.ticket_url,
            };
          });
          setCreatedTickets(mapping);
        }
      }
      setError(null);
    } catch (err) {
      console.error("Fetch error:", err);
      setError(err.message);
    } finally {
      // Force loading for at least 5 seconds
      const elapsedTime = Date.now() - startTime;
      const remainingTime = Math.max(0, 5000 - elapsedTime);
      if (remainingTime > 0) {
        await new Promise((resolve) => setTimeout(resolve, remainingTime));
      }
      setLoading(false);
    }
  }, [sourceQuery, triageApiSuffix]);
  const refreshData = async () => {
    setLoading(true);
    const startTime = Date.now();
    setError(null);
    try {
      const response = await fetch(
        `${BACKEND_URL}/api/refresh-triage${triageApiSuffix}?${sourceQuery}`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            source: telemetrySource,
          }),
        },
      );
      if (response.ok) {
        const result = await response.json();
        setData(result.data);
        await fetchData();
      } else {
        let errorMsg = `Refresh failed (${response.status})`;
        try {
          const result = await response.json();
          errorMsg = result.message || errorMsg;
        } catch (e) {
          errorMsg =
            "Refresh failed and returned an HTML error page. Check backend logs.";
        }
        throw new Error(errorMsg);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      const elapsedTime = Date.now() - startTime;
      const remainingTime = Math.max(0, 5000 - elapsedTime);
      if (remainingTime > 0) {
        await new Promise((resolve) => setTimeout(resolve, remainingTime));
      }
      setLoading(false);
    }
  };
  useEffect(() => {
    setSelectedCategory(null);
    setSelectedCase(null);
    setError(null);
  }, [telemetrySource]);
  const normalizeProjectValue = (value) =>
    String(value || "")
      .trim()
      .replace(/^hedgehog[-_]/i, "");
  const firstProjectValue = (...values) => {
    for (const value of values) {
      if (Array.isArray(value)) {
        const nested = firstProjectValue(...value);
        if (nested) return nested;
        continue;
      }
      if (value && typeof value === "object") {
        const nested = firstProjectValue(value.name, value.id, value.keyword);
        if (nested) return nested;
        continue;
      }
      if (typeof value === "string" && value.trim()) {
        return normalizeProjectValue(value);
      }
    }
    return "";
  };
  const resolveCaseProject = (caseData) => {
    const sampleSources = (caseData.sample_logs || []).map(
      (log) =>
        (log === null || log === void 0 ? void 0 : log._source) || log || {},
    );
    return (
      firstProjectValue(
        caseData.project,
        caseData.city,
        caseData.clientID,
        caseData.client_id,
        caseData.client?.id,
        caseData.client?.name,
        caseData.organization?.name,
        caseData.host?.name,
        caseData.host?.hostname,
        ...sampleSources.flatMap((source) => [
          source.project,
          source.city,
          source.clientID,
          source.client_id,
          source.client?.id,
          source.client?.name,
          source.organization?.name,
          source.host?.name,
          source.host?.hostname,
          source.host?.clientID,
          source.host?.client?.id,
          source.host?.client?.name,
        ]),
      ) || "bainbridge"
    );
  };
  const buildCaseFingerprint = (caseData) => {
    return {
      case_id: caseData.case_id,
      category: caseData.category,
      signature: caseData.signature,
      src_ip: caseData.src_ip,
      dest_ip: caseData.dest_ip,
      target_host: caseData.target_host,
      target_url: caseData.target_url || "",
      dest_port: caseData.dest_port,
      first_seen: caseData.first_seen,
      last_seen: caseData.last_seen,
    };
  };
  const isUsefulValue = (value) => {
    if (value === null || value === undefined) {
      return false;
    }
    const text = String(value).trim();
    return (
      text &&
      !["unknown", "n/a", "na", "null", "undefined", "0"].includes(
        text.toLowerCase(),
      )
    );
  };
  const luceneValue = (value) =>
    `"${String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"').trim()}"`;
  const addTerm = (parts, field, value) => {
    if (isUsefulValue(value)) {
      parts.push(`${field}:${luceneValue(value)}`);
    }
  };
  const firstUseful = (...values) => values.find(isUsefulValue);
  const firstArrayValue = (value) =>
    Array.isArray(value) ? value.find(isUsefulValue) : null;
  const isGenericSignature = (signature) => {
    const normalized = String(signature || "")
      .trim()
      .toLowerCase();
    return (
      !normalized ||
      [
        "alert",
        "dns",
        "ssl",
        "http",
        "conn",
        "notice",
        "unknown",
        "n/a",
      ].includes(normalized)
    );
  };
  const buildEvidenceTimeBounds = () => {
    return {
      timeFrom: "now-30d",
      timeTo: "now",
    };
  };
  const buildSignatureClause = (signature) => {
    if (!isUsefulValue(signature) || isGenericSignature(signature)) {
      return null;
    }
    const quoted = luceneValue(signature);
    return `(rule.name:${quoted} OR alert.signature:${quoted} OR zeek.notice.note:${quoted} OR zeek.notice.msg:${quoted} OR event.original:${quoted})`;
  };
  const buildAnyFieldClause = (fields, value) => {
    if (!isUsefulValue(value)) {
      return null;
    }
    const quoted = luceneValue(value);
    return `(${fields.map((field) => `${field}:${quoted}`).join(" OR ")})`;
  };
  const buildEvidenceFilter = (caseData, source) => {
    const parts = [];
    const srcField = source === "opensearch" ? "source.ip" : "src_ip";
    const destField = source === "opensearch" ? "destination.ip" : "dest_ip";
    const portField =
      source === "opensearch" ? "destination.port" : "dest_port";
    const category = String(caseData.category || "").toLowerCase();
    const indicator = firstUseful(
      caseData.incident_indicator,
      firstArrayValue(caseData.dns_root_domains),
      firstArrayValue(caseData.tls_server_names),
      firstArrayValue(caseData.http_hosts),
      caseData.target_host,
      caseData.signature,
    );
    const signatureClause = buildSignatureClause(caseData.signature);
    addTerm(parts, srcField, caseData.src_ip);
    if (!["brute_force", "recon_scanning"].includes(category)) {
      addTerm(parts, destField, caseData.dest_ip);
    }
    if (Number(caseData.dest_port) > 0 && category !== "recon_scanning") {
      parts.push(`${portField}:${caseData.dest_port}`);
    }
    if (source !== "opensearch") {
      if (signatureClause) {
        parts.push(signatureClause);
      }
      return parts.length > 0 ? parts.join(" AND ") : "*";
    }
    if (category === "brute_force") {
      addTerm(
        parts,
        "zeek.notice.note",
        firstUseful(firstArrayValue(caseData.notice_types), caseData.signature),
      );
      return parts.length > 0 ? parts.join(" AND ") : "*";
    }
    if (category === "recon_scanning") {
      addTerm(
        parts,
        "zeek.notice.note",
        firstUseful(firstArrayValue(caseData.notice_types), caseData.signature),
      );
      const hostClause = buildAnyFieldClause(
        ["host.name", "host.hostname", "agent.name"],
        caseData.target_host,
      );
      if (hostClause) {
        parts.push(hostClause);
      }
      return parts.length > 0 ? parts.join(" AND ") : "*";
    }
    if (
      category === "dns_tunneling" ||
      category === "dual_use_abused_infrastructure"
    ) {
      if (Number(caseData.dest_port) === 53 || category === "dns_tunneling") {
        const dnsClause = buildAnyFieldClause(
          ["zeek.dns.query", "dns.host"],
          indicator,
        );
        if (dnsClause) {
          parts.push(dnsClause);
        }
      } else {
        const tlsClause = buildAnyFieldClause(
          ["zeek.ssl.server_name", "url.domain", "server.domain"],
          firstUseful(firstArrayValue(caseData.tls_server_names), indicator),
        );
        if (tlsClause) {
          parts.push(tlsClause);
        }
      }
    }
    if (category === "http_protocol_anomalies") {
      addTerm(
        parts,
        "zeek.notice.note",
        firstUseful(firstArrayValue(caseData.notice_types), caseData.signature),
      );
    }
    if (
      category === "web_exploitation" ||
      category === "exploit_attempts" ||
      category === "malware_activity" ||
      category === "lateral_movement" ||
      category === "c2_beaconing"
    ) {
      if (signatureClause && parts.length < 2) {
        parts.push(signatureClause);
      }
    }
    return parts.length > 0 ? parts.join(" AND ") : "*";
  };
  const handleCheckDuplicates = async (caseData) => {
    const caseId = caseData.case_id;
    if (duplicateLoading[caseId]) return;
    setDuplicateLoading((prev) => ({
      ...prev,
      [caseId]: true,
    }));
    try {
      const fingerprint = buildCaseFingerprint(caseData);
      const response = await fetch(`${BACKEND_URL}/api/check-duplicates`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          caseData: fingerprint,
        }),
      });
      if (!response.ok) throw new Error("Duplicate check failed");
      const result = await response.json();
      setDuplicateResults((prev) => ({
        ...prev,
        [caseId]: result.result,
      }));
    } catch (err) {
      console.error("Duplicate check error:", err);
    } finally {
      setDuplicateLoading((prev) => ({
        ...prev,
        [caseId]: false,
      }));
    }
  };
  const buildTicketPreview = (
    caseData,
    aiAssessment,
    duplicateCheck,
    queryFilter = "",
    opensearchUrl = "",
    pivots = [],
    source = "opensearch",
  ) => {
    // 1. Severity / Priority Mapping
    let severity = "minor";
    let priority = "normal";
    const isEscalate = aiAssessment.verdict === "ESCALATE";
    const confidence = aiAssessment.confidence;
    const classification =
      aiAssessment.attack_classification || aiAssessment.classification || "";
    const category = caseData.category;
    const project = resolveCaseProject(caseData);
    if (isEscalate) {
      if (
        confidence > 0.8 ||
        ["c2_beaconing", "exploit_attempts", "malware_activity"].includes(
          category,
        )
      ) {
        severity = "major";
        priority = "high";
      } else if (confidence > 0.5) {
        severity = "major";
        priority = "normal";
      }
    }
    // 2. Summary Generation
    const cleanCategory = category
      .split("_")
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(" ");
    const signature = caseData.signature;
    const cveMatch = signature.match(/CVE-\d{4}-\d+/);
    const summary = `${cleanCategory} Attempt - ${signature.split(" ").slice(0, 5).join(" ")}${cveMatch ? ` (${cveMatch[0]})` : ""}`;
    // 3. Description Formatting
    const mainAssessment =
      aiAssessment.updated_assessment || aiAssessment.threat_assessment || "";
    const reasoningPoints = aiAssessment.reasoning
      ? `\n\n**Detailed Investigation Findings:**\n` +
        aiAssessment.reasoning.map((r) => `- ${r}`).join("\n")
      : "";
    const analystReasoning = aiAssessment.analyst_reasoning
      ? `\n\n**Investigator Side Note:**\n${aiAssessment.analyst_reasoning}`
      : "";
    // Add Pivot Results to description
    let pivotSection = "";
    if (pivots.length > 0) {
      pivotSection = `\n\n## Investigation Data (Pivots):\n`;
      pivots.forEach((p, idx) => {
        var _a, _b, _c, _d;
        pivotSection += `\n### Pivot ${idx + 1}: ${p.query}\n`;
        pivotSection += `- Hits Found: ${p.total_hits}\n`;
        if (
          (_a = p.top_signatures) === null || _a === void 0 ? void 0 : _a.length
        )
          pivotSection += `- Top Signatures: ${p.top_signatures.join(", ")}\n`;
        if ((_b = p.top_src_ips) === null || _b === void 0 ? void 0 : _b.length)
          pivotSection += `- Top Source IPs: ${p.top_src_ips.join(", ")}\n`;
        if (
          (_c = p.top_dest_ips) === null || _c === void 0 ? void 0 : _c.length
        )
          pivotSection += `- Top Destination IPs: ${p.top_dest_ips.join(", ")}\n`;
        if ((_d = p.top_hosts) === null || _d === void 0 ? void 0 : _d.length)
          pivotSection += `- Top Affected Hosts: ${p.top_hosts.join(", ")}\n`;
      });
    }
    const description = `## Analyst Notes:

Analyzing the ${signature}: ${mainAssessment}${reasoningPoints}${analystReasoning}${pivotSection}

## Evidence Summary:

source ip: ${caseData.src_ip}
destination ip: ${caseData.dest_ip}
target host: ${caseData.target_host}
destination port: ${caseData.dest_port}
signature: ${caseData.signature}
first seen: ${new Date(caseData.first_seen).toLocaleString()}
last seen: ${new Date(caseData.last_seen).toLocaleString()}
log count: ${caseData.log_count}
category: ${category}
confidence: ${Math.round(confidence * 100)}%
verdict: ${aiAssessment.verdict}

## Recommendations:

- Verify whether the activity was blocked by existing security controls (IPS/Firewall).
- Review system and application logs on ${caseData.target_host} for signs of successful compromise.
- If successful, isolate the host and initiate the standard incident response procedure.
- Monitor for any follow-up activity or lateral movement from ${caseData.src_ip}.`;
    // 4. Steps to Reproduce / Evidence Link
    const evidenceLabel =
      source === "opensearch" ? "OpenSearch Dashboards" : "OpenSearch";
    const evidenceLinkSection = opensearchUrl
      ? `${evidenceLabel} Link: ${opensearchUrl}`
      : source === "opensearch"
        ? `OpenSearch Dashboards Link: [NOT GENERATED] This ticket was created from OpenSearch mode. Use the query below inside OpenSearch Dashboards or Discover.`
        : `OpenSearch Dashboards Link: [ERROR] Direct permalink generation failed. Please use the manual query provided below.`;
    const steps_to_reproduce = `All traffic associated with this case can be reviewed in ${evidenceLabel}.

${evidenceLinkSection}
Investigation Query: ${queryFilter}`;
    // 5. Additional Information
    const additional_information = `Case ID: ${caseData.case_id}
Project: ${project}
MITRE: ${classification}
Duplicate Check: ${(duplicateCheck === null || duplicateCheck === void 0 ? void 0 : duplicateCheck.match_count) || 0} matches found
Source IP: ${caseData.src_ip}
Destination IP: ${caseData.dest_ip}
Target Host: ${caseData.target_host}
Target URL: ${caseData.target_url || "N/A"}
Destination Port: ${caseData.dest_port}`;
    // 6. API Payload
    const api_payload = {
      summary,
      description,
      steps_to_reproduce,
      additional_information,
      project: {
        name: project,
      },
      category: {
        name: "Bellevue College",
      },
      severity: {
        name: severity,
      },
      priority: {
        name: priority,
      },
      reproducibility: {
        name: "have not tried",
      },
      view_state: {
        name: "public",
      },
    };
    return {
      source,
      project,
      category: "Bellevue College",
      reproducibility: "have not tried",
      severity,
      priority,
      view_status: "public",
      summary,
      description,
      steps_to_reproduce,
      additional_information,
      api_payload,
    };
  };
  const handleCreateTicket = async (caseData) => {
    const aiAssessment =
      latestAiAssessments[caseData.case_id] || aiAnalyses[caseData.case_id];
    const duplicateCheck = duplicateResults[caseData.case_id];
    const categorySummary = selectedCategorySummary;
    if (!aiAssessment) return;
    const queryFilter =
      buildEvidenceFilter(caseData, telemetrySource) ||
      (categorySummary === null || categorySummary === void 0
        ? void 0
        : categorySummary.filter) ||
      caseData.signature;
    const casePivots = executedPivots[caseData.case_id] || [];
    setTicketLoading(true);
    if (telemetrySource === "opensearch") {
      try {
        const response = await fetch(`${BACKEND_URL}/api/opensearch-url`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            query: queryFilter,
            ...buildEvidenceTimeBounds(caseData, casePivots),
          }),
        });
        const data = await response.json();
        const preview = buildTicketPreview(
          caseData,
          aiAssessment,
          duplicateCheck,
          queryFilter,
          data.url || "",
          casePivots,
          telemetrySource,
        );
        setTicketPreview(preview);
      } catch (err) {
        console.error("Failed to generate OpenSearch link:", err);
        const preview = buildTicketPreview(
          caseData,
          aiAssessment,
          duplicateCheck,
          queryFilter,
          "",
          casePivots,
          telemetrySource,
        );
        setTicketPreview(preview);
      } finally {
        setTicketLoading(false);
      }
      return;
    }
    // Fetch the direct, long OpenSearch URL from the backend
    try {
      const response = await fetch(`${BACKEND_URL}/api/opensearch-url`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          query: queryFilter,
          ...buildEvidenceTimeBounds(caseData, casePivots),
        }),
      });
      const data = await response.json();
      const preview = buildTicketPreview(
        caseData,
        aiAssessment,
        duplicateCheck,
        queryFilter,
        data.url,
        // Use the direct OPENSEARCH_NODE from the backend
        casePivots,
        telemetrySource,
      );
      setTicketPreview(preview);
    } catch (err) {
      console.error("Failed to generate direct OpenSearch URL:", err);
      // Fallback if API fails
      const preview = buildTicketPreview(
        caseData,
        aiAssessment,
        duplicateCheck,
        queryFilter,
        "",
        casePivots,
        telemetrySource,
      );
      setTicketPreview(preview);
    } finally {
      setTicketLoading(false);
    }
  };
  const handleSubmitTicket = async () => {
    if (!ticketPreview || !selectedCaseData) return;
    setIsSubmitting(true);
    try {
      const url = `${BACKEND_URL}/api/tickets/create`;
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          ...ticketPreview,
          case_id: selectedCaseData.case_id,
          fingerprint: buildCaseFingerprint(selectedCaseData),
        }),
      });
      const contentType = response.headers.get("content-type");
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(
          `Server returned ${response.status}: ${errorText.substring(0, 100)}`,
        );
      }
      if (!contentType || !contentType.includes("application/json")) {
        const text = await response.text();
        console.error("Non-JSON response:", text.substring(0, 500));
        throw new Error(
          "Server returned an HTML error page instead of JSON. Please ensure the backend is running the latest code and has been restarted.",
        );
      }
      const result = await response.json();
      if (result.status === "success") {
        setCreatedTickets((prev) => ({
          ...prev,
          [selectedCaseData.case_id]: {
            id: result.ticket_id,
            url: result.ticket_url,
          },
        }));
        setTicketPreview(null);
        alert(`Ticket #${result.ticket_id} created successfully!`);
      } else {
        throw new Error(result.message || "Failed to create ticket");
      }
    } catch (err) {
      console.error("Submit ticket error:", err);
      alert(`Error creating ticket: ${err.message}`);
    } finally {
      setIsSubmitting(false);
    }
  };
  const handleAIAnalysis = async (caseData) => {
    if (aiLoading[caseData.case_id]) return;
    setAiLoading((prev) => ({
      ...prev,
      [caseData.case_id]: true,
    }));
    try {
      const response = await fetch(`${BACKEND_URL}/api/analyze-case`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(caseData),
      });
      if (!response.ok) throw new Error("Investigation failed");
      const result = await response.json();
      setAiAnalyses((prev) => ({
        ...prev,
        [caseData.case_id]: result.analysis,
      }));
      // Auto-run duplicate check if final verdict is ESCALATE
      if (
        result.analysis.status === "final_verdict" &&
        result.analysis.verdict === "ESCALATE"
      ) {
        handleCheckDuplicates(caseData);
      }
    } catch (err) {
      console.error("Investigation error:", err);
    } finally {
      setAiLoading((prev) => ({
        ...prev,
        [caseData.case_id]: false,
      }));
    }
  };
  const executePivotQuery = async (caseId, pivot) => {
    if (pivotLoading[caseId]) return;
    const pivotCase =
      selectedCaseData && selectedCaseData.case_id === caseId
        ? selectedCaseData
        : null;
    setPivotLoading((prev) => ({
      ...prev,
      [caseId]: true,
    }));
    setPivotError((prev) => ({
      ...prev,
      [caseId]: null,
    }));
    try {
      const response = await fetch(`${BACKEND_URL}/api/pivot-query`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          query: pivot.query,
          options: {
            maxLogs: 10,
            source: telemetrySource,
            ...(pivotCase
              ? buildEvidenceTimeBounds(pivotCase, executedPivots[caseId] || [])
              : {
                  timeRange: "now-48h",
                }),
          },
        }),
      });
      if (!response.ok)
        throw new Error(`Pivot query failed: ${response.statusText}`);
      const result = await response.json();
      setExecutedPivots((prev) => ({
        ...prev,
        [caseId]: [...(prev[caseId] || []), result.result],
      }));
    } catch (err) {
      console.error("Pivot error:", err);
      setPivotError((prev) => ({
        ...prev,
        [caseId]: err.message,
      }));
    } finally {
      setPivotLoading((prev) => ({
        ...prev,
        [caseId]: false,
      }));
    }
  };
  const handleReassessCase = async (caseData, pivotResult) => {
    var _a;
    const caseId = caseData.case_id;
    if (reassessLoading[caseId]) return;
    const totalPivotsDone =
      ((_a = executedPivots[caseId]) === null || _a === void 0
        ? void 0
        : _a.length) || 0;
    setReassessLoading((prev) => ({
      ...prev,
      [caseId]: true,
    }));
    try {
      const previousAnalysis = aiAnalyses[caseId];
      const response = await fetch(`${BACKEND_URL}/api/reassess-case`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          caseData,
          previousAnalysis,
          pivotResult,
          totalPivotsDone,
        }),
      });
      if (!response.ok)
        throw new Error(`AI reassessment failed: ${response.statusText}`);
      const result = await response.json();
      setLatestAiAssessments((prev) => ({
        ...prev,
        [caseId]: result.result,
      }));
      // Auto-run duplicate check if final verdict is ESCALATE
      if (
        result.result.status === "final_verdict" &&
        result.result.verdict === "ESCALATE"
      ) {
        handleCheckDuplicates(caseData);
      }
    } catch (err) {
      console.error("Reassessment error:", err);
    } finally {
      setReassessLoading((prev) => ({
        ...prev,
        [caseId]: false,
      }));
    }
  };
  const generateOpenSearchFilter = (caseData) => {
    return buildEvidenceFilter(caseData, "opensearch");
  };
  const copyToClipboard = async (text) => {
    try {
      await navigator.clipboard.writeText(text);
      alert("OpenSearch filter copied to clipboard!");
    } catch (err) {
      console.error("Failed to copy!", err);
      alert("Failed to copy to clipboard.");
    }
  };
  useEffect(() => {
    fetchData();
  }, [fetchData]);
  const getSampleLogs = (categoryId) => {
    var _a, _b;
    return (
      ((_b =
        (_a =
          rawData === null || rawData === void 0
            ? void 0
            : rawData.categories) === null || _a === void 0
          ? void 0
          : _a.find((c) => c.id === categoryId)) === null || _b === void 0
        ? void 0
        : _b.sampleLogs) || []
    );
  };
  // Get freshest summary for the selected category ID
  const selectedCategorySummary =
    (_a = data === null || data === void 0 ? void 0 : data.summaries) ===
      null || _a === void 0
      ? void 0
      : _a.find(
          (s) =>
            s.id ===
            (selectedCategory === null || selectedCategory === void 0
              ? void 0
              : selectedCategory.id),
        );
  // Get freshest case data for the investigation view
  const selectedCaseData =
    (_b =
      selectedCategorySummary === null || selectedCategorySummary === void 0
        ? void 0
        : selectedCategorySummary.cases) === null || _b === void 0
      ? void 0
      : _b.find(
          (c) =>
            c.case_id ===
            (selectedCase === null || selectedCase === void 0
              ? void 0
              : selectedCase.case_id),
        );
  const latestAiAssessment = selectedCaseData
    ? latestAiAssessments[selectedCaseData.case_id]
    : null;
  const initialAiAnalysis = selectedCaseData
    ? aiAnalyses[selectedCaseData.case_id]
    : null;
  const currentStatus =
    (latestAiAssessment === null || latestAiAssessment === void 0
      ? void 0
      : latestAiAssessment.status) ||
    (initialAiAnalysis === null || initialAiAnalysis === void 0
      ? void 0
      : initialAiAnalysis.status);
  const handleOpenOpenSearch = async (query) => {
    try {
      const casePivots = selectedCaseData
        ? executedPivots[selectedCaseData.case_id] || []
        : [];
      const response = await fetch(`${BACKEND_URL}/api/opensearch-url`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          query,
          ...(selectedCaseData
            ? buildEvidenceTimeBounds(selectedCaseData, casePivots)
            : {
                timeFrom: "now-30d",
                timeTo: "now",
              }),
        }),
      });
      const data = await response.json();
      if (data.url) {
        window.open(data.url, "_blank");
      }
    } catch (err) {
      console.error("Failed to get OpenSearch URL:", err);
    }
  };
  if (loading) {
    return (
      <div className="shams-loader-container">
        <div className="shams-loader-content">
          <img src={shamsLogo} className="shams-logo" alt="SHAMS Logo" />
          <div className="shams-status">
            <span className="shams-pulse" />
            BROADCASTING: INITIALIZING SOC HUNTING AND MITIGATION SYSTEM...
          </div>
          <div className="shams-terminal">
            <p>&gt; Connecting to OpenSearch Telemetry Lake...</p>
            <p>&gt; Pulling telemetry for the last 48h...</p>
            <p>&gt; Executing AI Triage Engine...</p>
            <p>&gt; Analyzing threat patterns & attack vectors...</p>
          </div>
        </div>
      </div>
    );
  }
  return (
    <div className="App dark-theme">
      <header className="Dashboard-header">
        <div className="header-left">
          <div className="logo-container">
            <img src={shamsLogo} className="header-logo" alt="SHAMS Logo" />
            <h1>SOC Hunting And Mitigation System</h1>
          </div>
          <span className="last-updated">
            Last Updated:{" "}
            {(data === null || data === void 0 ? void 0 : data.lastUpdated)
              ? new Date(data.lastUpdated).toLocaleString()
              : "Never"}
          </span>
        </div>
        <nav className="header-nav">
          <button
            className={`nav-btn ${currentView === "dashboard-v1" ? "active" : ""}`}
            onClick={() => setCurrentView("dashboard-v1")}
          >
            Dashboard v1
          </button>
          <button
            className={`nav-btn ${currentView === "cases-v1" ? "active" : ""}`}
            onClick={() => setCurrentView("cases-v1")}
          >
            Case Manager v1
          </button>
          <button
            className={`nav-btn ${currentView === "tickets" ? "active" : ""}`}
            onClick={() => setCurrentView("tickets")}
          >
            Ticket Registry
          </button>
        </nav>
        <div className="header-stats">
          <div className="telemetry-switch">
            <span className="stat-label">SOURCE</span>
            <div className="switch-buttons">
              <button className="nav-btn active">OpenSearch</button>
            </div>
          </div>
          <div className="stat-box">
            <span className="stat-label">TOTAL LOGS (48H)</span>
            <span className="stat-value">
              {getCountValue(
                data === null || data === void 0 ? void 0 : data.totalLogs48h,
              ).toLocaleString()}
            </span>
          </div>
          <button
            className="sync-btn"
            onClick={async () => {
              try {
                const res = await fetch(`${BACKEND_URL}/api/tickets/test`);
                const d = await res.json();
                alert(`Sync OK: ${d.message}`);
              } catch (e) {
                alert(
                  "Sync FAILED: Route not found. Please RESTART your backend server to apply new routes.",
                );
              }
            }}
          >
            Sync
          </button>
          <button
            className="refresh-btn"
            onClick={refreshData}
            disabled={loading || !isDashboardView}
          >
            {isDashboardView && loading ? "Analyzing..." : "Analyze Now"}
          </button>
        </div>
      </header>
      {error && <div className="error-banner">⚠️ Error: {error}</div>}
      <main className="Dashboard-content">
        {isDashboardView ? (
          <>
            <div className="category-grid">
              {(_d =
                data === null || data === void 0 ? void 0 : data.summaries) ===
                null || _d === void 0
                ? void 0
                : _d.map((cat) => {
                    var _a, _b;
                    return (
                      <div
                        className={`category-card ${cat.totalMatches > 0 ? "active" : "inactive"} ${(selectedCategory === null || selectedCategory === void 0 ? void 0 : selectedCategory.id) === cat.id ? "selected" : ""}`}
                        onClick={() => {
                          var _a;
                          console.log(
                            "Selected Category:",
                            cat.name,
                            "Case Count:",
                            cat.caseCandidates,
                            "Cases Array Length:",
                            (_a = cat.cases) === null || _a === void 0
                              ? void 0
                              : _a.length,
                          );
                          setSelectedCategory(cat);
                          setSelectedCase(null);
                        }}
                        key={cat.id}
                      >
                        <div className="card-top">
                          <span
                            className={`priority-badge ${(_a = cat.suggestedPriority) === null || _a === void 0 ? void 0 : _a.toLowerCase()}`}
                          >
                            {cat.suggestedPriority} Priority
                          </span>
                          <span className="card-tier">{cat.tier}</span>
                        </div>
                        <h3>{cat.name}</h3>
                        <div className="card-main">
                          <div className="main-stat">
                            <span className="match-count">
                              {((_b = cat.totalMatches) === null ||
                              _b === void 0
                                ? void 0
                                : _b.toLocaleString()) || "0"}
                            </span>
                            <span className="match-label">Total Events</span>
                          </div>
                          {cat.totalMatches > 0 && (
                            <div className="mini-stats">
                              <div className="mini-stat">
                                <strong>{cat.uniqueSrcCount}</strong>
                                <span>Attacker IPs</span>
                              </div>
                              <div className="mini-stat">
                                <strong>{cat.caseCandidates}</strong>
                                <span>Case Candidates</span>
                              </div>
                            </div>
                          )}
                        </div>
                        <div className="card-footer">
                          <span className="view-link">View Analysis →</span>
                        </div>
                      </div>
                    );
                  })}
            </div>
            {selectedCategorySummary && (
              <section className="details-pane">
                <div className="details-header">
                  <div className="title-group">
                    <h2>{selectedCategorySummary.name} Analysis</h2>
                    <span className="ticket-type">
                      Suggested Ticket:{" "}
                      {selectedCategorySummary.suggestedTicketType}
                    </span>
                  </div>
                  <button
                    className="close-btn"
                    onClick={() => {
                      setSelectedCategory(null);
                      setSelectedCase(null);
                    }}
                  >
                    ×
                  </button>
                </div>
                <div className="summary-overview">
                  <div className="overview-row">
                    <div className="overview-item">
                      <label>Time Window</label>
                      <span>
                        {selectedCategorySummary.firstSeen
                          ? new Date(
                              selectedCategorySummary.firstSeen,
                            ).toLocaleString()
                          : "N/A"}{" "}
                        -
                        {selectedCategorySummary.lastSeen
                          ? new Date(
                              selectedCategorySummary.lastSeen,
                            ).toLocaleString()
                          : "N/A"}
                      </span>
                    </div>
                  </div>
                  <div className="stats-row">
                    <div className="stat-group">
                      <h4>Top Signatures</h4>
                      <ul>
                        {(_e = selectedCategorySummary.topSignatures) ===
                          null || _e === void 0
                          ? void 0
                          : _e.map((s, i) => (
                              <li title={s} key={i}>
                                {s}
                              </li>
                            ))}
                      </ul>
                    </div>
                    <div className="stat-group">
                      <h4>Top Attacker IPs</h4>
                      <ul>
                        {(_f = selectedCategorySummary.topSrcIps) === null ||
                        _f === void 0
                          ? void 0
                          : _f.map((s, i) => (
                              <li title={s} key={i}>
                                {s}
                              </li>
                            ))}
                      </ul>
                    </div>
                    <div className="stat-group">
                      <h4>Affected Hosts</h4>
                      <ul>
                        {(_g = selectedCategorySummary.affectedHosts) ===
                          null || _g === void 0
                          ? void 0
                          : _g.map((s, i) => (
                              <li title={s} key={i}>
                                {s}
                              </li>
                            ))}
                      </ul>
                    </div>
                  </div>
                </div>
                <div className="case-candidates-section">
                  <h3>
                    Case Candidates (
                    {((_h = selectedCategorySummary.cases) === null ||
                    _h === void 0
                      ? void 0
                      : _h.length) || 0}
                    )
                  </h3>
                  {(() => {
                    var _a;
                    console.log(
                      `Panel Debug [${selectedCategorySummary.name}]:`,
                      {
                        prop_caseCandidates:
                          selectedCategorySummary.caseCandidates,
                        array_length:
                          (_a = selectedCategorySummary.cases) === null ||
                          _a === void 0
                            ? void 0
                            : _a.length,
                      },
                    );
                    return null;
                  })()}
                  <div className="case-list">
                    {(_j = selectedCategorySummary.cases) === null ||
                    _j === void 0
                      ? void 0
                      : _j.map((c) => (
                          <div
                            className="case-card"
                            onClick={() => setSelectedCase(c)}
                            key={c.case_id}
                          >
                            <div className="case-card-header">
                              <span className="case-id">{c.case_id}</span>
                              <span className="case-log-count">
                                {c.log_count} Logs
                              </span>
                            </div>
                            <div className="case-card-body">
                              <div
                                className="case-signature"
                                title={c.signature}
                              >
                                {c.signature}
                              </div>
                              <div className="case-ips">
                                <span>
                                  <strong>Src:</strong> {c.src_ip}
                                </span>
                                <span>
                                  <strong>Target:</strong> {c.target_host}
                                </span>
                              </div>
                              {c.target_url && (
                                <div className="case-url" title={c.target_url}>
                                  <strong>URL:</strong> {c.target_url}
                                </div>
                              )}
                            </div>
                            <button className="analyze-case-btn">
                              Analyze Case
                            </button>
                          </div>
                        ))}
                  </div>
                </div>
                <div className="log-samples">
                  <h3>Category Logs (Last 10)</h3>
                  {((_k = getSampleLogs(selectedCategorySummary.id)) === null ||
                  _k === void 0
                    ? void 0
                    : _k.length) > 0 ? (
                    getSampleLogs(selectedCategorySummary.id).map((log) => (
                      <div className="log-entry" key={log._id}>
                        <div className="log-meta">
                          <span className="log-time">
                            {log._source["@timestamp"]
                              ? new Date(
                                  log._source["@timestamp"],
                                ).toLocaleString()
                              : "N/A"}
                          </span>
                          <span className="log-id">ID: {log._id}</span>
                        </div>
                        <pre className="log-json">
                          {JSON.stringify(log._source, null, 2)}
                        </pre>
                      </div>
                    ))
                  ) : (
                    <p>No sample logs available for this category.</p>
                  )}
                </div>
              </section>
            )}
            {selectedCaseData && (
              <div className="case-investigation-overlay">
                <div className="case-investigation-view">
                  <header className="case-header">
                    <div className="case-title-group">
                      <h2>Case Investigation: {selectedCaseData.case_id}</h2>
                      <span className="case-category">
                        {(_l = selectedCaseData.category) === null ||
                        _l === void 0
                          ? void 0
                          : _l.replace("_", " ")}
                      </span>
                      <button
                        className="view-kibana-link-btn"
                        onClick={() => {
                          const filter =
                            generateOpenSearchFilter(selectedCaseData);
                          handleOpenOpenSearch(filter);
                        }}
                      >
                        View in OpenSearch 🔗
                      </button>
                      <button
                        className="copy-kibana-filter-btn"
                        onClick={() => {
                          const filter =
                            generateOpenSearchFilter(selectedCaseData);
                          copyToClipboard(filter);
                        }}
                        title="Copy Lucene filter to clipboard"
                      >
                        Copy Filter 📋
                      </button>
                    </div>
                    <button
                      className="close-btn"
                      onClick={() => setSelectedCase(null)}
                    >
                      ×
                    </button>
                  </header>
                  <div className="case-content">
                    <section className="case-overview-section">
                      <h3>CASE OVERVIEW</h3>
                      <div className="overview-grid">
                        <div className="overview-field">
                          <label>Signature</label>
                          <span>{selectedCaseData.signature}</span>
                        </div>
                        <div className="overview-field">
                          <label>Source IP</label>
                          <span>{selectedCaseData.src_ip}</span>
                        </div>
                        <div className="overview-field">
                          <label>Destination IP</label>
                          <span>{selectedCaseData.dest_ip}</span>
                        </div>
                        <div className="overview-field">
                          <label>Target Host</label>
                          <span>{selectedCaseData.target_host}</span>
                        </div>
                        {selectedCaseData.target_url && (
                          <div className="overview-field">
                            <label>Target URL</label>
                            <span>{selectedCaseData.target_url}</span>
                          </div>
                        )}
                        <div className="overview-field">
                          <label>Log Count</label>
                          <span>{selectedCaseData.log_count}</span>
                        </div>
                        <div className="overview-field">
                          <label>First Seen</label>
                          <span>
                            {selectedCaseData.first_seen
                              ? new Date(
                                  selectedCaseData.first_seen,
                                ).toLocaleString()
                              : "N/A"}
                          </span>
                        </div>
                        <div className="overview-field">
                          <label>Last Seen</label>
                          <span>
                            {selectedCaseData.last_seen
                              ? new Date(
                                  selectedCaseData.last_seen,
                                ).toLocaleString()
                              : "N/A"}
                          </span>
                        </div>
                      </div>
                    </section>
                    <section className="case-attack-context">
                      <h3>ATTACK CONTEXT</h3>
                      <div className="context-info">
                        <div className="context-item">
                          <strong>Attacker:</strong> {selectedCaseData.src_ip}
                        </div>
                        <div className="context-item">
                          <strong>Target:</strong>{" "}
                          {selectedCaseData.target_host} (
                          {selectedCaseData.dest_ip})
                        </div>
                        <div className="context-item">
                          <strong>Port:</strong> {selectedCaseData.dest_port}
                        </div>
                      </div>
                    </section>
                    <section className="case-ai-analysis">
                      <h3>AUTOMATED INVESTIGATION</h3>
                      <div className="ai-analysis-container">
                        {!initialAiAnalysis &&
                          !aiLoading[selectedCaseData.case_id] && (
                            <button
                              className="ai-analyze-btn"
                              onClick={() => handleAIAnalysis(selectedCaseData)}
                            >
                              <span className="ai-icon">🔍</span>Start
                              Investigation
                            </button>
                          )}
                        {aiLoading[selectedCaseData.case_id] && (
                          <div className="ai-loading">
                            <div className="spinner" />
                            <p>Automated investigation in progress...</p>
                          </div>
                        )}
                        {initialAiAnalysis && (
                          <div className="ai-response">
                            {latestAiAssessment && (
                              <h4 className="analysis-phase-label">
                                Initial Automated Analysis
                              </h4>
                            )}
                            <div className="ai-header-row">
                              <span className="ai-badge">
                                {initialAiAnalysis.attack_classification}
                              </span>
                              <div className="ai-score">
                                <span className="score-label">Confidence:</span>
                                <span
                                  className={`score-value ${initialAiAnalysis.confidence * 100 > 80 ? "high" : initialAiAnalysis.confidence * 100 > 50 ? "medium" : "low"}`}
                                >
                                  {Math.round(
                                    initialAiAnalysis.confidence * 100,
                                  )}
                                  %
                                </span>
                              </div>
                            </div>
                            {initialAiAnalysis.status === "final_verdict" && (
                              <div className="final-verdict-banner">
                                <label>Final Verdict</label>
                                <span
                                  className={`verdict-value ${initialAiAnalysis.verdict}`}
                                >
                                  {(_m = initialAiAnalysis.verdict) === null ||
                                  _m === void 0
                                    ? void 0
                                    : _m.replace(/_/g, " ")}
                                </span>
                              </div>
                            )}
                            <div className="ai-field">
                              <h4>Threat Assessment</h4>
                              <p>{initialAiAnalysis.threat_assessment}</p>
                            </div>
                            {initialAiAnalysis.analyst_reasoning && (
                              <div className="ai-field analyst-reasoning-box">
                                <h4>Analyst Reasoning (Side Note)</h4>
                                <div className="reasoning-content">
                                  <span className="info-icon">💡</span>
                                  <p>{initialAiAnalysis.analyst_reasoning}</p>
                                </div>
                              </div>
                            )}
                            {initialAiAnalysis.status === "final_verdict" && (
                              <div className="ai-field recommendation-summary">
                                <h4>Ticket Recommendation</h4>
                                {initialAiAnalysis.verdict === "ESCALATE" && (
                                  <p className="rec-text escalate">
                                    Escalate for immediate investigation.
                                  </p>
                                )}
                                {initialAiAnalysis.verdict ===
                                  "SUSPICIOUS_MONITOR" && (
                                  <p className="rec-text monitor">
                                    No ticket recommended at this time. Continue
                                    monitoring only if new evidence appears.
                                  </p>
                                )}
                                {initialAiAnalysis.verdict ===
                                  "LIKELY_FALSE_POSITIVE" && (
                                  <p className="rec-text fp">
                                    No ticket recommended. Case appears to be a
                                    likely false positive.
                                  </p>
                                )}
                              </div>
                            )}
                            {initialAiAnalysis.status === "pivot_required" &&
                              !latestAiAssessment && (
                                <div className="ai-field">
                                  <h4>Recommended Pivot Queries</h4>
                                  <div className="pivot-buttons-container">
                                    {initialAiAnalysis.recommended_pivot_queries.map(
                                      (pivot) => (
                                        <div
                                          className="pivot-button-wrapper"
                                          key={pivot.pivot_id}
                                        >
                                          <button
                                            className="pivot-execute-btn"
                                            onClick={() =>
                                              executePivotQuery(
                                                selectedCaseData.case_id,
                                                pivot,
                                              )
                                            }
                                            disabled={
                                              pivotLoading[
                                                selectedCaseData.case_id
                                              ]
                                            }
                                          >
                                            {pivot.label}
                                          </button>
                                          <p className="pivot-reason">
                                            {pivot.reason}
                                          </p>
                                        </div>
                                      ),
                                    )}
                                  </div>
                                </div>
                              )}
                            {initialAiAnalysis.status === "final_verdict" &&
                              initialAiAnalysis.verdict === "ESCALATE" && (
                                <div className="escalation-actions">
                                  <div className="duplicate-check-section">
                                    <h4>Duplicate Ticket Check</h4>
                                    {duplicateLoading[
                                      selectedCaseData.case_id
                                    ] ? (
                                      <div className="duplicate-status checking">
                                        <div className="spinner mini" />
                                        <span>
                                          Checking duplicates in Mantis...
                                        </span>
                                      </div>
                                    ) : duplicateResults[
                                        selectedCaseData.case_id
                                      ] ? (
                                      <div className="duplicate-results-container">
                                        {duplicateResults[
                                          selectedCaseData.case_id
                                        ].match_count > 0 ? (
                                          <>
                                            <div className="duplicate-alert warning">
                                              <span>
                                                ⚠️ Possible duplicate tickets
                                                found
                                              </span>
                                            </div>
                                            <div className="duplicate-list">
                                              {duplicateResults[
                                                selectedCaseData.case_id
                                              ].possible_duplicates.map(
                                                (ticket) => (
                                                  <div
                                                    className="duplicate-item"
                                                    key={ticket.id}
                                                  >
                                                    <div className="duplicate-item-info">
                                                      <span className="ticket-id">
                                                        Ticket #{ticket.id}
                                                      </span>
                                                      <span className="ticket-summary">
                                                        {ticket.summary}
                                                      </span>
                                                      <span
                                                        className={`ticket-status ${ticket.status.toLowerCase()}`}
                                                      >
                                                        {ticket.status}
                                                      </span>
                                                    </div>
                                                    <a
                                                      href={`${process.env.REACT_APP_MANTIS_URL || "https://wa-mantis.cyberrangepoulsbo.com"}/view.php?id=${ticket.id}`}
                                                      target="_blank"
                                                      rel="noopener noreferrer"
                                                      className="view-ticket-link"
                                                    >
                                                      View Ticket
                                                    </a>
                                                  </div>
                                                ),
                                              )}
                                            </div>
                                          </>
                                        ) : (
                                          <div className="duplicate-alert success">
                                            <span>
                                              ✔ No duplicates found in the last
                                              7 days
                                            </span>
                                          </div>
                                        )}
                                      </div>
                                    ) : (
                                      <button
                                        className="check-duplicates-btn"
                                        onClick={() =>
                                          handleCheckDuplicates(
                                            selectedCaseData,
                                          )
                                        }
                                      >
                                        Run Duplicate Check
                                      </button>
                                    )}
                                  </div>
                                  {createdTickets[selectedCaseData.case_id] ? (
                                    <div className="ticket-status-success">
                                      <span className="success-icon">✅</span>
                                      <div className="ticket-info">
                                        <label>Ticket Created</label>
                                        <a
                                          href={
                                            createdTickets[
                                              selectedCaseData.case_id
                                            ].url
                                          }
                                          target="_blank"
                                          rel="noopener noreferrer"
                                          className="ticket-link"
                                        >
                                          View Ticket #
                                          {
                                            createdTickets[
                                              selectedCaseData.case_id
                                            ].id
                                          }{" "}
                                          🔗
                                        </a>
                                      </div>
                                    </div>
                                  ) : (
                                    <button
                                      className="create-ticket-btn"
                                      onClick={() =>
                                        handleCreateTicket(selectedCaseData)
                                      }
                                      disabled={
                                        !duplicateResults[
                                          selectedCaseData.case_id
                                        ] ||
                                        duplicateResults[
                                          selectedCaseData.case_id
                                        ].match_count > 0
                                      }
                                      title={
                                        ((_o =
                                          duplicateResults[
                                            selectedCaseData.case_id
                                          ]) === null || _o === void 0
                                          ? void 0
                                          : _o.match_count) > 0
                                          ? "Resolve duplicate tickets before creating a new one"
                                          : ""
                                      }
                                    >
                                      Create Ticket
                                    </button>
                                  )}{" "}
                                </div>
                              )}
                          </div>
                        )}
                        {latestAiAssessment && (
                          <div className="ai-response reassessment">
                            <h4 className="analysis-phase-label">
                              Latest Automated Reassessment
                            </h4>
                            <div className="ai-header-row">
                              <span className="ai-badge">
                                {latestAiAssessment.classification}
                              </span>
                              <div className="ai-score">
                                <span className="score-label">Confidence:</span>
                                <span
                                  className={`score-value ${latestAiAssessment.confidence * 100 > 80 ? "high" : latestAiAssessment.confidence * 100 > 50 ? "medium" : "low"}`}
                                >
                                  {Math.round(
                                    latestAiAssessment.confidence * 100,
                                  )}
                                  %
                                </span>
                              </div>
                            </div>
                            {latestAiAssessment.status === "final_verdict" && (
                              <div className="final-verdict-banner">
                                <label>Final Verdict</label>
                                <span
                                  className={`verdict-value ${latestAiAssessment.verdict}`}
                                >
                                  {(_p = latestAiAssessment.verdict) === null ||
                                  _p === void 0
                                    ? void 0
                                    : _p.replace(/_/g, " ")}
                                </span>
                              </div>
                            )}
                            <div className="ai-field">
                              <h4>Updated Assessment</h4>
                              <p>{latestAiAssessment.updated_assessment}</p>
                            </div>
                            {latestAiAssessment.analyst_reasoning && (
                              <div className="ai-field analyst-reasoning-box">
                                <h4>Analyst Reasoning (Side Note)</h4>
                                <div className="reasoning-content">
                                  <span className="info-icon">💡</span>
                                  <p>{latestAiAssessment.analyst_reasoning}</p>
                                </div>
                              </div>
                            )}
                            {latestAiAssessment.status === "final_verdict" && (
                              <div className="ai-field recommendation-summary">
                                <h4>Ticket Recommendation</h4>
                                {latestAiAssessment.verdict === "ESCALATE" && (
                                  <p className="rec-text escalate">
                                    Escalate for immediate investigation.
                                  </p>
                                )}
                                {latestAiAssessment.verdict ===
                                  "SUSPICIOUS_MONITOR" && (
                                  <p className="rec-text monitor">
                                    No ticket recommended at this time. Continue
                                    monitoring only if new evidence appears.
                                  </p>
                                )}
                                {latestAiAssessment.verdict ===
                                  "LIKELY_FALSE_POSITIVE" && (
                                  <p className="rec-text fp">
                                    No ticket recommended. Case appears to be a
                                    likely false positive.
                                  </p>
                                )}
                              </div>
                            )}
                            <div className="ai-field">
                              <h4>Reasoning</h4>
                              <ul className="ai-reasoning-list">
                                {latestAiAssessment.reasoning.map((r, i) => (
                                  <li key={i}>{r}</li>
                                ))}
                              </ul>
                            </div>
                            {latestAiAssessment.status === "pivot_required" && (
                              <>
                                <div className="ai-field">
                                  <h4>Recommended Actions</h4>
                                  <ul className="ai-actions-list">
                                    {latestAiAssessment.recommended_actions.map(
                                      (a, i) => (
                                        <li key={i}>{a}</li>
                                      ),
                                    )}
                                  </ul>
                                </div>
                                <div className="ai-field">
                                  <h4>Follow-up Pivots</h4>
                                  <div className="pivot-buttons-container">
                                    {latestAiAssessment.recommended_pivots.map(
                                      (pivot) => (
                                        <div
                                          className="pivot-button-wrapper"
                                          key={pivot.pivot_id}
                                        >
                                          <button
                                            className="pivot-execute-btn"
                                            onClick={() =>
                                              executePivotQuery(
                                                selectedCaseData.case_id,
                                                pivot,
                                              )
                                            }
                                            disabled={
                                              pivotLoading[
                                                selectedCaseData.case_id
                                              ]
                                            }
                                          >
                                            {pivot.label}
                                          </button>
                                          <p className="pivot-reason">
                                            {pivot.reason}
                                          </p>
                                        </div>
                                      ),
                                    )}
                                  </div>
                                </div>
                              </>
                            )}
                            {latestAiAssessment.status === "final_verdict" &&
                              latestAiAssessment.verdict === "ESCALATE" && (
                                <div className="escalation-actions">
                                  <div className="duplicate-check-section">
                                    <h4>Duplicate Ticket Check</h4>
                                    {duplicateLoading[
                                      selectedCaseData.case_id
                                    ] ? (
                                      <div className="duplicate-status checking">
                                        <div className="spinner mini" />
                                        <span>
                                          Checking duplicates in Mantis...
                                        </span>
                                      </div>
                                    ) : duplicateResults[
                                        selectedCaseData.case_id
                                      ] ? (
                                      <div className="duplicate-results-container">
                                        {duplicateResults[
                                          selectedCaseData.case_id
                                        ].match_count > 0 ? (
                                          <>
                                            <div className="duplicate-alert warning">
                                              <span>
                                                ⚠️ Possible duplicate tickets
                                                found
                                              </span>
                                            </div>
                                            <div className="duplicate-list">
                                              {duplicateResults[
                                                selectedCaseData.case_id
                                              ].possible_duplicates.map(
                                                (ticket) => (
                                                  <div
                                                    className="duplicate-item"
                                                    key={ticket.id}
                                                  >
                                                    <div className="duplicate-item-info">
                                                      <span className="ticket-id">
                                                        Ticket #{ticket.id}
                                                      </span>
                                                      <span className="ticket-summary">
                                                        {ticket.summary}
                                                      </span>
                                                      <span
                                                        className={`ticket-status ${ticket.status.toLowerCase()}`}
                                                      >
                                                        {ticket.status}
                                                      </span>
                                                    </div>
                                                    <a
                                                      href={`${process.env.REACT_APP_MANTIS_URL || "https://wa-mantis.cyberrangepoulsbo.com"}/view.php?id=${ticket.id}`}
                                                      target="_blank"
                                                      rel="noopener noreferrer"
                                                      className="view-ticket-link"
                                                    >
                                                      View Ticket
                                                    </a>
                                                  </div>
                                                ),
                                              )}
                                            </div>
                                          </>
                                        ) : (
                                          <div className="duplicate-alert success">
                                            <span>
                                              ✔ No duplicates found in the last
                                              7 days
                                            </span>
                                          </div>
                                        )}
                                      </div>
                                    ) : (
                                      <button
                                        className="check-duplicates-btn"
                                        onClick={() =>
                                          handleCheckDuplicates(
                                            selectedCaseData,
                                          )
                                        }
                                      >
                                        Run Duplicate Check
                                      </button>
                                    )}
                                  </div>
                                  {createdTickets[selectedCaseData.case_id] ? (
                                    <div className="ticket-status-success">
                                      <span className="success-icon">✅</span>
                                      <div className="ticket-info">
                                        <label>Ticket Created</label>
                                        <a
                                          href={
                                            createdTickets[
                                              selectedCaseData.case_id
                                            ].url
                                          }
                                          target="_blank"
                                          rel="noopener noreferrer"
                                          className="ticket-link"
                                        >
                                          View Ticket #
                                          {
                                            createdTickets[
                                              selectedCaseData.case_id
                                            ].id
                                          }{" "}
                                          🔗
                                        </a>
                                      </div>
                                    </div>
                                  ) : (
                                    <button
                                      className="create-ticket-btn"
                                      onClick={() =>
                                        handleCreateTicket(selectedCaseData)
                                      }
                                      disabled={
                                        !duplicateResults[
                                          selectedCaseData.case_id
                                        ] ||
                                        duplicateResults[
                                          selectedCaseData.case_id
                                        ].match_count > 0
                                      }
                                      title={
                                        ((_q =
                                          duplicateResults[
                                            selectedCaseData.case_id
                                          ]) === null || _q === void 0
                                          ? void 0
                                          : _q.match_count) > 0
                                          ? "Resolve duplicate tickets before creating a new one"
                                          : ""
                                      }
                                    >
                                      Create Ticket
                                    </button>
                                  )}{" "}
                                </div>
                              )}
                            {(latestAiAssessment === null ||
                            latestAiAssessment === void 0
                              ? void 0
                              : latestAiAssessment.status) ===
                              "pivot_required" && (
                              <div
                                className={`recommendation-box ${latestAiAssessment.ticket_recommended ? "escalate" : ""}`}
                              >
                                <div className="ai-field">
                                  <h4>Initial Verdict Recommendation</h4>
                                  <p>
                                    {latestAiAssessment.ticket_recommended
                                      ? "ESCALATE: This case is ticket-worthy."
                                      : "CLOSE: No further action recommended."}
                                  </p>
                                  <span className="status-badge">
                                    {latestAiAssessment.status.replace(
                                      /_/g,
                                      " ",
                                    )}
                                  </span>
                                </div>
                              </div>
                            )}
                          </div>
                        )}
                        {reassessLoading[selectedCaseData.case_id] && (
                          <div className="ai-loading">
                            <div className="spinner" />
                            <p>Investigation in progress with new data...</p>
                          </div>
                        )}
                      </div>
                    </section>
                    {pivotLoading[selectedCaseData.case_id] && (
                      <div className="pivot-loading-overlay">
                        <div className="spinner" />
                        <p>Executing pivot query...</p>
                      </div>
                    )}
                    {pivotError[selectedCaseData.case_id] && (
                      <div className="pivot-error-message">
                        ⚠️ Pivot Failed: {pivotError[selectedCaseData.case_id]}
                      </div>
                    )}
                    {(((_r = executedPivots[selectedCaseData.case_id]) ===
                      null || _r === void 0
                      ? void 0
                      : _r.length) || 0) > 0 && (
                      <section className="case-pivot-results">
                        <h3>
                          PIVOT RESULTS (
                          {((_s = executedPivots[selectedCaseData.case_id]) ===
                            null || _s === void 0
                            ? void 0
                            : _s.length) || 0}
                          )
                        </h3>
                        <div className="pivot-results-list">
                          {(_t = executedPivots[selectedCaseData.case_id]) ===
                            null || _t === void 0
                            ? void 0
                            : _t.map((pivotResult, idx) => {
                                var _a, _b, _c;
                                return (
                                  <div className="pivot-result-card" key={idx}>
                                    <header className="pivot-result-header">
                                      <div className="query-info">
                                        <label>Query:</label>
                                        <code>{pivotResult.query}</code>
                                      </div>
                                      <div className="hits-info">
                                        <strong>
                                          {pivotResult.total_hits}
                                        </strong>{" "}
                                        hits found
                                        <button
                                          className="view-kibana-mini-btn"
                                          onClick={() =>
                                            handleOpenOpenSearch(
                                              pivotResult.query,
                                            )
                                          }
                                          title="View these results in OpenSearch"
                                        >
                                          🔗
                                        </button>
                                      </div>
                                      {currentStatus === "pivot_required" &&
                                        !reassessLoading[
                                          selectedCaseData.case_id
                                        ] && (
                                          <button
                                            className="reassess-btn"
                                            onClick={() =>
                                              handleReassessCase(
                                                selectedCaseData,
                                                pivotResult,
                                              )
                                            }
                                          >
                                            Reassess with AI
                                          </button>
                                        )}{" "}
                                    </header>
                                    {pivotResult.total_hits > 0 ? (
                                      <div className="pivot-result-content">
                                        <div className="pivot-summary-grid">
                                          <div className="pivot-summary-item">
                                            <label>Top Signatures</label>
                                            <ul>
                                              {(_a =
                                                pivotResult.top_signatures) ===
                                                null || _a === void 0
                                                ? void 0
                                                : _a.map((s, i) => (
                                                    <li key={i}>{s}</li>
                                                  ))}
                                            </ul>
                                          </div>
                                          <div className="pivot-summary-item">
                                            <label>Top Sources</label>
                                            <ul>
                                              {(_b =
                                                pivotResult.top_src_ips) ===
                                                null || _b === void 0
                                                ? void 0
                                                : _b.map((s, i) => (
                                                    <li key={i}>{s}</li>
                                                  ))}
                                            </ul>
                                          </div>
                                          <div className="pivot-summary-item">
                                            <label>Top Destinations</label>
                                            <ul>
                                              {(_c =
                                                pivotResult.top_dest_ips) ===
                                                null || _c === void 0
                                                ? void 0
                                                : _c.map((s, i) => (
                                                    <li key={i}>{s}</li>
                                                  ))}
                                            </ul>
                                          </div>
                                        </div>
                                        <div className="pivot-logs">
                                          <label>
                                            Sample Evidence (Last 10)
                                          </label>
                                          <div className="evidence-list mini">
                                            {pivotResult.sample_logs.map(
                                              (log) => (
                                                <div
                                                  className="log-entry mini"
                                                  key={log._id}
                                                >
                                                  <pre className="log-json">
                                                    {JSON.stringify(
                                                      log._source,
                                                      null,
                                                      2,
                                                    )}
                                                  </pre>
                                                </div>
                                              ),
                                            )}
                                          </div>
                                        </div>
                                      </div>
                                    ) : (
                                      <div className="empty-pivot-result">
                                        No logs found for this query.
                                      </div>
                                    )}
                                  </div>
                                );
                              })}
                        </div>
                      </section>
                    )}
                    <section className="case-evidence">
                      <h3>
                        EVIDENCE (Last{" "}
                        {((_u = selectedCaseData.sample_logs) === null ||
                        _u === void 0
                          ? void 0
                          : _u.length) || 0}
                        )
                      </h3>
                      <div className="evidence-list">
                        {(_v = selectedCaseData.sample_logs) === null ||
                        _v === void 0
                          ? void 0
                          : _v.map((log) => (
                              <div className="log-entry" key={log._id}>
                                <div className="log-meta">
                                  <span className="log-time">
                                    {log._source["@timestamp"]
                                      ? new Date(
                                          log._source["@timestamp"],
                                        ).toLocaleString()
                                      : "N/A"}
                                  </span>
                                  <span className="log-id">ID: {log._id}</span>
                                </div>
                                <pre className="log-json">
                                  {JSON.stringify(log._source, null, 2)}
                                </pre>
                              </div>
                            ))}
                      </div>
                    </section>
                  </div>
                </div>
              </div>
            )}
            {ticketLoading && (
              <div className="ticket-loading-overlay">
                <div className="ticket-loading-modal">
                  <div className="spinner" />
                  <h3>Preparing Ticket Evidence...</h3>
                  <p>
                    {telemetrySource === "opensearch"
                      ? "Preparing OpenSearch-backed ticket details."
                      : "Please wait while we secure a direct OpenSearch link for your ticket."}
                  </p>
                </div>
              </div>
            )}
            {isSubmitting && (
              <div className="ticket-loading-overlay">
                <div className="ticket-loading-modal">
                  <div className="spinner" />
                  <h3>Creating Mantis Ticket...</h3>
                  <p>
                    Submitting investigation details and saving to local
                    history.
                  </p>
                </div>
              </div>
            )}
            {ticketPreview && (
              <div className="ticket-preview-overlay">
                <div className="ticket-preview-modal">
                  <header className="ticket-preview-header">
                    <div className="title-group">
                      <h2>Mantis Ticket Preview</h2>
                      <span className="subtitle">
                        Review ticket details before final submission
                      </span>
                    </div>
                    <button
                      className="close-btn"
                      onClick={() => setTicketPreview(null)}
                    >
                      ×
                    </button>
                  </header>
                  <div className="ticket-preview-content">
                    <section className="preview-section">
                      <h3>MANTIS FIELDS</h3>
                      <div className="preview-grid">
                        <div className="preview-field">
                          <label>Project</label>
                          <input
                            type="text"
                            className="preview-input"
                            value={ticketPreview.project}
                            onChange={(e) => {
                              const val = e.target.value;
                              setTicketPreview((prev) =>
                                prev
                                  ? {
                                      ...prev,
                                      project: val,
                                      api_payload: {
                                        ...prev.api_payload,
                                        project: {
                                          name: val,
                                        },
                                      },
                                    }
                                  : null,
                              );
                            }}
                          />
                        </div>
                        <div className="preview-field">
                          <label>Category</label>
                          <input
                            type="text"
                            className="preview-input"
                            value={ticketPreview.category}
                            onChange={(e) => {
                              const val = e.target.value;
                              setTicketPreview((prev) =>
                                prev
                                  ? {
                                      ...prev,
                                      category: val,
                                      api_payload: {
                                        ...prev.api_payload,
                                        category: {
                                          name: val,
                                        },
                                      },
                                    }
                                  : null,
                              );
                            }}
                          />
                        </div>
                        <div className="preview-field">
                          <label>Reproducibility</label>
                          <select
                            className="preview-input"
                            value={ticketPreview.reproducibility}
                            onChange={(e) => {
                              const val = e.target.value;
                              setTicketPreview((prev) =>
                                prev
                                  ? {
                                      ...prev,
                                      reproducibility: val,
                                      api_payload: {
                                        ...prev.api_payload,
                                        reproducibility: {
                                          name: val,
                                        },
                                      },
                                    }
                                  : null,
                              );
                            }}
                          >
                            <option value="have not tried">
                              have not tried
                            </option>
                            <option value="always">always</option>
                            <option value="sometimes">sometimes</option>
                            <option value="random">random</option>
                            <option value="unable to reproduce">
                              unable to reproduce
                            </option>
                            <option value="N/A">N/A</option>
                          </select>
                        </div>
                        <div className="preview-field">
                          <label>Severity</label>
                          <select
                            className="preview-input"
                            value={ticketPreview.severity}
                            onChange={(e) => {
                              const val = e.target.value;
                              setTicketPreview((prev) =>
                                prev
                                  ? {
                                      ...prev,
                                      severity: val,
                                      api_payload: {
                                        ...prev.api_payload,
                                        severity: {
                                          name: val,
                                        },
                                      },
                                    }
                                  : null,
                              );
                            }}
                          >
                            <option value="feature">feature</option>
                            <option value="trivial">trivial</option>
                            <option value="text">text</option>
                            <option value="tweak">tweak</option>
                            <option value="minor">minor</option>
                            <option value="major">major</option>
                            <option value="crash">crash</option>
                            <option value="block">block</option>
                          </select>
                        </div>
                        <div className="preview-field">
                          <label>Priority</label>
                          <select
                            className="preview-input"
                            value={ticketPreview.priority}
                            onChange={(e) => {
                              const val = e.target.value;
                              setTicketPreview((prev) =>
                                prev
                                  ? {
                                      ...prev,
                                      priority: val,
                                      api_payload: {
                                        ...prev.api_payload,
                                        priority: {
                                          name: val,
                                        },
                                      },
                                    }
                                  : null,
                              );
                            }}
                          >
                            <option value="none">none</option>
                            <option value="low">low</option>
                            <option value="normal">normal</option>
                            <option value="high">high</option>
                            <option value="urgent">urgent</option>
                            <option value="immediate">immediate</option>
                          </select>
                        </div>
                        <div className="preview-field">
                          <label>View Status</label>
                          <select
                            className="preview-input"
                            value={ticketPreview.view_status}
                            onChange={(e) => {
                              const val = e.target.value;
                              setTicketPreview((prev) =>
                                prev
                                  ? {
                                      ...prev,
                                      view_status: val,
                                      api_payload: {
                                        ...prev.api_payload,
                                        view_state: {
                                          name: val,
                                        },
                                      },
                                    }
                                  : null,
                              );
                            }}
                          >
                            <option value="public">public</option>
                            <option value="private">private</option>
                          </select>
                        </div>
                      </div>
                      <div className="preview-field full-width">
                        <label>Summary</label>
                        <input
                          type="text"
                          className="preview-input summary-input"
                          value={ticketPreview.summary}
                          onChange={(e) => {
                            const val = e.target.value;
                            setTicketPreview((prev) =>
                              prev
                                ? {
                                    ...prev,
                                    summary: val,
                                    api_payload: {
                                      ...prev.api_payload,
                                      summary: val,
                                    },
                                  }
                                : null,
                            );
                          }}
                        />
                      </div>
                      <div className="preview-field full-width">
                        <label>Description</label>
                        <textarea
                          className="preview-textarea"
                          rows={10}
                          value={ticketPreview.description}
                          onChange={(e) => {
                            const val = e.target.value;
                            setTicketPreview((prev) =>
                              prev
                                ? {
                                    ...prev,
                                    description: val,
                                    api_payload: {
                                      ...prev.api_payload,
                                      description: val,
                                    },
                                  }
                                : null,
                            );
                          }}
                        />
                      </div>
                      <div className="preview-field full-width">
                        <label>Steps To Reproduce</label>
                        <textarea
                          className="preview-textarea"
                          rows={4}
                          value={ticketPreview.steps_to_reproduce}
                          placeholder={
                            telemetrySource === "opensearch"
                              ? "Paste OpenSearch Dashboards link or manual reproduction steps here..."
                              : "Paste OpenSearch Link or manual reproduction steps here..."
                          }
                          onChange={(e) => {
                            const val = e.target.value;
                            setTicketPreview((prev) =>
                              prev
                                ? {
                                    ...prev,
                                    steps_to_reproduce: val,
                                    api_payload: {
                                      ...prev.api_payload,
                                      steps_to_reproduce: val,
                                    },
                                  }
                                : null,
                            );
                          }}
                        />
                      </div>
                      <div className="preview-field full-width">
                        <label>Additional Information</label>
                        <textarea
                          className="preview-textarea"
                          rows={6}
                          value={ticketPreview.additional_information}
                          onChange={(e) => {
                            const val = e.target.value;
                            setTicketPreview((prev) =>
                              prev
                                ? {
                                    ...prev,
                                    additional_information: val,
                                    api_payload: {
                                      ...prev.api_payload,
                                      additional_information: val,
                                    },
                                  }
                                : null,
                            );
                          }}
                        />
                      </div>
                    </section>
                    <section className="preview-section payload-section">
                      <h3>API PAYLOAD PREVIEW (JSON)</h3>
                      <pre className="payload-json">
                        {JSON.stringify(ticketPreview.api_payload, null, 2)}
                      </pre>
                    </section>
                  </div>
                  <footer className="ticket-preview-footer">
                    <button
                      className="preview-secondary-btn"
                      onClick={() => setTicketPreview(null)}
                      disabled={isSubmitting}
                    >
                      Close Preview
                    </button>
                    <button
                      className="preview-primary-btn"
                      onClick={handleSubmitTicket}
                      disabled={isSubmitting}
                    >
                      {isSubmitting
                        ? "Submitting..."
                        : "Confirm & Submit Ticket"}
                    </button>
                  </footer>
                </div>
              </div>
            )}
          </>
        ) : currentView === "cases-v1" ? (
          <CaseManagerV1Page />
        ) : (
          <TicketsPage />
        )}
      </main>
    </div>
  );
}
export default App;
