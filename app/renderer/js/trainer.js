// Тренажёр слепой печати: следующая клавиша подсвечивается на клавиатуре и на схеме.

const TEXTS = {
  ru: [
    'Съешь же ещё этих мягких французских булок, да выпей чаю.',
    'Новая клавиатура требует привычки: сначала медленно и точно, потом быстро.',
    'Чертёж начинается с осей, затем вид спереди, сверху и слева.',
    'Редуктор передаёт вращение с вала на вал и меняет скорость.',
  ],
  en: [
    'The quick brown fox jumps over the lazy dog.',
    'Pack my box with five dozen liquor jugs.',
    'Small steps every day add up to big results.',
    'Split keyboards keep your wrists straight and shoulders relaxed.',
  ],
};

// Русская раскладка ЙЦУКЕН → клавиши QWERTY
const RU = {
  й: 'Q', ц: 'W', у: 'E', к: 'R', е: 'T', н: 'Y', г: 'U', ш: 'I', щ: 'O', з: 'P', х: 'LBKT', ъ: 'RBKT',
  ф: 'A', ы: 'S', в: 'D', а: 'F', п: 'G', р: 'H', о: 'J', л: 'K', д: 'L', ж: 'SEMI', э: 'SQT',
  я: 'Z', ч: 'X', с: 'C', м: 'V', и: 'B', т: 'N', ь: 'M', б: 'COMMA', ю: 'DOT', ё: 'GRAVE',
};
const RU_SYM = { '.': ['FSLH'], ',': ['FSLH', true], '!': ['N1', true], '"': ['N2', true], '№': ['N3', true], ';': ['N4', true], '%': ['N5', true], ':': ['N6', true], '?': ['N7', true], '*': ['N8', true], '(': ['N9', true], ')': ['N0', true], '-': ['MINUS'], ' ': ['SPACE'] };
const EN_PLAIN = { '-': 'MINUS', '=': 'EQUAL', '[': 'LBKT', ']': 'RBKT', '\\': 'BSLH', ';': 'SEMI', "'": 'SQT', '`': 'GRAVE', ',': 'COMMA', '.': 'DOT', '/': 'FSLH', ' ': 'SPACE' };
const EN_SHIFT = { '!': 'N1', '@': 'N2', '#': 'N3', $: 'N4', '%': 'N5', '^': 'N6', '&': 'N7', '*': 'N8', '(': 'N9', ')': 'N0', _: 'MINUS', '+': 'EQUAL', '{': 'LBKT', '}': 'RBKT', '|': 'BSLH', ':': 'SEMI', '"': 'SQT', '~': 'GRAVE', '<': 'COMMA', '>': 'DOT', '?': 'FSLH' };
// Символы, которые часто стоят отдельной клавишей на слое (без Shift)
const DIRECT = { '!': ['EXCL'], '@': ['AT'], '#': ['HASH'], $: ['DOLLAR'], '%': ['PRCNT', 'PERCENT'], '^': ['CARET'], '&': ['AMPS'], '*': ['STAR', 'ASTRK', 'ASTERISK'], '(': ['LPAR'], ')': ['RPAR'], _: ['UNDER'], '+': ['PLUS'], '{': ['LBRC'], '}': ['RBRC'], '|': ['PIPE'], ':': ['COLON'], '"': ['DQT'], '~': ['TILDE'], '<': ['LT'], '>': ['GT'], '?': ['QMARK'] };
const DIGIT = (ch) => (/[0-9]/.test(ch) ? ['N' + ch, 'NUMBER_' + ch] : null);

/** Что нажать для символа: варианты [{names:[...], shift}] */
function keysForChar(ch, lang) {
  const lo = ch.toLowerCase();
  const up = ch !== lo;
  if (lang === 'ru') {
    if (RU[lo]) return [{ names: [RU[lo]], shift: up }];
    if (RU_SYM[ch]) return [{ names: [RU_SYM[ch][0]], shift: !!RU_SYM[ch][1] }];
  }
  if (/[a-z]/i.test(ch)) return [{ names: [ch.toUpperCase()], shift: up }];
  const d = DIGIT(ch);
  if (d) return [{ names: d, shift: false }];
  if (EN_PLAIN[ch]) return [{ names: [EN_PLAIN[ch]], shift: false }];
  const out = [];
  if (DIRECT[ch]) out.push({ names: DIRECT[ch], shift: false });
  if (EN_SHIFT[ch]) out.push({ names: [EN_SHIFT[ch]], shift: true });
  return out;
}

export function initTrainer(ctx) {
  const { $, renderKeyboard, applyLabels, getLayers, setOverlay, clearOverlay, settings, saveSettings, leds, MH } = ctx;
  const kb = renderKeyboard($('#trKb'), { showLeds: false });
  applyLabels(kb);

  let text = '';
  let idx = 0;
  let errors = 0;
  let started = 0;
  let running = false;
  let target = { positions: [], layerKey: null, shift: null, missing: false };
  let errFlash = 0;

  /** Ищет клавишу по имени кода: сначала слой 0, потом остальные (+ клавиша включения слоя) */
  function findPositions(variants) {
    const layers = getLayers();
    for (const v of variants) {
      for (let li = 0; li < layers.length; li++) {
        const b = layers[li].bindings;
        const pos = b.findIndex((x) => v.names.some((n) => x === `&kp ${n}`));
        if (pos < 0) continue;
        let layerKey = null;
        if (li > 0) layerKey = layers[0].bindings.findIndex((x) => x === `&mo ${li}` || x.startsWith(`&lt ${li} `));
        let shift = null;
        if (v.shift) shift = layers[0].bindings.findIndex((x) => x === '&kp LSHFT' || x === '&kp RSHFT' || x === '&kp LSHIFT');
        return { positions: [pos], layerKey: layerKey >= 0 ? layerKey : null, shift: shift >= 0 ? shift : null, missing: false };
      }
    }
    return { positions: [], layerKey: null, shift: null, missing: true };
  }

  function renderText() {
    const box = $('#trText');
    box.innerHTML = '';
    [...text].forEach((ch, i) => {
      const s = document.createElement('span');
      s.textContent = ch;
      s.className = i < idx ? 'done' : i === idx ? 'cur' : '';
      box.appendChild(s);
    });
  }

  function updateTarget() {
    kb.clearClass('selected');
    KEYS_RESET();
    if (!running || idx >= text.length) { target = { positions: [] }; return; }
    target = findPositions(keysForChar(text[idx], $('#trLang').value));
    for (const p of target.positions) kb.setKeyColor(p, 'rgba(124,156,255,.9)');
    if (target.shift !== null) kb.setKeyColor(target.shift, 'rgba(255,179,92,.8)');
    if (target.layerKey !== null) kb.setKeyColor(target.layerKey, 'rgba(91,227,176,.8)');
    $('#trHint').textContent = target.missing ? `Символ «${text[idx]}» не найден в раскладке` :
      [target.layerKey !== null ? 'зажмите клавишу слоя (зелёная)' : '', target.shift !== null ? 'с Shift (оранжевая)' : ''].filter(Boolean).join(', ');
  }
  function KEYS_RESET() { for (let p = 0; p < 42; p++) kb.setKeyColor(p, ''); }

  function stats() {
    const min = (performance.now() - started) / 60000;
    const wpm = min > 0 ? Math.round(idx / 5 / min) : 0;
    const acc = idx + errors > 0 ? Math.round((100 * idx) / (idx + errors)) : 100;
    $('#trWpm').textContent = wpm;
    $('#trAcc').textContent = `${acc}%`;
    $('#trErr').textContent = errors;
    return { wpm, acc };
  }

  function start() {
    const lang = $('#trLang').value;
    const custom = $('#trCustom').value.trim();
    const list = TEXTS[lang];
    text = custom || list[Math.floor(Math.random() * list.length)];
    idx = 0; errors = 0; started = performance.now(); running = true;
    $('#trResult').textContent = '';
    renderText();
    updateTarget();
    $('#trFocus').focus();
    setOverlay('trainer', (led, t) => {
      const err = performance.now() - errFlash < 250;
      if (led.pos !== null && target.positions.includes(led.pos)) return err ? [255, 30, 30] : [200, 210, 255];
      if (led.pos !== null && led.pos === target.shift) return [255, 140, 0];
      if (led.pos !== null && led.pos === target.layerKey) return [0, 220, 120];
      if (led.under) return err ? [120, 0, 0] : [6, 8, 20];
      return [0, 0, 0];
    }, { prio: 5 });
  }

  function finish() {
    running = false;
    clearOverlay('trainer');
    const { wpm, acc } = stats();
    const best = settings.trainerBest || 0;
    if (wpm > best && acc >= 90) saveSettings({ trainerBest: wpm });
    $('#trResult').textContent = `Готово: ${wpm} слов/мин, точность ${acc}%${wpm > best && acc >= 90 ? ' — новый рекорд!' : ''}`;
    $('#trBest').textContent = settings.trainerBest || 0;
    updateTarget();
  }

  $('#trFocus').addEventListener('keydown', (e) => {
    if (!running) return;
    if (e.key.length !== 1) return; // Shift, Ctrl и т.п.
    e.preventDefault();
    if (e.key === text[idx]) {
      idx++;
      if (idx >= text.length) { renderText(); return finish(); }
    } else {
      errors++;
      errFlash = performance.now();
      $('#trText').classList.add('shake');
      setTimeout(() => $('#trText').classList.remove('shake'), 200);
    }
    renderText();
    updateTarget();
    stats();
  });
  $('#trText').onclick = () => $('#trFocus').focus();
  $('#trStart').onclick = start;
  $('#trStop').onclick = () => { running = false; clearOverlay('trainer'); updateTarget(); };
  $('#trBest').textContent = settings.trainerBest || 0;

  return {
    onTab: () => applyLabels(kb),
    stop: () => { running = false; clearOverlay('trainer'); },
  };
}
