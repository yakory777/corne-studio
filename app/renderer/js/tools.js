// Инструменты: сниппеты на F13–F24, Pomodoro и таймер выступления, погода, питомец, калибровка цвета, резервная копия.

export const SNIPPET_KEYS = Array.from({ length: 12 }, (_, i) => `F${13 + i}`);
const WMO = { 0: 'ясно', 1: 'малооблачно', 2: 'облачно', 3: 'пасмурно', 45: 'туман', 48: 'туман', 51: 'морось', 53: 'морось', 55: 'морось', 61: 'дождь', 63: 'дождь', 65: 'ливень', 71: 'снег', 73: 'снег', 75: 'снегопад', 80: 'ливень', 81: 'ливень', 82: 'ливень', 95: 'гроза', 96: 'гроза', 99: 'гроза' };

export function initTools(ctx) {
  const { $, cs, settings, saveSettings, toast, setOverlay, clearOverlay, flashNotify } = ctx;

  /* ---------------- сниппеты ---------------- */
  const snippets = settings.snippets || {};
  const box = $('#snipList');
  for (const k of SNIPPET_KEYS) {
    const row = document.createElement('div');
    row.className = 'row';
    row.innerHTML = `<span class="mono" style="width:44px">${k}</span><input class="grow" data-snip="${k}" placeholder="текст, который вставится по клавише ${k}" />`;
    box.appendChild(row);
    row.querySelector('input').value = snippets[k] || '';
  }
  box.addEventListener('change', (e) => {
    const k = e.target.dataset.snip;
    if (!k) return;
    snippets[k] = e.target.value;
    saveSettings({ snippets });
  });
  function onKeyBinding(binding) {
    const m = /^&kp (F1[3-9]|F2[0-4])$/.exec(binding || '');
    if (m && snippets[m[1]]) cs.pasteSnippet(snippets[m[1]].replace(/\\n/g, '\n'));
  }

  /* ---------------- Pomodoro и таймер выступления ---------------- */
  const pomo = { phase: 'idle', end: 0, start: 0, work: settings.pomoWork || 25, rest: settings.pomoRest || 5, count: 0 };
  const timer = { running: false, start: 0, target: settings.talkMin || 15 };
  $('#pomoWork').value = pomo.work;
  $('#pomoRest').value = pomo.rest;
  $('#talkMin').value = timer.target;

  function pomoStart(phase) {
    pomo.phase = phase;
    pomo.start = Date.now();
    pomo.end = Date.now() + (phase === 'work' ? pomo.work : pomo.rest) * 60000;
    setOverlay('pomo', (led, t, base) => {
      if (!led.under) return base;
      const k = Math.min(1, (Date.now() - pomo.start) / (pomo.end - pomo.start));
      return pomo.phase === 'work' ? [255 * k, 120 * (1 - k), 20 * (1 - k)].map((v) => v * 0.6) : [0, 120, 60];
    }, { prio: 1 });
    renderPomo();
  }
  function pomoStop() { pomo.phase = 'idle'; clearOverlay('pomo'); renderPomo(); }
  function renderPomo() {
    const left = Math.max(0, pomo.end - Date.now());
    $('#pomoState').textContent = pomo.phase === 'idle' ? 'остановлен' : `${pomo.phase === 'work' ? 'работа' : 'перерыв'} · ${fmt(left)} · помидоров: ${pomo.count}`;
  }
  const fmt = (ms) => `${Math.floor(ms / 60000)}:${String(Math.floor((ms % 60000) / 1000)).padStart(2, '0')}`;
  setInterval(() => {
    if (pomo.phase !== 'idle' && Date.now() >= pomo.end) {
      if (pomo.phase === 'work') { pomo.count++; toast('🍅 Перерыв!'); flashNotify('00ff60', 3000); pomoStart('rest'); } else { toast('Перерыв окончен — за работу'); flashNotify('ff6020', 3000); pomoStart('work'); }
    }
    if (pomo.phase !== 'idle') renderPomo();
    if (timer.running) {
      const el = Date.now() - timer.start;
      $('#talkState').textContent = `${fmt(el)} из ${timer.target}:00`;
      if (el >= timer.target * 60000 && !timer.warned) { timer.warned = true; flashNotify('ff2020', 4000); toast('⏰ Время выступления вышло'); }
    }
  }, 1000);
  $('#pomoGo').onclick = () => { pomo.work = +$('#pomoWork').value || 25; pomo.rest = +$('#pomoRest').value || 5; saveSettings({ pomoWork: pomo.work, pomoRest: pomo.rest }); pomoStart('work'); };
  $('#pomoStop').onclick = pomoStop;
  $('#talkGo').onclick = () => { timer.target = +$('#talkMin').value || 15; saveSettings({ talkMin: timer.target }); timer.running = true; timer.warned = false; timer.start = Date.now(); };
  $('#talkStop').onclick = () => { timer.running = false; $('#talkState').textContent = 'остановлен'; };

  /* ---------------- погода ---------------- */
  let weather = null;
  $('#wCity').value = settings.city || '';
  async function loadWeather() {
    const city = $('#wCity').value.trim();
    if (!city) return;
    saveSettings({ city });
    try {
      weather = await cs.weather(city);
      $('#wState').textContent = `${weather.city}: ${weather.temp > 0 ? '+' : ''}${weather.temp}°, ${WMO[weather.code] || '—'}, ветер ${weather.wind} м/с`;
    } catch (e) { $('#wState').textContent = e.message; }
  }
  $('#wLoad').onclick = loadWeather;
  if (settings.city) loadWeather();
  setInterval(loadWeather, 15 * 60 * 1000);

  /* ---------------- питомец ---------------- */
  const pet = settings.pet || { xp: 0, food: 60, name: 'Corne' };
  function petFeed() { pet.xp++; pet.food = Math.min(100, pet.food + 0.4); }
  setInterval(() => { pet.food = Math.max(0, pet.food - 0.5); saveSettings({ pet }); }, 60000);
  function petLines() {
    const lvl = Math.floor(Math.sqrt(pet.xp / 50)) + 1;
    const face = pet.food > 70 ? '(^o^)' : pet.food > 40 ? '(^_^)' : pet.food > 15 ? '(-_-)' : '(T_T)';
    const bar = '#'.repeat(Math.round(pet.food / 10)).padEnd(10, '.');
    const mood = pet.food > 70 ? 'schastliv' : pet.food > 40 ? 'dovolen' : pet.food > 15 ? 'skuchaet' : 'goloden! pechatai';
    return [`${face} ${pet.name} ur.${lvl}`, `syt [${bar}]`, mood];
  }

  /* ---------------- строки для экрана ---------------- */
  function screenLines(mode) {
    const now = Date.now();
    if (mode === 'pomodoro') {
      if (pomo.phase === 'idle') return ['', 'Pomodoro', 'ne zapushchen'];
      return ['', `${pomo.phase === 'work' ? 'RABOTA' : 'PERERYV'} ${fmt(Math.max(0, pomo.end - now))}`, `pomidorov: ${pomo.count}`];
    }
    if (mode === 'talk') {
      if (!timer.running) return ['', 'Taimer vystuplenia', 'ne zapushchen'];
      const el = now - timer.start, left = timer.target * 60000 - el;
      return ['', `${fmt(el)} / ${timer.target}:00`, left > 0 ? `ostalos ${fmt(left)}` : 'VREMYA VYSHLO!'];
    }
    if (mode === 'weather') {
      if (!weather) return ['', 'Pogoda', 'ukazhite gorod'];
      return ['', `${weather.temp > 0 ? '+' : ''}${weather.temp}C ${WMO[weather.code] || ''}`, `${weather.min}..${weather.max}C ветер ${weather.wind} м/с`];
    }
    if (mode === 'pet') return petLines();
    return null;
  }

  /* ---------------- калибровка цвета ---------------- */
  const calib = settings.calib || { r: 1, g: 1, b: 1 };
  ['r', 'g', 'b'].forEach((ch) => {
    const el = $(`#cal${ch.toUpperCase()}`);
    el.value = calib[ch];
    el.oninput = () => { calib[ch] = +el.value; saveSettings({ calib }); if (ctx.onCalibWhite && $('#calLive').checked) ctx.onCalibWhite(calib); };
  });
  $('#calWhite').onclick = () => ctx.onCalibWhite && ctx.onCalibWhite(calib);

  /* ---------------- резервная копия ---------------- */
  $('#bkExport').onclick = async () => { const p = await cs.backup.export(); if (p) toast('Сохранено: ' + p); };
  $('#bkImport').onclick = async () => {
    if (await cs.backup.import()) { toast('Настройки восстановлены — перезапуск…'); setTimeout(() => location.reload(), 800); }
  };

  return { onKeyBinding, screenLines, petFeed, calib };
}
