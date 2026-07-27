/**
 * SentinelOps AI agent configuration.
 * Scopes the security copilot to DevOps / DevSecOps / networking / cloud
 * and related IT engineering domains.
 */

export const AGENT_NAME = 'SentinelOps Security Copilot';
export const AGENT_VERSION = '1.0.0';

export const ALLOWED_DOMAINS = [
  'DevSecOps & application security',
  'CI/CD and Jenkins pipelines',
  'DevOps / SRE / platform engineering',
  'Cloud engineering (AWS, Azure, GCP, Kubernetes)',
  'Networking, firewalls, DNS, load balancing',
  'Containers, IaC, GitOps, Argo CD',
  'Secrets, SAST/SCA, vulnerability management',
  'Observability and incident response for IT systems',
];

/** Keywords that strongly suggest an in-scope IT/engineering question. */
export const IN_SCOPE_HINTS = [
  'devops', 'devsecops', 'jenkins', 'pipeline', 'ci/cd', 'cicd', 'docker', 'kubernetes', 'k8s',
  'helm', 'argo', 'argocd', 'terraform', 'ansible', 'cloud', 'aws', 'azure', 'gcp', 'network',
  'firewall', 'dns', 'vpn', 'load balancer', 'nginx', 'ingress', 'tls', 'ssl', 'certificate',
  'sast', 'sca', 'trivy', 'gitleaks', 'sonar', 'owasp', 'cve', 'vulnerability', 'finding',
  'secret', 'iam', 'rbac', 'pod', 'container', 'image', 'registry', 'cosign', 'sbom',
  'linux', 'bash', 'shell', 'git', 'github', 'gitlab', 'prometheus', 'grafana', 'elk',
  'security', 'remediat', 'risk', 'deploy', 'helmfile', 'istio', 'service mesh',
  'postgres', 'database', 'api gateway', 'zero trust', 'sre', 'observability', 'log',
  'build', 'scan', 'scanner', 'compliance', 'nist', 'iso', 'soc2', 'patch',
  'bgp', 'router', 'subnet', 'vpc', 'cidr', 'vlan', 'waf', 'proxy', 'tcp', 'udp', 'http',
  'iptables', 'calico', 'cilium', 'eks', 'aks', 'gke', 'lambda', 'vault', 'pulumi',
  'oidc', 'oauth', 'saml', 'ldap', 'kafka', 'redis', 'nomad', 'packer', 'cloudformation',
];

/** Clear out-of-domain topics to refuse without calling the model. */
export const OUT_OF_SCOPE_HINTS = [
  'football', 'soccer', 'nba', 'nfl', 'cricket', 'movie', 'netflix', 'celebrity', 'dating',
  'recipe', 'cooking', 'horoscope', 'lottery', 'crypto pump', 'meme coin', 'boyfriend',
  'girlfriend', 'politics election', 'who won the', 'joke about cats', 'write a poem about love',
];

/** Questions that typically need ingested pipeline/build evidence. */
export const PIPELINE_REQUIRED_HINTS = [
  'this build', 'this pipeline', 'my build', 'my pipeline', 'latest build', 'latest pipeline',
  'our findings', 'these findings', 'analyze this', 'analyse this', 'remediation for this',
  'what should i fix', 'fix first', 'risk score', 'selected build', 'current build',
  'stored findings', 'ingested', 're-run analysis', 'rerun analysis', 'verdict',
];

export const OFF_TOPIC_REFUSAL =
  'I only answer questions in networking, DevOps, DevSecOps, cloud engineering, and closely related IT domains (CI/CD, containers, IaC, secrets, vulnerability management, GitOps). Please rephrase your question within those areas.';

export const NO_PIPELINE_GUIDANCE =
  'No pipeline has been pushed to the security dashboard yet. Run your Jenkins pipeline through Store Security Findings (and optionally AI Security Analysis), then come back — I will analyze the findings and provide remediation steps.';

export function buildChatSystemPrompt({ hasPipeline, jobName, buildNumber }) {
  const pipelineStatus = hasPipeline
    ? `A pipeline build is available: job "${jobName}" #${buildNumber}. Prefer this evidence for build-specific questions. Cite finding keys when useful.`
    : `NO pipeline build is available in the dashboard database yet. If the user asks about THIS project's findings, risk, verdict, or remediation for a specific build, tell them clearly that no pipeline has been pushed, explain they should run Jenkins so results are ingested, and invite general DevSecOps/IT questions meanwhile. Do NOT invent findings or fake build numbers.`;

  return [
    `You are ${AGENT_NAME}, a specialist assistant for IT engineering teams.`,
    'HARD SCOPE: Only discuss networking, DevOps, DevSecOps, cloud engineering, CI/CD, containers, Kubernetes, IaC, GitOps, secrets/SAST/SCA, vulnerability management, Linux/platform ops, and closely related IT topics.',
    'If the user asks about anything outside that scope (sports, entertainment, politics, general homework, unrelated personal advice, etc.), refuse briefly and list the allowed domains. Do not answer off-topic content.',
    'Be concise, practical, and actionable. Prefer steps, commands, and prioritization over long essays.',
    pipelineStatus,
    `Allowed domains: ${ALLOWED_DOMAINS.join('; ')}.`,
  ].join('\n');
}

export function buildAnalyzeSystemPrompt() {
  return [
    `You are ${AGENT_NAME}, a DevSecOps security analyst.`,
    'Return ONLY valid JSON with keys: verdict, confidence, narrative, priorities.',
    'priorities is an array of {priority,title,impact,effort}.',
    'Focus on actionable remediation for networking, cloud, containers, secrets, and CI/CD security findings.',
    'Be concise and actionable.',
  ].join(' ');
}

export function looksOutOfScope(question) {
  const q = String(question || '').toLowerCase();
  return OUT_OF_SCOPE_HINTS.some((hint) => q.includes(hint));
}

export function looksInScope(question) {
  const q = String(question || '').toLowerCase();
  if (!q.trim()) return false;
  if (looksOutOfScope(q)) return false;
  // Ambiguous / short follow-ups: let the model enforce domain rules.
  if (q.length < 80) return true;
  return IN_SCOPE_HINTS.some((hint) => q.includes(hint));
}

export function looksPipelineRequired(question) {
  const q = String(question || '').toLowerCase();
  return PIPELINE_REQUIRED_HINTS.some((hint) => q.includes(hint));
}

export function agentPublicConfig() {
  return {
    name: AGENT_NAME,
    version: AGENT_VERSION,
    domains: ALLOWED_DOMAINS,
    capabilities: [
      'domain-limited IT chat without a pipeline',
      'pipeline-aware analysis and remediation',
      'security finding Q&A when builds are ingested',
    ],
  };
}
