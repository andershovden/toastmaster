/* Toastmaster – enkel lesevisning for et toastmaster-manus.
   Manuset er delt i poster (én per taler som skal introduseres). Hver post
   består av replikker merket med hvem som sier dem. Du velger hvem du er,
   og dine replikker vises store og uthevet, mens den andres står som
   stikkord slik at du vet når det er din tur. */

'use strict';

const KEY = { doc: 'tm.doc', me: 'tm.me', font: 'tm.font', theme: 'tm.theme' };
const DEFAULT_PERSONS = ['Anders', 'Fredrik'];

const state = {
  intros: [],       // { name, section, lines: [{ type, who, text }] }
  speakers: [],     // navn som opptrer som replikkmerker i manuset
  me: null,
  font: 30,
  current: -1
};

const $ = (sel) => document.querySelector(sel);

const store = {
  get(k, fallback) {
    try {
      const v = localStorage.getItem(k);
      return v === null ? fallback : v;
    } catch (e) { return fallback; }
  },
  set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* privat modus */ } },
  del(k) { try { localStorage.removeItem(k); } catch (e) { /* ignorer */ } }
};

/* Fast farge per toastmaster: Anders i rosa, Fredrik i grønt.
   Andre navn i manuset får en farge etter tur. */
const SPEAKER_COLORS = { anders: 'rosa', fredrik: 'gronn' };
const COLOR_CYCLE = ['gul', 'bla', 'rosa', 'gronn'];

const same = (a, b) => !!a && !!b && a.trim().toLowerCase() === b.trim().toLowerCase();

/* ================= parsing ================= */

const HASH_HEADING = /^\s{0,3}(#{1,6})\s+(.+?)\s*#*\s*$/;
const BRACKET_HEADING = /^\s{0,3}\[(.+?)\]\s*$/;
const LABELLED_HEADING = /^\s{0,3}(?:taler|speaker|navn|name)\s*[:\-–]\s*(.+?)\s*$/i;
const BULLET = /^\s*[-*•]\s+/;
const CUE_LINE = /^\s*[[(]([^[\]()]*)[\])]\s*$/;
const SPEAKER_LINE = /^([\p{Lu}][\p{L}\p{M}.'\- ]{0,20}?)\s*:\s+(.+)$/u;

/* [hakeparentes] er både overskrift og regibeskjed. Bruker manuset
   #-overskrifter, er hakeparentes alltid regibeskjed. */
function looksLikeName(text) {
  const t = text.trim();
  return t.length > 0 && t.length <= 60 &&
    t.split(/\s+/).length <= 4 &&
    !/[.!?:]/.test(t) &&
    t[0] === t[0].toLocaleUpperCase('no');
}

function parseDocument(text) {
  const clean = String(text).replace(/^﻿/, '').replace(/\r\n?/g, '\n');
  const lines = clean.split('\n').map((l) => l.replace(BULLET, ''));

  const levels = new Set();
  lines.forEach((l) => { const m = HASH_HEADING.exec(l); if (m) levels.add(m[1].length); });
  const sorted = [...levels].sort();
  const sectionLevel = sorted.length > 1 ? sorted[0] : null;   // «# FREDAG» over «## Taler»
  const allowBrackets = levels.size === 0;

  const intros = [];
  let section = null;
  let current = null;

  for (const line of lines) {
    let name = null;
    let level = null;

    const hash = HASH_HEADING.exec(line);
    const labelled = hash ? null : LABELLED_HEADING.exec(line);
    const bracket = hash || labelled || !allowBrackets ? null : BRACKET_HEADING.exec(line);

    if (hash) { level = hash[1].length; name = hash[2].trim(); }
    else if (labelled) { level = 2; name = labelled[1].trim(); }
    else if (bracket && looksLikeName(bracket[1])) { level = 2; name = bracket[1].trim(); }

    if (name !== null) {
      if (sectionLevel !== null && level === sectionLevel) { section = name; continue; }
      current = { name: name.replace(/^\d+[.)]\s*/, ''), section, raw: [] };
      intros.push(current);
      continue;
    }
    if (current) current.raw.push(line);
  }

  if (!intros.length) {
    // Ingen overskrifter: hvert avsnitt er én post, første linje er navnet.
    clean.split(/\n\s*\n+/).map((b) => b.trim()).filter(Boolean).forEach((block) => {
      const blockLines = block.split('\n');
      intros.push({ name: blockLines.shift().trim(), section: null, raw: blockLines });
    });
  }

  const speakers = findSpeakers(intros);
  intros.forEach((intro) => {
    intro.lines = toLines(intro.raw, speakers);
    delete intro.raw;
  });

  return {
    intros: intros.filter((i) => i.name),
    speakers: speakers.length ? speakers : DEFAULT_PERSONS.slice()
  };
}

/* Et navn foran kolon regnes som replikkmerke først når det går igjen i
   manuset – slik at enkeltlinjer som «Musikkforslag:» blir vanlig tekst. */
function findSpeakers(intros) {
  const counts = new Map();
  intros.forEach((intro) => intro.raw.forEach((line) => {
    if (CUE_LINE.test(line)) return;
    const m = SPEAKER_LINE.exec(line.trim());
    if (!m) return;
    const name = m[1].trim();
    const key = name.toLowerCase();
    const hit = counts.get(key) || { name, n: 0 };
    hit.n += 1;
    counts.set(key, hit);
  }));
  return [...counts.values()].filter((c) => c.n >= 3).map((c) => c.name);
}

function toLines(raw, speakers) {
  const isSpeaker = (n) => speakers.some((s) => same(s, n));
  const canonical = (n) => speakers.find((s) => same(s, n)) || n;

  const lines = raw.map((line) => {
    const trimmed = line.trim();
    if (!trimmed) return { type: 'blank' };
    if (CUE_LINE.test(trimmed)) return { type: 'cue', text: trimmed.replace(/^[[(]|[\])]$/g, '').trim() };
    const m = SPEAKER_LINE.exec(trimmed);
    if (m && isSpeaker(m[1])) return { type: 'say', who: canonical(m[1].trim()), text: m[2].trim() };
    return { type: 'text', text: trimmed };
  });

  while (lines.length && lines[0].type === 'blank') lines.shift();
  while (lines.length && lines[lines.length - 1].type === 'blank') lines.pop();
  return lines;
}

/* ================= .docx ================= */

function findEOCD(view) {
  for (let i = view.byteLength - 22; i >= 0; i--) {
    if (view.getUint32(i, true) === 0x06054b50) return i;
  }
  return -1;
}

async function inflateRaw(bytes) {
  if (typeof DecompressionStream !== 'function') {
    throw new Error('Nettleseren kan ikke pakke ut .docx. Lagre dokumentet som .txt og prøv igjen.');
  }
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function readZipEntry(buffer, wanted) {
  const view = new DataView(buffer);
  const eocd = findEOCD(view);
  if (eocd < 0) throw new Error('Klarte ikke lese .docx-filen.');

  let offset = view.getUint32(eocd + 16, true);
  const count = view.getUint16(eocd + 10, true);

  for (let i = 0; i < count; i++) {
    if (view.getUint32(offset, true) !== 0x02014b50) break;
    const method = view.getUint16(offset + 10, true);
    const compressedSize = view.getUint32(offset + 20, true);
    const nameLen = view.getUint16(offset + 28, true);
    const extraLen = view.getUint16(offset + 30, true);
    const commentLen = view.getUint16(offset + 32, true);
    const localOffset = view.getUint32(offset + 42, true);
    const name = new TextDecoder().decode(new Uint8Array(buffer, offset + 46, nameLen));

    if (name === wanted) {
      const lNameLen = view.getUint16(localOffset + 26, true);
      const lExtraLen = view.getUint16(localOffset + 28, true);
      const start = localOffset + 30 + lNameLen + lExtraLen;
      const data = new Uint8Array(buffer, start, compressedSize);
      return method === 0 ? data : inflateRaw(data);
    }
    offset += 46 + nameLen + extraLen + commentLen;
  }
  throw new Error('Fant ikke tekst i .docx-filen.');
}

function docxXmlToText(xml) {
  return xml
    .replace(/<w:tab\b[^>]*\/>/g, '\t')
    .replace(/<w:br\b[^>]*\/>/g, '\n')
    .replace(/<\/w:p>/g, '\n')
    .replace(/<w:t\b[^>]*>([\s\S]*?)<\/w:t>/g, '$1')
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/\n{3,}/g, '\n\n');
}

async function readFileAsText(file) {
  if (/\.docx$/i.test(file.name)) {
    const bytes = await readZipEntry(await file.arrayBuffer(), 'word/document.xml');
    return docxXmlToText(new TextDecoder().decode(bytes));
  }
  return file.text();
}

/* ================= visning ================= */

function showView(id) {
  ['#view-setup', '#view-list', '#view-read'].forEach((sel) => { $(sel).hidden = sel !== id; });
  window.scrollTo(0, 0);
}

function escapeHtml(s) {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

const inline = (html) => html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');

function colorClass(name) {
  if (!name) return '';
  const fixed = SPEAKER_COLORS[name.trim().toLowerCase()];
  if (fixed) return 'farge-' + fixed;
  const i = state.speakers.findIndex((s) => same(s, name));
  return 'farge-' + COLOR_CYCLE[(i < 0 ? 0 : i) % COLOR_CYCLE.length];
}

function myLineCount(intro) {
  if (!state.me) return 0;
  return intro.lines.filter((l) => l.type === 'say' && same(l.who, state.me)).length;
}

function renderRead(intro) {
  const out = [];
  let paragraph = [];
  const flush = () => {
    if (paragraph.length) { out.push(`<p class="plain">${inline(escapeHtml(paragraph.join(' ')))}</p>`); paragraph = []; }
  };

  intro.lines.forEach((line) => {
    if (line.type === 'text') { paragraph.push(line.text); return; }
    flush();
    if (line.type === 'blank') return;
    if (line.type === 'cue') {
      out.push(`<p class="cue">${inline(escapeHtml(line.text))}</p>`);
      return;
    }
    const mine = state.me ? (same(line.who, state.me) ? 'mine' : 'andre') : 'noytral';
    out.push(
      `<div class="line ${mine} ${colorClass(line.who)}">` +
      `<span class="who">${escapeHtml(line.who)}</span>` +
      `<span class="say">${inline(escapeHtml(line.text))}</span></div>`
    );
  });
  flush();

  return out.join('') || '<p class="cue">Ingen tekst under denne posten</p>';
}

function renderPersons() {
  const wrap = $('#who');
  wrap.innerHTML = '';
  state.speakers.forEach((p) => {
    const b = document.createElement('button');
    b.className = 'seg ' + colorClass(p);
    b.textContent = p;
    b.setAttribute('aria-pressed', String(same(p, state.me)));
    b.addEventListener('click', () => {
      state.me = same(p, state.me) ? null : p;
      if (state.me) store.set(KEY.me, state.me); else store.del(KEY.me);
      renderList();
    });
    wrap.appendChild(b);
  });
}

function renderList() {
  renderPersons();

  const list = $('#list');
  list.innerHTML = '';
  let section = null;

  state.intros.forEach((intro, i) => {
    if (intro.section && intro.section !== section) {
      section = intro.section;
      const head = document.createElement('li');
      head.className = 'day';
      head.textContent = section;
      list.appendChild(head);
    }

    const li = document.createElement('li');
    const btn = document.createElement('button');
    btn.className = 'item';
    btn.innerHTML = `
      <div class="item-main">
        <div class="item-name"></div>
        <div class="item-sub"></div>
      </div>
      <span class="chip"></span>
      <span class="item-arrow" aria-hidden="true">›</span>`;
    btn.querySelector('.item-name').textContent = intro.name;

    const first = intro.lines.find((l) => l.type === 'say' || l.type === 'text');
    btn.querySelector('.item-sub').textContent = first ? firstWords(first.text) : '';

    const chip = btn.querySelector('.chip');
    chip.className = 'chip ' + colorClass(state.me);
    const mine = myLineCount(intro);
    if (state.me) {
      chip.textContent = mine ? `${mine} replikk${mine === 1 ? '' : 'er'}` : 'ingen replikker';
      if (mine) chip.classList.add('is-me');
    } else {
      chip.hidden = true;
    }

    btn.addEventListener('click', () => openIntro(i));
    li.appendChild(btn);
    list.appendChild(li);
  });

  $('#list-empty').hidden = state.intros.length > 0;
}

function firstWords(text) {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > 64 ? flat.slice(0, 64) + '…' : flat;
}

function openIntro(index) {
  const intro = state.intros[index];
  if (!intro) return;
  state.current = index;

  $('#read-name').textContent = intro.name;
  $('#read-count').textContent =
    `${intro.section ? intro.section.toLowerCase() + ' · ' : ''}${index + 1} av ${state.intros.length}`;
  $('#read-body').innerHTML = renderRead(intro);
  $('#read-body').scrollTop = 0;

  $('#prev').disabled = index === 0;
  $('#next').disabled = index === state.intros.length - 1;

  showView('#view-read');
  requestWakeLock();
}

function step(delta) {
  const target = state.current + delta;
  if (target >= 0 && target < state.intros.length) openIntro(target);
}

function setFont(px) {
  state.font = Math.min(72, Math.max(18, px));
  document.documentElement.style.setProperty('--read-size', state.font + 'px');
  store.set(KEY.font, String(state.font));
}

/* ================= skjermlås ================= */

let wakeLock = null;

async function requestWakeLock() {
  if (!('wakeLock' in navigator)) return;
  try {
    wakeLock = await navigator.wakeLock.request('screen');
    wakeLock.addEventListener('release', () => { wakeLock = null; });
  } catch (e) { /* nettleseren nekter – ikke kritisk */ }
}

function releaseWakeLock() {
  if (wakeLock) { wakeLock.release().catch(() => {}); wakeLock = null; }
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && !$('#view-read').hidden) requestWakeLock();
});

/* ================= manus inn ================= */

function showError(msg) {
  const el = $('#setup-error');
  el.textContent = msg;
  el.hidden = !msg;
}

function loadText(text, { remember = true } = {}) {
  const parsed = parseDocument(text);
  if (!parsed.intros.length) {
    showError('Fant ingen poster i teksten. Legg inn en overskrift per taler, for eksempel «## Miriam».');
    return false;
  }
  state.intros = parsed.intros;
  state.speakers = parsed.speakers;
  if (state.me && !state.speakers.some((s) => same(s, state.me))) state.me = null;
  state.current = -1;
  if (remember) store.set(KEY.doc, text);
  showError('');
  renderList();
  showView('#view-list');
  return true;
}

const builtInScript = () => {
  const el = document.getElementById('innebygd-manus');
  return el ? el.textContent.trim() : '';
};

/* ================= oppstart ================= */

function initEvents() {
  $('#file').addEventListener('change', async (ev) => {
    const file = ev.target.files && ev.target.files[0];
    if (!file) return;
    try {
      loadText(await readFileAsText(file));
    } catch (e) {
      showError(e.message || 'Klarte ikke lese filen.');
    } finally {
      ev.target.value = '';
    }
  });

  $('#use-paste').addEventListener('click', () => {
    const text = $('#paste').value;
    if (!text.trim()) { showError('Lim inn tekst først.'); return; }
    loadText(text);
  });

  $('#use-builtin').addEventListener('click', () => {
    const text = builtInScript();
    if (!text) { showError('Fant ikke det innebygde manuset.'); return; }
    $('#paste').value = text;
    loadText(text);
  });

  $('#setup-back').addEventListener('click', () => {
    if (!state.intros.length) { showError('Legg inn et manus først.'); return; }
    showError('');
    showView('#view-list');
  });

  $('#back').addEventListener('click', () => {
    releaseWakeLock();
    renderList();
    showView('#view-list');
  });
  $('#prev').addEventListener('click', () => step(-1));
  $('#next').addEventListener('click', () => step(1));
  $('#font-up').addEventListener('click', () => setFont(state.font + 3));
  $('#font-down').addEventListener('click', () => setFont(state.font - 3));

  // Sveip mellom poster
  const body = $('#read-body');
  let startX = 0, startY = 0, tracking = false;
  body.addEventListener('touchstart', (e) => {
    if (e.touches.length !== 1) { tracking = false; return; }
    tracking = true;
    startX = e.touches[0].clientX;
    startY = e.touches[0].clientY;
  }, { passive: true });
  body.addEventListener('touchend', (e) => {
    if (!tracking) return;
    tracking = false;
    const t = e.changedTouches[0];
    const dx = t.clientX - startX;
    const dy = t.clientY - startY;
    if (Math.abs(dx) > 70 && Math.abs(dy) < 60) step(dx < 0 ? 1 : -1);
  }, { passive: true });

  document.addEventListener('keydown', (e) => {
    if ($('#view-read').hidden) return;
    if (e.key === 'ArrowRight') step(1);
    if (e.key === 'ArrowLeft') step(-1);
    if (e.key === 'Escape') { releaseWakeLock(); showView('#view-list'); }
  });

  // Meny
  const sheet = $('#sheet');
  const closeSheet = () => { sheet.hidden = true; };
  $('#menu-btn').addEventListener('click', () => { sheet.hidden = false; });
  sheet.querySelectorAll('[data-close]').forEach((el) => el.addEventListener('click', closeSheet));

  $('#m-edit').addEventListener('click', () => {
    closeSheet();
    $('#paste').value = store.get(KEY.doc, '') || builtInScript();
    showError('');
    showView('#view-setup');
  });
  $('#m-theme').addEventListener('click', () => {
    closeSheet();
    const next = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light';
    document.documentElement.dataset.theme = next;
    store.set(KEY.theme, next);
  });
  $('#m-reset').addEventListener('click', () => {
    closeSheet();
    const text = builtInScript();
    if (!text) return;
    if (!confirm('Hente inn originalmanuset og forkaste endringene dine?')) return;
    store.del(KEY.doc);
    $('#paste').value = text;
    loadText(text, { remember: false });
  });
}

function init() {
  document.documentElement.dataset.theme = store.get(KEY.theme, 'dark');
  state.me = store.get(KEY.me, null);
  setFont(parseInt(store.get(KEY.font, '30'), 10) || 30);

  initEvents();

  const saved = store.get(KEY.doc, '');
  if (saved && saved.trim() && loadText(saved, { remember: false })) return;

  const builtIn = builtInScript();
  if (builtIn && loadText(builtIn, { remember: false })) return;

  showView('#view-setup');
}

init();

if ('serviceWorker' in navigator && location.protocol === 'https:') {
  window.addEventListener('load', () => { navigator.serviceWorker.register('sw.js').catch(() => {}); });
}
