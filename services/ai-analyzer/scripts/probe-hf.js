/**
 * Local smoke test: validate HF token and find a working free chat model.
 * Reads key from .env — do not commit this output if it contains secrets.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.resolve(__dirname, '../.env');
for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) continue;
  const i = trimmed.indexOf('=');
  const key = trimmed.slice(0, i).trim();
  const value = trimmed.slice(i + 1).trim();
  if (!(key in process.env)) process.env[key] = value;
}

const token = process.env.HUGGINGFACE_API_KEY || process.env.HF_TOKEN;
if (!token) {
  console.error('No HUGGINGFACE_API_KEY in .env');
  process.exit(1);
}

const candidates = [
  process.env.HUGGINGFACE_MODEL,
  'Qwen/Qwen2.5-7B-Instruct:fastest',
  'Qwen/Qwen2.5-7B-Instruct',
  'google/gemma-2-2b-it:fastest',
  'google/gemma-2-2b-it',
  'meta-llama/Llama-3.2-3B-Instruct:fastest',
  'meta-llama/Llama-3.2-3B-Instruct',
  'microsoft/Phi-3.5-mini-instruct:fastest',
  'HuggingFaceH4/zephyr-7b-beta:fastest',
  'openai/gpt-oss-20b:fastest',
].filter(Boolean);

async function main() {
  console.log('1) Checking token against /v1/models ...');
  const modelsRes = await fetch('https://router.huggingface.co/v1/models', {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(30000),
  });
  const modelsBody = await modelsRes.text();
  console.log(`   status=${modelsRes.status}`);
  if (!modelsRes.ok) {
    console.error('   TOKEN FAILED:', modelsBody.slice(0, 500));
    process.exit(2);
  }
  console.log('   TOKEN OK (can list models)');

  let listed = [];
  try {
    listed = JSON.parse(modelsBody).data || [];
  } catch {
    listed = [];
  }
  const freeish = listed
    .filter((m) => Array.isArray(m.providers) && m.providers.some((p) => p.is_free || p.status === 'live'))
    .slice(0, 8)
    .map((m) => m.id);
  if (freeish.length) {
    console.log('   sample live models:', freeish.join(', '));
    for (const id of freeish.slice(0, 3)) {
      if (!candidates.includes(id)) candidates.push(`${id}:fastest`, id);
    }
  }

  console.log('2) Probing chat models ...');
  for (const model of candidates) {
    process.stdout.write(`   try ${model} ... `);
    try {
      const res = await fetch('https://router.huggingface.co/v1/chat/completions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model,
          temperature: 0,
          max_tokens: 32,
          messages: [
            { role: 'system', content: 'Reply with exactly OK.' },
            { role: 'user', content: 'ping' },
          ],
        }),
        signal: AbortSignal.timeout(45000),
      });
      const text = await res.text();
      if (!res.ok) {
        console.log(`FAIL ${res.status}: ${text.slice(0, 160).replace(/\s+/g, ' ')}`);
        continue;
      }
      const payload = JSON.parse(text);
      const answer = payload.choices?.[0]?.message?.content || '';
      console.log(`OK -> ${JSON.stringify(answer).slice(0, 80)}`);
      console.log(`\nWORKING_MODEL=${model}`);
      process.exit(0);
    } catch (error) {
      console.log(`ERROR ${error.message}`);
    }
  }

  console.error('\nNo working chat model found with this token.');
  process.exit(3);
}

main();
