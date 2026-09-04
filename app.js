/* Toastmaster – enkel lesevisning for et toastmaster-manus.
   Manuset hentes fra Google-dokumentet via /manus (Netlify proxyer dit),
   og oppdateres automatisk mens siden er åpen. Manuset er delt i poster –
   én per taler – og hver post består av replikker merket med hvem som sier
   dem. Du velger hvem du er, og dine replikker vises store og uthevet,
   mens den andres står som stikkord slik at du vet når det er din tur. */

'use strict';

const KEY = { doc: 'tm.doc', me: 'tm.me', font: 'tm.font', theme: 'tm.theme', sync: 'tm.sync' };
const DEFAULT_PERSONS = ['Anders', 'Fredrik'];

/* Fast farge per toastmaster: Anders i rosa, Fredrik i grønt.
   Andre navn i manuset får en farge etter tur. */
const SPEAKER_COLORS = { anders: 'rosa', fredrik: 'gronn' };
const COLOR_CYCLE = ['gul', 'bla', 'rosa', 'gronn'];

const state = {
  intros: [],       // { name, section, lines: [{ type, who, text }] }
  speakers: [],
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

const same = (a, b) => !!a && !!b && a.trim().toLowerCase() === b.trim().toLowerCase();

/* ================= parsing =================
   Manuset kan være skrevet med markdown-overskrifter (# DAG / ## Navn),
   men også som vanlig tekst rett fra Google Docs. Da gjenkjennes dagene på
   at de står i STORE BOKSTAVER, og postene på at de er korte linjer uten
   punktum som følges av replikker. */

const HASH_HEADING = /^(#{1,6})\s+(.+?)\s*#*\s*$/;
const BRACKET_HEADING = /^\[(.+?)\]$/;
const LABELLED_HEADING = /^(?:taler|speaker|navn|name)\s*[:\-–]\s*(.+?)$/i;
const BULLET = /^\s*(?:[-*•●○▪–]|\d+[.)])\s+/;
const NUMBERED = /^\d+[.)]\s+/;
const CUE_LINE = /^[[(]([^[\]()]*)[\])]$/;
const SPEAKER_LINE = /^([\p{Lu}][\p{L}\p{M}.'\- ]{0,20}?)\s*:\s+(.+)$/u;

function splitLines(text) {
  return String(text).replace(/^﻿/, '').replace(/\r\n?/g, '\n').split('\n').map((raw) => {
    const bulleted = BULLET.test(raw) && !NUMBERED.test(raw.trim());
    return { text: raw.replace(BULLET, '').trim(), bulleted };
  });
}

/* Et navn foran kolon regnes som replikkmerke først når det går igjen i
   manuset – slik at enkeltlinjer som «Musikkforslag:» blir vanlig tekst. */
function findSpeakers(lines) {
  const counts = new Map();
  lines.forEach(({ text }) => {
    if (!text || CUE_LINE.test(text)) return;
    const m = SPEAKER_LINE.exec(text);
    if (!m) return;
    const name = m[1].trim();
    const key = name.toLowerCase();
    const hit = counts.get(key) || { name, n: 0 };
    hit.n += 1;
    counts.set(key, hit);
  });
  return [...counts.values()].filter((c) => c.n >= 3).map((c) => c.name);
}

function isDayLine(text) {
  if (!text || text.length > 40 || text.includes(':')) return false;
  const word = (text.split(/\s+/)[0] || '').replace(/[^\p{L}]/gu, '');
  return word.length >= 3 &&
    word === word.toLocaleUpperCase('no') &&
    word !== word.toLocaleLowerCase('no');
}

function looksLikeHeading(line, prev) {
  const t = line.text;
  if (!t || line.bulleted || t.length > 70) return false;
  if (/[.!?,;:]$/.test(t)) return false;
  if (CUE_LINE.test(t)) return false;
  return !prev || !prev.text || isDayLine(prev.text);   // står alene, etter luft
}

/* En kandidat er en overskrift bare hvis det kommer replikker under den før
   neste kandidat. Ellers er den vanlig tekst – for eksempel et punkt i en
   liste midt i en post. */
function headingHasLines(lines, from, speakers, prevOf) {
  for (let i = from + 1; i < lines.length; i++) {
    const t = lines[i].text;
    if (!t) continue;
    const m = SPEAKER_LINE.exec(t);
    if (m && speakers.some((s) => same(s, m[1]))) return true;
    if (isDayLine(t)) continue;
    if (looksLikeHeading(lines[i], prevOf(i))) return false;
  }
  return false;
}

function parseDocument(text) {
  const lines = splitLines(text);
  const speakers = findSpeakers(lines);
  const isSpeaker = (n) => speakers.some((s) => same(s, n));
  const canonical = (n) => speakers.find((s) => same(s, n)) || n;

  const hashLevels = new Set();
  lines.forEach(({ text: t }) => { const m = HASH_HEADING.exec(t); if (m) hashLevels.add(m[1].length); });
  const levels = [...hashLevels].sort();
  const sectionLevel = levels.length > 1 ? levels[0] : null;
  const markdown = hashLevels.size > 0;
  const prevOf = (i) => (i > 0 ? lines[i - 1] : null);

  /* Google Docs legger dokumentets tittel øverst. Den hopper vi over når det
     står en dagoverskrift mellom tittelen og den første replikken. */
  let titleIndex = -1;
  if (!markdown) {
    const first = lines.findIndex((l) => l.text);
    if (first >= 0 && looksLikeHeading(lines[first], null) && !isDayLine(lines[first].text)) {
      for (let i = first + 1; i < lines.length; i++) {
        const t = lines[i].text;
        if (!t) continue;
        if (isDayLine(t)) { titleIndex = first; break; }
        const m = SPEAKER_LINE.exec(t);
        if (m && isSpeaker(m[1])) break;
      }
    }
  }

  const intros = [];
  let section = null;
  let current = null;

  const startIntro = (name) => {
    current = { name: name.replace(NUMBERED, '').trim(), section, lines: [] };
    intros.push(current);
  };
  const push = (line) => {
    if (!current) startIntro('Velkomst');
    current.lines.push(line);
  };

  lines.forEach((line, i) => {
    const t = line.text;

    if (i === titleIndex) return;
    if (!t) { if (current) push({ type: 'blank' }); return; }

    if (CUE_LINE.test(t)) { push({ type: 'cue', text: CUE_LINE.exec(t)[1].trim() }); return; }

    const say = SPEAKER_LINE.exec(t);
    if (say && isSpeaker(say[1])) {
      push({ type: 'say', who: canonical(say[1].trim()), text: say[2].trim() });
      return;
    }

    if (markdown) {
      const hash = HASH_HEADING.exec(t);
      if (hash) {
        const name = hash[2].trim();
        if (sectionLevel !== null && hash[1].length === sectionLevel) { section = name; return; }
        startIntro(name);
        return;
      }
      const labelled = LABELLED_HEADING.exec(t);
      if (labelled) { startIntro(labelled[1]); return; }
    } else {
      if (isDayLine(t)) { section = t; return; }
      const bracket = BRACKET_HEADING.exec(t);
      if (bracket) { startIntro(bracket[1]); return; }
      if (looksLikeHeading(line, prevOf(i)) && headingHasLines(lines, i, speakers, prevOf)) {
        startIntro(t);
        return;
      }
    }

    push({ type: 'text', text: t });
  });

  intros.forEach((intro) => {
    while (intro.lines.length && intro.lines[0].type === 'blank') intro.lines.shift();
    while (intro.lines.length && intro.lines[intro.lines.length - 1].type === 'blank') intro.lines.pop();
  });

  return {
    intros: intros.filter((i) => i.name && i.lines.length),
    speakers: speakers.length ? speakers : DEFAULT_PERSONS.slice()
  };
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
    if (line.type === 'cue') { out.push(`<p class="cue">${inline(escapeHtml(line.text))}</p>`); return; }

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

function openIntro(index, { keepScroll = false } = {}) {
  const intro = state.intros[index];
  if (!intro) return;
  const scroll = keepScroll ? $('#read-body').scrollTop : 0;
  state.current = index;

  $('#read-name').textContent = intro.name;
  $('#read-count').textContent =
    `${intro.section ? intro.section.toLowerCase() + ' · ' : ''}${index + 1} av ${state.intros.length}`;
  $('#read-body').innerHTML = renderRead(intro);
  $('#read-body').scrollTop = scroll;

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

/* ================= manus inn ================= */

function showError(msg) {
  const el = $('#setup-error');
  el.textContent = msg;
  el.hidden = !msg;
}

function loadText(text, { remember = true, view = true } = {}) {
  const parsed = parseDocument(text);
  if (!parsed.intros.length) {
    showError('Fant ingen poster i teksten. Hver taler trenger en egen overskriftslinje.');
    return false;
  }

  const wasReading = !$('#view-read').hidden;
  const readingName = wasReading && state.intros[state.current] ? state.intros[state.current].name : null;

  state.intros = parsed.intros;
  state.speakers = parsed.speakers;
  if (state.me && !state.speakers.some((s) => same(s, state.me))) state.me = null;
  if (remember) store.set(KEY.doc, text);
  showError('');
  renderList();

  if (wasReading) {
    const i = readingName ? state.intros.findIndex((x) => x.name === readingName) : -1;
    if (i >= 0) { openIntro(i, { keepScroll: true }); return true; }
  }
  state.current = -1;
  if (view) showView('#view-list');
  return true;
}

const builtInScript = () => {
  const el = document.getElementById('innebygd-manus');
  return el ? el.textContent.trim() : '';
};

/* ================= synk mot Google-dokumentet =================
   Netlify proxyer /manus til dokumentets txt-eksport, slik at siden kan
   hente det fra sitt eget domene. Vi henter på nytt hvert tiende sekund
   mens siden er synlig, og bytter bare ut teksten når den faktisk er endret. */

const MANUS_URL = '/manus';
const SYNC_MS = 10000;
const SYNC_MS_ETTER_FEIL = 60000;

let syncTimer = null;
let syncFeil = 0;
let syncAktiv = false;   // settes bare i byggene som faktisk har /manus

const syncPaa = () => store.get(KEY.sync, 'på') === 'på';

function setSyncStatus(kind, detail) {
  const el = $('#sync-status');
  if (!el) return;
  if (!syncPaa()) { el.textContent = 'Synk mot dokumentet er slått av.'; el.className = 'sync'; return; }
  const tid = new Date().toLocaleTimeString('no', { hour: '2-digit', minute: '2-digit' });
  if (kind === 'venter') { el.textContent = 'Henter manuset fra dokumentet …'; el.className = 'sync'; }
  else if (kind === 'ok') { el.textContent = `Hentet fra dokumentet ${tid}.`; el.className = 'sync'; }
  else if (kind === 'ny') { el.textContent = `Oppdatert fra dokumentet ${tid}.`; el.className = 'sync er-ny'; }
  else { el.textContent = `Får ikke kontakt med dokumentet – viser sist lagrede manus. (${detail})`; el.className = 'sync er-feil'; }
}

async function hentManus() {
  const res = await fetch(`${MANUS_URL}?t=${Date.now()}`, { cache: 'no-store' });
  if (!res.ok) throw new Error('svar ' + res.status);
  const text = await res.text();
  if (/^\s*<(?:!doctype|html)/i.test(text)) throw new Error('fikk en nettside, ikke dokumentet');
  if (text.trim().length < 40) throw new Error('tomt svar');
  return text;
}

async function syncNaa() {
  if (!syncAktiv || !syncPaa()) return;
  try {
    const text = await hentManus();
    syncFeil = 0;
    if (text === store.get(KEY.doc, '')) { setSyncStatus('ok'); return; }

    const parsed = parseDocument(text);
    // Et halvferdig eller feilhentet dokument skal ikke få slette et manus som virker.
    if (parsed.intros.length < 3 && state.intros.length >= 3) {
      setSyncStatus('feil', 'dokumentet ga bare ' + parsed.intros.length + ' poster');
      return;
    }
    if (loadText(text, { view: false })) setSyncStatus('ny');
  } catch (e) {
    syncFeil += 1;
    setSyncStatus('feil', e.message || 'ukjent feil');
  } finally {
    planlegg();
  }
}

function planlegg() {
  clearTimeout(syncTimer);
  if (!syncPaa() || document.visibilityState !== 'visible') return;
  syncTimer = setTimeout(syncNaa, syncFeil > 2 ? SYNC_MS_ETTER_FEIL : SYNC_MS);
}

function settSync(paa) {
  store.set(KEY.sync, paa ? 'på' : 'av');
  clearTimeout(syncTimer);
  setSyncStatus(paa ? 'ok' : 'av');
  if (paa) syncNaa();
}

/* ================= oppstart ================= */

function initEvents() {
  $('#file').addEventListener('change', async (ev) => {
    const file = ev.target.files && ev.target.files[0];
    if (!file) return;
    try {
      if (loadText(await readFileAsText(file))) settSync(false);
    } catch (e) {
      showError(e.message || 'Klarte ikke lese filen.');
    } finally {
      ev.target.value = '';
    }
  });

  $('#use-paste').addEventListener('click', () => {
    const text = $('#paste').value;
    if (!text.trim()) { showError('Lim inn tekst først.'); return; }
    if (loadText(text)) settSync(false);
  });

  $('#use-builtin').addEventListener('click', () => {
    const text = builtInScript();
    if (!text) { showError('Fant ikke det innebygde manuset.'); return; }
    $('#paste').value = text;
    if (loadText(text)) settSync(false);
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
  $('#menu-btn').addEventListener('click', () => {
    $('#m-sync').hidden = !syncAktiv;
    $('#m-sync').textContent = syncPaa() ? 'Slå av synk mot dokumentet' : 'Slå på synk mot dokumentet';
    sheet.hidden = false;
  });
  sheet.querySelectorAll('[data-close]').forEach((el) => el.addEventListener('click', closeSheet));

  $('#m-sync').addEventListener('click', () => { closeSheet(); settSync(!syncPaa()); });
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
    if (!confirm('Hente inn det innebygde manuset og slå av synk mot dokumentet?')) return;
    if (loadText(text)) settSync(false);
  });

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') { clearTimeout(syncTimer); return; }
    if (!$('#view-read').hidden) requestWakeLock();
    syncNaa();
  });
}

function init() {
  document.documentElement.dataset.theme = store.get(KEY.theme, 'dark');
  state.me = store.get(KEY.me, null);
  setFont(parseInt(store.get(KEY.font, '30'), 10) || 30);

  initEvents();

  const saved = store.get(KEY.doc, '');
  if (!(saved && saved.trim() && loadText(saved, { remember: false }))) {
    const builtIn = builtInScript();
    if (!(builtIn && loadText(builtIn, { remember: false }))) showView('#view-setup');
  }

  /* SYNK-START */
  syncAktiv = true;
  setSyncStatus(syncPaa() ? 'venter' : 'av');
  syncNaa();
  /* SYNK-SLUTT */
}

init();

if ('serviceWorker' in navigator && location.protocol === 'https:') {
  window.addEventListener('load', () => { navigator.serviceWorker.register('sw.js').catch(() => {}); });
}
