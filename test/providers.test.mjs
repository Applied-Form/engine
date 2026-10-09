/**
 * Routes are tested without a network: the request each one would make, and nothing more.
 *
 * The three things that would waste a paid run if wrong: a key that resolves to the wrong route,
 * a request that goes to the wrong host or carries the wrong credential, and a credential check
 * that says a run can proceed when it cannot. Each is driven here with an environment object the
 * test controls, so no test depends on what the machine running it has in its shell.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { MODELS, ROUTES, resolveModel, chatRequest, chatBody, credentialled, available, generate, claudeClient, postRetrying, retryAfter, routeIdentity } from '../eval/providers.mjs';

test('every table entry names a route that exists', () => {
  for (const [key, m] of Object.entries(MODELS)) assert.ok(ROUTES[m.route], `${key} routes to ${m.route}, which has no transport`);
});

test('a table key resolves to its entry, and route:id resolves to whatever the route calls it', () => {
  assert.equal(resolveModel('haiku-5-5').id, 'claude-haiku-5-5');
  assert.equal(resolveModel('haiku-5-5').route, 'anthropic');
  const r = resolveModel('openrouter:anthropic/claude-sonnet-5');
  assert.deepEqual([r.route, r.id], ['openrouter', 'anthropic/claude-sonnet-5']);
  assert.equal(resolveModel('azure:gpt-5-deployment').route, 'azure');
  assert.throws(() => resolveModel('nope:x'), /unknown model/);
  assert.throws(() => resolveModel('gpt-6'), /unknown model/);
});

test('the three Claude tiers of each generation are pinned to the same effort, so tiers differ in capability and not in how hard they were asked', () => {
  for (const g of [['opus-5-5', 'sonnet-5-5', 'haiku-5-5'], ['opus-5', 'sonnet-5']]) {
    const efforts = new Set(g.map((k) => MODELS[k].effort));
    assert.equal(efforts.size, 1, `${g.join(', ')} differ in effort: ${[...efforts].join(', ')}`);
  }
});

test('each chat route sends to its own host with its own credential header', () => {
  const env = { OPENAI_API_KEY: 'oa', OPENROUTER_API_KEY: 'or', AZURE_OPENAI_API_KEY: 'az', AZURE_OPENAI_ENDPOINT: 'https://res.openai.azure.com/' };
  const openai = chatRequest('openai', env);
  assert.equal(openai.url, 'https://api.openai.com/v1/chat/completions');
  assert.equal(openai.headers.authorization, 'Bearer oa');
  const openrouter = chatRequest('openrouter', env);
  assert.equal(openrouter.url, 'https://openrouter.ai/api/v1/chat/completions');
  assert.equal(openrouter.headers.authorization, 'Bearer or');
  const azure = chatRequest('azure', env);
  assert.equal(azure.url, 'https://res.openai.azure.com/openai/v1/chat/completions', 'no double slash, v1 surface');
  assert.equal(azure.headers['api-key'], 'az');
  assert.equal(azure.headers.authorization, undefined, 'Azure authenticates with api-key, not a bearer');
});

test('a base URL override reroutes OpenAI-protocol traffic without touching the credential', () => {
  const r = chatRequest('openai', { OPENAI_API_KEY: 'k', OPENAI_BASE_URL: 'https://gateway.example/v1/' });
  assert.equal(r.url, 'https://gateway.example/v1/chat/completions');
});

test('a route with no credential refuses before any request is built', () => {
  assert.throws(() => chatRequest('openai', {}), /OPENAI_API_KEY/);
  assert.throws(() => chatRequest('azure', { AZURE_OPENAI_API_KEY: 'k' }), /AZURE_OPENAI_ENDPOINT/);
  assert.throws(() => chatRequest('anthropic', {}), /not a chat-completions route/);
});

test('Claude through Foundry needs the resource and its key, and is a client with the Messages surface', () => {
  assert.throws(() => claudeClient('foundry', {}), /ANTHROPIC_FOUNDRY_RESOURCE/);
  const client = claudeClient('foundry', { ANTHROPIC_FOUNDRY_RESOURCE: 'res.azure.anthropic.com', ANTHROPIC_FOUNDRY_API_KEY: 'k' });
  assert.equal(typeof client.messages.create, 'function');
  assert.equal(resolveModel('foundry:claude-haiku-5-5').route, 'foundry');
  assert.equal(credentialled('foundry', { ANTHROPIC_FOUNDRY_API_KEY: 'k' }), false, 'a key without a resource is not a route');
  assert.equal(credentialled('foundry', { ANTHROPIC_FOUNDRY_API_KEY: 'k', ANTHROPIC_FOUNDRY_RESOURCE: 'r' }), true);
});

test('availability is per route, and route:id keys are covered', () => {
  const env = { OPENROUTER_API_KEY: 'x' };
  assert.equal(credentialled('openrouter', env), true);
  assert.equal(credentialled('anthropic', env), false);
  assert.equal(credentialled('anthropic', { ANTHROPIC_AUTH_TOKEN: 't' }), true);
  const have = available(['haiku-5-5', 'openrouter:openai/gpt-5', 'stub'], env);
  assert.deepEqual(have, { 'haiku-5-5': false, 'openrouter:openai/gpt-5': true, stub: true });
});

test('the body names the wire id, carries the system prompt first, and the record names the route', async () => {
  const body = chatBody([{ role: 'user', content: 'hi' }], { id: 'anthropic/claude-haiku-5-5' }, 'sys');
  assert.equal(body.model, 'anthropic/claude-haiku-5-5');
  assert.deepEqual(body.messages[0], { role: 'system', content: 'sys' });

  process.env.OPENROUTER_API_KEY = 'test';
  let seen;
  const fetchImpl = async (url, init) => {
    seen = { url, init };
    return { ok: true, json: async () => ({ choices: [{ message: { content: '<html></html>' }, finish_reason: 'stop' }], usage: { prompt_tokens: 3, completion_tokens: 2 } }) };
  };
  const out = await generate([{ role: 'user', content: 'hi' }], 'openrouter:anthropic/claude-haiku-5-5', { fetchImpl });
  delete process.env.OPENROUTER_API_KEY;
  assert.equal(out.route, 'openrouter');
  assert.equal(out.id, 'anthropic/claude-haiku-5-5');
  assert.equal(out.stop, 'stop');
  assert.deepEqual(out.usage, { input: 3, output: 2 });
  assert.match(seen.url, /^https:\/\/openrouter\.ai\//);
  assert.equal(JSON.parse(seen.init.body).model, 'anthropic/claude-haiku-5-5');
});

test('no route uses a server-side fallback, because the model is the independent variable', () => {
  const src = readFileSync(new URL('../eval/providers.mjs', import.meta.url), 'utf8');
  assert.ok(!/fallbacks\s*:/.test(src), 'a fallback would answer with a model the record does not name');
});

test('a busy provider is waited for a bounded number of times; a refused request is not retried', async () => {
  const reply = (status, headers = {}) => ({ status, ok: status < 300, headers: new Headers(headers) });
  const slept = [];
  const sleep = async (ms) => { slept.push(ms); };
  const sequence = (statuses) => { let i = 0; return async () => { const s = statuses[i++]; if (s === 'reset') throw new Error('socket hang up'); return s; }; };

  const ok = await postRetrying(sequence([reply(429, { 'retry-after': '3' }), 'reset', reply(503), reply(200)]), 'u', {}, { waits: [10, 20, 30], sleep });
  assert.equal(ok.status, 200);
  assert.deepEqual(slept, [3000, 20, 30], 'Retry-After is honoured, then the schedule');

  slept.length = 0;
  const bad = await postRetrying(sequence([reply(400), reply(200)]), 'u', {}, { waits: [10], sleep });
  assert.equal(bad.status, 400, 'a 400 says the same thing twice');
  assert.deepEqual(slept, []);

  const still = await postRetrying(sequence([reply(500), reply(500), reply(500)]), 'u', {}, { waits: [1, 1], sleep });
  assert.equal(still.status, 500, 'bounded: after the last wait the failure is returned, and the cell records it');
  await assert.rejects(postRetrying(sequence(['reset', 'reset']), 'u', {}, { waits: [1], sleep }), /socket hang up/);
});

test('Retry-After is read in both of its forms, and capped', () => {
  const now = Date.parse('Thu, 08 Oct 2026 17:00:00 GMT');
  assert.equal(retryAfter('7', now), 7000);
  assert.equal(retryAfter('Thu, 08 Oct 2026 17:00:30 GMT', now), 30000, 'an HTTP date is a time to wait until');
  assert.equal(retryAfter('Thu, 08 Oct 2026 18:00:00 GMT', now), 120000, 'capped at two minutes');
  assert.equal(retryAfter('Thu, 08 Oct 2026 16:59:00 GMT', now), null, 'a date already passed falls back to the schedule');
  assert.equal(retryAfter('soon', now), null);
  assert.equal(retryAfter(null, now), null);
});

test('a route identity moves with the endpoint and never carries the credential or the hostname', () => {
  const a = routeIdentity(['azure:gpt-5'], { AZURE_OPENAI_ENDPOINT: 'https://one.openai.azure.com', AZURE_OPENAI_API_KEY: 'k1' });
  assert.equal(routeIdentity(['azure:gpt-5'], { AZURE_OPENAI_ENDPOINT: 'https://one.openai.azure.com/', AZURE_OPENAI_API_KEY: 'k2' }), a, 'a rotated key and a trailing slash are the same endpoint');
  assert.notEqual(routeIdentity(['azure:gpt-5'], { AZURE_OPENAI_ENDPOINT: 'https://two.openai.azure.com' }), a, 'another resource is another experiment');
  assert.doesNotMatch(a, /one|azure/);
  assert.equal(routeIdentity(['stub', 'opus-5'], {}), routeIdentity(['opus-5', 'stub'], {}), 'order of keys does not matter');
});
