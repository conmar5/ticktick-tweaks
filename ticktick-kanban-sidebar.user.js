// ==UserScript==
// @name         TickTick — Kanban detail as resizable right sidebar
// @namespace    cowork
// @version      1.8.0
// @downloadURL  https://raw.githubusercontent.com/conmar5/ticktick-tweaks/main/ticktick-kanban-sidebar.user.js
// @updateURL    https://raw.githubusercontent.com/conmar5/ticktick-tweaks/main/ticktick-kanban-sidebar.user.js
// @description  Optionally docks TickTick's Kanban/board task-detail popup into a full-height panel pinned to the right edge, with a draggable left edge to resize. A toggle icon beside the priority flag switches between the sidebar and TickTick's default popup; the choice and width are remembered. Adds "Project" and "Chat" buttons into the task detail's own footer toolbar: "Project" opens the Claude Project linked by the card's "Project ID:" line (and explains how to link one if it's missing), "Chat" opens a Cowork session prefilled for the task.
// @author       Mark
// @match        https://ticktick.com/*
// @match        https://*.ticktick.com/*
// @run-at       document-idle
// @grant        none
// ==/UserScript==

(function () {
  'use strict';

  // Only run in the top window, not in any embedded iframes.
  if (window.top !== window.self) return;

  var KEY = 'tt_sidebar_width_v2';  // localStorage key for remembered width
  var MODE_KEY = 'tt_sidebar_mode'; // 'on' = our sidebar, 'off' = TickTick's default popup
  var MINW = 320;                 // smallest allowed width (px)
  var DEFAULT = 600;              // starting width (px) — drag the edge to change; your choice is remembered
  var root = document.documentElement;

  var w = parseInt(localStorage.getItem(KEY), 10) || DEFAULT;
  root.style.setProperty('--tt-sidebar-w', w + 'px');

  // Sidebar mode is on by default; 'off' leaves TickTick's popup exactly as it ships.
  var sidebarOn = localStorage.getItem(MODE_KEY) !== 'off';

  // TickTick's own anchors inside the task-detail popup (verified against the live DOM):
  //   header row  .header.td-header .toolBar.td-bar .td-btns   -> [check, due-date, .td-priority(flag)]
  //   footer bar  .td-footer .toolBar .td-items                -> the A / comment / more icon group
  var SEL_PANEL = '.out-detail.out-detail-pop';
  var SEL_HEADER_ROW = '.header.td-header .toolBar.td-bar .td-btns';
  var SEL_FOOTER_GROUP = '.td-footer .toolBar .td-items';

  var css = [
    /* every panel rule is gated behind body.tt-sidebar-on, so toggling the class
       restores TickTick's stock popup with no other side effects */
    'body.tt-sidebar-on .out-detail.out-detail-pop{',
    '  position:fixed !important; top:0 !important; right:0 !important;',
    '  left:auto !important; bottom:0 !important;',
    '  width:var(--tt-sidebar-w,460px) !important; max-width:90vw !important;',
    '  height:100vh !important; max-height:none !important; min-height:0 !important;',
    '  margin:0 !important; transform:none !important; border-radius:0 !important;',
    '  border-left:1px solid rgba(128,128,128,0.25) !important;',
    '  box-shadow:-4px 0 16px rgba(0,0,0,0.35) !important;',
    // 1050 = TickTick's own popup layer, so its dropdown menus (more, tags, dates) still open above the panel
    '  z-index:1050 !important;',
    '}',
    'body.tt-sidebar-on .out-detail.out-detail-pop .task-detail{',
    '  height:100vh !important; max-height:none !important;',
    '}',
    /* the drag handle sits on the panel's left edge, full height (sidebar mode only) */
    '#tt-sidebar-grip{',
    '  position:fixed; top:0; bottom:0; width:10px;',
    '  right:var(--tt-sidebar-w,460px); margin-right:-5px;',
    '  cursor:col-resize; z-index:1051; display:none;',
    '}',
    '#tt-sidebar-grip:hover, #tt-sidebar-grip.dragging{ background:rgba(74,144,226,0.6); }',
    'body.tt-resizing{ user-select:none !important; cursor:col-resize !important; }',
    /* our buttons, injected into TickTick's own footer toolbar */
    '.tt-c-btn{',
    '  font:12px/1.2 -apple-system,system-ui,sans-serif; padding:4px 8px; margin-right:8px;',
    '  border:1px solid rgba(128,128,128,0.4); border-radius:5px; background:transparent;',
    '  color:inherit; cursor:pointer; white-space:nowrap; opacity:0.85;',
    '}',
    '.tt-c-btn:hover{ opacity:1; border-color:rgba(74,144,226,0.9); background:rgba(74,144,226,0.15); }',
    /* view toggle, injected beside the priority flag */
    '.tt-c-toggle{',
    '  display:flex; align-items:center; cursor:pointer; padding:0 4px 0 8px; opacity:0.45;',
    '}',
    '.tt-c-toggle:hover{ opacity:0.9; }',
    'body.tt-sidebar-on .tt-c-toggle{ opacity:0.95; color:#4a90e2; }'
  ].join('\n');

  var style = document.createElement('style');
  style.id = 'tt-sidebar-style';
  style.textContent = css;
  (document.head || root).appendChild(style);

  var grip = document.createElement('div');
  grip.id = 'tt-sidebar-grip';
  document.body.appendChild(grip);

  // ---- helpers ---------------------------------------------------------------
  function currentTask() {
    var panel = document.querySelector(SEL_PANEL);
    var title = '';
    if (panel) {
      var el = panel.querySelector('.task-detail .title, textarea.title-input, .title-input, [contenteditable="true"], .title, h1, h2');
      if (el) title = (el.value || el.innerText || el.textContent || '').trim();
    }
    if (!title) title = (document.title || '').replace(/\s*[|-].*$/, '').trim();
    return { title: title || 'this task', url: location.href };
  }

  // Look for a "Project ID: <value>" line anywhere in the open card and return the
  // bare project id. Also accepts the "Claude Project ID:" label (the daily scout
  // writes that variant). Accepts a raw UUID, a claude.ai/project/<id> URL, or a
  // claude://.../project/<id> link. Returns '' if absent/blank/placeholder.
  function projectIdFromCard() {
    var panel = document.querySelector(SEL_PANEL);
    if (!panel) return '';
    var text = panel.innerText || panel.textContent || '';
    var m = text.match(/(?:^|\n)\s*(?:claude\s+)?project\s*id\s*[:=]\s*([^\n]*)/i);
    if (!m) return '';
    var raw = (m[1] || '').trim();
    if (!raw) return '';
    var urlMatch = raw.match(/project\/([A-Za-z0-9_-]{8,})/i);
    var id = urlMatch ? urlMatch[1] : raw;
    id = id.replace(/[^A-Za-z0-9_-]/g, '');
    return id.length >= 8 ? id : '';
  }

  function fire(url) {
    if (!url) return;
    var a = document.createElement('a');
    a.href = url;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  function workLink(t) {
    var title = (t.title || 'this task').slice(0, 180);
    var prompt =
      'Let\'s work on my TickTick task "' + title + '".\n' +
      'It is on my Opportunity Pipeline board - open it via the TickTick connector (the full brief is in the notes). Card link: ' + t.url + '\n' +
      'First, quickly review my recent Claude sessions for any earlier or related work on this opportunity; if you find some, tell me which and offer to continue from there. Then help me dig in, answer questions, and update the card as we go.';
    return 'claude://cowork/new?q=' + encodeURIComponent(prompt);
  }

  function openProject() {
    var pid = projectIdFromCard();
    if (pid) {
      fire('claude://claude.ai/project/' + pid);
      return;
    }
    window.alert(
      'No Claude Project is linked to this card yet.\n\n' +
      'To link one:\n' +
      '1. Create a Project in Claude for this opportunity.\n' +
      '2. Copy the "Claude Project Instructions" block from the bottom of this card ' +
      'into the project\'s "Set project instructions".\n' +
      '3. Copy the project\'s ID from its URL (claude.ai/project/<ID>).\n' +
      '4. Paste it into this card\'s "Project ID:" line at the top.\n\n' +
      'In the meantime, "Chat" works on this card without a project.'
    );
  }

  function toggleMode() {
    sidebarOn = !sidebarOn;
    localStorage.setItem(MODE_KEY, sidebarOn ? 'on' : 'off');
    applyMode();
  }

  function applyMode() {
    document.body.classList.toggle('tt-sidebar-on', sidebarOn);
    refreshGrip();
  }

  function mkBtn(text, tip, handler) {
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'tt-c-btn';
    b.textContent = text;
    b.title = tip;
    b.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      handler();
    });
    return b;
  }

  // ---- inject our controls into TickTick's own task-detail chrome -------------
  // React re-renders the popup, so this runs on every mutation and is idempotent.
  function injectPanelUI(panel) {
    var row = panel.querySelector(SEL_HEADER_ROW);
    if (row && !row.querySelector('.tt-c-toggle')) {
      var t = document.createElement('div');
      t.className = 'btn-item tt-c-toggle';
      t.title = 'Switch between the Claude sidebar and TickTick\'s default popup';
      t.innerHTML =
        '<svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">' +
        '<rect x="1" y="2" width="14" height="12" rx="2" fill="none" stroke="currentColor" stroke-width="1.5"/>' +
        '<rect x="9.5" y="3.5" width="5" height="9" fill="currentColor" opacity="0.6"/></svg>';
      t.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        toggleMode();
      });
      row.appendChild(t); // sits immediately after .td-priority (the flag)
    }

    var grp = panel.querySelector(SEL_FOOTER_GROUP);
    if (grp && !grp.querySelector('.tt-c-btn')) {
      var chat = mkBtn('Chat', 'Start a Claude Cowork chat on this card', function () {
        fire(workLink(currentTask()));
      });
      var proj = mkBtn('Project', 'Open this card\'s linked Claude Project', openProject);
      grp.insertBefore(chat, grp.firstChild);
      grp.insertBefore(proj, grp.firstChild);
    }
  }

  var panelOpen = false;
  function refreshGrip() {
    grip.style.display = (panelOpen && sidebarOn) ? 'block' : 'none';
  }

  function tick() {
    var panel = document.querySelector(SEL_PANEL);
    panelOpen = !!panel;
    if (panel) injectPanelUI(panel);
    refreshGrip();
  }

  applyMode();

  // rAF-debounced so we don't re-scan on every keystroke inside the notes
  var pending = false;
  function schedule() {
    if (pending) return;
    pending = true;
    requestAnimationFrame(function () { pending = false; tick(); });
  }
  new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true });
  tick();

  // Drag to resize (sidebar mode only).
  var dragging = false;
  grip.addEventListener('pointerdown', function (e) {
    dragging = true;
    grip.classList.add('dragging');
    document.body.classList.add('tt-resizing');
    grip.setPointerCapture(e.pointerId);
    e.preventDefault();
  });
  window.addEventListener('pointermove', function (e) {
    if (!dragging) return;
    var nw = window.innerWidth - e.clientX;
    nw = Math.min(Math.max(nw, MINW), Math.round(window.innerWidth * 0.9));
    root.style.setProperty('--tt-sidebar-w', nw + 'px');
  });
  window.addEventListener('pointerup', function () {
    if (!dragging) return;
    dragging = false;
    grip.classList.remove('dragging');
    document.body.classList.remove('tt-resizing');
    var cur = parseInt(getComputedStyle(root).getPropertyValue('--tt-sidebar-w'), 10) || DEFAULT;
    localStorage.setItem(KEY, cur);
  });
})();
