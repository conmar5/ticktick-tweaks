// ==UserScript==
// @name         TickTick — Kanban detail as resizable right sidebar
// @namespace    cowork
// @version      1.3.0
// @downloadURL  https://raw.githubusercontent.com/conmar5/ticktick-tweaks/main/ticktick-kanban-sidebar.user.js
// @updateURL    https://raw.githubusercontent.com/conmar5/ticktick-tweaks/main/ticktick-kanban-sidebar.user.js
// @description  Docks TickTick's Kanban/board task-detail popup into a full-height panel pinned to the right edge, with a draggable left edge to resize. The width is remembered across tasks and reloads. Only affects the floating popup (Kanban / Timeline / Calendar) — the List view side panel is left untouched. Adds a Claude action bar (Work in Claude / Feedback / New chat) for the open task.
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

  var KEY = 'tt_sidebar_width_v2'; // localStorage key for remembered width (v2 = adopt new wider default once)
  var MINW = 320;                 // smallest allowed width (px)
  var DEFAULT = 600;              // starting width (px) — drag the edge to change; your choice is remembered
  var root = document.documentElement;

  var w = parseInt(localStorage.getItem(KEY), 10) || DEFAULT;
  root.style.setProperty('--tt-sidebar-w', w + 'px');

  var css = [
    '.out-detail.out-detail-pop{',
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
    '.out-detail.out-detail-pop .task-detail{',
    '  height:100vh !important; max-height:none !important;',
    '  padding-bottom:52px !important;', // leave room so content scrolls clear of the Claude bar
    '}',
    /* the drag handle sits on the panel's left edge, full height */
    '#tt-sidebar-grip{',
    '  position:fixed; top:0; bottom:0; width:10px;',
    '  right:var(--tt-sidebar-w,460px); margin-right:-5px;',
    '  cursor:col-resize; z-index:1051; display:none;',
    '}',
    '#tt-sidebar-grip:hover, #tt-sidebar-grip.dragging{ background:rgba(74,144,226,0.6); }',
    'body.tt-resizing{ user-select:none !important; cursor:col-resize !important; }',
    /* Claude action bar, pinned to the bottom of the sidebar while a task is open */
    '#tt-claude-bar{',
    '  position:fixed; right:0; bottom:0; box-sizing:border-box;',
    '  width:var(--tt-sidebar-w,460px); max-width:90vw;',
    '  display:none; gap:6px; align-items:center; flex-wrap:wrap;',
    '  padding:8px 10px; z-index:1051;',
    '  border-top:1px solid rgba(128,128,128,0.25);',
    '  background:rgba(128,128,128,0.10);',
    '}',
    '#tt-claude-bar .tt-claude-label{ font:600 11px/1 -apple-system,system-ui,sans-serif; opacity:0.55; margin-right:2px; }',
    '#tt-claude-bar button{',
    '  font:12px/1.2 -apple-system,system-ui,sans-serif; padding:6px 10px;',
    '  border:1px solid rgba(128,128,128,0.4); border-radius:6px;',
    '  background:rgba(128,128,128,0.12); color:inherit; cursor:pointer; white-space:nowrap;',
    '}',
    '#tt-claude-bar button:hover{ border-color:rgba(74,144,226,0.9); background:rgba(74,144,226,0.18); }'
  ].join('\n');

  var style = document.createElement('style');
  style.id = 'tt-sidebar-style';
  style.textContent = css;
  (document.head || root).appendChild(style);

  var grip = document.createElement('div');
  grip.id = 'tt-sidebar-grip';
  document.body.appendChild(grip);

  // ---- Claude action bar -----------------------------------------------------
  // Reads the currently open task (title + URL) at click time and opens Claude
  // Desktop via the claude:// deep-link scheme. Requires Claude Desktop installed.
  function currentTask() {
    var panel = document.querySelector('.out-detail.out-detail-pop');
    var title = '';
    if (panel) {
      var el = panel.querySelector('.task-detail .title, textarea.title-input, .title-input, [contenteditable="true"], .title, h1, h2');
      if (el) title = (el.value || el.innerText || el.textContent || '').trim();
    }
    if (!title) title = (document.title || '').replace(/\s*[|-].*$/, '').trim();
    return { title: title || 'this task', url: location.href };
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
      'Help me dig into it, answer my questions, and update the card (notes / comments) as we go.';
    return 'claude://cowork/new?q=' + encodeURIComponent(prompt);
  }

  function feedbackLink(t, note) {
    var prompt =
      'Add a comment to my TickTick task "' + t.title + '" (' + t.url + ') that starts exactly with "@claude " ' +
      'followed by this feedback:\n' + note + '\n' +
      'Post it via the TickTick connector, then confirm. (The @claude prefix is how my daily scout picks up feedback.)';
    return 'claude://cowork/new?q=' + encodeURIComponent(prompt);
  }

  var bar = document.createElement('div');
  bar.id = 'tt-claude-bar';
  var label = document.createElement('span');
  label.className = 'tt-claude-label';
  label.textContent = 'Claude';
  bar.appendChild(label);

  function addBtn(text, handler) {
    var b = document.createElement('button');
    b.type = 'button';
    b.textContent = text;
    b.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      handler();
    });
    bar.appendChild(b);
    return b;
  }

  addBtn('Work in Claude', function () {
    fire(workLink(currentTask()));
  });
  addBtn('Feedback', function () {
    var t = currentTask();
    var note = window.prompt('Feedback for the scout (posted as an "@claude" comment on this card):', '');
    if (note == null || !note.trim()) return;
    fire(feedbackLink(t, note.trim()));
  });
  addBtn('New chat', function () {
    fire('claude://claude.ai/new');
  });
  document.body.appendChild(bar);

  // Show the grip + Claude bar only while the popup is open; match the bar to the panel theme.
  var wasOpen = false;
  function updateChrome() {
    var panel = document.querySelector('.out-detail.out-detail-pop');
    var open = !!panel;
    if (open === wasOpen) return;
    wasOpen = open;
    grip.style.display = open ? 'block' : 'none';
    bar.style.display = open ? 'flex' : 'none';
    if (open) {
      var bg = getComputedStyle(panel).backgroundColor;
      if (bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent') bar.style.background = bg;
    }
  }
  new MutationObserver(updateChrome).observe(document.body, { childList: true, subtree: true });
  updateChrome();

  // Drag to resize.
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
