/**
 * Generation, one function per route.
 *
 * At least one model from outside the Claude family is deliberately included. An effect visible
 * only in one family is a property of that family, not of the method, and the claim we want to
 * make — that an executable design system beats a written one — is a claim about the method.
 *
 * Every route returns the same shape: { text, usage, stop }. Usage is recorded because an approach
 * that wins at ten times the cost has not obviously won, and arm F pays for repair rounds.
 *
 * A *route* is who is paid and which wire protocol is spoken; a *model* is what answers. The two
 * were one thing in the first version, which meant the study could run only against the three
 * vendors' own endpoints with three separate accounts. Now a model key can name its route
 * explicitly — `openrouter:anthropic/claude-sonnet-5`, `azure:gpt-5` — so the same study runs
 * through whichever account has budget, and every record says which route produced it, because a
 * result nobody can tell the route of is a result nobody can reproduce.
 *
 * Deliberately absent: server-side refusal fallbacks. A fallback silently answers with a different
 * model, and the model is the independent variable here. A refusal is recorded as a failure, by
 * `classifyFailure()` in `run.mjs`, and the rate is reported beside every arm.
 */
import { createHash } from 'node:crypto';
import Anthropic from '@anthropic-ai/sdk';
import AnthropicFoundry from '@anthropic-ai/foundry-sdk';

/**
 * Model tiers. Spanning capability matters: we predict the arm gap is widest on the weakest model.
 *
 * The protocol names the 5 / 4.5 generation as the minimum set, and those entries stay so a run
 * against them is still the pre-registered one. The 5.5 generation is present beside them: Haiku
 * 5.5 in particular is a tenth of Haiku 4.5's price, and a cheap weak tier is where the headline
 * prediction is tested. `effort` is pinned so the tiers differ in capability and not in how hard
 * each was asked to think; Haiku 4.5 predates the parameter and takes none.
 */
export const MODELS = {
  'opus-5-5': { route: 'anthropic', id: 'claude-opus-5-5', effort: 'medium' },
  'sonnet-5-5': { route: 'anthropic', id: 'claude-sonnet-5-5', effort: 'medium' },
  'haiku-5-5': { route: 'anthropic', id: 'claude-haiku-5-5', effort: 'medium' },
  'opus-5': { route: 'anthropic', id: 'claude-opus-5', effort: 'medium' },
  'sonnet-5': { route: 'anthropic', id: 'claude-sonnet-5', effort: 'medium' },
  'haiku-4-5': { route: 'anthropic', id: 'claude-haiku-4-5' },   // no effort parameter on this model
  'gpt-5': { route: 'openai', id: 'gpt-5' },
  'gemini-3-pro': { route: 'google', id: 'gemini-3-pro' },
  // Not models. These exercise the pipeline offline so plumbing bugs are found for free rather than
  // discovered halfway through a paid run. `stub-flaky` emits the failure modes real models
  // actually produce — a page cut off at the token cap, markup that never closes, a refusal — so
  // the failure accounting is proved end to end and not only in unit tests.
  'stub': { route: 'stub', id: 'stub' },
  'stub-flaky': { route: 'stub', id: 'stub-flaky', flaky: true },
};

const MAX_TOKENS = 32000;
const SYSTEM = 'You are a designer and front-end engineer. You produce complete, working HTML pages.';

/**
 * A model key is either a name from the table above or `route:id`, where the id is whatever that
 * route calls the model. The explicit form exists because an aggregator's slugs and a cloud
 * deployment's names are theirs, change without notice, and cannot be verified from here; the
 * person with the account supplies them and the record keeps them.
 */
export function resolveModel(key) {
  if (MODELS[key]) return { key, ...MODELS[key] };
  const m = /^([a-z]+):(.+)$/.exec(key);
  if (!m || !ROUTES[m[1]]) throw new Error(`unknown model: ${key} (a table entry, or route:id with a route of ${Object.keys(ROUTES).join(', ')})`);
  return { key, route: m[1], id: m[2] };
}

/**
 * Where each route sends a request and how it proves who is paying. Pure, so a test can check the
 * request a route would make without making it. Base URLs can be overridden from the environment
 * for the routes that commonly front other services; the defaults are the vendors' own.
 *
 * Azure is the one that cannot default: a resource name is part of the hostname. It speaks the
 * OpenAI-compatible v1 surface under `/openai/v1`, authenticated with `api-key`, and names the
 * deployment rather than the model.
 */
export function chatRequest(route, env = process.env) {
  switch (route) {
    case 'openai': {
      const key = env.OPENAI_API_KEY;
      if (!key) throw new Error('OPENAI_API_KEY is not set');
      const base = (env.OPENAI_BASE_URL ?? 'https://api.openai.com/v1').replace(/\/$/, '');
      return { url: `${base}/chat/completions`, headers: { authorization: `Bearer ${key}` } };
    }
    case 'openrouter': {
      const key = env.OPENROUTER_API_KEY;
      if (!key) throw new Error('OPENROUTER_API_KEY is not set');
      const base = (env.OPENROUTER_BASE_URL ?? 'https://openrouter.ai/api/v1').replace(/\/$/, '');
      return {
        url: `${base}/chat/completions`,
        headers: { authorization: `Bearer ${key}`, 'http-referer': 'https://github.com/appliedform', 'x-title': 'Applied Form evaluation' },
      };
    }
    case 'azure': {
      const key = env.AZURE_OPENAI_API_KEY, endpoint = env.AZURE_OPENAI_ENDPOINT;
      if (!key || !endpoint) throw new Error('AZURE_OPENAI_API_KEY and AZURE_OPENAI_ENDPOINT are both needed');
      return { url: `${endpoint.replace(/\/$/, '')}/openai/v1/chat/completions`, headers: { 'api-key': key } };
    }
    default: throw new Error(`${route} is not a chat-completions route`);
  }
}

/**
 * Where each model's requests go, as a short hash: route, wire id and the endpoint the route
 * resolves to (a base URL, an Azure endpoint, a Foundry resource). A resumed run or judging round
 * compares it, so a changed gateway or deployment is a new experiment, not more of the old one.
 * Hashed, so a resource name never reaches a committed record; credentials are never read into it.
 */
export function routeIdentity(keys, env = process.env) {
  const endpoint = (route) => ({
    anthropic: env.ANTHROPIC_BASE_URL ?? 'https://api.anthropic.com',
    foundry: env.ANTHROPIC_FOUNDRY_RESOURCE ?? '',
    openai: env.OPENAI_BASE_URL ?? 'https://api.openai.com/v1',
    openrouter: env.OPENROUTER_BASE_URL ?? 'https://openrouter.ai/api/v1',
    azure: env.AZURE_OPENAI_ENDPOINT ?? '',
    google: 'https://generativelanguage.googleapis.com/v1beta',
  })[route] ?? '';
  const lines = [...new Set(keys)].sort().map((k) => { const m = resolveModel(k); return `${k}|${m.route}|${m.id}|${endpoint(m.route).replace(/\/$/, '')}`; });
  return createHash('sha256').update(lines.join('\n')).digest('hex').slice(0, 16);
}

/** The body every chat-completions route sends. Separate from the transport so a test can read it. */
export function chatBody(messages, model, system) {
  return {
    model: model.id,
    max_completion_tokens: MAX_TOKENS,
    messages: [{ role: 'system', content: system }, ...messages],
  };
}

/**
 * A POST that survives the provider being briefly busy. A 429 or a 5xx is the provider's capacity,
 * not the model's answer, and with cells running concurrently it is more likely; recorded as a
 * failed cell, it would put the run's concurrency into the model's failure rate, and a resumed run
 * would never try that cell again. So it waits and tries again a bounded number of times (honouring
 * Retry-After when it is given), and then fails as before. Anything else fails at once: a 400 or a
 * 401 will say the same thing the second time.
 */
/** Retry-After in milliseconds, capped at two minutes: seconds or an HTTP date (RFC 9110 §10.2.3). */
export function retryAfter(value, now = Date.now()) {
  if (value == null || value === '') return null;
  const ms = /^\d+$/.test(value.trim()) ? Number(value) * 1000 : Date.parse(value) - now;
  return Number.isFinite(ms) && ms > 0 ? Math.min(ms, 120000) : null;
}

export async function postRetrying(fetchImpl, url, init, { waits = [2000, 8000, 30000, 60000], sleep = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
  for (let attempt = 0; ; attempt++) {
    let res, err;
    try { res = await fetchImpl(url, init); } catch (e) { err = e; }
    const transient = err || res.status === 429 || res.status >= 500;
    if (!transient || attempt >= waits.length) {
      if (err) throw err;
      return res;
    }
    await sleep(retryAfter(res?.headers?.get?.('retry-after')) ?? waits[attempt]);
  }
}

/** One transport for the three routes that speak OpenAI's protocol. `fetchImpl` is injectable for tests. */
function chatCompletions(route) {
  return async (messages, model, { system, fetchImpl = fetch }) => {
    const { url, headers } = chatRequest(route);
    const res = await postRetrying(fetchImpl, url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(chatBody(messages, model, system)),
    });
    if (!res.ok) throw new Error(`${route} ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const body = await res.json();
    const choice = body.choices?.[0];
    return {
      text: choice?.message?.content ?? '',
      usage: { input: body.usage?.prompt_tokens ?? 0, output: body.usage?.completion_tokens ?? 0 },
      stop: choice?.finish_reason,
    };
  };
}

/**
 * Claude, through Anthropic directly or through Microsoft Foundry. Foundry speaks the same Messages
 * API from an Azure resource and bills through Azure — the route to use when the credit is there.
 * Two environment variables: the resource host and its key. The model id is the first-party one.
 */
export function claudeClient(route, env = process.env) {
  if (route === 'foundry') {
    const resource = env.ANTHROPIC_FOUNDRY_RESOURCE, apiKey = env.ANTHROPIC_FOUNDRY_API_KEY;
    if (!resource || !apiKey) throw new Error('ANTHROPIC_FOUNDRY_RESOURCE and ANTHROPIC_FOUNDRY_API_KEY are both needed');
    return new AnthropicFoundry({ apiKey, resource, maxRetries: 4 });
  }
  // The SDK already retries a 429 or a 5xx with backoff; four times rather than two, for the same
  // reason the REST routes retry (postRetrying).
  return new Anthropic({ maxRetries: 4 });
}

const claude = (route) => async (messages, model, { system }) => {
  const client = claudeClient(route);
  const params = {
    model: model.id,
    max_tokens: MAX_TOKENS,
    system,
    messages,
    ...(model.effort ? { output_config: { effort: model.effort } } : {}),
  };
  // Streaming, because a full HTML page can approach the output cap and a non-streamed request
  // that large risks an HTTP timeout.
  const stream = client.messages.stream(params);
  const message = await stream.finalMessage();
  return {
    text: message.content.filter((b) => b.type === 'text').map((b) => b.text).join(''),
    usage: { input: message.usage.input_tokens, output: message.usage.output_tokens },
    stop: message.stop_reason,
  };
};

async function google(messages, model, { system, fetchImpl = fetch }) {
  const key = process.env.GOOGLE_API_KEY ?? process.env.GEMINI_API_KEY;
  if (!key) throw new Error('GOOGLE_API_KEY is not set');
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model.id}:generateContent`;
  const res = await postRetrying(fetchImpl, url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: messages.map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] })),
      generationConfig: { maxOutputTokens: MAX_TOKENS },
    }),
  });
  if (!res.ok) throw new Error(`google ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const body = await res.json();
  const cand = body.candidates?.[0];
  return {
    text: (cand?.content?.parts ?? []).map((p) => p.text ?? '').join(''),
    usage: { input: body.usageMetadata?.promptTokenCount ?? 0, output: body.usageMetadata?.candidatesTokenCount ?? 0 },
    stop: cand?.finishReason,
  };
}

/** Deterministic fake output, varied enough that the scorer and the analysis have something to do. */
async function stub(messages, model) {
  const seed = messages[0].content.length % 3;
  const sloppy = seed !== 0;
  const mode = model.flaky ? ['ok', 'truncated', 'incomplete', 'refused', 'fenced'][messages[0].content.length % 5] : 'ok';
  const page = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<title>Stub</title><style>
body{font-family:system-ui;margin:0;padding:${sloppy ? '17px' : '16px'};background:#F2F6F3;color:#222B26}
main{max-width:640px}
a{color:#15653A;text-decoration:${sloppy ? 'none' : 'underline'}}
.card{padding:16px;${sloppy ? 'box-shadow:0 2px 8px rgba(0,0,0,.2);border-radius:9px;' : ''}}
button{min-width:${sloppy ? '15px' : '44px'};min-height:${sloppy ? '15px' : '44px'}}
</style></head><body><main>
<h1>Stub page</h1><p>Body copy for the stub. <a href="#x">A link</a>.</p>
<div class="card"><p>A card.</p></div>
<img src="data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw=="${sloppy ? '' : ' alt="A placeholder"'} width="120" height="80">
<button>Do the thing</button>
</main></body></html>`;
  const usage = { input: Math.round(messages[0].content.length / 4), output: 400 };
  switch (mode) {
    // Cut off at the token cap, mid-element. Shorter than a finished page, so it would score well.
    case 'truncated': return { text: page.slice(0, Math.floor(page.length * 0.6)), usage, stop: 'max_tokens' };
    // Finished generating, but the markup never closes.
    case 'incomplete': return { text: page.replace('</body></html>', ''), usage, stop: 'end_turn' };
    case 'refused': return { text: 'I can’t help with that.', usage, stop: 'refusal' };
    // Wrapped in a fence despite being told not to: recoverable, and recorded as a tell.
    case 'fenced': return { text: '```html\n' + page + '\n```', usage, stop: 'end_turn' };
    default: return { text: page, usage, stop: 'end_turn' };
  }
}

export const ROUTES = {
  anthropic: claude('anthropic'),
  foundry: claude('foundry'),
  openai: chatCompletions('openai'),
  openrouter: chatCompletions('openrouter'),
  azure: chatCompletions('azure'),
  google,
  stub,
};

/**
 * A judgement over images: two screenshots and one question, one short answer back.
 *
 * Judges need to see the page, not read its markup — a judge handed HTML would be grading code.
 * Each route takes images in its own shape; the stub is a judge with one fixed preference, the
 * larger screenshot, which is deterministic, documented, and wrong in a known way. That is what
 * drives the tests: a stub that prefers more rendered content loses the unstyled floor anchor and
 * passes a truncated attention check, so the round's own instruments can be exercised offline.
 */
// One budget for every route. The answer is one word, but a reasoning model spends its completion
// tokens thinking first: at 64, gpt-5-mini spent them all and answered nothing.
const JUDGE_MAX_TOKENS = 4096;

export async function judge(images, question, modelKey, { fetchImpl = fetch } = {}) {
  const model = resolveModel(modelKey);
  const started = Date.now();
  const png = (b) => b.toString('base64');
  let out;
  if (model.route === 'stub') {
    const sizes = images.map((b) => b.length);
    out = { text: sizes[0] === sizes[1] ? 'tie' : sizes[0] > sizes[1] ? 'a' : 'b', usage: { input: 0, output: 1 }, stop: 'end_turn' };
  } else if (model.route === 'anthropic' || model.route === 'foundry') {
    const client = claudeClient(model.route);
    const message = await client.messages.create({
      model: model.id, max_tokens: JUDGE_MAX_TOKENS,
      ...(model.effort ? { output_config: { effort: model.effort } } : {}),
      messages: [{ role: 'user', content: [
        ...images.map((b) => ({ type: 'image', source: { type: 'base64', media_type: 'image/png', data: png(b) } })),
        { type: 'text', text: question },
      ] }],
    });
    out = { text: message.content.filter((b) => b.type === 'text').map((b) => b.text).join(''), usage: { input: message.usage.input_tokens, output: message.usage.output_tokens }, stop: message.stop_reason };
  } else if (model.route === 'google') {
    const key = process.env.GOOGLE_API_KEY ?? process.env.GEMINI_API_KEY;
    if (!key) throw new Error('GOOGLE_API_KEY is not set');
    const res = await postRetrying(fetchImpl, `https://generativelanguage.googleapis.com/v1beta/models/${model.id}:generateContent`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify({ contents: [{ role: 'user', parts: [...images.map((b) => ({ inlineData: { mimeType: 'image/png', data: png(b) } })), { text: question }] }], generationConfig: { maxOutputTokens: JUDGE_MAX_TOKENS } }),
    });
    if (!res.ok) throw new Error(`google ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const body = await res.json();
    const cand = body.candidates?.[0];
    out = { text: (cand?.content?.parts ?? []).map((p) => p.text ?? '').join(''), usage: { input: body.usageMetadata?.promptTokenCount ?? 0, output: body.usageMetadata?.candidatesTokenCount ?? 0 }, stop: cand?.finishReason };
  } else {
    const { url, headers } = chatRequest(model.route);
    const res = await postRetrying(fetchImpl, url, {
      method: 'POST', headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify({ model: model.id, max_completion_tokens: JUDGE_MAX_TOKENS, messages: [{ role: 'user', content: [
        ...images.map((b) => ({ type: 'image_url', image_url: { url: `data:image/png;base64,${png(b)}` } })),
        { type: 'text', text: question },
      ] }] }),
    });
    if (!res.ok) throw new Error(`${model.route} ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const body = await res.json();
    const choice = body.choices?.[0];
    out = { text: choice?.message?.content ?? '', usage: { input: body.usage?.prompt_tokens ?? 0, output: body.usage?.completion_tokens ?? 0 }, stop: choice?.finish_reason };
  }
  return { ...out, model: modelKey, id: model.id, route: model.route, ms: Date.now() - started };
}

export async function generate(messages, modelKey, { system = SYSTEM, fetchImpl } = {}) {
  const model = resolveModel(modelKey);
  const started = Date.now();
  const out = await ROUTES[model.route](messages, model, { system, ...(fetchImpl ? { fetchImpl } : {}) });
  return { ...out, model: modelKey, id: model.id, route: model.route, ms: Date.now() - started };
}

/** Whether a route's credentials are present, so a run can say what it can and cannot do before paying. */
export function credentialled(route, env = process.env) {
  switch (route) {
    case 'anthropic': return !!(env.ANTHROPIC_API_KEY || env.ANTHROPIC_AUTH_TOKEN);
    case 'foundry': return !!(env.ANTHROPIC_FOUNDRY_API_KEY && env.ANTHROPIC_FOUNDRY_RESOURCE);
    case 'openai': return !!env.OPENAI_API_KEY;
    case 'openrouter': return !!env.OPENROUTER_API_KEY;
    case 'azure': return !!(env.AZURE_OPENAI_API_KEY && env.AZURE_OPENAI_ENDPOINT);
    case 'google': return !!(env.GOOGLE_API_KEY || env.GEMINI_API_KEY);
    case 'stub': return true;
    default: return false;
  }
}

/** Models whose credentials are actually present. Takes the keys a run asked for, so `route:id` keys are covered. */
export function available(keys = Object.keys(MODELS), env = process.env) {
  return Object.fromEntries(keys.map((k) => [k, credentialled(resolveModel(k).route, env)]));
}

/** Strip the fences a model adds despite being asked not to. Recorded, because it is a small tell. */
export function extractHtml(text) {
  const fenced = /```(?:html)?\s*\n([\s\S]*?)```/i.exec(text);
  const body = fenced ? fenced[1] : text;
  const start = body.search(/<!doctype html|<html/i);
  return { html: start >= 0 ? body.slice(start).trim() : body.trim(), fenced: !!fenced };
}
