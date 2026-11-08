// Демо-режим: виртуальная клавиатура, которая отвечает по протоколу corne-tool.
// Позволяет пройти по всем вкладкам и всё попробовать без подключённой платы.

export class DemoDevice {
  constructor({ side = 'right' } = {}) {
    this.side = side;
    this.leds = 27;
    this.frame = new Array(this.leds).fill([0, 0, 0]);
    this.hostLed = false;
    this.rgbOn = true;
    this.display = { lines: ['', 'Corne Studio', ''], auto: true, test: 0 };
    this.layers = new Set([0]);
    this.listeners = new Set();
    this.bat = 87;
    const enc = new TextEncoder();
    let ctrl;
    this.readable = new ReadableStream({ start: (c) => { ctrl = c; } });
    this.emit = (line) => { try { ctrl.enqueue(enc.encode(line + '\n')); } catch { /* закрыт */ } };
    const dec = new TextDecoder();
    let buf = '';
    this.writable = new WritableStream({
      write: (chunk) => {
        buf += dec.decode(chunk);
        let i;
        while ((i = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, i).trim();
          buf = buf.slice(i + 1);
          if (line) this.handle(line);
        }
      },
    });
    // Медленный разряд, чтобы было видно график батареи
    this.batTimer = setInterval(() => { this.bat = Math.max(5, this.bat - 1); }, 120000);
  }

  // Методы «порта» для Link
  async open() {}
  async setSignals() {}
  async close() { clearInterval(this.batTimer); }
  getInfo() { return { demo: true }; }

  onChange(cb) { this.listeners.add(cb); }
  changed() { this.listeners.forEach((cb) => cb(this)); }

  handle(line) {
    const [cmd, sub, ...rest] = line.split(' ');
    const ok = () => this.emit(`OK ${cmd}`);
    switch (cmd) {
      case 'PING': return this.emit('PONG');
      case 'INFO': case 'HELLO': {
        const layer = Math.max(...this.layers);
        const names = ['QWERTY', 'NUMBER', 'SYMBOL'];
        return this.emit(`INFO fw=demo side=${this.side} role=central leds=${this.leds} bat=${this.bat} usb=1 profile=0 layer=${layer} rgb=${this.rgbOn ? 1 : 0} host_led=${this.hostLed ? 1 : 0} display=1 img=1 layer_name=${names[layer] || '-'}`);
      }
      case 'KEYS': return ok();
      case 'LED': {
        if (sub === 'HOST') this.hostLed = true;
        else if (sub === 'FW') this.hostLed = false;
        else {
          this.hostLed = true;
          if (sub === 'FILL') this.frame = this.frame.map(() => hex(rest[0]));
          if (sub === 'PX') this.frame[+rest[0]] = hex(rest[1]);
          if (sub === 'FRAME') {
            const h = rest[0] || '';
            for (let i = 0; i < this.leds && i * 6 + 6 <= h.length; i++) this.frame[i] = hex(h.slice(i * 6, i * 6 + 6));
            this.changed();
            return; // кадры без ответа
          }
        }
        this.changed();
        return ok();
      }
      case 'RGB':
        this.hostLed = false;
        if (sub === 'TOG') this.rgbOn = !this.rgbOn;
        if (sub === 'ON') this.rgbOn = true;
        if (sub === 'OFF') this.rgbOn = false;
        this.changed();
        return ok();
      case 'DISP':
        if (sub === 'LINE') this.display.lines[+rest[0]] = rest.slice(1).join(' ');
        if (sub === 'AUTO') this.display.auto = rest[0] === '1';
        if (sub === 'TEST') this.display.test = +rest[0];
        if (sub === 'CLEAR') { this.display.lines = ['', '', '']; this.display.test = 0; this.display.img = null; }
        if (sub === 'MODE') this.display.imgMode = rest[0] === 'IMG';
        if (sub === 'IMG') {
          const h = rest[0] || '';
          const bits = new Uint8Array(512);
          for (let i = 0; i < 512; i++) bits[i] = parseInt(h.slice(i * 2, i * 2 + 2), 16) || 0;
          this.display.img = bits;
          this.display.imgMode = true;
          this.changed();
          return; // без ответа
        }
        this.changed();
        return ok();
      case 'BOOT': case 'RESET': return ok();
      default: return this.emit('ERR unknown command');
    }
  }

  /** Нажатие виртуальной клавиши */
  key(pos, down) { this.emit(`KEY ${pos} ${down ? 1 : 0} 255`); }
  layer(l, on) {
    if (on) this.layers.add(l); else this.layers.delete(l);
    this.emit(`LAYER ${l} ${on ? 1 : 0}`);
  }
}

const hex = (h = '000000') => [parseInt(h.slice(0, 2), 16) || 0, parseInt(h.slice(2, 4), 16) || 0, parseInt(h.slice(4, 6), 16) || 0];

// Клавиши компьютера → имена ZMK (для нажатий в демо-режиме)
export const CODE_TO_ZMK = {
  Tab: 'TAB', Escape: 'ESC', Space: 'SPACE', Enter: 'RET', Backspace: 'BSPC', Delete: 'DEL',
  ShiftLeft: 'LSHFT', ShiftRight: 'RSHFT', ControlLeft: 'LCTRL', ControlRight: 'RCTRL',
  AltLeft: 'LALT', AltRight: 'RALT', MetaLeft: 'LGUI', MetaRight: 'RGUI',
  Semicolon: 'SEMI', Quote: 'SQT', Comma: 'COMMA', Period: 'DOT', Slash: 'FSLH', Backslash: 'BSLH',
  Minus: 'MINUS', Equal: 'EQUAL', BracketLeft: 'LBKT', BracketRight: 'RBKT', Backquote: 'GRAVE',
  ArrowLeft: 'LEFT', ArrowRight: 'RIGHT', ArrowUp: 'UP', ArrowDown: 'DOWN',
};
export function zmkName(code) {
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit\d$/.test(code)) return 'N' + code.slice(5);
  if (/^F\d+$/.test(code)) return code;
  return CODE_TO_ZMK[code] || null;
}
