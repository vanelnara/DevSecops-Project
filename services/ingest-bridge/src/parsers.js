function severityFromCvss(score) {
  const value = Number(score || 0);
  if (value >= 9) return 'critical';
  if (value >= 7) return 'high';
  if (value >= 4) return 'medium';
  return 'low';
}

function mapTrivySeverity(value = '') {
  const normalized = String(value).toUpperCase();
  if (normalized === 'CRITICAL') return 'critical';
  if (normalized === 'HIGH') return 'high';
  if (normalized === 'MEDIUM') return 'medium';
  return 'low';
}

export function parseGitleaks(report) {
  const items = Array.isArray(report) ? report : [];
  return items.map((item, index) => ({
    finding_key: `SEC-GL-${item.Fingerprint || item.RuleID || index + 1}`.slice(0, 64),
    severity: 'critical',
    title: item.Description || `Secret detected: ${item.RuleID || 'unknown rule'}`,
    source: 'Gitleaks',
    asset: item.File || item.Match || 'repository',
    status: 'open',
    confidence: 98,
    raw: item,
  }));
}

export function parseTrivy(report) {
  const findings = [];
  const results = report?.Results || [];
  for (const result of results) {
    for (const vuln of result.Vulnerabilities || []) {
      findings.push({
        finding_key: vuln.VulnerabilityID || `TRIVY-${findings.length + 1}`,
        severity: mapTrivySeverity(vuln.Severity),
        title: vuln.Title || `${vuln.VulnerabilityID} in ${vuln.PkgName}`,
        source: 'Trivy',
        asset: `${result.Target || 'image'}:${vuln.PkgName || 'package'}`,
        status: 'open',
        confidence: 95,
        raw: vuln,
      });
    }
  }
  return findings;
}

export function parseDependencyCheck(report) {
  const findings = [];
  const deps = report?.dependencies || [];
  for (const dep of deps) {
    for (const vuln of dep.vulnerabilities || []) {
      const score =
        vuln.cvssv3?.baseScore ||
        vuln.cvssv2?.score ||
        vuln.cvssScore ||
        0;
      findings.push({
        finding_key: vuln.name || `OWASP-${findings.length + 1}`,
        severity: severityFromCvss(score),
        title: vuln.description
          ? `${vuln.name}: ${String(vuln.description).slice(0, 120)}`
          : `Vulnerability ${vuln.name}`,
        source: 'OWASP',
        asset: dep.fileName || dep.filePath || 'dependency',
        status: 'open',
        confidence: 92,
        raw: vuln,
      });
    }
  }
  return findings;
}

export function computeRiskScore(findings) {
  const weights = { critical: 18, high: 9, medium: 3, low: 1 };
  const raw = findings.reduce((sum, item) => sum + (weights[item.severity] || 0), 0);
  return Math.min(100, raw);
}

export function summarizeSeverities(findings) {
  const summary = { critical: 0, high: 0, medium: 0, low: 0 };
  for (const item of findings) {
    if (summary[item.severity] !== undefined) summary[item.severity] += 1;
  }
  return summary;
}
