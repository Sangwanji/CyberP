import dotenv from 'dotenv';
dotenv.config();

const GROQ_API_KEY = process.env.GROQ_API_KEY?.trim() ?? '';
const GROQ_MODEL = process.env.GROQ_MODEL?.trim() || 'llama-3.3-70b-versatile';

export function isGroqConfigured() {
  return Boolean(GROQ_API_KEY);
}

function toSingleLine(value, fallback) {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

export function enrichZapAlerts(alerts) {
  return alerts.map((alert) => {
    const name = toSingleLine(alert?.alert, 'Unknown vulnerability');
    const description = toSingleLine(
      alert?.description,
      'ZAP did not provide a detailed description for this finding.',
    );
    const solution = toSingleLine(
      alert?.solution,
      'Apply the remediation recommended by OWASP ZAP and verify the fix with a rescan.',
    );

    return {
      ...alert,
      insight: {
        whatItIs: `${name} is a weakness that ZAP detected while testing the target application.`,
        whyDangerous: description,
        exampleAttack: `An attacker could probe the application endpoints associated with ${name} and try to trigger the weakness for data exposure or unwanted behavior.`,
        fix: solution,
        secureCodeExample: 'Apply the recommended control at the affected endpoint, then retest to confirm the issue is gone.',
        codeLanguage: 'text',
        source: 'fallback',
      },
    };
  });
}

export async function callGroq(prompt, options = {}) {
  const {
    maxTokens = 500,
    temperature = 0.3,
    jsonMode = false,
  } = options;

  if (!GROQ_API_KEY) {
    throw new Error('Groq API key is not configured');
  }

  const finalPrompt = jsonMode
    ? `${prompt}\n\nIMPORTANT: Respond ONLY with valid JSON. Do not include any markdown formatting or explanations.`
    : prompt;

  try {
    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${GROQ_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: GROQ_MODEL,
        messages: [{ role: 'user', content: finalPrompt }],
        max_tokens: maxTokens,
        temperature,
        ...(jsonMode ? { response_format: { type: 'json_object' } } : {}),
      }),
    });

    if (!response.ok) {
      const errorBody = await response.text().catch(() => '');
      throw new Error(`Groq API error (${response.status}): ${errorBody}`);
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content;
    if (typeof content === 'string') {
      return content;
    }
    throw new Error('Unexpected response format from Groq API');
  } catch (error) {
    console.error('Groq API call failed:', error.message);
    throw error;
  }
}

export async function generateZapOverview(alerts, targetUrl) {
  const fallback = {
    title: 'ZAP scan summary',
    summary: alerts.length
      ? `ZAP found ${alerts.length} issue${alerts.length === 1 ? '' : 's'} across the application.`
      : 'ZAP did not return any findings for this scan.',
    impact: alerts.length
      ? 'The findings should be prioritized because they may expose sensitive data, weaken defenses, or make exploitation easier.'
      : 'No immediate ZAP findings were reported, but the target should still be retested after changes.',
    riskLevel: alerts.some((alert) => alert.risk === 'High')
      ? 'High'
      : alerts.some((alert) => alert.risk === 'Medium')
        ? 'Medium'
        : alerts.length
          ? 'Low'
          : 'Informational',
    recommendations: alerts.length
      ? [
          'Fix all High-risk findings first, then work through Medium and Low issues.',
          'Apply the specific mitigation in each ZAP card and verify the fix with a rescan.',
          'Review security headers, input validation, authentication, and access control around the affected paths.',
        ]
      : ['Keep scanning after major application changes and review security headers regularly.'],
    quickWins: alerts.length
      ? [
          'Patch the most severe issue first.',
          'Remove unnecessary exposed endpoints or test pages.',
          'Re-run ZAP after each fix to confirm the result.'
        ]
      : ['No quick wins were necessary from this scan.'],
    nextStep: alerts.length
      ? 'Start with the highest-risk issue and validate each fix with a fresh ZAP scan.'
      : 'Schedule another scan after deployment or configuration changes.',
    source: 'fallback',
  };

  if (!GROQ_API_KEY) {
    return fallback;
  }

  const riskCounts = (alerts || []).reduce(
    (acc, alert) => {
      const risk = alert?.risk ?? 'Informational';
      acc[risk] = (acc[risk] ?? 0) + 1;
      return acc;
    },
    {}
  );

  const topAlerts = (alerts || []).slice(0, 5).map((alert) =>
    `- ${alert?.alert ?? 'Unknown'} (${alert?.risk ?? 'Unknown'} Risk)`
  ).join('\n');

  const prompt = `You are a security analyst. Provide a brief, concise summary of this OWASP ZAP scan.\n\nReturn ONLY valid JSON with these keys: title, summary, impact, riskLevel, recommendations, quickWins, nextStep.\nKeep ALL text short and direct - max 1 sentence per field, max 3 items in arrays.\n\nURL: ${targetUrl}\nRisks: ${JSON.stringify(riskCounts)}\nTop Issues: ${topAlerts || 'None'}\n\nRespond with valid JSON only:`;

  try {
    const rawResponse = await callGroq(prompt, {
      maxTokens: 500,
      temperature: 0.2,
      jsonMode: true,
    });

    const cleanedResponse = String(rawResponse || '')
      .trim()
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```$/i, '')
      .trim();

    const parsed = JSON.parse(cleanedResponse);

    return {
      title: parsed.title || fallback.title,
      summary: parsed.summary || fallback.summary,
      impact: parsed.impact || fallback.impact,
      riskLevel: parsed.riskLevel || fallback.riskLevel,
      recommendations: Array.isArray(parsed.recommendations) && parsed.recommendations.length > 0
        ? parsed.recommendations
        : fallback.recommendations,
      quickWins: Array.isArray(parsed.quickWins) && parsed.quickWins.length > 0
        ? parsed.quickWins
        : fallback.quickWins,
      nextStep: parsed.nextStep || fallback.nextStep,
      source: 'groq',
    };
  } catch (error) {
    console.warn('Groq overview generation failed:', error.message);
    return fallback;
  }
}

export async function generateScanSummary(scanResult, zapAlerts, zapOverview) {
  let prompt = `Security Scan Analysis - Provide a BRIEF executive summary.\n\nFormat: Use markdown headers (##) and bullet points. Keep it SHORT and ACTIONABLE.\n\nRequired sections:\n## Executive Summary (2-3 sentences max)\n## Critical Findings (top 3 only)\n## Risk Level (one word: Critical/High/Medium/Low)\n## Recommendations (max 3 bullet points)\n## Next Steps (1 sentence)\n\n---\n\n`;

  if (scanResult) {
    const missingHeaders = (scanResult.headers ?? []).filter(h => h.status === 'Missing').length;
    prompt += `**Target:** ${scanResult.targetUrl}\n**Status:** ${scanResult.status} (HTTP ${scanResult.upstreamStatus ?? 'N/A'})\n**Security Headers:** ${missingHeaders} missing\n**SSL:** ${scanResult.certificate?.expiryStatus} (${scanResult.certificate?.daysRemaining ?? 'N/A'} days)\n**Open Ports:** ${scanResult.nmap?.ports?.length ?? 0}\n`;
  }

  if (zapAlerts && zapAlerts.length > 0) {
    const grouped = zapAlerts.reduce((acc, alert) => {
      if (!acc[alert.risk]) acc[alert.risk] = [];
      acc[alert.risk].push(alert);
      return acc;
    }, {});

    prompt += `\n**Vulnerabilities:** ${zapAlerts.length} total`;
    ['High', 'Medium', 'Low'].forEach((risk) => {
      if (grouped[risk]?.length > 0) {
        prompt += `\n- ${risk}: ${grouped[risk].length} (${grouped[risk].slice(0, 2).map(a => a.alert).join(', ')})`;
      }
    });
  }

  prompt += `\n\n---\n\nProvide your CONCISE analysis now:`;

  try {
    const summary = await callGroq(prompt, {
      maxTokens: 800,
      temperature: 0.3,
      jsonMode: false,
    });

    return summary;
  } catch (error) {
    console.error('Summary generation failed:', error.message);
    throw error;
  }
}

export async function generateVaptReport(scanResult, zapAlerts) {
  const missingHeaders = (scanResult?.headers ?? []).filter(h => h.status === 'Missing');
  const highHeaders = missingHeaders.filter(h => h.severity === 'high');
  const medHeaders = missingHeaders.filter(h => h.severity === 'medium');

  const zapGrouped = (zapAlerts ?? []).reduce((acc, a) => {
    if (!acc[a.risk]) acc[a.risk] = [];
    acc[a.risk].push(a);
    return acc;
  }, {});

  const facts = [];

  if (scanResult) {
    facts.push(`Target: ${scanResult.targetUrl}`);
    facts.push(`HTTP status: ${scanResult.upstreamStatus ?? 'N/A'}`);
    facts.push(`SSL: ${scanResult.certificate?.expiryStatus}, issuer=${scanResult.certificate?.issuer}, TLS=${scanResult.certificate?.tlsVersion ?? 'N/A'}, days=${scanResult.certificate?.daysRemaining ?? 'N/A'}`);
    facts.push(`WHOIS: registrar=${scanResult.whois?.registrar}, org=${scanResult.whois?.organization}, status=${scanResult.whois?.whoisStatus}`);
    const ports = (scanResult.nmap?.ports ?? []).map(p => `${p.port}/${p.protocol}(${p.service})`).join(', ') || 'none';
    facts.push(`Open ports (${scanResult.nmap?.ports?.length ?? 0}): ${ports}`);
    if (highHeaders.length) facts.push(`Missing HIGH-severity headers: ${highHeaders.map(h => h.header).join(', ')}`);
    if (medHeaders.length) facts.push(`Missing MEDIUM-severity headers: ${medHeaders.map(h => h.header).join(', ')}`);
  }

  ['High', 'Medium', 'Low', 'Informational'].forEach(risk => {
    const group = zapGrouped[risk];
    if (group?.length) {
      const names = group.slice(0, 3).map(a => `${a.alert}(CWE-${a.cweid})`).join(', ');
      const extra = group.length > 3 ? ` +${group.length - 3} more` : '';
      facts.push(`ZAP ${risk} (${group.length}): ${names}${extra}`);
    }
  });

  const prompt = `You are a security analyst writing a VAPT report.\nReturn ONLY a valid JSON object — no markdown fences, no extra text.\n\nJSON schema (all fields required):\n{\n  "executiveSummary": "<2-3 sentence overview>",\n  "totalFindings": { "critical": 0, "high": 0, "medium": 0, "low": 0, "informational": 0 },\n  "findings": [\n    {\n      "id": "VAPT-01",\n      "title": "<short title>",\n      "owasp": "<e.g. A05:2021 – Security Misconfiguration>",\n      "riskLevel": "<CRITICAL|HIGH|MEDIUM|LOW|INFORMATIONAL>",\n      "description": "<1-2 sentences>",\n      "evidence": "<observed data: headers/ports/domains/alerts>",\n      "impact": "<1 sentence on consequence>",\n      "remediation": "<1-2 concrete fix steps>"\n    }\n  ]\n}\n\nRules:\n- One finding per distinct issue.\n- Keep every string short — max 2 sentences.\n- riskLevel MUST be one of: CRITICAL, HIGH, MEDIUM, LOW, INFORMATIONAL.\n- totalFindings counts must match the actual findings array.\n- Do NOT include findings you have no data for.\n\nScan data:\n${facts.join('\n')}\n\nRespond with valid JSON only:`;

  try {
    const rawResponse = await callGroq(prompt, {
      maxTokens: 2000,
      temperature: 0.2,
      jsonMode: true,
    });

    const cleanedResponse = String(rawResponse || '')
      .trim()
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```$/i, '')
      .trim();

    const parsed = JSON.parse(cleanedResponse);

    return parsed;
  } catch (error) {
    console.error('VAPT report generation failed:', error.message);
    throw error;
  }
}

export { generateScanSummary as generateSummary };
export default {
  callGroq,
  isGroqConfigured,
  enrichZapAlerts,
  generateZapOverview,
  generateScanSummary,
  generateVaptReport,
  generateSummary: generateScanSummary,
};
