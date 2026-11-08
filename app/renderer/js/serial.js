// Связь с клавиатурой через Web Serial (виртуальный COM-порт модуля corne-tool).
const ZMK_VID = 0x1d50;

export class Link extends EventTarget {
  constructor() {
    super();
    this.port = null;
    this.reader = null;
    this.writer = null;
    this.buf = '';
    this.waiters = [];
    this.writing = Promise.resolve();
    this.frameBusy = false;
    this.enc = new TextEncoder();
  }

  get connected() { return !!this.writer; }

  async connect({ anyPort = true } = {}) {
    // Без фильтра: на некоторых Windows порт приходит без USB VID — выбираем сами в списке
    const filters = anyPort ? [] : [{ usbVendorId: ZMK_VID }];
    const port = await navigator.serial.requestPort({ filters });
    await this.open(port);
  }

  async open(port) {
    await port.open({ baudRate: 115200 });
    try { await port.setSignals({ dataTerminalReady: true, requestToSend: true }); } catch { /* не все порты */ }
    this.port = port;
    this.writer = port.writable.getWriter();
    this.readLoop();
    this.dispatchEvent(new Event('open'));
  }

  async readLoop() {
    const dec = new TextDecoder();
    while (this.port && this.port.readable) {
      this.reader = this.port.readable.getReader();
      try {
        for (;;) {
          const { value, done } = await this.reader.read();
          if (done) break;
          this.buf += dec.decode(value, { stream: true });
          let i;
          while ((i = this.buf.indexOf('\n')) >= 0) {
            const line = this.buf.slice(0, i).replace(/\r$/, '');
            this.buf = this.buf.slice(i + 1);
            if (line) this.onLine(line);
          }
        }
      } catch {
        break;
      } finally {
        try { this.reader.releaseLock(); } catch { /* уже отпущен */ }
      }
    }
    this.cleanup();
  }

  onLine(line) {
    this.dispatchEvent(new CustomEvent('line', { detail: line }));
    const w = this.waiters.find((x) => x.match(line));
    if (w) {
      this.waiters.splice(this.waiters.indexOf(w), 1);
      clearTimeout(w.timer);
      if (line.startsWith('ERR')) w.reject(new Error(line));
      else w.resolve(line);
    }
  }

  write(text) {
    if (!this.writer) return Promise.reject(new Error('Нет соединения'));
    this.dispatchEvent(new CustomEvent('tx', { detail: text }));
    const data = this.enc.encode(text + '\n');
    this.writing = this.writing.then(() => this.writer && this.writer.write(data)).catch(() => {});
    return this.writing;
  }

  /** Отправить команду и дождаться ответа (OK <cmd> / ERR / заданного префикса). */
  request(cmd, expect, timeout = 1500) {
    const word = cmd.split(' ')[0];
    const match = (l) => l.startsWith('ERR') || (expect ? l.startsWith(expect) : l === `OK ${word}`);
    return new Promise((resolve, reject) => {
      const w = { match, resolve, reject };
      w.timer = setTimeout(() => {
        this.waiters.splice(this.waiters.indexOf(w), 1);
        reject(new Error(`Нет ответа на «${cmd}»`));
      }, timeout);
      this.waiters.push(w);
      this.write(cmd).catch(reject);
    });
  }

  /** Кадр подсветки: если предыдущий ещё не ушёл — пропускаем. */
  sendFrame(hex) {
    if (!this.writer || this.frameBusy) return;
    this.frameBusy = true;
    const data = this.enc.encode(`LED FRAME ${hex}\n`);
    this.writing = this.writing
      .then(() => this.writer && this.writer.write(data))
      .catch(() => {})
      .finally(() => { this.frameBusy = false; });
  }

  /** Поток строк (картинки экрана): если предыдущая ещё не ушла — пропускаем. */
  sendStream(key, line) {
    this.busy = this.busy || {};
    if (!this.writer || this.busy[key]) return;
    this.busy[key] = true;
    const data = this.enc.encode(line + '\n');
    this.writing = this.writing
      .then(() => this.writer && this.writer.write(data))
      .catch(() => {})
      .finally(() => { this.busy[key] = false; });
  }

  async disconnect() {
    try { if (this.writer) { await this.write('LED FW'); await this.write('KEYS 0'); } } catch { /* */ }
    try { this.reader && (await this.reader.cancel()); } catch { /* */ }
    this.cleanup();
  }

  async cleanup() {
    const port = this.port;
    if (!port) return;
    this.port = null;
    try { this.writer && this.writer.releaseLock(); } catch { /* */ }
    this.writer = null;
    try { await port.close(); } catch { /* */ }
    this.waiters.forEach((w) => { clearTimeout(w.timer); w.reject(new Error('Соединение закрыто')); });
    this.waiters = [];
    this.dispatchEvent(new Event('close'));
  }
}

export function parseInfo(line) {
  const out = {};
  line.replace(/^INFO\s*/, '').split(' ').forEach((kv) => {
    const i = kv.indexOf('=');
    if (i > 0) out[kv.slice(0, i)] = kv.slice(i + 1);
  });
  return out;
}
