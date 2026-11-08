#!/usr/bin/env node
// The bridge script: calling an external model (an OpenAI-compatible chat/completions) instead of the Agent tool.
// Text-in/text-out of a task without live access to the environment (`vneshnyaya-model-spec-core.md`).
// A neutral name: a bridge to any OpenAI-compatible provider (DeepSeek, OpenRouter).
//
// Usage:
//   node .claude/scripts/external-model-bridge.cjs --prompt-file <path> [--provider deepseek|openrouter] [--model ...] [--max-tokens 8192] [--out <path>]
//   node .claude/scripts/external-model-bridge.cjs --prompt "<text>" ...
//
// Prohibition 17 (AGENTS.md §5): only the scrubbed leaves. The CLI path scrubs --prompt/--prompt-file
// and --system by the same module as the Plumb (plumb-scrub.cjs): the values from .env and VARS/ -> [[name]],
// the patterns (addresses, tokens, paths) -> labels. A secret-like residue - a fail-closed refusal (code 2,
// no network call is made); the fallback - to the executor of one's own family (the Agent tool), not a repeat of the request.
//
// The key - DEEPSEEK_API_KEY / OPENROUTER_API_KEY, read from .env in the project root (not from the process/shell - prohibition 15, AGENTS.md §5).
// Prints the model's response content to stdout (or writes it to --out, if given); adds nothing extra -
// the calling node parses the result itself, the way it would parse a subagent's text.
//
// Cost: for DeepSeek it is counted by the deepseek-flash price (
// https://api-docs.deepseek.com/quick_start/pricing) - the legacy names deepseek-chat/deepseek-reasoner
// are accepted but served by the same base model (confirmed by the `model` field in the API response);
// the difference between them - the thinking mode, not different base models.
// For OpenRouter - by the price of the concrete model (`--model`), the table below; an unknown model gives
// cost_usd_estimate: null instead of a made-up figure, and does not silently use someone else's tariff.
// Re-check the price of another model/date with the provider; never treat these numbers as forever-constants.
//
// Error labels come from the core dictionary: English key in code, ru value as data.

const fs = require('fs');
const path = require('path');
const https = require('https');
const { parseKnown } = require('../../.forma/dashboard/lib/cli.cjs');
const i18n = require('../../.forma/i18n/index.cjs');
const msg = (code, params) => i18n.message(code, params, 'ru');

// $ per 1 token (not per 1M - divided right away, so the /1e6 is not forgotten in a new line)
const PRICING = {
  deepseek: {
    // off-peak (the peak hours 01:00-04:00 and 06:00-10:00 UTC, Mon-Fri cost twice as much, not accounted here)
    inputCacheMiss: 0.15 / 1e6,
    inputCacheHit: 0.003 / 1e6,
    output: 0.6 / 1e6,
  },
  openrouter: {
    // The price - openrouter.ai
    'z-ai/glm-5.3-flash': { input: 0.045 / 1e6, output: 0.14 / 1e6 },
    'qwen/qwen3.7-flash': { input: 0.03 / 1e6, output: 0.13 / 1e6 },
    // The price - openrouter.ai
    'deepseek/deepseek-v4-flash': { input: 0.049 / 1e6, output: 0.097 / 1e6 },
    // The price - openrouter.ai/typesafe/jev-1.14: the input $0.042/1M, the output free (the Decisions API
    // charges only for the input tokens - openrouter.ai/docs/guides/community/jev,
    // "How much does Jev cost?"). The `usage.cost` response is preferred over this estimate, see estimateCostUsd.
    'typesafe/jev-1.14': { input: 0.042 / 1e6, output: 0 },
  },
};

function estimateCostUsd(provider, model, usage) {
  if (provider === 'deepseek') {
    const p = PRICING.deepseek;
    const hit = usage.prompt_cache_hit_tokens ?? 0;
    const miss = usage.prompt_cache_miss_tokens ?? (usage.prompt_tokens ?? 0) - hit;
    const out = usage.completion_tokens ?? 0;
    return hit * p.inputCacheHit + miss * p.inputCacheMiss + out * p.output;
  }
  if (provider === 'openrouter') {
    const p = PRICING.openrouter[model];
    if (!p) return null; // an unknown model - no guessing the price
    const inTok = usage.prompt_tokens ?? 0;
    const out = usage.completion_tokens ?? 0;
    return inTok * p.input + out * p.output;
  }
  return null;
}

function loadEnvKey(name) {
  // __dirname = .claude/scripts - two levels up to the project root, where the only
  // .env lives (prohibition 15, AGENTS.md §5: one file, no copies per engine).
  const envPath = path.join(__dirname, '..', '..', '.env');
  if (!fs.existsSync(envPath)) {
    throw new Error(msg('extbridge.env_not_found', { path: envPath }));
  }
  const text = fs.readFileSync(envPath, 'utf8');
  const re = new RegExp(`^${name}=(.*)$`, 'm');
  const m = text.match(re);
  if (!m || !m[1].trim()) {
    throw new Error(msg('extbridge.key_empty', { name }));
  }
  return m[1].trim();
}

// The same check but without an exception - for the callers for whom a missing key
// is not an error in itself, but a reason to fall back to the built-in executor (plumb-run.cjs).
function loadEnvKeyOptional(name, root) {
  try {
    const envPath = root ? path.join(root, '.env') : path.join(__dirname, '..', '..', '.env');
    if (!fs.existsSync(envPath)) return null;
    const text = fs.readFileSync(envPath, 'utf8');
    const re = new RegExp(`^${name}=(.*)$`, 'm');
    const m = text.match(re);
    return m && m[1].trim() ? m[1].trim() : null;
  } catch {
    return null;
  }
}

// The Decisions API call (typesafe/jev-1.14) - a typed choice/score/noul output directly,
// without a run through chat/completions (a different request shape: questions+state, not messages).
// openrouter.ai/docs/api/api-reference/alphadecisions/submit-a-decisions-request
function callDecisions({ apiKey, model, questions, state, timeoutMs }) {
  const body = JSON.stringify({ model, questions, state });
  const options = {
    hostname: 'openrouter.ai',
    path: '/api/alpha/decisions',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
      'Content-Length': Buffer.byteLength(body),
    },
  };
  const TIMEOUT_MS = timeoutMs || 60000;
  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        if (res.statusCode !== 200) {
          reject(new Error(`decisions API ${res.statusCode}: ${data.slice(0, 500)}`));
          return;
        }
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(new Error(msg('extbridge.decisions_parse', { err: e.message })));
        }
      });
    });
    req.setTimeout(TIMEOUT_MS, () => {
      req.destroy(new Error(msg('extbridge.decisions_timeout', { sec: TIMEOUT_MS / 1000 })));
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// The default (project/config/CONFIG.md #deepseek-extraction-quality):
// OpenRouter GLM 5.3 Flash - almost three times cheaper than DeepSeek at a comparable extraction quality.
// DeepSeek stays as the reserve for when time is critical (--provider deepseek explicitly).
const DEFAULT_PROVIDER = 'openrouter';
// For the graphs - DeepSeek V4 Flash via OpenRouter.
const DEFAULT_MODEL = 'deepseek/deepseek-v4-flash';

function parseArgs(argv) {
  const int = (v) => parseInt(v, 10);
  const args = parseKnown(argv, {
    '--prompt-file': 'promptFile', '--prompt': 'prompt', '--provider': 'provider', '--model': 'model',
    '--max-tokens': ['maxTokens', int], '--out': 'out', '--system': 'system',
    '--reasoning-effort': 'reasoningEffort', '--reasoning-max-tokens': ['reasoningMaxTokens', int],
  }, { provider: DEFAULT_PROVIDER, model: DEFAULT_MODEL, maxTokens: 8192 });
  // switched to deepseek by the flag but did not name a model explicitly - its default is substituted,
  // not the openrouter default (otherwise we would enter DeepSeek with the GLM model nonexistent there)
  if (args.provider === 'deepseek' && args.model === DEFAULT_MODEL) {
    args.model = 'deepseek-chat';
  }
  // GLM by the extraction contract requires reasoning.effort=low on files larger than ~20K tokens -
  // set low by default for the default provider+model pair, unless overridden explicitly
  if (args.provider === DEFAULT_PROVIDER && args.model === DEFAULT_MODEL && !args.reasoningEffort && !args.reasoningMaxTokens) {
    args.reasoningEffort = 'low';
  }
  return args;
}

const PROVIDER_HOSTS = {
  deepseek: { hostname: 'api.deepseek.com', path: '/chat/completions', envKey: 'DEEPSEEK_API_KEY' },
  openrouter: { hostname: 'openrouter.ai', path: '/api/v1/chat/completions', envKey: 'OPENROUTER_API_KEY' },
};

function callChatCompletions({ provider, apiKey, model, system, prompt, maxTokens, reasoningEffort, reasoningMaxTokens }) {
  const messages = [];
  if (system) messages.push({ role: 'system', content: system });
  messages.push({ role: 'user', content: prompt });

  const payload = {
    model,
    messages,
    max_tokens: maxTokens,
    stream: false,
  };
  // OpenRouter: the reasoning budget limited separately from the visible output (openrouter.ai/docs/use-cases/reasoning-tokens)
  if (provider === 'openrouter' && (reasoningEffort || reasoningMaxTokens)) {
    payload.reasoning = reasoningEffort ? { effort: reasoningEffort } : { max_tokens: reasoningMaxTokens };
  }
  const body = JSON.stringify(payload);

  const { hostname, path: apiPath } = PROVIDER_HOSTS[provider];
  const options = {
    hostname,
    path: apiPath,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
      'Content-Length': Buffer.byteLength(body),
    },
  };

  // A timeout over the whole request - without it a hung connection (a drop on the provider's side,
  // the network) hangs forever, neither success nor error ever arrives (
  // the closed cards' experience graph build hung on file 32/53 without a single error).
  const TIMEOUT_MS = 120000;

  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        if (res.statusCode !== 200) {
          reject(new Error(`${provider} API ${res.statusCode}: ${data}`));
          return;
        }
        try {
          const json = JSON.parse(data);
          resolve(json);
        } catch (e) {
          reject(new Error(msg('extbridge.chat_parse', { provider, err: e.message }) + '\n' + data.slice(0, 500)));
        }
      });
    });
    req.setTimeout(TIMEOUT_MS, () => {
      req.destroy(new Error(msg('extbridge.chat_timeout', { provider, sec: TIMEOUT_MS / 1000 })));
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// The scrub of the outgoing text (prohibition 17): the .env/VARS secrets -> [[name]], the residue - a refusal with code 2.
// The refusal happens before the key is loaded and before any network call.
function scrubOutgoing(text) {
  const { loadSecrets, scrub, residue } = require('./plumb-scrub.cjs');
  const siteHosts = new Set();
  const secrets = loadSecrets(path.join(__dirname, '..', '..'), siteHosts);
  const { text: scrubbed } = scrub(text, secrets, siteHosts);
  const why = residue(scrubbed, secrets);
  if (why.length) {
    console.error(msg('extbridge.scrub_refused', { why: why.join('; ') }));
    process.exit(2);
  }
  return scrubbed;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.prompt && !args.promptFile) {
    console.error(msg('extbridge.need_prompt'));
    process.exit(1);
  }
  if (!PROVIDER_HOSTS[args.provider]) {
    console.error(msg('extbridge.unknown_provider', { provider: args.provider }));
    process.exit(1);
  }
  if (args.provider === 'openrouter' && !args.model) {
    console.error(msg('extbridge.need_model'));
    process.exit(1);
  }
  const prompt = scrubOutgoing(args.prompt || fs.readFileSync(args.promptFile, 'utf8'));
  const system = args.system ? scrubOutgoing(args.system) : undefined;
  const apiKey = loadEnvKey(PROVIDER_HOSTS[args.provider].envKey);

  const t0 = Date.now();
  const result = await callChatCompletions({
    provider: args.provider,
    apiKey,
    model: args.model,
    system,
    prompt,
    maxTokens: args.maxTokens,
    reasoningEffort: args.reasoningEffort,
    reasoningMaxTokens: args.reasoningMaxTokens,
  });
  const durationMs = Date.now() - t0;

  const text = result.choices?.[0]?.message?.content ?? '';
  const usage = result.usage || {};
  // OpenRouter returns the real cost in usage.cost - more precise than our own price-based estimate; we prefer it
  const costUsd = typeof usage.cost === 'number' ? usage.cost : estimateCostUsd(args.provider, args.model, usage);

  const report = {
    text,
    usage: {
      prompt_tokens: usage.prompt_tokens ?? null,
      completion_tokens: usage.completion_tokens ?? null,
      total_tokens: usage.total_tokens ?? null,
      prompt_cache_hit_tokens: usage.prompt_cache_hit_tokens ?? null,
      prompt_cache_miss_tokens: usage.prompt_cache_miss_tokens ?? null,
    },
    cost_usd_estimate: costUsd === null ? null : Number(costUsd.toFixed(6)),
    duration_ms: durationMs,
    provider: args.provider,
    model_requested: args.model,
    model_served: result.model ?? null,
  };

  if (args.out) {
    fs.writeFileSync(args.out, JSON.stringify(report, null, 2), 'utf8');
    console.log(msg('extbridge.written', { file: args.out }));
  } else {
    console.log(JSON.stringify(report, null, 2));
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error(msg('extbridge.bridge_error', { err: err.message }));
    process.exit(1);
  });
}

module.exports = { loadEnvKey, loadEnvKeyOptional, callChatCompletions, callDecisions, estimateCostUsd, PRICING, scrubOutgoing };
