# Interview Prep

## Project Overview

S.H.A.M.S. is an analyst-in-the-loop SOC triage prototype. It collects security telemetry from OpenSearch, groups related events into case candidates, uses AI to assist with assessment and pivot selection, and supports MantisBT ticket workflows.

## Questions To Be Ready For

1. What problem were you solving?

Raw logs and alerts do not automatically become investigations. The project reduces repetitive triage steps by grouping related telemetry, surfacing evidence, recommending pivots, and preparing ticket context.

2. Why OpenSearch?

The final working environment exposed security telemetry through OpenSearch. The collector was adapted to the fields actually available in that environment instead of assuming a generic Kibana/ELK schema.

3. What telemetry did you use?

The backend queries OpenSearch datasets including `alert`, `dns`, `http`, `notice`, `conn`, and `ssl`, with fields such as `rule.name`, `rule.category`, `dns.host`, `zeek.dns.query`, `http.host`, `http.uri`, `url.full`, `zeek.notice.note`, `zeek.notice.msg`, and `zeek.ssl.server_name`.

4. How does case grouping work?

Events are normalized, categorized, filtered for noise, and grouped with category-aware logic. The grouped case preserves representative indicators, affected hosts/IPs, ports, timestamps, log counts, priority signals, and sample evidence.

5. How did you use AI safely?

AI is used for structured assistance, not automatic enforcement. The backend asks for JSON output, limits pivots, requires reassessment after pivot results, and keeps the analyst in control of final ticket submission.

6. What are the main limitations?

The system depends on field quality, OpenSearch access, prompt reliability, and local JSON storage. It lacks production authentication, multi-user authorization, centralized secret management, and production-grade persistence.

7. What would you improve next?

Add authentication and RBAC, move local JSON storage to a database, add tests, add redaction controls, improve telemetry schema configuration, add audit logs, and containerize the stack for easier deployment.

8. What did you learn?

SOC automation is most useful when it preserves analyst context. Good grouping, evidence links, duplicate checks, and ticket quality are as important as the initial detection logic.

9. How would you explain this to a recruiter?

It is a security-engineering portfolio project that shows I can connect telemetry, backend services, frontend workflows, AI-assisted analysis, and ticketing into a practical SOC workflow.

10. How would you explain this to a senior security engineer?

It is a prototype triage orchestration layer over OpenSearch. It normalizes selected Suricata/Zeek fields, groups events into case candidates, ranks them, sends bounded evidence to an LLM for analyst-assistive reasoning, executes OpenSearch pivots, and writes MantisBT ticket context while retaining local investigation history.
