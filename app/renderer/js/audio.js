// Звук компьютера для эквалайзера: 14 полос (по колонкам клавиатуры), 0..1.

export const audio = { bands: new Array(14).fill(0), level: 0, running: false };
let ctx = null;
let stream = null;
let analyser = null;
let raf = 0;

export async function startAudio() {
  if (audio.running) return;
  stream = await navigator.mediaDevices.getDisplayMedia({ audio: true, video: true });
  stream.getVideoTracks().forEach((t) => t.stop());
  if (!stream.getAudioTracks().length) throw new Error('Звук компьютера недоступен');
  ctx = new AudioContext();
  const src = ctx.createMediaStreamSource(stream);
  analyser = ctx.createAnalyser();
  analyser.fftSize = 1024;
  analyser.smoothingTimeConstant = 0.7;
  src.connect(analyser);
  const data = new Uint8Array(analyser.frequencyBinCount);
  audio.running = true;
  const tick = () => {
    analyser.getByteFrequencyData(data);
    // Логарифмические полосы ~40 Гц … 12 кГц
    const nyq = ctx.sampleRate / 2;
    let sum = 0;
    for (let b = 0; b < 14; b++) {
      const f0 = 40 * Math.pow(300, b / 14), f1 = 40 * Math.pow(300, (b + 1) / 14);
      const i0 = Math.floor((f0 / nyq) * data.length), i1 = Math.max(i0 + 1, Math.floor((f1 / nyq) * data.length));
      let m = 0;
      for (let i = i0; i < i1 && i < data.length; i++) m = Math.max(m, data[i]);
      const v = m / 255;
      audio.bands[b] = Math.max(v, audio.bands[b] * 0.85);
      sum += v;
    }
    audio.level = sum / 14;
    raf = requestAnimationFrame(tick);
  };
  tick();
}

export function stopAudio() {
  cancelAnimationFrame(raf);
  if (stream) stream.getTracks().forEach((t) => t.stop());
  if (ctx) ctx.close();
  stream = null; ctx = null; analyser = null;
  audio.running = false;
  audio.bands.fill(0);
  audio.level = 0;
}
