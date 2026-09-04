/* Toastmaster – enkel lesevisning for introduksjoner.
   Alt kjører i nettleseren; teksten lagres kun lokalt på telefonen. */

'use strict';

const KEY = {
  doc: 'tm.doc',
  me: 'tm.me',
  font: 'tm.font',
  filter: 'tm.filter',
  overrides: 'tm.overrides',
  theme: 'tm.theme'
};

const DEFAULT_PERSONS = ['Anders', 'Fredrik'];

const state = {
  intros: [],      // { name, reader, body }
  overrides: {},   // navn -> leser valgt i appen
  me: null,
  filter: 'mine',
  font: 34,
  current: -1      // indeks i state.intros
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

/* ================= parsing ================= */

const HASH_HEADING = /^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$/;            // # Navn
const BRACKET_HEADING = /^\s{0,3}\[(.+?)\]\s*$/;                    // [Navn]
const LABELLED_HEADING = /^\s{0,3}(?:taler|speaker|navn|name)\s*[:\-–]\s*(.+?)\s*$/i;

const READER_LINE = /^\s*(?:leses\s+av|lest\s+av|leser|toastmaster|intro(?:duseres)?\s+av|ansvarlig|reader|av)\s*[:\-–]\s*(.+?)\s*$/i;

/* "Ola Nordmann (Anders)", "Ola Nordmann - Anders", "Ola Nordmann | Anders".
   Bindestrek krever mellomrom rundt seg, slik at "Anne-Lise" ikke splittes. */
const NAME_WITH_READER = /^(.*?)(?:\s*\(([^()]+)\)|\s+[|/]\s*([^|/]+)|\s+[–—-]\s+(.+))\s*$/;

function splitNameAndReader(heading) {
  const m = NAME_WITH_READER.exec(heading);
  if (!m) return { name: heading.trim(), reader: null };
  const candidate = (m[2] || m[3] || m[4] || '').trim();
  // Bare tolk det som leser hvis det ser ut som ett navn (1–2 ord).
  if (!candidate || candidate.split(/\s+/).length > 2) {
    return { name: heading.trim(), reader: null };
  }
  return { name: (m[1] || '').trim() || heading.trim(), reader: candidate };
}

/* [hakeparentes] brukes både til overskrifter og til regibeskjeder som
   "[vent på applaus]". Bruker dokumentet #-overskrifter, er hakeparentes
   alltid en regibeskjed. Ellers godtas den bare når den ser ut som et navn. */
function looksLikeName(text) {
  const t = text.trim();
  return t.length > 0 && t.length <= 60 &&
    t.split(/\s+/).length <= 4 &&
    !/[.!?:]$/.test(t) &&
    t[0] === t[0].toLocaleUpperCase('no');
}

function matchHeading(line, allowBrackets) {
  let m = HASH_HEADING.exec(line);
  if (m) return m[1].trim();
  m = LABELLED_HEADING.exec(line);
  if (m) return m[1].trim();
  if (allowBrackets) {
    m = BRACKET_HEADING.exec(line);
    if (m && looksLikeName(m[1])) return m[1].trim();
  }
  return null;
}

function finishBlock(name, reader, lines) {
  const body = lines.join('\n').replace(/^\n+|\s+$/g, '');
  return { name: name.trim(), reader: reader ? reader.trim() : null, body };
}

function parseDocument(text) {
  const clean = String(text).replace(/^﻿/, '').replace(/\r\n?/g, '\n');
  const lines = clean.split('\n');
  const allowBrackets = !lines.some((l) => HASH_HEADING.test(l));

  const intros = [];
  let name = null;
  let reader = null;
  let buffer = [];

  for (const line of lines) {
    const heading = matchHeading(line, allowBrackets);
    if (heading !== null) {
      if (name !== null) intros.push(finishBlock(name, reader, buffer));
      const split = splitNameAndReader(heading);
      name = split.name;
      reader = split.reader;
      buffer = [];
      continue;
    }
    if (name !== null && !buffer.some((l) => l.trim())) {
      const rm = READER_LINE.exec(line);
      if (rm) { if (!reader) reader = rm[1]; continue; }
    }
    if (name !== null) buffer.push(line);
  }
  if (name !== null) intros.push(finishBlock(name, reader, buffer));

  if (intros.length) return intros.filter((i) => i.name);

  // Ingen overskrifter: tolk avsnitt der første linje er navnet.
  return clean
    .split(/\n\s*\n\s*\n+|\n\s*\n(?=\S)/)
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block) => {
      const blockLines = block.split('\n');
      const split = splitNameAndReader(blockLines.shift());
      let rest = blockLines;
      const rm = rest.length ? READER_LINE.exec(rest[0]) : null;
      if (rm) { if (!split.reader) split.reader = rm[1]; rest = rest.slice(1); }
      return finishBlock(split.name, split.reader, rest);
    })
    .filter((i) => i.name);
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

/* ================= personer og filtrering ================= */

function readerOf(intro) {
  return state.overrides[intro.name] || intro.reader || null;
}

function samePerson(a, b) {
  if (!a || !b) return false;
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

function persons() {
  const found = [];
  const seen = new Set();
  const add = (n) => {
    if (!n) return;
    const key = n.trim().toLowerCase();
    if (!key || seen.has(key)) return;
    seen.add(key);
    found.push(n.trim());
  };
  DEFAULT_PERSONS.forEach(add);
  state.intros.forEach((i) => add(readerOf(i)));
  Object.values(state.overrides).forEach(add);
  return found;
}

function visibleIndexes() {
  return state.intros
    .map((intro, i) => i)
    .filter((i) => {
      if (state.filter === 'alle' || !state.me) return true;
      return samePerson(readerOf(state.intros[i]), state.me);
    });
}

/* ================= visning ================= */

function showView(id) {
  ['#view-setup', '#view-list', '#view-read'].forEach((sel) => {
    $(sel).hidden = sel !== id;
  });
  window.scrollTo(0, 0);
}

function escapeHtml(s) {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

const CUE_LINE = /^\[[^\[\]]*\]$/;
const LIST_LINE = /^(?:[-*•–—]\s|\d+[.)]\s)/;

function inline(html) {
  return html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
}

/* Tekstfiler har ofte harde linjeskift midt i setninger. Vi lar teksten flyte
   på nytt så den fyller mobilskjermen, men beholder skiftet der det ser bevisst
   ut: linje som slutter med to mellomrom eller \\, og lister. */
function renderParagraph(lines) {
  let html = '';
  lines.forEach((raw, i) => {
    const line = raw.trim();
    if (i > 0) {
      const prev = lines[i - 1];
      const forced = /(?:\s{2}|\\)$/.test(prev) || LIST_LINE.test(line);
      html += forced ? '<br>' : ' ';
    }
    html += escapeHtml(line);
  });
  return `<p>${inline(html)}</p>`;
}

function renderBody(text) {
  if (!text.trim()) return '<span class="cue">[ingen tekst under denne overskriften]</span>';

  const out = [];
  text.split(/\n\s*\n/).forEach((block) => {
    let buffer = [];
    const flush = () => {
      if (buffer.length) { out.push(renderParagraph(buffer)); buffer = []; }
    };
    block.split('\n').forEach((line) => {
      if (!line.trim()) return;
      if (CUE_LINE.test(line.trim())) {
        flush();
        out.push(`<span class="cue">${inline(escapeHtml(line.trim()))}</span>`);
      } else {
        buffer.push(line);
      }
    });
    flush();
  });

  return out.join('') || '<span class="cue">[ingen tekst under denne overskriften]</span>';
}

function renderPersons() {
  const wrap = $('#who');
  wrap.innerHTML = '';
  persons().forEach((p) => {
    const b = document.createElement('button');
    b.className = 'seg';
    b.textContent = p;
    b.setAttribute('aria-pressed', String(samePerson(p, state.me)));
    b.addEventListener('click', () => {
      state.me = samePerson(p, state.me) ? null : p;
      if (state.me) {
        store.set(KEY.me, state.me);
        state.filter = 'mine';      // velger du deg selv, vil du normalt se dine egne
        store.set(KEY.filter, state.filter);
      } else {
        store.del(KEY.me);
      }
      renderList();
    });
    wrap.appendChild(b);
  });
}

function renderFilter() {
  document.querySelectorAll('[data-filter]').forEach((b) => {
    b.setAttribute('aria-pressed', String(b.dataset.filter === state.filter));
  });
}

function renderList() {
  renderPersons();
  renderFilter();

  const list = $('#list');
  const empty = $('#list-empty');
  list.innerHTML = '';

  const indexes = visibleIndexes();

  if (!indexes.length) {
    empty.hidden = false;
    empty.textContent = state.intros.length
      ? `Ingen introduksjoner er merket med ${state.me}. Velg «Alle», eller trykk på merkelappen til høyre i listen for å sette leser.`
      : 'Fant ingen introduksjoner i teksten. Sjekk formatet under «Rediger / bytt tekst».';
    return;
  }
  empty.hidden = true;

  indexes.forEach((i, n) => {
    const intro = state.intros[i];
    const reader = readerOf(intro);
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
    btn.querySelector('.item-name').textContent = `${n + 1}. ${intro.name}`;
    btn.querySelector('.item-sub').textContent = firstWords(intro.body);
    btn.addEventListener('click', () => openIntro(i));

    const chip = btn.querySelector('.chip');
    chip.textContent = reader || 'Sett leser';
    if (samePerson(reader, state.me)) chip.classList.add('is-me');
    chip.setAttribute('role', 'button');
    chip.setAttribute('tabindex', '0');
    chip.title = 'Trykk for å bytte hvem som leser';
    const cycle = (ev) => {
      ev.stopPropagation();
      ev.preventDefault();
      const options = persons();
      const idx = options.findIndex((p) => samePerson(p, reader));
      const next = options[(idx + 1) % options.length];
      state.overrides[intro.name] = next;
      store.set(KEY.overrides, JSON.stringify(state.overrides));
      renderList();
    };
    chip.addEventListener('click', cycle);
    chip.addEventListener('keydown', (ev) => { if (ev.key === 'Enter' || ev.key === ' ') cycle(ev); });

    li.appendChild(btn);
    list.appendChild(li);
  });
}

function firstWords(body) {
  const flat = body.replace(/\s+/g, ' ').trim();
  return flat.length > 70 ? flat.slice(0, 70) + '…' : flat;
}

function openIntro(index) {
  state.current = index;
  const intro = state.intros[index];
  const indexes = visibleIndexes();
  const pos = indexes.indexOf(index);

  $('#read-name').textContent = intro.name;
  $('#read-count').textContent = pos >= 0 ? `${pos + 1} av ${indexes.length}` : (readerOf(intro) || '');
  $('#read-body').innerHTML = renderBody(intro.body);
  $('#read-body').scrollTop = 0;

  $('#prev').disabled = pos <= 0;
  $('#next').disabled = pos < 0 || pos >= indexes.length - 1;

  showView('#view-read');
  requestWakeLock();
}

function step(delta) {
  const indexes = visibleIndexes();
  const pos = indexes.indexOf(state.current);
  if (pos < 0) return;
  const target = indexes[pos + delta];
  if (target !== undefined) openIntro(target);
}

function setFont(px) {
  state.font = Math.min(72, Math.max(18, px));
  document.documentElement.style.setProperty('--read-size', state.font + 'px');
  store.set(KEY.font, String(state.font));
}

/* ================= wake lock ================= */

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

/* ================= dokument inn ================= */

function loadText(text, { remember = true } = {}) {
  const intros = parseDocument(text);
  if (!intros.length) {
    showError('Fant ingen introduksjoner i teksten. Legg inn en overskrift per taler, f.eks. «# Ola Nordmann».');
    return false;
  }
  state.intros = intros;
  state.current = -1;
  if (remember) store.set(KEY.doc, text);
  showError('');
  renderList();
  showView('#view-list');
  return true;
}

function showError(msg) {
  const el = $('#setup-error');
  el.textContent = msg;
  el.hidden = !msg;
}

const EXAMPLE = `# Ola Nordmann (Anders)

Kjære alle sammen. Vår neste taler har vært med i klubben i tre år,
og har holdt **elleve** taler på den tiden.

[vent til det blir stille]

Ta vel imot Ola Nordmann!

# Kari Nordmann
Leses av: Fredrik

Neste ut er en av dem som alltid får oss til å le.

[pek mot bordet til høyre]

Gi en varm applaus til Kari Nordmann!

# Per Hansen (Anders)

Til slutt skal vi høre fra Per, som i kveld snakker om
hvorfor det aldri er for sent å begynne på nytt.

Vær så god, Per Hansen!`;

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

  $('#use-example').addEventListener('click', () => {
    $('#paste').value = EXAMPLE;
    loadText(EXAMPLE);
  });

  document.querySelectorAll('[data-filter]').forEach((b) => {
    b.addEventListener('click', () => {
      state.filter = b.dataset.filter;
      store.set(KEY.filter, state.filter);
      renderList();
    });
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

  // Sveip mellom introduksjoner
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
    $('#paste').value = store.get(KEY.doc, '');
    showError('');
    showView('#view-setup');
  });
  $('#m-theme').addEventListener('click', () => {
    closeSheet();
    const next = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light';
    document.documentElement.dataset.theme = next;
    store.set(KEY.theme, next);
  });
  $('#m-clear').addEventListener('click', () => {
    closeSheet();
    if (!confirm('Slette den lagrede teksten på denne telefonen?')) return;
    store.del(KEY.doc);
    store.del(KEY.overrides);
    state.intros = [];
    state.overrides = {};
    $('#paste').value = '';
    showView('#view-setup');
  });
}

function init() {
  document.documentElement.dataset.theme = store.get(KEY.theme, 'dark');
  state.me = store.get(KEY.me, null);
  state.filter = store.get(KEY.filter, 'mine');
  setFont(parseInt(store.get(KEY.font, '34'), 10) || 34);
  try { state.overrides = JSON.parse(store.get(KEY.overrides, '{}')) || {}; } catch (e) { state.overrides = {}; }

  initEvents();

  const saved = store.get(KEY.doc, '');
  if (saved && saved.trim()) {
    $('#paste').value = saved;
    if (loadText(saved, { remember: false })) return;
  }
  showView('#view-setup');
}

init();

if ('serviceWorker' in navigator && location.protocol === 'https:') {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  });
}
