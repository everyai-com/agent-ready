/**
 * Static console assets — CSS and vanilla JS, served from their own
 * same-origin routes so the page can stay `default-src 'self'` CSP-clean
 * with no inline scripts/styles and no CDNs.
 */

export const CONSOLE_CSS = `
:root {
  color-scheme: light dark;
  --bg: #16130f;
  --bg-elevated: #1e1a14;
  --border: #332c22;
  --text: #f2ece0;
  --text-dim: #b4a892;
  --accent: #e8a33d;
  --accent-text: #201607;
  --green: #7bc47f;
  --red: #e0715c;
  --font: -apple-system, BlinkMacSystemFont, "Segoe UI", Inter, sans-serif;
  --mono: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
}
@media (prefers-color-scheme: light) {
  :root {
    --bg: #faf6ee;
    --bg-elevated: #ffffff;
    --border: #e6ddc9;
    --text: #221c12;
    --text-dim: #6b5f49;
    --accent: #b5751b;
    --accent-text: #fffaf0;
    --green: #2f7d38;
    --red: #b23a24;
  }
}
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; }
body {
  background: var(--bg);
  color: var(--text);
  font: 15px/1.55 var(--font);
  min-height: 100vh;
}
a { color: var(--accent); }
code, pre, .mono { font-family: var(--mono); }
code {
  background: color-mix(in srgb, currentColor 10%, transparent);
  border-radius: 4px;
  padding: 0.1em 0.4em;
  font-size: 0.9em;
}
pre {
  background: var(--bg-elevated);
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 1rem;
  overflow-x: auto;
  font-size: 0.85em;
}
.wrap { max-width: 880px; margin: 0 auto; padding: 2.5rem 1.5rem 5rem; }
.hero { margin-bottom: 2rem; }
.hero .badge {
  display: inline-flex; align-items: center; gap: 0.4em;
  background: color-mix(in srgb, var(--green) 18%, transparent);
  color: var(--green);
  border-radius: 999px;
  padding: 0.25em 0.8em;
  font-size: 0.8rem;
  font-weight: 600;
  margin-bottom: 0.9rem;
}
.hero h1 { font-size: 1.7rem; margin: 0 0 0.4rem; letter-spacing: -0.01em; }
.hero p { color: var(--text-dim); margin: 0; }
.tabs { display: flex; gap: 0.4rem; margin: 2rem 0 1.5rem; border-bottom: 1px solid var(--border); }
.tab-btn {
  appearance: none; background: none; border: none; cursor: pointer;
  color: var(--text-dim); font: inherit; font-weight: 600;
  padding: 0.6rem 0.2rem; margin-right: 1.2rem; border-bottom: 2px solid transparent;
}
.tab-btn.active { color: var(--text); border-bottom-color: var(--accent); }
.panel { display: none; }
.panel.active { display: block; }
.card {
  background: var(--bg-elevated);
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 1.25rem 1.4rem;
  margin-bottom: 1.1rem;
}
.card h2 { font-size: 1rem; margin: 0 0 0.9rem; }
.resource-row { padding: 0.7rem 0; border-top: 1px solid var(--border); }
.resource-row:first-child { border-top: none; padding-top: 0; }
.resource-row .rname { font-weight: 600; }
.resource-row .rmeta { color: var(--text-dim); font-size: 0.85rem; margin-left: 0.4em; }
.chips { display: flex; flex-wrap: wrap; gap: 0.4rem; margin-top: 0.5rem; }
.chip {
  font-size: 0.78rem; font-weight: 600; border-radius: 999px;
  padding: 0.22em 0.7em; border: 1px solid var(--border);
  color: var(--text-dim);
}
.chip.on { background: color-mix(in srgb, var(--green) 16%, transparent); color: var(--green); border-color: transparent; }
.chip.locked { background: color-mix(in srgb, var(--red) 14%, transparent); color: var(--red); border-color: transparent; }
.chip-note { font-size: 0.78rem; color: var(--text-dim); margin-top: 0.3rem; }
.snippet-tabs { display: flex; gap: 0.4rem; flex-wrap: wrap; margin-bottom: 0.6rem; }
.snippet-tabs button {
  appearance: none; cursor: pointer; font: inherit; font-size: 0.8rem; font-weight: 600;
  background: var(--bg); color: var(--text-dim); border: 1px solid var(--border);
  border-radius: 999px; padding: 0.3em 0.8em;
}
.snippet-tabs button.active { color: var(--accent-text); background: var(--accent); border-color: transparent; }
.copy-row { position: relative; }
.copy-btn {
  position: absolute; top: 0.5rem; right: 0.5rem;
  font: inherit; font-size: 0.75rem; cursor: pointer;
  background: var(--bg); color: var(--text); border: 1px solid var(--border);
  border-radius: 6px; padding: 0.25em 0.6em;
}
select, input[type=text], input[type=number], textarea {
  width: 100%; font: inherit; color: var(--text);
  background: var(--bg); border: 1px solid var(--border); border-radius: 8px;
  padding: 0.55em 0.7em; margin-top: 0.3rem;
}
label { display: block; font-size: 0.85rem; font-weight: 600; margin-top: 0.9rem; }
label:first-child { margin-top: 0; }
.field-row { display: flex; align-items: center; gap: 0.5em; }
.field-row input[type=checkbox] { width: auto; margin: 0; }
button.primary {
  font: inherit; font-weight: 700; cursor: pointer;
  background: var(--accent); color: var(--accent-text);
  border: none; border-radius: 8px; padding: 0.6em 1.2em; margin-top: 1.2rem;
}
button.primary:disabled { opacity: 0.6; cursor: default; }
button.link { appearance: none; background: none; border: none; color: var(--accent); font: inherit; cursor: pointer; padding: 0; }
table.result { width: 100%; border-collapse: collapse; font-size: 0.85rem; margin-top: 0.6rem; }
table.result th, table.result td {
  text-align: left; padding: 0.4em 0.6em; border-bottom: 1px solid var(--border);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 260px;
}
table.result th { color: var(--text-dim); font-weight: 600; }
.denial { color: var(--red); font-weight: 600; }
.empty { color: var(--text-dim); font-style: italic; }
.login-wrap { max-width: 360px; margin: 6rem auto; padding: 0 1.5rem; }
.login-wrap h1 { font-size: 1.3rem; }
.login-wrap input { margin-bottom: 0.8rem; }
.error-text { color: var(--red); font-size: 0.85rem; margin-top: 0.5rem; }
.footer-note { color: var(--text-dim); font-size: 0.8rem; margin-top: 2.5rem; }
.raw-toggle { margin-top: 0.8rem; }
`;

export const CONSOLE_JS = `
(function () {
  "use strict";

  function $(sel, root) { return (root || document).querySelector(sel); }
  function $all(sel, root) { return Array.from((root || document).querySelectorAll(sel)); }

  function escapeHtml(v) {
    return String(v)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  async function api(path, opts) {
    const res = await fetch(path, Object.assign({ headers: { "content-type": "application/json" } }, opts || {}));
    let body = null;
    try { body = await res.json(); } catch (e) { /* no body */ }
    return { ok: res.ok, status: res.status, body: body };
  }

  function initTabs() {
    $all(".tab-btn").forEach(function (btn) {
      btn.addEventListener("click", function () {
        $all(".tab-btn").forEach(function (b) { b.classList.remove("active"); });
        $all(".panel").forEach(function (p) { p.classList.remove("active"); });
        btn.classList.add("active");
        $("#" + btn.dataset.panel).classList.add("active");
      });
    });
  }

  function initSnippetTabs() {
    $all(".snippet-tabs").forEach(function (group) {
      var buttons = $all("button", group);
      buttons.forEach(function (btn) {
        btn.addEventListener("click", function () {
          buttons.forEach(function (b) { b.classList.remove("active"); });
          btn.classList.add("active");
          var container = group.parentElement;
          $all("pre[data-snippet]", container).forEach(function (pre) {
            pre.style.display = pre.dataset.snippet === btn.dataset.snippet ? "block" : "none";
          });
        });
      });
    });
  }

  function initCopyButtons() {
    $all(".copy-btn").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var target = document.getElementById(btn.dataset.copyTarget);
        if (!target) return;
        var text = target.innerText;
        navigator.clipboard.writeText(text).then(function () {
          var old = btn.textContent;
          btn.textContent = "Copied";
          setTimeout(function () { btn.textContent = old; }, 1200);
        });
      });
    });
  }

  var toolsCache = [];

  function fieldInput(name, schema, required) {
    var type = (schema && schema.type) || "string";
    var id = "field_" + name;
    var label = '<label for="' + id + '">' + escapeHtml(name) + (required ? " *" : "") + "</label>";
    if (type === "boolean") {
      return '<div class="field-row"><input type="checkbox" id="' + id + '" data-field="' + escapeHtml(name) + '" data-type="boolean" /><label for="' + id + '" style="margin:0">' + escapeHtml(name) + "</label></div>";
    }
    if (type === "number") {
      return label + '<input type="number" id="' + id + '" data-field="' + escapeHtml(name) + '" data-type="number" />';
    }
    if (type === "object") {
      return label + '<textarea id="' + id + '" data-field="' + escapeHtml(name) + '" data-type="object" rows="3" placeholder="{}"></textarea>';
    }
    return label + '<input type="text" id="' + id + '" data-field="' + escapeHtml(name) + '" data-type="string" />';
  }

  function renderForm(tool) {
    var form = $("#playground-form");
    form.innerHTML = "";
    var props = (tool.inputSchema && tool.inputSchema.properties) || {};
    var required = (tool.inputSchema && tool.inputSchema.required) || [];
    Object.keys(props).forEach(function (name) {
      var wrap = document.createElement("div");
      wrap.innerHTML = fieldInput(name, props[name], required.indexOf(name) !== -1);
      form.appendChild(wrap.firstElementChild || wrap);
    });
    $("#run-btn").disabled = false;
  }

  function collectInput() {
    var input = {};
    $all("[data-field]", $("#playground-form")).forEach(function (el) {
      var name = el.dataset.field;
      var type = el.dataset.type;
      if (type === "boolean") {
        input[name] = el.checked;
      } else if (type === "number") {
        if (el.value !== "") input[name] = Number(el.value);
      } else if (type === "object") {
        if (el.value.trim() !== "") {
          try { input[name] = JSON.parse(el.value); } catch (e) { /* leave unset on bad json */ }
        }
      } else if (el.value !== "") {
        input[name] = el.value;
      }
    });
    return input;
  }

  function renderResultTable(rows) {
    if (!rows || rows.length === 0) {
      return '<p class="empty">No rows returned.</p>';
    }
    var cols = Object.keys(rows[0]);
    var html = '<table class="result"><thead><tr>';
    cols.forEach(function (c) { html += "<th>" + escapeHtml(c) + "</th>"; });
    html += "</tr></thead><tbody>";
    rows.forEach(function (row) {
      html += "<tr>";
      cols.forEach(function (c) {
        var v = row[c];
        var text = v === null || v === undefined ? "" : typeof v === "object" ? JSON.stringify(v) : String(v);
        html += "<td>" + escapeHtml(text) + "</td>";
      });
      html += "</tr>";
    });
    html += "</tbody></table>";
    return html;
  }

  async function loadTools() {
    var res = await api("/api/console/tools");
    if (!res.ok) return;
    toolsCache = res.body.tools || [];
    var select = $("#tool-select");
    select.innerHTML = '<option value="">Select a tool…</option>';
    toolsCache.forEach(function (t) {
      var opt = document.createElement("option");
      opt.value = t.name;
      opt.textContent = t.name + " — " + t.description;
      select.appendChild(opt);
    });
    select.addEventListener("change", function () {
      var tool = toolsCache.find(function (t) { return t.name === select.value; });
      if (tool) renderForm(tool);
      else { $("#playground-form").innerHTML = ""; $("#run-btn").disabled = true; }
    });
  }

  async function runTool() {
    var select = $("#tool-select");
    var toolName = select.value;
    if (!toolName) return;
    var input = collectInput();
    var runBtn = $("#run-btn");
    runBtn.disabled = true;
    runBtn.textContent = "Running…";
    var res = await api("/api/console/run", {
      method: "POST",
      body: JSON.stringify({ tool: toolName, input: input }),
    });
    runBtn.disabled = false;
    runBtn.textContent = "Run";

    var out = $("#playground-result");
    var raw = { request: { tool: toolName, input: input }, response: res.body };
    $("#raw-json").textContent = JSON.stringify(raw, null, 2);

    if (!res.ok || !res.body || res.body.ok === false) {
      var reason = (res.body && (res.body.error || res.body.denial)) || "Request failed.";
      out.innerHTML = '<p class="denial">Denied: ' + escapeHtml(reason) + "</p>";
      return;
    }
    out.innerHTML = renderResultTable(res.body.rows || []);
  }

  function initPlayground() {
    if (!$("#tool-select")) return;
    loadTools();
    $("#run-btn").addEventListener("click", runTool);
    var toggle = $("#raw-toggle");
    if (toggle) {
      toggle.addEventListener("click", function () {
        var pre = $("#raw-json");
        var showing = pre.style.display !== "none";
        pre.style.display = showing ? "none" : "block";
        toggle.textContent = showing ? "Show raw request/response" : "Hide raw request/response";
      });
    }
  }

  function initLogout() {
    var btn = $("#logout-btn");
    if (!btn) return;
    btn.addEventListener("click", async function () {
      await api("/api/console/logout", { method: "POST" });
      window.location.reload();
    });
  }

  document.addEventListener("DOMContentLoaded", function () {
    initTabs();
    initSnippetTabs();
    initCopyButtons();
    initPlayground();
    initLogout();
  });
})();
`;

export const LOGIN_JS = `
(function () {
  "use strict";
  var form = document.getElementById("login-form");
  if (!form) return;
  form.addEventListener("submit", async function (e) {
    e.preventDefault();
    var pw = document.getElementById("password").value;
    var err = document.getElementById("login-error");
    err.textContent = "";
    var res = await fetch("/api/console/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ password: pw }),
    });
    if (res.ok) {
      window.location.reload();
    } else {
      err.textContent = "Incorrect password.";
    }
  });
})();
`;
