import OpenAI from "openai";
import dotenv from 'dotenv';
import { buildCaseManagerAnalysisPrompt } from './services/caseAnalysisContext.service.js';

dotenv.config();

function getOpenAIClient() {
    if (!process.env.OPENAI_API_KEY) {
        throw new Error('OPENAI_API_KEY is not configured on the server.');
    }

    return new OpenAI({
        apiKey: process.env.OPENAI_API_KEY,
    });
}

const PIVOT_TYPES = [
  "src_ip", "dest_ip", "signature", "cve", "dest_port", 
  "http_url", "target_host", "dns_rrname", "tls_sni", 
  "extended_timerange_src_ip", "extended_timerange_dest_ip"
];

const SOC_RULES = `
INVESTIGATION RULES:
1. Identify the most critical pivots needed to confirm the threat (max 2 total for the entire investigation).
2. If enough evidence exists to ESCALATE, stop requesting pivots and return status: "final_verdict" and verdict: "ESCALATE".
3. If enough evidence exists to mark as LIKELY_FALSE_POSITIVE or SUSPICIOUS_MONITOR, stop requesting pivots and return status: "final_verdict" and the corresponding verdict.
4. If you have already analyzed results from 2 investigation pivots, you MUST return status: "final_verdict" with a final verdict.
5. "more_pivots_required" should be true only if status is NOT "final_verdict".
`;

export async function analyzeCase(caseData) {
    const prompt = `
    Analyze the following security case and provide a detailed threat assessment.
    
    ${SOC_RULES}
    
    CASE DATA:
    - Signature: ${caseData.signature}
    - Representative Source IP: ${caseData.src_ip}
    - Affected Source IPs: ${(caseData.affected_src_ips || []).join(', ') || 'N/A'}
    - Destination IP: ${caseData.dest_ip}
    - Affected Destination IPs: ${(caseData.affected_dest_ips || []).join(', ') || 'N/A'}
    - Destination Port: ${caseData.dest_port}
    - Target Host: ${caseData.target_host}
    - Log Count: ${caseData.log_count}
    - First Seen: ${caseData.first_seen}
    - Last Seen: ${caseData.last_seen}
    
    SAMPLE LOGS (last 10):
    ${JSON.stringify(caseData.sample_logs, null, 2)}
    
    Please provide the analysis in the following JSON format:
    {
      "status": "pivot_required | final_verdict",
      "verdict": "ESCALATE | LIKELY_FALSE_POSITIVE | SUSPICIOUS_MONITOR | null",
      "threat_assessment": "Detailed assessment of the threat level and nature",
      "analyst_reasoning": "A educational 'side note' explaining WHY this is malicious, what the attacker is trying to achieve (e.g., steal a specific file, gain persistence, etc.), and how this attack works to help a junior analyst learn.",
      "reasoning": ["point 1", "point 2", "..."],
      "confidence": 0.85,
      "attack_classification": "MITRE ATT&CK category or common attack name",
      "ticket_recommended": true | false,
      "more_pivots_required": true | false,
      "recommended_pivot_queries": [
        {
          "pivot_id": "unique_string",
          "type": "one of: ${PIVOT_TYPES.join(', ')}",
          "label": "Short button label",
          "reason": "Why this pivot is critical to confirm the case",
          "value": "The specific value to pivot on",
          "query": "The actual Kibana Lucene query string"
        }
      ],
      "ticket_recommendation": "Recommendation on whether to escalate or close"
    }
    
    ONLY return the JSON object. No extra text.
    `;

    try {
        const response = await getOpenAIClient().chat.completions.create({
            model: "gpt-4o",
            messages: [
                { role: "system", content: "You are a senior SOC analyst assistant." },
                { role: "user", content: prompt }
            ],
            response_format: { type: "json_object" }
        });

        const text = response.choices[0].message.content;
        return JSON.parse(text);
    } catch (error) {
        console.error("Investigation Analysis Error:", error);
        throw new Error("Failed to analyze case: " + error.message);
    }
}

export async function reassessCase(caseData, previousAnalysis, pivotResult, totalPivotsDone = 1) {
    const prompt = `
    Refine the security investigation based on the results of a pivot query.
    
    ${SOC_RULES}
    INVESTIGATION PROGRESS: You have completed ${totalPivotsDone} out of 2 allowed pivot opportunities.
    
    ORIGINAL CASE OVERVIEW:
    - Signature: ${caseData.signature}
    - Representative Source IP: ${caseData.src_ip}
    - Affected Source IPs: ${(caseData.affected_src_ips || []).join(', ') || 'N/A'}
    - Destination IP: ${caseData.dest_ip}
    - Target Host: ${caseData.target_host}
    
    PREVIOUS INVESTIGATION ASSESSMENT:
    - Assessment: ${previousAnalysis.threat_assessment || previousAnalysis.updated_assessment}
    - Classification: ${previousAnalysis.attack_classification || previousAnalysis.classification}
    - Confidence: ${previousAnalysis.confidence}
    
    EXECUTED PIVOT:
    - Query: ${pivotResult.query}
    
    PIVOT RESULT SUMMARY:
    - Total Hits: ${pivotResult.total_hits}
    - Top Signatures: ${pivotResult.top_signatures?.join(', ')}
    - Top Source IPs: ${pivotResult.top_src_ips?.join(', ')}
    - Top Destination IPs: ${pivotResult.top_dest_ips?.join(', ')}
    - Top Hosts: ${pivotResult.top_hosts?.join(', ')}
    
    PIVOT SAMPLE LOGS (max 10):
    ${JSON.stringify(pivotResult.sample_logs, null, 2)}
    
    Please provide an updated analysis in the following JSON format:
    {
      "case_id": "${caseData.case_id}",
      "status": "pivot_required | final_verdict",
      "verdict": "ESCALATE | LIKELY_FALSE_POSITIVE | SUSPICIOUS_MONITOR | null",
      "updated_assessment": "How the new data changes or confirms the previous assessment",
      "confidence": 0.92,
      "classification": "Updated MITRE ATT&CK category or attack name",
      "ticket_recommended": true | false,
      "more_pivots_required": true | false,
      "analyst_reasoning": "A educational 'side note' explaining WHY this is malicious, what the attacker is trying to achieve (e.g., steal a specific file, gain persistence, etc.), and how this attack works to help a junior analyst learn.",
      "reasoning": ["point 1", "point 2", "..."],
      "recommended_pivots": [
        {
          "pivot_id": "unique_string",
          "type": "one of: ${PIVOT_TYPES.join(', ')}",
          "label": "Short button label",
          "reason": "Why this pivot is the next most critical step",
          "value": "The specific value to pivot on",
          "query": "The actual Kibana Lucene query string"
        }
      ],
      "recommended_actions": ["Action 1", "Action 2", "..."]
    }
    
    ONLY return the JSON object. No extra text.
    `;

    try {
        const response = await getOpenAIClient().chat.completions.create({
            model: "gpt-4o",
            messages: [
                { role: "system", content: "You are a senior SOC analyst assistant specializing in multi-step investigations." },
                { role: "user", content: prompt }
            ],
            response_format: { type: "json_object" }
        });

        const text = response.choices[0].message.content;
        return JSON.parse(text);
    } catch (error) {
        console.error("AI Reassessment Error:", error);
        throw new Error("Failed to reassess case with OpenAI: " + error.message);
    }
}

export async function summarizeTicket(ticketData) {
    const prompt = `
    Provide a concise and professional summary of the following Mantis ticket.
    
    TICKET DATA:
    - ID: ${ticketData.id}
    - Summary: ${ticketData.summary}
    - Description: ${ticketData.description}
    - Status: ${ticketData.status?.name}
    - Severity: ${ticketData.severity?.name}
    - Priority: ${ticketData.priority?.name}
    - Created At: ${ticketData.created_at}
    - Additional Info: ${ticketData.additional_information || 'N/A'}
    
    Please provide the summary in the following JSON format:
    {
      "executive_summary": "A brief 2-3 sentence overview of the issue",
      "key_findings": ["point 1", "point 2", "..."],
      "technical_details": {
        "source_ip": "if found in description",
        "dest_ip": "if found in description",
        "signature": "if found in description"
      },
      "recommended_next_steps": ["action 1", "action 2"]
    }
    
    ONLY return the JSON object. No extra text.
    `;

    try {
        const response = await getOpenAIClient().chat.completions.create({
            model: "gpt-4o",
            messages: [
                { role: "system", content: "You are a senior SOC analyst assistant." },
                { role: "user", content: prompt }
            ],
            response_format: { type: "json_object" }
        });

        const text = response.choices[0].message.content;
        return JSON.parse(text);
    } catch (error) {
        console.error("AI Summarization Error:", error);
        throw new Error("Failed to summarize ticket with OpenAI: " + error.message);
    }
}

export async function analyzeCaseWithContext(analysisContext) {
    const prompt = buildCaseManagerAnalysisPrompt(analysisContext);

    try {
        const response = await getOpenAIClient().chat.completions.create({
            model: process.env.OPENAI_CASE_MANAGER_MODEL || 'gpt-4o',
            messages: [
                {
                    role: 'system',
                    content: 'You are a senior SOC analyst. Correlate current telemetry with prior tickets and return only valid JSON.',
                },
                { role: 'user', content: prompt },
            ],
            response_format: { type: 'json_object' },
        });

        const text = response.choices[0].message.content;
        return JSON.parse(text);
    } catch (error) {
        console.error('Case Manager Analysis Error:', error);
        throw new Error('Failed to analyze case with historical context: ' + error.message);
    }
}
