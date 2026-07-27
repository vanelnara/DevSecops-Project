/**
 * Hugging Face LLM client for SentinelOps AI analyzer
 * (OpenAI-compatible chat completions via HF router).
 */

function truthy(value) {
  return Boolean(value && String(value).trim());
}

export function resolveProviderConfig(env = process.env) {
  const apiKey = env.HUGGINGFACE_API_KEY || env.HF_TOKEN || '';
  return {
    id: 'huggingface',
    apiKey,
    apiUrl: env.HUGGINGFACE_API_URL || 'https://router.huggingface.co/v1/chat/completions',
    model: env.HUGGINGFACE_MODEL || 'mistralai/Mistral-7B-Instruct-v0.3',
  };
}

export async function callChatCompletion({
  systemPrompt,
  userPrompt,
  messages = [],
  env = process.env,
  timeoutMs = Number(env.AI_TIMEOUT_MS || 20000),
}) {
  const provider = resolveProviderConfig(env);
  if (!provider.apiKey) {
    throw new Error(
      'HUGGINGFACE_API_KEY is not configured. Create a token at https://huggingface.co/settings/tokens and set Jenkins credential ID huggingface-api-key.',
    );
  }

  const history = Array.isArray(messages)
    ? messages
        .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && m.content)
        .slice(-8)
        .map((m) => ({ role: m.role, content: String(m.content).slice(0, 4000) }))
    : [];

  const response = await fetch(provider.apiUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${provider.apiKey}`,
    },
    body: JSON.stringify({
      model: provider.model,
      temperature: 0.2,
      max_tokens: 1024,
      messages: [
        { role: 'system', content: systemPrompt },
        ...history,
        { role: 'user', content: userPrompt },
      ],
    }),
    signal: AbortSignal.timeout(timeoutMs),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`huggingface API error ${response.status}: ${body}`);
  }

  const payload = await response.json();
  const content =
    payload.choices?.[0]?.message?.content
    || payload.choices?.[0]?.text
    || payload.generated_text
    || '';

  if (!content) {
    throw new Error('huggingface returned an empty completion');
  }

  return {
    content: String(content),
    provider: provider.id,
    model: provider.model,
  };
}

export function providerStatus(env = process.env) {
  const active = resolveProviderConfig(env);
  const configured = truthy(active.apiKey);
  return {
    provider: 'huggingface',
    model: configured ? active.model : 'local-fallback',
    huggingfaceConfigured: configured,
    configured,
  };
}
