#!/usr/bin/env node
/**
 * af mcp-config [--client claude-code|cursor]
 *
 * The MCP server block for an agent's configuration, on stdout as JSON so it can be piped or pasted,
 * with where it goes on stderr. Both clients read the same shape: Claude Code from .mcp.json in the
 * project, Cursor from .cursor/mcp.json.
 */
const args = process.argv.slice(2);
const client = args.includes('--client') ? args[args.indexOf('--client') + 1] : 'claude-code';
const WHERE = {
  'claude-code': 'Add to .mcp.json in your project, or run: claude mcp add applied-form -- npx af-mcp',
  cursor: 'Add to .cursor/mcp.json in your project',
};
if (!WHERE[client]) { console.error(`af mcp-config: unknown client "${client}"; expected ${Object.keys(WHERE).join(' or ')}`); process.exit(2); }
console.log(JSON.stringify({ mcpServers: { 'applied-form': { command: 'npx', args: ['af-mcp'] } } }, null, 2));
console.error(WHERE[client]);
