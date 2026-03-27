/**
 * Interactive API Documentation
 *
 * Serves a self-contained HTML page at /v1/docs with:
 * - Endpoint browser grouped by tag (reads from /openapi.json)
 * - "Try It" forms with live request/response
 * - Schema viewer for request/response models
 */

import type { IncomingMessage, ServerResponse } from 'http';

export function handleDocs(_req: IncomingMessage, res: ServerResponse): void {
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(DOCS_HTML);
}

const DOCS_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Cullit API Documentation</title>
<style>
  :root {
    --bg: #0d1117; --surface: #161b22; --border: #30363d;
    --text: #c9d1d9; --text-muted: #8b949e; --accent: #58a6ff;
    --green: #3fb950; --red: #f85149; --yellow: #d29922; --purple: #bc8cff;
    --radius: 8px; --font: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    --mono: 'SF Mono', SFMono-Regular, Consolas, 'Liberation Mono', Menlo, monospace;
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: var(--font); background: var(--bg); color: var(--text); line-height: 1.5; }
  a { color: var(--accent); text-decoration: none; }
  a:hover { text-decoration: underline; }
  .container { max-width: 1100px; margin: 0 auto; padding: 24px; }
  header { border-bottom: 1px solid var(--border); padding-bottom: 20px; margin-bottom: 24px; }
  header h1 { font-size: 1.8rem; font-weight: 600; }
  header p { color: var(--text-muted); margin-top: 4px; }
  .header-meta { display: flex; gap: 16px; margin-top: 12px; font-size: 0.85rem; color: var(--text-muted); }
  .header-meta span { background: var(--surface); padding: 2px 8px; border-radius: 4px; border: 1px solid var(--border); }

  /* Sidebar + main layout */
  .layout { display: flex; gap: 24px; }
  .sidebar { width: 240px; flex-shrink: 0; position: sticky; top: 20px; align-self: flex-start; max-height: calc(100vh - 40px); overflow-y: auto; }
  .sidebar h3 { font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.05em; color: var(--text-muted); margin-bottom: 8px; margin-top: 16px; }
  .sidebar a { display: block; padding: 4px 8px; border-radius: 4px; font-size: 0.85rem; color: var(--text-muted); }
  .sidebar a:hover { background: var(--surface); color: var(--text); text-decoration: none; }
  .main { flex: 1; min-width: 0; }

  /* Tag group */
  .tag-group { margin-bottom: 32px; }
  .tag-group h2 { font-size: 1.2rem; border-bottom: 1px solid var(--border); padding-bottom: 8px; margin-bottom: 16px; }

  /* Endpoint card */
  .endpoint { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); margin-bottom: 12px; overflow: hidden; }
  .endpoint-header { display: flex; align-items: center; gap: 10px; padding: 12px 16px; cursor: pointer; user-select: none; }
  .endpoint-header:hover { background: rgba(88,166,255,0.05); }
  .method { font-family: var(--mono); font-size: 0.75rem; font-weight: 700; padding: 3px 8px; border-radius: 4px; min-width: 55px; text-align: center; text-transform: uppercase; }
  .method-get { background: rgba(63,185,80,0.15); color: var(--green); }
  .method-post { background: rgba(88,166,255,0.15); color: var(--accent); }
  .method-put { background: rgba(210,153,34,0.15); color: var(--yellow); }
  .method-patch { background: rgba(188,140,255,0.15); color: var(--purple); }
  .method-delete { background: rgba(248,81,73,0.15); color: var(--red); }
  .endpoint-path { font-family: var(--mono); font-size: 0.9rem; }
  .endpoint-summary { color: var(--text-muted); font-size: 0.85rem; margin-left: auto; }
  .endpoint-chevron { color: var(--text-muted); transition: transform 0.2s; }
  .endpoint.open .endpoint-chevron { transform: rotate(90deg); }

  /* Endpoint body */
  .endpoint-body { display: none; border-top: 1px solid var(--border); padding: 16px; }
  .endpoint.open .endpoint-body { display: block; }
  .endpoint-desc { color: var(--text-muted); font-size: 0.9rem; margin-bottom: 16px; }

  /* Parameters & request body */
  .section-title { font-size: 0.8rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em; color: var(--text-muted); margin: 16px 0 8px; }
  .param-table { width: 100%; border-collapse: collapse; font-size: 0.85rem; }
  .param-table th { text-align: left; border-bottom: 1px solid var(--border); padding: 6px 8px; color: var(--text-muted); font-weight: 500; }
  .param-table td { padding: 6px 8px; border-bottom: 1px solid var(--border); vertical-align: top; }
  .param-name { font-family: var(--mono); color: var(--accent); }
  .param-required { color: var(--red); font-size: 0.75rem; margin-left: 4px; }
  .param-type { font-family: var(--mono); font-size: 0.8rem; color: var(--text-muted); }

  /* Try It form */
  .try-it { background: var(--bg); border: 1px solid var(--border); border-radius: var(--radius); padding: 16px; margin-top: 16px; }
  .try-it h4 { font-size: 0.85rem; margin-bottom: 12px; color: var(--accent); }
  .form-group { margin-bottom: 10px; }
  .form-group label { display: block; font-size: 0.8rem; color: var(--text-muted); margin-bottom: 4px; font-family: var(--mono); }
  .form-group input, .form-group textarea, .form-group select {
    width: 100%; padding: 8px 10px; background: var(--surface); border: 1px solid var(--border);
    border-radius: 4px; color: var(--text); font-family: var(--mono); font-size: 0.85rem;
  }
  .form-group textarea { min-height: 100px; resize: vertical; }
  .btn-send {
    background: var(--accent); color: #000; border: none; padding: 8px 20px;
    border-radius: 4px; font-weight: 600; cursor: pointer; font-size: 0.85rem; margin-top: 8px;
  }
  .btn-send:hover { opacity: 0.9; }
  .btn-send:disabled { opacity: 0.5; cursor: not-allowed; }

  /* Response viewer */
  .response-viewer { margin-top: 12px; display: none; }
  .response-viewer.visible { display: block; }
  .response-status { font-family: var(--mono); font-size: 0.85rem; margin-bottom: 8px; padding: 6px 10px; border-radius: 4px; }
  .response-status.ok { background: rgba(63,185,80,0.15); color: var(--green); }
  .response-status.err { background: rgba(248,81,73,0.15); color: var(--red); }
  .response-body { background: var(--surface); border: 1px solid var(--border); border-radius: 4px; padding: 12px; overflow-x: auto; }
  .response-body pre { font-family: var(--mono); font-size: 0.8rem; white-space: pre-wrap; word-break: break-all; }

  /* Schema viewer */
  .schema { background: var(--bg); border: 1px solid var(--border); border-radius: 4px; padding: 12px; margin-top: 8px; }
  .schema pre { font-family: var(--mono); font-size: 0.8rem; color: var(--text-muted); white-space: pre-wrap; }

  /* Responsive */
  @media (max-width: 768px) {
    .layout { flex-direction: column; }
    .sidebar { width: 100%; position: static; max-height: none; }
    .endpoint-summary { display: none; }
  }

  /* Loading spinner */
  .loading { text-align: center; padding: 40px; color: var(--text-muted); }
</style>
</head>
<body>
<div class="container">
  <header>
    <h1>Cullit API</h1>
    <p id="api-desc">Loading API documentation...</p>
    <div class="header-meta">
      <span id="api-version"></span>
      <span><a href="/openapi.json" target="_blank">OpenAPI Spec</a></span>
      <span><a href="/health">Health Check</a></span>
    </div>
  </header>
  <div class="layout">
    <nav class="sidebar" id="sidebar"></nav>
    <div class="main" id="main">
      <div class="loading">Loading endpoints...</div>
    </div>
  </div>
</div>
<script>
(function() {
  'use strict';

  let spec = null;
  const baseUrl = window.location.origin;

  async function init() {
    try {
      const res = await fetch(baseUrl + '/openapi.json');
      spec = await res.json();
      render();
    } catch(e) {
      document.getElementById('main').innerHTML = '<p style="color:var(--red)">Failed to load OpenAPI spec: ' + escapeHtml(e.message) + '</p>';
    }
  }

  function escapeHtml(s) {
    const d = document.createElement('div');
    d.textContent = s;
    return d.innerHTML;
  }

  function render() {
    document.getElementById('api-desc').textContent = spec.info.description || '';
    document.getElementById('api-version').textContent = 'v' + spec.info.version;

    // Group paths by tag
    const groups = {};
    for (const [path, methods] of Object.entries(spec.paths)) {
      for (const [method, op] of Object.entries(methods)) {
        if (typeof op !== 'object' || !op) continue;
        const tags = op.tags || ['Other'];
        for (const tag of tags) {
          if (!groups[tag]) groups[tag] = [];
          groups[tag].push({ path, method: method.toUpperCase(), op });
        }
      }
    }

    // Build sidebar
    const sidebar = document.getElementById('sidebar');
    const sidebarParts = [];
    for (const tag of Object.keys(groups)) {
      sidebarParts.push('<h3>' + escapeHtml(tag) + '</h3>');
      for (const ep of groups[tag]) {
        const id = slugify(ep.method + '-' + ep.path);
        sidebarParts.push('<a href="#' + id + '">' + ep.method + ' ' + escapeHtml(ep.path) + '</a>');
      }
    }
    sidebar.innerHTML = sidebarParts.join('');

    // Build main content
    const main = document.getElementById('main');
    const mainParts = [];
    for (const [tag, endpoints] of Object.entries(groups)) {
      mainParts.push('<div class="tag-group">');
      mainParts.push('<h2>' + escapeHtml(tag) + '</h2>');
      for (const ep of endpoints) {
        mainParts.push(renderEndpoint(ep));
      }
      mainParts.push('</div>');
    }
    main.innerHTML = mainParts.join('');

    // Bind toggle events
    main.querySelectorAll('.endpoint-header').forEach(h => {
      h.addEventListener('click', () => h.parentElement.classList.toggle('open'));
    });
  }

  function slugify(s) { return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, ''); }

  function renderEndpoint({ path, method, op }) {
    const id = slugify(method + '-' + path);
    const methodClass = 'method-' + method.toLowerCase();
    const params = op.parameters || [];
    const hasBody = !!op.requestBody;
    const pathParams = params.filter(p => p.in === 'path');
    const queryParams = params.filter(p => p.in === 'query');

    const h = [];
    h.push('<div class="endpoint" id="' + id + '">');
    h.push('<div class="endpoint-header">');
    h.push('<span class="method ' + methodClass + '">' + method + '</span>');
    h.push('<span class="endpoint-path">' + escapeHtml(path) + '</span>');
    h.push('<span class="endpoint-summary">' + escapeHtml(op.summary || '') + '</span>');
    h.push('<span class="endpoint-chevron">&#9654;</span>');
    h.push('</div>');
    h.push('<div class="endpoint-body">');

    if (op.description) {
      h.push('<p class="endpoint-desc">' + escapeHtml(op.description) + '</p>');
    }

    // Parameters table
    if (params.length > 0) {
      h.push('<div class="section-title">Parameters</div>');
      h.push('<table class="param-table"><thead><tr><th>Name</th><th>In</th><th>Type</th><th>Description</th></tr></thead><tbody>');
      for (const p of params) {
        h.push('<tr>');
        h.push('<td><span class="param-name">' + escapeHtml(p.name) + '</span>');
        if (p.required) h.push('<span class="param-required">*</span>');
        h.push('</td>');
        h.push('<td>' + escapeHtml(p.in) + '</td>');
        h.push('<td class="param-type">' + escapeHtml(p.schema?.type || 'any') + '</td>');
        h.push('<td>' + escapeHtml(p.description || '') + '</td>');
        h.push('</tr>');
      }
      h.push('</tbody></table>');
    }

    // Request body schema
    if (hasBody) {
      h.push('<div class="section-title">Request Body</div>');
      const content = op.requestBody.content;
      const jsonContent = content?.['application/json'];
      if (jsonContent?.schema) {
        const resolved = resolveSchema(jsonContent.schema);
        h.push('<div class="schema"><pre>' + escapeHtml(JSON.stringify(resolved, null, 2)) + '</pre></div>');
      }
      if (jsonContent?.examples) {
        h.push('<div class="section-title">Examples</div>');
        for (const [name, ex] of Object.entries(jsonContent.examples)) {
          h.push('<p style="color:var(--text-muted);font-size:0.8rem;margin:4px 0">' + escapeHtml(ex.summary || name) + '</p>');
          h.push('<div class="schema"><pre>' + escapeHtml(JSON.stringify(ex.value, null, 2)) + '</pre></div>');
        }
      }
    }

    // Response schemas
    if (op.responses) {
      h.push('<div class="section-title">Responses</div>');
      h.push('<table class="param-table"><thead><tr><th>Status</th><th>Description</th></tr></thead><tbody>');
      for (const [code, resp] of Object.entries(op.responses)) {
        h.push('<tr><td class="param-name">' + escapeHtml(code) + '</td><td>' + escapeHtml(resp.description || '') + '</td></tr>');
      }
      h.push('</tbody></table>');
    }

    // Try It form
    h.push('<div class="try-it">');
    h.push('<h4>&#9889; Try It</h4>');

    // Auth input
    h.push('<div class="form-group"><label>Authorization (Bearer token or leave empty)</label>');
    h.push('<input type="text" data-try-auth="' + id + '" placeholder="clt_your_api_key or Bearer token"></div>');

    // Path params
    for (const p of pathParams) {
      h.push('<div class="form-group"><label>' + escapeHtml(p.name) + (p.required ? ' *' : '') + '</label>');
      h.push('<input type="text" data-try-path="' + id + '" data-param="' + escapeHtml(p.name) + '" placeholder="' + escapeHtml(p.description || p.name) + '"></div>');
    }

    // Query params
    for (const p of queryParams) {
      h.push('<div class="form-group"><label>' + escapeHtml(p.name) + (p.required ? ' *' : '') + '</label>');
      h.push('<input type="text" data-try-query="' + id + '" data-param="' + escapeHtml(p.name) + '" placeholder="' + escapeHtml((p.schema?.default != null ? 'default: ' + p.schema.default : '') || p.description || '') + '"></div>');
    }

    // Request body
    if (hasBody) {
      const content = op.requestBody.content?.['application/json'];
      const example = getFirstExample(content);
      h.push('<div class="form-group"><label>Request Body (JSON)</label>');
      h.push('<textarea data-try-body="' + id + '">' + escapeHtml(example ? JSON.stringify(example, null, 2) : '{}') + '</textarea></div>');
    }

    h.push('<button class="btn-send" onclick="tryRequest(\\'' + escapeAttr(id) + '\\',\\'' + escapeAttr(method) + '\\',\\'' + escapeAttr(path) + '\\')">Send Request</button>');

    // Response area
    h.push('<div class="response-viewer" id="resp-' + id + '">');
    h.push('<div class="response-status" id="resp-status-' + id + '"></div>');
    h.push('<div class="response-body"><pre id="resp-body-' + id + '"></pre></div>');
    h.push('</div>');

    h.push('</div>'); // .try-it
    h.push('</div>'); // .endpoint-body
    h.push('</div>'); // .endpoint

    return h.join('');
  }

  function escapeAttr(s) { return s.replace(/'/g, "\\\\'").replace(/"/g, '&quot;'); }

  function resolveSchema(schema) {
    if (schema.$ref) {
      const parts = schema.$ref.split('/');
      let resolved = spec;
      for (const p of parts.slice(1)) resolved = resolved?.[p];
      return resolved || schema;
    }
    return schema;
  }

  function getFirstExample(content) {
    if (!content) return null;
    if (content.examples) {
      const first = Object.values(content.examples)[0];
      if (first?.value) return first.value;
    }
    if (content.schema) {
      const resolved = resolveSchema(content.schema);
      return buildExampleFromSchema(resolved);
    }
    return null;
  }

  function buildExampleFromSchema(schema) {
    if (!schema || !schema.properties) return {};
    const obj = {};
    for (const [key, prop] of Object.entries(schema.properties)) {
      if (prop.example !== undefined) { obj[key] = prop.example; continue; }
      if (prop.default !== undefined) { obj[key] = prop.default; continue; }
      if (prop.type === 'string') obj[key] = prop.enum ? prop.enum[0] : '';
      else if (prop.type === 'integer' || prop.type === 'number') obj[key] = 0;
      else if (prop.type === 'boolean') obj[key] = false;
      else if (prop.type === 'array') obj[key] = [];
      else if (prop.type === 'object') obj[key] = {};
    }
    return obj;
  }

  // Exposed globally for onclick
  window.tryRequest = async function(id, method, pathTemplate) {
    const btn = document.querySelector('.endpoint#' + CSS.escape(id) + ' .btn-send');
    const viewer = document.getElementById('resp-' + id);
    const statusEl = document.getElementById('resp-status-' + id);
    const bodyEl = document.getElementById('resp-body-' + id);

    btn.disabled = true;
    btn.textContent = 'Sending...';
    viewer.classList.add('visible');
    statusEl.textContent = '';
    bodyEl.textContent = '';

    try {
      // Build URL with path params
      let url = pathTemplate;
      document.querySelectorAll('[data-try-path="' + id + '"]').forEach(input => {
        url = url.replace('{' + input.dataset.param + '}', encodeURIComponent(input.value));
      });

      // Add query params
      const qp = new URLSearchParams();
      document.querySelectorAll('[data-try-query="' + id + '"]').forEach(input => {
        if (input.value) qp.set(input.dataset.param, input.value);
      });
      const qs = qp.toString();
      if (qs) url += '?' + qs;

      // Build headers
      const headers = {};
      const auth = document.querySelector('[data-try-auth="' + id + '"]')?.value;
      if (auth) headers['Authorization'] = auth.startsWith('Bearer ') ? auth : 'Bearer ' + auth;

      // Build request options
      const opts = { method, headers };
      const bodyTextarea = document.querySelector('[data-try-body="' + id + '"]');
      if (bodyTextarea && (method === 'POST' || method === 'PUT' || method === 'PATCH')) {
        headers['Content-Type'] = 'application/json';
        opts.body = bodyTextarea.value;
      }

      const start = performance.now();
      const res = await fetch(baseUrl + url, opts);
      const elapsed = Math.round(performance.now() - start);
      const text = await res.text();

      statusEl.className = 'response-status ' + (res.ok ? 'ok' : 'err');
      statusEl.textContent = res.status + ' ' + res.statusText + '  (' + elapsed + 'ms)';

      try {
        bodyEl.textContent = JSON.stringify(JSON.parse(text), null, 2);
      } catch {
        bodyEl.textContent = text;
      }
    } catch(e) {
      statusEl.className = 'response-status err';
      statusEl.textContent = 'Request failed';
      bodyEl.textContent = e.message;
    } finally {
      btn.disabled = false;
      btn.textContent = 'Send Request';
    }
  };

  init();
})();
</script>
</body>
</html>`;
