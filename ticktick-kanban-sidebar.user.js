// ==UserScript==
// @name         TickTick — Kanban detail as resizable right sidebar
// @namespace    cowork
// @version      1.2.1
// @downloadURL  https://raw.githubusercontent.com/conmar5/ticktick-tweaks/main/ticktick-kanban-sidebar.user.js
// @updateURL    https://raw.githubusercontent.com/conmar5/ticktick-tweaks/main/ticktick-kanban-sidebar.user.js
// @description  Docks TickTick's Kanban/board task-detail popup into a full-height panel pinned to the right edge, with a draggable left edge to resize. The width is remembered across tasks and reloads. Only affects the floating popup (Kanban / Timeline / Calendar) — the List view side panel is left untouched.
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
    '}',
    /* the drag handle sits on the panel's left edge, full height */
    '#tt-sidebar-grip{',
    '  position:fixed; top:0; bottom:0; width:10px;',
    '  right:var(--tt-sidebar-w,460px); margin-right:-5px;',
    '  cursor:col-resize; z-index:1051; display:none;',
    '}',
    '#tt-sidebar-grip:hover, #tt-sidebar-grip.dragging{ background:rgba(74,144,226,0.6); }',
    'body.tt-resizing{ user-select:none !important; cursor:col-resize !important; }'
  ].join('\n');

  var style = document.createElement('style');
  style.id = 'tt-sidebar-style';
  style.textContent = css;
  (document.head || root).appendChild(style);

  var grip = document.createElement('div');
  grip.id = 'tt-sidebar-grip';
  document.body.appendChild(grip);

  // Show the grip only while the popup is open.
  function updateGrip() {
    grip.style.display = document.querySelector('.out-detail.out-detail-pop') ? 'block' : 'none';
  }
  new MutationObserver(updateGrip).observe(document.body, { childList: true, subtree: true });
  updateGrip();

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
