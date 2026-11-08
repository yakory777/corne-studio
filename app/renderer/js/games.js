// Мини-игры на светодиодах главной половины + достижения.
import { KEYS, DEFAULT_LED_MAP } from './layout.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export const ACHIEVEMENTS = [
  { id: 'first', name: 'Первое касание', desc: 'Первое нажатие в приложении', test: (s) => s.totalPresses >= 1 },
  { id: 'k1', name: 'Тысячник', desc: '1 000 нажатий', test: (s) => s.totalPresses >= 1000 },
  { id: 'k10', name: 'Разогрелся', desc: '10 000 нажатий', test: (s) => s.totalPresses >= 10000 },
  { id: 'k100', name: 'Стотысячник', desc: '100 000 нажатий', test: (s) => s.totalPresses >= 100000 },
  { id: 'wpm40', name: 'Уверенно', desc: '40 слов/мин в тренажёре', test: (s) => s.trainerBest >= 40 },
  { id: 'wpm60', name: 'Быстрые пальцы', desc: '60 слов/мин в тренажёре', test: (s) => s.trainerBest >= 60 },
  { id: 'wpm80', name: 'Пулемёт', desc: '80 слов/мин в тренажёре', test: (s) => s.trainerBest >= 80 },
  { id: 'all42', name: 'Полный обход', desc: 'Нажать все 42 клавиши', test: (s) => s.keysUsed >= 42 },
  { id: 'mole20', name: 'Ловкач', desc: '20 очков в «Поймай огонёк»', test: (s) => (s.games.mole || 0) >= 20 },
  { id: 'simon8', name: 'Слон', desc: 'Последовательность из 8 в «Повтори»', test: (s) => (s.games.simon || 0) >= 8 },
  { id: 'react200', name: 'Реакция кошки', desc: 'Реакция быстрее 200 мс', test: (s) => (s.games.reactBest || 9999) < 200 },
  { id: 'flash1', name: 'Мастер прошивки', desc: 'Первая прошивка из приложения', test: (s) => s.flashes >= 1 },
  { id: 'night', name: 'Сова', desc: 'Печатать после 2 ночи', test: (s) => s.night },
  { id: 'streak7', name: 'Неделя с Corne', desc: 'Печатать 7 дней', test: (s) => s.days >= 7 },
];

export function initGames(ctx) {
  const { $, setOverlay, clearOverlay, settings, saveSettings, toast, flashNotify, MH, renderKeyboard, applyLabels } = ctx;
  const kb = renderKeyboard($('#gameKb'), { showLeds: false });
  applyLabels(kb);
  const g = settings.games || {};
  let current = null; // { name, onKey(pos) }
  let lit = new Map(); // pos → [r,g,b]

  // Клавиши главной половины, у которых есть светодиод
  const pads = () => KEYS.filter((k) => k.half === MH() && DEFAULT_LED_MAP[k.pos] !== undefined).map((k) => k.pos);

  function show() {
    setOverlay('game', (led) => {
      if (led.pos !== null && lit.has(led.pos)) return lit.get(led.pos);
      return led.under ? [4, 4, 10] : [0, 0, 0];
    }, { prio: 7 });
    KEYS.forEach((k) => {
      const c = lit.get(k.pos);
      kb.setKeyColor(k.pos, c ? `rgb(${c.join(',')})` : '');
    });
  }
  function setScore(text) { $('#gameScore').textContent = text; }
  function saveGame(patch) { Object.assign(g, patch); saveSettings({ games: g }); renderRecords(); }
  function renderRecords() {
    $('#gameRecords').textContent = `Рекорды: огонёк ${g.mole || 0} · повтори ${g.simon || 0} · реакция ${g.reactBest ? g.reactBest + ' мс' : '—'}`;
  }
  function stop(msg) {
    current = null;
    lit = new Map();
    clearOverlay('game');
    KEYS.forEach((k) => kb.setKeyColor(k.pos, ''));
    if (msg) setScore(msg);
  }

  /* ---- Поймай огонёк: 30 секунд, жми загоревшуюся клавишу ---- */
  async function mole() {
    stop();
    let score = 0;
    const end = performance.now() + 30000;
    let target = null;
    const next = () => {
      const p = pads();
      target = p[Math.floor(Math.random() * p.length)];
      lit = new Map([[target, [255, 200, 0]]]);
      show();
    };
    current = {
      onKey: (pos) => {
        if (pos === target) { score++; next(); } else { lit = new Map([[pos, [255, 0, 0]], [target, [255, 200, 0]]]); show(); }
      },
    };
    next();
    while (current && performance.now() < end) {
      setScore(`Огонёк: ${score} · осталось ${Math.ceil((end - performance.now()) / 1000)} с`);
      await sleep(200);
    }
    if (!current) return;
    stop(`Огонёк: ${score} очков${score > (g.mole || 0) ? ' — рекорд!' : ''}`);
    if (score > (g.mole || 0)) { saveGame({ mole: score }); flashNotify('00ff60', 1200); }
  }

  /* ---- Повтори (Simon): запомни последовательность ---- */
  async function simon() {
    stop();
    const colors = [[255, 40, 40], [40, 255, 80], [40, 120, 255], [255, 220, 0]];
    const p = pads();
    const seq = [];
    let level = 0;
    for (;;) {
      seq.push(p[Math.floor(Math.random() * p.length)]);
      setScore(`Повтори: смотри… (${seq.length})`);
      current = { onKey: () => {} };
      for (const [i, pos] of seq.entries()) {
        lit = new Map([[pos, colors[i % 4]]]); show();
        await sleep(450);
        lit = new Map(); show();
        await sleep(150);
        if (!current) return;
      }
      setScore(`Повтори: твоя очередь (${seq.length})`);
      const ok = await new Promise((resolve) => {
        let i = 0;
        current = {
          onKey: (pos) => {
            if (pos !== seq[i]) return resolve(false);
            lit = new Map([[pos, colors[i % 4]]]); show();
            setTimeout(() => { lit = new Map(); show(); }, 150);
            if (++i === seq.length) resolve(true);
          },
          cancel: () => resolve(null),
        };
      });
      if (ok === null) return;
      if (!ok) break;
      level = seq.length;
      await sleep(500);
    }
    stop(`Повтори: ${level}${level > (g.simon || 0) ? ' — рекорд!' : ''}`);
    flashNotify('ff2020', 600);
    if (level > (g.simon || 0)) saveGame({ simon: level });
  }

  /* ---- Реакция: жди зелёный, жми любую клавишу ---- */
  async function reaction() {
    stop();
    const results = [];
    for (let round = 0; round < 5; round++) {
      lit = new Map(pads().map((p) => [p, [80, 0, 0]])); show();
      setScore(`Реакция: жди зелёный… (${round + 1}/5)`);
      let early = false;
      current = { onKey: () => { early = true; } };
      await sleep(1200 + Math.random() * 2500);
      if (!current) return;
      if (early) { setScore('Рано! Попробуй ещё'); round--; await sleep(800); continue; }
      lit = new Map(pads().map((p) => [p, [0, 255, 80]])); show();
      const t0 = performance.now();
      const ms = await new Promise((resolve) => { current = { onKey: () => resolve(Math.round(performance.now() - t0)), cancel: () => resolve(null) }; });
      if (ms === null) return;
      results.push(ms);
      setScore(`Реакция: ${ms} мс`);
      await sleep(700);
    }
    const best = Math.min(...results);
    const avg = Math.round(results.reduce((a, b) => a + b, 0) / results.length);
    stop(`Реакция: среднее ${avg} мс, лучшее ${best} мс`);
    if (!g.reactBest || best < g.reactBest) saveGame({ reactBest: best });
  }

  $('#gMole').onclick = () => mole();
  $('#gSimon').onclick = () => simon();
  $('#gReact').onclick = () => reaction();
  $('#gStop').onclick = () => { if (current && current.cancel) current.cancel(); stop('Игра остановлена'); };
  renderRecords();

  return {
    onKey: (pos, down) => { if (down && current) current.onKey(pos); },
    stop: () => { if (current && current.cancel) current.cancel(); stop(); },
    onTab: () => applyLabels(kb),
    games: g,
  };
}

/* ---------------- достижения ---------------- */

export function initAchievements(ctx) {
  const { $, settings, saveSettings, toast, flashNotify } = ctx;
  const got = settings.achievements || {};

  function snapshot() {
    const st = settings.stats || { days: {} };
    const days = Object.values(st.days || {});
    const keys = new Set();
    days.forEach((d) => Object.keys(d.keys || {}).forEach((k) => keys.add(k)));
    return {
      totalPresses: days.reduce((a, d) => a + (d.presses || 0), 0),
      keysUsed: keys.size,
      trainerBest: settings.trainerBest || 0,
      games: settings.games || {},
      flashes: (settings.flashHistory || []).length,
      night: !!settings.nightOwl,
      days: days.filter((d) => d.presses > 50).length,
    };
  }

  function render() {
    const box = $('#achList');
    box.innerHTML = '';
    for (const a of ACHIEVEMENTS) {
      const d = document.createElement('div');
      d.className = 'ach' + (got[a.id] ? ' got' : '');
      d.innerHTML = '<b></b><span></span>';
      d.children[0].textContent = (got[a.id] ? '🏆 ' : '🔒 ') + a.name;
      d.children[1].textContent = a.desc + (got[a.id] ? ` · ${new Date(got[a.id]).toLocaleDateString('ru-RU')}` : '');
      box.appendChild(d);
    }
    $('#achCount').textContent = `${Object.keys(got).length} / ${ACHIEVEMENTS.length}`;
  }

  function check() {
    if (new Date().getHours() >= 2 && new Date().getHours() < 5 && !settings.nightOwl) saveSettings({ nightOwl: true });
    const s = snapshot();
    let changed = false;
    for (const a of ACHIEVEMENTS) {
      if (!got[a.id] && a.test(s)) {
        got[a.id] = Date.now();
        changed = true;
        toast(`🏆 Достижение: ${a.name}`);
        flashNotify('ffd000', 1500);
      }
    }
    if (changed) { saveSettings({ achievements: got }); render(); }
  }

  render();
  setInterval(check, 15000);
  setTimeout(check, 3000);
  return { check, render };
}
