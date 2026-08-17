/**
 * The chat webview's markup. Shared by both surfaces it can appear in:
 * the sidebar view (AiPmChatViewProvider) and the large editor-column
 * panel (AiPmChatPanel), so the two can never drift apart.
 */
export function renderChatHtml(nonce: string, variant: "sidebar" | "panel"): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
<style>
  :root { color-scheme: light dark; }
  * { box-sizing: border-box; }
  body {
    margin: 0; height: 100vh; display: flex; flex-direction: column;
    font-family: var(--vscode-font-family);
    font-size: var(--vscode-font-size, 13px);
    color: var(--vscode-foreground);
    background: var(--vscode-editor-background);
  }
  #shell {
    flex: 1; display: flex; flex-direction: column; min-height: 0;
    width: 100%; max-width: ${variant === "panel" ? "820px" : "100%"};
    margin: 0 auto;
  }

  /* ---- header ---- */
  #header {
    padding: 12px 16px 10px; display: flex; flex-direction: column; gap: 7px;
    border-bottom: 1px solid var(--vscode-panel-border);
  }
  .titleRow { display: flex; align-items: center; gap: 8px; }
  /* The project name doubles as the project switcher, so the one thing
     naming the chat's scope is also the control that changes it. */
  .switcher {
    display: flex; align-items: center; gap: 8px; min-width: 0;
    background: transparent; color: var(--vscode-foreground);
    border: 1px solid transparent; border-radius: 7px;
    margin-left: -7px; padding: 3px 7px; cursor: pointer; text-align: left;
  }
  .switcher:hover:not(:disabled) { background: var(--vscode-list-hoverBackground); }
  .switcher:focus-visible { outline: none; border-color: var(--vscode-focusBorder); }
  .chev { font-size: 9px; opacity: .45; flex: none; }
  .dot { width: 7px; height: 7px; border-radius: 50%; background: #3fb950; flex: none; }
  .dot.off { background: var(--vscode-descriptionForeground); }
  .name { font-weight: 600; font-size: 14px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .key {
    font-family: var(--vscode-editor-font-family, monospace);
    font-size: 11px; opacity: .55; letter-spacing: .03em;
  }
  .ver { margin-left: auto; font-size: 10px; opacity: .35; letter-spacing: .05em; }
  .chips { display: flex; flex-wrap: wrap; gap: 5px; }
  .chip {
    font-size: 11px; padding: 2px 9px; border-radius: 999px;
    border: 1px solid var(--vscode-panel-border); opacity: .9;
  }
  .chip.warn { border-color: var(--vscode-editorWarning-foreground, #d29922); }

  /* ---- messages ---- */
  #messages { flex: 1; overflow-y: auto; padding: 18px 16px; display: flex; flex-direction: column; gap: 18px; }

  #empty { display: flex; flex-direction: column; gap: 12px; padding-top: 6px; }
  #empty h2 { margin: 0; font-size: 15px; font-weight: 600; }
  #empty p { margin: 0; opacity: .6; font-size: 12px; line-height: 1.6; }
  .suggestions { display: flex; flex-direction: column; gap: 6px; margin-top: 4px; }
  .suggestion {
    text-align: left; width: 100%; padding: 9px 12px; border-radius: 8px; cursor: pointer;
    background: transparent; color: var(--vscode-foreground);
    border: 1px solid var(--vscode-panel-border);
    font-family: inherit; font-size: 12px; line-height: 1.4;
  }
  .suggestion:hover { background: var(--vscode-list-hoverBackground); }

  .msg { display: flex; flex-direction: column; gap: 7px; }
  .msg .who {
    font-size: 10px; font-weight: 700; letter-spacing: .09em; text-transform: uppercase; opacity: .5;
  }
  .msg .text { line-height: 1.62; white-space: pre-wrap; word-wrap: break-word; }
  .msg.user { align-items: flex-end; }
  .msg.user .text {
    background: var(--vscode-button-background); color: var(--vscode-button-foreground);
    padding: 9px 13px; border-radius: 14px; border-bottom-right-radius: 5px; max-width: 88%;
  }
  .msg.error .text {
    background: var(--vscode-inputValidation-errorBackground);
    border: 1px solid var(--vscode-inputValidation-errorBorder);
    padding: 9px 13px; border-radius: 8px;
  }

  /* ---- action cards ---- */
  .card { border: 1px solid var(--vscode-panel-border); border-radius: 10px; overflow: hidden; }
  .card.await { border-color: var(--vscode-editorWarning-foreground, #d29922); }
  .card .head {
    padding: 8px 13px; font-size: 10px; font-weight: 700;
    letter-spacing: .09em; text-transform: uppercase; opacity: .65;
    background: var(--vscode-textCodeBlock-background);
  }
  .card .body { padding: 11px 13px; display: flex; flex-direction: column; gap: 8px; }
  .act { font-size: 12px; line-height: 1.55; white-space: pre-wrap; padding-left: 20px; position: relative; }
  .act::before { position: absolute; left: 0; top: 0; font-weight: 700; }
  .act.ok::before { content: "✓"; color: #3fb950; }
  .act.fail::before { content: "✕"; color: #f85149; }
  .act.wait::before { content: "→"; opacity: .55; }
  .act .err { display: block; font-size: 11px; opacity: .75; margin-top: 3px; }
  .card .foot {
    padding: 10px 13px; display: flex; gap: 8px; align-items: center;
    border-top: 1px solid var(--vscode-panel-border);
  }
  .card .foot .note { font-size: 11px; opacity: .7; margin-right: auto; }

  /* ---- composer ---- */
  #thinking { display: none; padding: 0 16px 10px; font-size: 12px; opacity: .65; }
  #thinking span { display: inline-block; animation: pulse 1.4s ease-in-out infinite; }
  @keyframes pulse { 0%,100% { opacity: .4 } 50% { opacity: 1 } }
  #composer { padding: 10px 16px 14px; }
  #box {
    display: flex; align-items: flex-end; gap: 8px; padding: 8px 8px 8px 12px;
    border: 1px solid var(--vscode-input-border, var(--vscode-panel-border));
    border-radius: 12px; background: var(--vscode-input-background);
  }
  #box:focus-within { border-color: var(--vscode-focusBorder); }
  #input {
    flex: 1; resize: none; border: none; outline: none; background: transparent;
    color: var(--vscode-input-foreground); font-family: inherit; font-size: inherit;
    line-height: 1.5; max-height: 180px; padding: 3px 0;
  }
  .hintline { margin-top: 7px; font-size: 10.5px; opacity: .45; text-align: center; }

  button {
    background: var(--vscode-button-background); color: var(--vscode-button-foreground);
    border: none; border-radius: 7px; padding: 5px 13px; cursor: pointer;
    font-size: 12px; font-family: inherit; font-weight: 500;
  }
  button:hover:not(:disabled) { background: var(--vscode-button-hoverBackground); }
  button:disabled { opacity: .45; cursor: default; }
  button.ghost {
    background: transparent; color: var(--vscode-foreground);
    border: 1px solid var(--vscode-panel-border);
  }
  button.ghost:hover:not(:disabled) { background: var(--vscode-list-hoverBackground); }
  #send { flex: none; border-radius: 8px; padding: 6px 14px; }
</style>
</head>
<body>
<div id="shell">
  <div id="header">
    <div class="titleRow"><span class="dot off"></span><span class="name">Connecting…</span></div>
  </div>

  <div id="messages">
    <div id="empty">
      <h2>What should I change?</h2>
      <p>I can create and edit issues, move them, set dependencies, and plan sprints — directly in this project.</p>
      <div class="suggestions">
        <button class="suggestion">Create a high priority bug for the login crash</button>
        <button class="suggestion">What's blocking this sprint?</button>
        <button class="suggestion">Plan the next sprint with max 25 points</button>
        <button class="suggestion">Carry unfinished work into a new sprint</button>
      </div>
    </div>
  </div>

  <div id="thinking"><span>AI PM is working…</span></div>

  <div id="composer">
    <div id="box">
      <textarea id="input" rows="1" placeholder="Ask AI PM to do something…"></textarea>
      <button id="send">Send</button>
    </div>
    <div class="hintline">Enter to send · Shift+Enter for a new line · local model, replies take a moment</div>
  </div>
</div>

<script nonce="${nonce}">
  const vscode = acquireVsCodeApi();
  const headerEl = document.getElementById('header');
  const messagesEl = document.getElementById('messages');
  const thinkingEl = document.getElementById('thinking');
  const inputEl = document.getElementById('input');
  const sendBtn = document.getElementById('send');
  const runs = new Map();
  const emptyTemplate = document.getElementById('empty').cloneNode(true);
  let currentProjectId = null;

  const el = (tag, cls, txt) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (txt !== undefined) n.textContent = txt;
    return n;
  };
  const scroll = () => { messagesEl.scrollTop = messagesEl.scrollHeight; };
  const dropEmpty = () => { const e = document.getElementById('empty'); if (e) e.remove(); };

  function renderHeader(m) {
    headerEl.innerHTML = '';
    const row = el('div', 'titleRow');

    const switcher = el('button', 'switcher');
    switcher.title = m.connected ? 'Switch to another project' : 'Connect a project';
    switcher.appendChild(el('span', 'dot' + (m.connected ? '' : ' off')));
    switcher.appendChild(el('span', 'name',
      m.connected ? m.project.name : m.unreachable ? 'API unreachable' : 'No project connected'));
    if (m.connected) switcher.appendChild(el('span', 'key', m.project.key));
    switcher.appendChild(el('span', 'chev', '▾'));
    switcher.addEventListener('click', () => vscode.postMessage({ type: 'switchProject' }));
    row.appendChild(switcher);

    row.appendChild(el('span', 'ver', 'v${"0.3.0"}'));
    headerEl.appendChild(row);

    const chips = el('div', 'chips');
    if (m.connected) {
      chips.appendChild(el('span', 'chip', m.sprint || 'No active sprint'));
      chips.appendChild(el('span', 'chip', m.progress + ' done'));
      if (m.riskCount > 0) chips.appendChild(el('span', 'chip warn', m.riskCount + (m.riskCount === 1 ? ' risk' : ' risks')));
    } else if (m.unreachable) {
      chips.appendChild(el('span', 'chip warn', 'Start the API with pnpm dev'));
    } else {
      chips.appendChild(el('span', 'chip', 'Click the name above to pick a project'));
    }
    headerEl.appendChild(chips);
  }

  /**
   * Agent runs are project-scoped, so a transcript from the old project --
   * and any proposal still awaiting approval in it -- can't carry over.
   */
  function resetTranscript() {
    runs.clear();
    messagesEl.innerHTML = '';
    const empty = emptyTemplate.cloneNode(true);
    wireSuggestions(empty);
    messagesEl.appendChild(empty);
  }

  function addMessage(role, text) {
    dropEmpty();
    const m = el('div', 'msg ' + role);
    if (role !== 'user') m.appendChild(el('div', 'who', role === 'error' ? 'Error' : 'AI PM'));
    m.appendChild(el('div', 'text', text));
    messagesEl.appendChild(m);
    scroll();
  }

  function actLine(cls, text, err) {
    const l = el('div', 'act ' + cls, text);
    if (err) l.appendChild(el('span', 'err', err));
    return l;
  }

  function addResultCard(results) {
    dropEmpty();
    const card = el('div', 'card');
    card.appendChild(el('div', 'head', 'Changes made'));
    const body = el('div', 'body');
    results.forEach(r => body.appendChild(actLine(r.ok ? 'ok' : 'fail', r.description, r.error || undefined)));
    card.appendChild(body);
    messagesEl.appendChild(card);
    scroll();
  }

  function addProposal(runId, actions) {
    dropEmpty();
    const card = el('div', 'card await');
    const head = el('div', 'head', 'Waiting for your approval');
    card.appendChild(head);
    const body = el('div', 'body');
    actions.forEach(a => body.appendChild(actLine('wait', a.description)));
    card.appendChild(body);

    const foot = el('div', 'foot');
    const note = el('span', 'note', 'Nothing has changed yet.');
    const cancel = el('button', 'ghost', 'Cancel');
    const apply = el('button', null, 'Apply');
    apply.addEventListener('click', () => vscode.postMessage({ type: 'apply', runId }));
    cancel.addEventListener('click', () => {
      foot.innerHTML = '';
      foot.appendChild(el('span', 'note', 'Cancelled — nothing was changed.'));
      head.textContent = 'Cancelled';
      card.classList.remove('await');
    });
    foot.append(note, cancel, apply);
    card.appendChild(foot);

    messagesEl.appendChild(card);
    runs.set(runId, { card, head, body, foot, apply, cancel, note });
    scroll();
  }

  function send(preset) {
    const text = (preset !== undefined ? preset : inputEl.value).trim();
    if (!text) return;
    addMessage('user', text);
    vscode.postMessage({ type: 'send', text });
    inputEl.value = '';
    inputEl.style.height = 'auto';
  }

  function wireSuggestions(root) {
    root.querySelectorAll('.suggestion').forEach(b =>
      b.addEventListener('click', () => send(b.textContent)));
  }

  sendBtn.addEventListener('click', () => send());
  wireSuggestions(document);
  inputEl.addEventListener('input', () => {
    inputEl.style.height = 'auto';
    inputEl.style.height = Math.min(inputEl.scrollHeight, 180) + 'px';
  });
  inputEl.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
  });

  window.addEventListener('message', ev => {
    const m = ev.data;
    if (m.type === 'header') {
      const projectId = m.projectId || null;
      if (currentProjectId !== null && projectId !== currentProjectId) resetTranscript();
      currentProjectId = projectId;
      renderHeader(m);
    } else if (m.type === 'assistant') {
      addMessage(m.role, m.text);
      if (m.applied && m.applied.length) addResultCard(m.applied);
      if (m.actions && m.actions.length && m.runId) addProposal(m.runId, m.actions);
    } else if (m.type === 'thinking') {
      thinkingEl.style.display = m.value ? 'block' : 'none';
      sendBtn.disabled = m.value;
    } else if (m.type === 'applying') {
      const r = runs.get(m.runId);
      if (r) { r.apply.disabled = m.value; r.cancel.disabled = m.value; if (m.value) r.note.textContent = 'Applying…'; }
    } else if (m.type === 'applied') {
      const r = runs.get(m.runId);
      if (r) {
        r.body.innerHTML = '';
        m.results.forEach(x => r.body.appendChild(actLine(x.ok ? 'ok' : 'fail', x.description, x.error || undefined)));
        r.foot.innerHTML = '';
        r.foot.appendChild(el('span', 'note',
          m.status === 'applied' ? 'Applied.' : 'Stopped after a failure — earlier changes were kept.'));
        r.head.textContent = m.status === 'applied' ? 'Changes made' : 'Partially applied';
        r.card.classList.remove('await');
      }
      scroll();
    }
  });

  vscode.postMessage({ type: 'ready' });
</script>
</body>
</html>`;
}

export function getNonce(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let text = "";
  for (let i = 0; i < 32; i++) text += chars.charAt(Math.floor(Math.random() * chars.length));
  return text;
}
