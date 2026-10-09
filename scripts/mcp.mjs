#!/usr/bin/env node
/**
 * `af mcp` — serve the gate to any MCP client over stdio.
 *
 *   af mcp              serve
 *   af mcp --selftest   exercise the protocol without a client, and exit non-zero if it breaks
 */
import { serve, handle, TOOLS, SERVER } from '../src/lib/mcp.mjs';

if (process.argv.includes('--selftest')) {
  const calls = [
    { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} },
    { jsonrpc: '2.0', id: 2, method: 'tools/list' },
    { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'af_rules', arguments: { group: 'absence' } } },
    { jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'af_contrast', arguments: { foreground: '#1A1A1A', background: '#FFFFFF' } } },
    { jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'af_move', arguments: {} } },
    { jsonrpc: '2.0', id: 6, method: 'tools/call', params: { name: 'af_nope', arguments: {} } },
  ];
  let bad = 0;
  for (const call of calls) {
    const r = await handle(call);
    const label = call.params?.name ?? call.method;
    if (call.id === 6) {
      if (!r.error) { bad++; console.log(`✗ ${label}: an unknown tool should be an error`); }
      else console.log(`✓ ${label} refused: ${r.error.message}`);
      continue;
    }
    if (!r || r.error) { bad++; console.log(`✗ ${label}: ${r?.error?.message ?? 'no response'}`); continue; }
    const size = JSON.stringify(r.result).length;
    console.log(`✓ ${label} (${size} bytes)`);
  }
  console.log(bad ? `${bad} problem(s)` : `${SERVER.name} ${SERVER.version}: ${TOOLS.length} tools, protocol clean`);
  process.exit(bad ? 1 : 0);
}

await serve();
