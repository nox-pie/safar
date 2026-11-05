import './styles.css';
import {
  applyFix, compile, lineCol, network, renderIR, renderJourneyText, routeProgram,
  type CompileResult, type Diagnostic, type Journey,
} from '../compiler/index.ts';
import { renderCard } from './card.ts';
import { completionsAt, type Completion } from './completions.ts';
import { EXAMPLES } from './examples.ts';
import { renderHighlight } from './highlight.ts';
import { esc } from './html.ts';
import { formatTime, profile, renderPipeline } from './pipeline.ts';
import { renderAst, renderNetwork, renderTokens } from './views.ts';

const STORAGE_KEY = 'safar:source';
const THEME_KEY = 'safar:theme';
/** Profiling waits until typing pauses so it never slows the editor down. */
const PROFILE_DELAY_MS = 200;

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const editor = $<HTMLTextAreaElement>('source');
const highlight = $('highlight');
const gutter = $('gutter');
const problems = $('problems');
const problemCount = $('problem-count');
const status = $('status');
const completionBar = $('completions');
const pipeline = $('pipeline');
const views = {
  journey: $('view-journey'),
  tokens: $('view-tokens'),
  ast: $('view-ast'),
  ir: $('view-ir'),
};

let result: CompileResult;
let lastJourney: Journey | null = null;
let completions: Completion[] = [];
let profileTimer: ReturnType<typeof setTimeout> | undefined;

const store = {
  get(key: string) {
    try { return localStorage.getItem(key); } catch { return null; }
  },
  set(key: string, value: string) {
    try { localStorage.setItem(key, value); } catch { /* storage unavailable */ }
  },
};

// ── Compile & render ───────────────────────────────────────────────────────────

function run() {
  const source = editor.value;
  result = compile(source);
  store.set(STORAGE_KEY, source);

  highlight.innerHTML = renderHighlight(source, result);
  const lineCount = source.split('\n').length;
  gutter.innerHTML = Array.from({ length: lineCount }, (_, i) => `<div>${i + 1}</div>`).join('');
  syncScroll();

  renderProblems(result.diagnostics);
  renderStatus();
  renderViews();
  updateCompletions();

  pipeline.innerHTML = renderPipeline(result);
  clearTimeout(profileTimer);
  const profiled = result;
  profileTimer = setTimeout(() => {
    if (profiled !== result) return;
    const timings = profile(source, profiled);
    const total = Object.values(timings).reduce((a, b) => a + b, 0);
    pipeline.innerHTML = renderPipeline(profiled, timings) + `<li class="stage-total">compiled in <strong>${formatTime(total)}</strong></li>`;
  }, PROFILE_DELAY_MS);
}

function renderStatus() {
  const count = (s: Diagnostic['severity']) => result.diagnostics.filter((d) => d.severity === s).length;
  const errors = count('error');
  const warnings = count('warning');
  const j = result.journey;
  status.className = `status ${errors ? 'is-error' : warnings ? 'is-warning' : 'is-ok'}`;
  status.textContent = errors
    ? `${errors} error${errors > 1 ? 's' : ''}${warnings ? `, ${warnings} warning${warnings > 1 ? 's' : ''}` : ''}`
    : j ? `Compiled · ${j.stationCount} stations · ~${Math.round(j.minutes.total)} min${warnings ? ` · ${warnings} warning${warnings > 1 ? 's' : ''}` : ''}` : 'Compiled';
  const total = result.diagnostics.length;
  problemCount.textContent = total ? String(total) : '';
}

function renderProblems(diags: Diagnostic[]) {
  if (diags.length === 0) {
    problems.innerHTML = '<li class="problem-empty">No problems. This journey is allowed.</li>';
    return;
  }
  problems.innerHTML = diags.map((d, i) => {
    const { line, col } = lineCol(result.source, d.span.start);
    return `
      <li class="problem sev-${d.severity}">
        <button type="button" class="problem-main" data-goto="${i}">
          <span class="sev-icon" aria-hidden="true">${d.severity === 'error' ? '✕' : d.severity === 'warning' ? '!' : 'i'}</span>
          <span class="problem-msg">${esc(d.message)}</span>
          <span class="problem-loc">${d.code} · ${line}:${col}</span>
        </button>
        ${d.help ? `<div class="problem-help">${esc(d.help)}</div>` : ''}
        ${d.fix ? `<button type="button" class="btn small fix" data-fix="${i}">${esc(d.fix.label)}</button>` : ''}
      </li>`;
  }).join('');
}

function renderViews() {
  const j = result.journey;
  const errors = result.diagnostics.filter((d) => d.severity === 'error').length;
  if (j) {
    lastJourney = j;
    views.journey.innerHTML = renderCard(j);
  } else if (lastJourney) {
    views.journey.innerHTML = `
      <div class="stale-banner">Fix ${errors} error${errors === 1 ? '' : 's'} to update the card. Showing the last valid journey.</div>
      <div class="stale">${renderCard(lastJourney)}</div>`;
  } else {
    views.journey.innerHTML = `<div class="empty-state"><div class="empty-icon" aria-hidden="true">⌁</div><p>Fix ${errors} error${errors === 1 ? '' : 's'} to see your journey card.</p></div>`;
  }
  views.tokens.innerHTML = renderTokens(result);
  views.ast.innerHTML = renderAst(result);
  views.ir.innerHTML = j
    ? `<pre class="code-view">${esc(renderIR(j))}</pre>`
    : '<div class="empty-state"><p>IR is generated once the program passes semantic checks.</p></div>';
}

// ── Editor ──────────────────────────────────────────────────────────────────────

function syncScroll() {
  highlight.style.transform = `translate(${-editor.scrollLeft}px, ${-editor.scrollTop}px)`;
  gutter.style.transform = `translateY(${-editor.scrollTop}px)`;
}

/** Loads a whole new program; the previous card no longer relates to it. */
function setSource(text: string, caret = text.length) {
  lastJourney = null;
  editor.value = text;
  editor.focus();
  editor.setSelectionRange(caret, caret);
  run();
}

function replaceRange(start: number, end: number, text: string) {
  editor.focus();
  editor.setSelectionRange(start, end);
  // execCommand keeps the browser's undo stack intact; fall back if unsupported.
  if (!document.execCommand('insertText', false, text)) {
    editor.setRangeText(text, start, end, 'end');
    run();
  }
}

function updateCompletions() {
  const caret = editor.selectionStart;
  completions = document.activeElement === editor && editor.selectionStart === editor.selectionEnd
    ? completionsAt(editor.value, caret, result)
    : [];
  completionBar.hidden = completions.length === 0;
  completionBar.innerHTML = completions.length
    ? `<span class="muted">Tab ↹</span>${completions.map((c, i) => `<button type="button" class="completion${i === 0 ? ' is-first' : ''}" data-complete="${i}"${c.color ? ` style="--c:${c.color}"` : ''}>${c.color ? '<i class="dot"></i>' : ''}${esc(c.label)}</button>`).join('')}`
    : '';
}

function acceptCompletion(c: Completion) {
  replaceRange(c.from, editor.selectionStart, c.text);
}

editor.addEventListener('input', run);
editor.addEventListener('scroll', syncScroll);
editor.addEventListener('keyup', (e) => {
  if (e.key.startsWith('Arrow') || e.key === 'Home' || e.key === 'End') updateCompletions();
});
editor.addEventListener('click', updateCompletions);
editor.addEventListener('focus', updateCompletions);
editor.addEventListener('blur', () => setTimeout(updateCompletions, 150));
editor.addEventListener('keydown', (e) => {
  if (e.key === 'Tab' && !e.shiftKey && completions.length) {
    e.preventDefault();
    acceptCompletion(completions[0]);
  } else if (e.key === 'Escape' && completions.length) {
    completions = [];
    completionBar.hidden = true;
  }
});
completionBar.addEventListener('mousedown', (e) => e.preventDefault()); // keep editor focus
completionBar.addEventListener('click', (e) => {
  const btn = (e.target as HTMLElement).closest<HTMLElement>('[data-complete]');
  if (btn) acceptCompletion(completions[Number(btn.dataset.complete)]);
});

problems.addEventListener('click', (e) => {
  const target = e.target as HTMLElement;
  const fixBtn = target.closest<HTMLElement>('[data-fix]');
  if (fixBtn) {
    const d = result.diagnostics[Number(fixBtn.dataset.fix)];
    if (d.fix) {
      const next = applyFix(result.source, d.fix);
      replaceRange(0, editor.value.length, next);
      const caret = d.fix.span.start + d.fix.text.length;
      editor.setSelectionRange(caret, caret);
    }
    return;
  }
  const goto = target.closest<HTMLElement>('[data-goto]');
  if (goto) {
    const { span } = result.diagnostics[Number(goto.dataset.goto)];
    editor.focus();
    editor.setSelectionRange(span.start, Math.max(span.end, span.start));
  }
});

// ── Output tabs ─────────────────────────────────────────────────────────────────

const tabs = document.querySelectorAll<HTMLButtonElement>('[role="tab"]');
function selectTab(panelId: string) {
  tabs.forEach((t) => {
    const selected = t.getAttribute('aria-controls') === panelId;
    t.setAttribute('aria-selected', String(selected));
    $(t.getAttribute('aria-controls')!).hidden = !selected;
  });
}
tabs.forEach((tab) => tab.addEventListener('click', () => selectTab(tab.getAttribute('aria-controls')!)));

pipeline.addEventListener('click', (e) => {
  const target = (e.target as HTMLElement).closest<HTMLElement>('[data-stage-tab]')?.dataset.stageTab;
  if (!target) return;
  if (target === 'problems') problems.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  else selectTab(target);
});

document.addEventListener('click', (e) => {
  const target = e.target as HTMLElement;
  if (target.closest('[data-toggle-leg]')) {
    const leg = target.closest('.leg')!;
    leg.classList.add('expanded');
  } else if (target.closest('[data-copy-card]') && lastJourney) {
    const btn = target.closest<HTMLButtonElement>('[data-copy-card]')!;
    void navigator.clipboard?.writeText(renderJourneyText(lastJourney)).then(() => flash(btn, 'Copied ✓'));
  } else if (target.closest('[data-insert]')) {
    const name = target.closest<HTMLElement>('[data-insert]')!.dataset.insert!;
    const { selectionStart: s, selectionEnd: end, value } = editor;
    const pad = s > 0 && !/\s/.test(value[s - 1]) ? ' ' : '';
    replaceRange(s, end, pad + name);
  }
});

function flash(btn: HTMLButtonElement, text: string) {
  const original = btn.textContent;
  btn.textContent = text;
  setTimeout(() => (btn.textContent = original), 1500);
}

// ── Toolbar: examples, planner, share, theme ───────────────────────────────────

const examples = $<HTMLSelectElement>('examples');
examples.innerHTML = '<option value="">Examples…</option>' + EXAMPLES.map((ex, i) => `<option value="${i}">${esc(ex.title)}</option>`).join('');
examples.addEventListener('change', () => {
  const ex = EXAMPLES[Number(examples.value)];
  if (ex) setSource(ex.source);
  examples.value = '';
});

$('station-list').innerHTML = network.stations.map((s) => `<option value="${esc(s.name)}"></option>`).join('');
$('net-list').innerHTML = renderNetwork();

$('planner').addEventListener('submit', (e) => {
  e.preventDefault();
  const fromText = $<HTMLInputElement>('plan-from').value;
  const toText = $<HTMLInputElement>('plan-to').value;
  const msg = $('plan-msg');
  const from = network.station(fromText);
  const to = network.station(toText);
  const unknown = !from ? fromText : !to ? toText : null;
  if (unknown !== null) {
    const [best] = network.suggestStations(unknown);
    msg.textContent = `Unknown station '${unknown}'${best ? `. Did you mean ${best}?` : ''}`;
    return;
  }
  const route = network.plan(from!, to!);
  if (!route) {
    msg.textContent = 'Pick two different stations.';
    return;
  }
  msg.textContent = '';
  setSource(routeProgram(from!, route));
});

$('share').addEventListener('click', () => {
  const url = `${location.origin}${location.pathname}#src=${encodeURIComponent(editor.value)}`;
  history.replaceState(null, '', url);
  void navigator.clipboard?.writeText(url).then(() => flash($<HTMLButtonElement>('share'), 'Link copied ✓'));
});

function applyTheme(theme: string | null) {
  if (theme === 'light' || theme === 'dark') document.documentElement.dataset.theme = theme;
  else delete document.documentElement.dataset.theme;
}
applyTheme(store.get(THEME_KEY));
$('theme').addEventListener('click', () => {
  const dark = document.documentElement.dataset.theme
    ? document.documentElement.dataset.theme === 'dark'
    : matchMedia('(prefers-color-scheme: dark)').matches;
  const next = dark ? 'light' : 'dark';
  applyTheme(next);
  store.set(THEME_KEY, next);
});

// ── Boot ────────────────────────────────────────────────────────────────────────

const fromHash = new URLSearchParams(location.hash.slice(1)).get('src');
editor.value = fromHash ?? store.get(STORAGE_KEY) ?? EXAMPLES[0].source;
run();
