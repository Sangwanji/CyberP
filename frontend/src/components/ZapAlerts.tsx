export interface ZapAlert {
  alert: string;
  risk: 'High' | 'Medium' | 'Low' | 'Informational';
  confidence: string;
  description: string;
  solution: string;
  cweid: string;
  url: string;
  insight?: ZapAlertInsight;
}

export interface ZapAlertInsight {
  whatItIs: string;
  whyDangerous: string;
  exampleAttack: string;
  fix: string;
  secureCodeExample: string;
  codeLanguage: string;
  source: 'gemini' | 'fallback';
}

export interface ZapOverview {
  title: string;
  summary: string;
  impact: string;
  riskLevel: string;
  recommendations: string[];
  quickWins: string[];
  nextStep: string;
  source: 'gemini' | 'fallback';
}

interface ZapAlertsProps {
  alerts: ZapAlert[];
  overview?: ZapOverview | null;
}

export default function ZapAlerts({ alerts, overview }: ZapAlertsProps) {
  if (!alerts || alerts.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-cyber-line bg-cyber-bg/60 p-6 text-sm leading-6 text-cyber-muted text-center">
        No vulnerabilities detected by OWASP ZAP.
      </div>
    );
  }

  const uniqueAlertsMap = new Map<string, ZapAlert & { instances: number; urls: string[] }>();

  alerts.forEach((alert) => {
    if (!uniqueAlertsMap.has(alert.alert)) {
      uniqueAlertsMap.set(alert.alert, { ...alert, instances: 1, urls: [alert.url] });
    } else {
      const existing = uniqueAlertsMap.get(alert.alert)!;
      existing.instances += 1;
      if (!existing.urls.includes(alert.url)) {
        existing.urls.push(alert.url);
      }
    }
  });

  const uniqueAlerts = Array.from(uniqueAlertsMap.values());

  const riskOrder: Array<ZapAlert['risk']> = ['High', 'Medium', 'Low', 'Informational'];

  const groupedAlerts = uniqueAlerts.reduce(
    (acc, alert) => {
      if (!acc[alert.risk]) {
        acc[alert.risk] = [];
      }
      acc[alert.risk].push(alert);
      return acc;
    },
    {} as Record<ZapAlert['risk'], (ZapAlert & { instances: number; urls: string[] })[]>
  );

  const getRiskTone = (risk: string) => {
    switch (risk) {
      case 'High':
        return 'border-red-500/40 bg-red-500/10 text-red-100';
      case 'Medium':
        return 'border-amber-500/40 bg-amber-500/10 text-amber-100';
      case 'Low':
        return 'border-yellow-500/40 bg-yellow-500/10 text-yellow-100';
      case 'Informational':
        return 'border-blue-500/40 bg-blue-500/10 text-blue-100';
      default:
        return 'border-cyber-line bg-cyber-bg/70 text-cyber-text';
    }
  };

  const riskCounts = riskOrder.reduce(
    (acc, risk) => {
      acc[risk] = groupedAlerts[risk]?.length ?? 0;
      return acc;
    },
    {} as Record<ZapAlert['risk'], number>,
  );

  return (
    <div className="space-y-8">
      {overview ? (
        <section className="rounded-[2rem] border border-cyber-accent/30 bg-gradient-to-br from-cyber-bg via-cyber-panel/80 to-cyber-panelAlt/70 p-6 shadow-glow">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="space-y-2">
              <p className="text-xs uppercase tracking-[0.3em] text-cyber-accent">Overall result</p>
              <h3 className="text-2xl font-black tracking-tight text-cyber-text">{overview.title}</h3>
              <p className="max-w-4xl text-sm leading-6 text-cyber-muted">{overview.summary}</p>
            </div>
            <span className="rounded-full border border-current/20 px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] text-cyber-text">
              {overview.riskLevel} Risk
            </span>
          </div>

          <div className="mt-6 grid gap-4 lg:grid-cols-2">
            <div className="rounded-3xl border border-white/10 bg-black/10 p-5">
              <p className="text-xs uppercase tracking-[0.2em] text-cyber-muted">Impact</p>
              <p className="mt-2 text-sm leading-6 text-cyber-text">{overview.impact}</p>
            </div>
            <div className="rounded-3xl border border-white/10 bg-black/10 p-5">
              <p className="text-xs uppercase tracking-[0.2em] text-cyber-muted">Next step</p>
              <p className="mt-2 text-sm leading-6 text-cyber-text">{overview.nextStep}</p>
            </div>
          </div>

          <div className="mt-6 grid gap-4 lg:grid-cols-2">
            <div className="rounded-3xl border border-white/10 bg-black/10 p-5">
              <p className="text-xs uppercase tracking-[0.2em] text-cyber-muted">Recommendations</p>
              <ul className="mt-3 space-y-3 text-sm leading-6 text-cyber-text">
                {overview.recommendations.map((item, index) => (
                  <li key={index} className="flex gap-3">
                    <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-cyber-accent" />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div className="rounded-3xl border border-white/10 bg-black/10 p-5">
              <p className="text-xs uppercase tracking-[0.2em] text-cyber-muted">Quick wins</p>
              <ul className="mt-3 space-y-3 text-sm leading-6 text-cyber-text">
                {overview.quickWins.map((item, index) => (
                  <li key={index} className="flex gap-3">
                    <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-cyber-accentSoft" />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </section>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <div className="rounded-3xl border border-cyber-line bg-cyber-bg/70 p-4">
          <p className="text-xs uppercase tracking-[0.25em] text-cyber-muted">Findings</p>
          <p className="mt-2 text-3xl font-black text-cyber-text">{uniqueAlerts.length}</p>
        </div>
        {riskOrder.map((risk) => (
          <div key={risk} className="rounded-3xl border border-cyber-line bg-cyber-bg/70 p-4">
            <p className="text-xs uppercase tracking-[0.25em] text-cyber-muted">{risk} Risk</p>
            <p className="mt-2 text-3xl font-black text-cyber-text">{riskCounts[risk]}</p>
          </div>
        ))}
      </div>

      {riskOrder.map((risk) => {
        const riskAlerts = groupedAlerts[risk];
        if (!riskAlerts) return null;

        return (
          <div key={risk} className="space-y-4">
            <h3 className="flex items-center text-xl font-bold text-cyber-text">
              <span
                className={`mr-3 inline-block h-4 w-4 rounded-full ${
                  risk === 'High'
                    ? 'bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.8)]'
                    : risk === 'Medium'
                      ? 'bg-amber-500 shadow-[0_0_8px_rgba(245,158,11,0.8)]'
                      : risk === 'Low'
                        ? 'bg-yellow-500 shadow-[0_0_8px_rgba(234,179,8,0.8)]'
                        : 'bg-blue-500 shadow-[0_0_8px_rgba(59,130,246,0.8)]'
                }`}
              />
              {risk} Risk ({riskAlerts.length} type{riskAlerts.length !== 1 ? 's' : ''})
            </h3>
            <div className="grid gap-6 lg:grid-cols-2 2xl:grid-cols-3">
              {riskAlerts.map((alert, idx) => (
                <details
                  key={idx}
                  className={`group overflow-hidden rounded-3xl border shadow-sm transition hover:shadow-glow ${getRiskTone(alert.risk)}`}
                >
                  <summary className="flex cursor-pointer list-none items-start justify-between gap-4 p-5 [&::-webkit-details-marker]:hidden">
                    <div className="space-y-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <h4 className="text-lg font-bold text-cyber-text">{alert.alert}</h4>
                        {alert.cweid && alert.cweid !== '-1' && (
                          <span className="shrink-0 rounded-full border border-current/20 px-2 py-0.5 text-[0.7rem] font-semibold uppercase tracking-[0.2em] opacity-90">
                            CWE-{alert.cweid}
                          </span>
                        )}
                        <span className="shrink-0 rounded-full border border-current/20 px-2 py-0.5 text-[0.7rem] font-semibold uppercase tracking-[0.2em] opacity-90">
                          {alert.insight?.source === 'gemini' ? 'Gemini' : 'Fallback'}
                        </span>
                      </div>
                      <p className="text-sm text-current/85">
                        Confidence: {alert.confidence} · Affected URLs: {alert.instances}
                      </p>
                    </div>
                    <span className="rounded-full border border-current/20 px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] opacity-90">
                      Open
                    </span>
                  </summary>

                  <div className="border-t border-white/10 p-5">
                    <div className="grid gap-4 lg:grid-cols-2">
                      <div className="rounded-2xl border border-white/10 bg-black/10 p-4">
                        <p className="text-xs uppercase tracking-[0.2em] opacity-70">What it is</p>
                        <p className="mt-2 text-sm leading-6 text-cyber-text">
                          {alert.insight?.whatItIs ?? alert.description}
                        </p>
                      </div>
                      <div className="rounded-2xl border border-white/10 bg-black/10 p-4">
                        <p className="text-xs uppercase tracking-[0.2em] opacity-70">Why it is dangerous</p>
                        <p className="mt-2 text-sm leading-6 text-cyber-text">
                          {alert.insight?.whyDangerous ?? alert.description}
                        </p>
                      </div>
                      <div className="rounded-2xl border border-white/10 bg-black/10 p-4">
                        <p className="text-xs uppercase tracking-[0.2em] opacity-70">Example attack</p>
                        <p className="mt-2 text-sm leading-6 text-cyber-text">
                          {alert.insight?.exampleAttack ?? 'An attacker could use this weakness to probe the application and trigger unsafe behavior.'}
                        </p>
                      </div>
                      <div className="rounded-2xl border border-white/10 bg-black/10 p-4">
                        <p className="text-xs uppercase tracking-[0.2em] opacity-70">Fix</p>
                        <p className="mt-2 text-sm leading-6 text-cyber-text">
                          {alert.insight?.fix ?? alert.solution}
                        </p>
                      </div>
                    </div>

                    <div className="mt-4 rounded-2xl border border-white/10 bg-black/10 p-4">
                      <p className="text-xs uppercase tracking-[0.2em] opacity-70">
                        Secure code example {alert.insight?.codeLanguage ? `(${alert.insight.codeLanguage})` : ''}
                      </p>
                      <pre className="mt-3 overflow-x-auto whitespace-pre-wrap rounded-xl border border-white/10 bg-black/30 p-4 text-xs leading-6 text-cyber-text">
{alert.insight?.secureCodeExample ?? 'Apply the recommended mitigation and validate the fix with a rescan.'}
                      </pre>
                    </div>

                    <div className="mt-4">
                      <p className="text-xs uppercase tracking-[0.2em] text-current/70">Affected URLs</p>
                      <div className="mt-2 flex flex-wrap gap-2">
                        {alert.urls.map((url, i) => (
                          <span
                            key={i}
                            className="rounded-full border border-white/10 bg-black/10 px-3 py-1 text-xs break-all"
                          >
                            {url}
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>
                </details>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
