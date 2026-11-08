'use strict';
/* Stand-in for the Max device: same server, synthetic frames at 60/s.
   Usage: node fake-device.js [port] [bpm]   (kick on the beat, hats on the off-beat, pad underneath; also sends a transport:
   tempo, beat position and play state, playing for 12 s then stopped for 4 s, repeating) */
const { createBridge, DEFAULT_PORT } = require('./bridge-core');
const port = Number(process.argv[2]) || DEFAULT_PORT;
const bridge = createBridge({
  port,
  onStatus: (s, p) => console.log('status:', s, p),
  onClients: n => console.log('clients:', n),
});
bridge.start();

const BPM = Number(process.argv[3]) || 120, t0 = Date.now();
let songBeat = 0, last = t0;
setInterval(() => {
  const now = Date.now(), cycle = ((now - t0) / 1000) % 16, playing = cycle < 12;
  if (playing) songBeat += (now - last) / 1000 * BPM / 60; last = now;
  const beats = songBeat;
  const ph = beats % 1, offPh = (beats + 0.5) % 1;
  const kick = Math.exp(-ph * 6), hat = Math.exp(-offPh * 14) * 0.5, pad = 0.05 + 0.03 * Math.sin(beats);
  bridge.sendFrame({
    rms: 0.05 + kick * 0.25 + hat * 0.05,
    peak: 0.1 + kick * 0.7 + hat * 0.2,
    bands: [kick * 0.6 + pad, kick * 0.25 + pad, pad + hat * 0.04, hat * 0.12, hat * 0.2],
    bpm: BPM, beat: songBeat, playing,
  });
}, 1000 / 60);
