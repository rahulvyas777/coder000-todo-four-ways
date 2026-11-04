#!/usr/bin/env node
// parse-session.js <stream.jsonl>
// Reads one Claude Code `--output-format stream-json --verbose` transcript as written by
// tools/claude-code/run-claude.ps1 (comment lines "# cwd", "# claude ...", "# exit code N"
// around the JSON lines; UTF-8 with a BOM) and prints one JSON object:
//   num_turns, duration_ms, total_cost_usd, is_error, result_subtype, usage (input, output,
//   cache_read, cache_creation), modelUsage, tool_calls by tool name, denied (permission
//   denials), rate_limit (whether a rate_limit_event appeared, the last one's fields, and whether
//   it signals a limit), result_text, exit_code, model, has_result.
// A transcript without a result line (killed on timeout, crashed) gives has_result: false and
// nulls for the result fields; the tool counts are still computed from the lines present.
'use strict';
const fs = require('fs');

function parse(file) {
  const text = fs.readFileSync(file, 'utf8').replace(/^﻿/, '');
  const lines = text.split(/\r?\n/);
  const out = {
    file: require('path').basename(file),
    has_result: false, num_turns: null, duration_ms: null, duration_api_ms: null, total_cost_usd: null,
    is_error: null, result_subtype: null, terminal_reason: null, api_error_status: null,
    usage: null, modelUsage: null, tool_calls: {}, tool_calls_total: 0,
    denied: { permission_denials: 0, permission_denied_events: 0, error_results_mentioning_permission: 0, tools: {} },
    tool_errors: 0, subagents_started: 0,
    rate_limit: { seen: false, events: 0, limited: false, last: null },
    model: null, exit_code: null, unparsable_lines: 0, result_text: null,
  };
  const toolUseIds = new Set();
  for (const raw of lines) {
    const l = raw.trim();
    if (!l) continue;
    if (l.startsWith('#')) {
      const m = /^# exit code (-?\d+)/.exec(l);
      if (m) out.exit_code = Number(m[1]);
      continue;
    }
    if (!l.startsWith('{')) { out.unparsable_lines++; continue; }
    let o;
    try { o = JSON.parse(l); } catch { out.unparsable_lines++; continue; }
    switch (o.type) {
      case 'system':
        if (o.subtype === 'init') out.model = o.model || null;
        else if (o.subtype === 'permission_denied') out.denied.permission_denied_events++;
        else if (o.subtype === 'task_started') out.subagents_started++;
        break;
      case 'assistant': {
        const content = (o.message && o.message.content) || [];
        for (const c of content) {
          if (c.type !== 'tool_use' || toolUseIds.has(c.id)) continue;
          toolUseIds.add(c.id);
          out.tool_calls[c.name] = (out.tool_calls[c.name] || 0) + 1;
          out.tool_calls_total++;
        }
        break;
      }
      case 'user': {
        const content = (o.message && Array.isArray(o.message.content)) ? o.message.content : [];
        for (const c of content) {
          if (c.type !== 'tool_result' || !c.is_error) continue;
          out.tool_errors++;
          const t = typeof c.content === 'string' ? c.content : JSON.stringify(c.content || '');
          if (/has been denied|requires approval|permission to use/i.test(t)) out.denied.error_results_mentioning_permission++;
        }
        break;
      }
      case 'rate_limit_event': {
        out.rate_limit.seen = true;
        out.rate_limit.events++;
        const info = o.rate_limit_info || {};
        out.rate_limit.last = info;
        const windows = info.unifiedWindows || {};
        const exhausted = Object.values(windows).some((w) => w && typeof w.utilization === 'number' && w.utilization >= 1);
        if ((info.status && info.status !== 'allowed' && info.status !== 'allowed_warning') || exhausted) out.rate_limit.limited = true;
        break;
      }
      case 'result': {
        out.has_result = true;
        out.num_turns = o.num_turns ?? null;
        out.duration_ms = o.duration_ms ?? null;
        out.duration_api_ms = o.duration_api_ms ?? null;
        out.total_cost_usd = o.total_cost_usd ?? null;
        out.is_error = o.is_error ?? null;
        out.result_subtype = o.subtype ?? null;
        out.terminal_reason = o.terminal_reason ?? null;
        out.api_error_status = o.api_error_status ?? null;
        const u = o.usage || {};
        out.usage = { input: u.input_tokens ?? null, output: u.output_tokens ?? null, cache_read: u.cache_read_input_tokens ?? null, cache_creation: u.cache_creation_input_tokens ?? null };
        out.modelUsage = o.modelUsage || null;
        const pd = Array.isArray(o.permission_denials) ? o.permission_denials : [];
        out.denied.permission_denials = pd.length;
        out.denied.list = [];
        for (const d of pd) {
          out.denied.tools[d.tool_name] = (out.denied.tools[d.tool_name] || 0) + 1;
          const inp = d.tool_input || {};
          const target = inp.file_path || inp.path || inp.command || inp.pattern || '';
          out.denied.list.push({ tool: d.tool_name, target: String(target).slice(0, 200) });
        }
        out.result_text = typeof o.result === 'string' ? o.result : (o.result == null ? null : JSON.stringify(o.result));
        break;
      }
      default:
        break;
    }
  }
  const rt = out.result_text || '';
  out.rate_limit.text_mentions_limit = /rate limit|usage limit|\b429\b/i.test(rt);
  out.rate_limited = out.rate_limit.limited || out.rate_limit.text_mentions_limit || out.api_error_status === 429;
  return out;
}

if (require.main === module) {
  const f = process.argv[2];
  if (!f) { console.error('usage: node parse-session.js <stream.jsonl>'); process.exit(2); }
  process.stdout.write(JSON.stringify(parse(f), null, 2) + '\n');
}
module.exports = { parse };
