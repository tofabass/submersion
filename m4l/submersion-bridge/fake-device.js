'use strict';
/* Stand-in for the Max device: same server, synthetic frames at 60/s.
   Usage: node fake-device.js [port]     (120 BPM: kick on the beat, hats on the off-beat, pad underneath) */
const { createBridge, DEFAULT_PORT } = require('./bridge-core');
const port = Number(process.argv[2]) || DEFAULT_PORT;
const bridge = createBridge({
  port,
  onStatus: (s, p) => console.log('status:', s, p),
  onClients: n => console.log('clients:', n),
});
bridge.start();

const BPM = 120, t0 = Date.now();
setInterval(() => {
  const beats = (Date.now() - t0) / 1000 * BPM / 60;
  const ph = beats % 1, offPh = (beats + 0.5) % 1;
  const kick = Math.exp(-ph * 6), hat = Math.exp(-offPh * 14) * 0.5, pad = 0.05 + 0.03 * Math.sin(beats);
  bridge.sendFrame({
    rms: 0.05 + kick * 0.25 + hat * 0.05,
    peak: 0.1 + kick * 0.7 + hat * 0.2,
    bands: [kick * 0.6 + pad, kick * 0.25 + pad, pad + hat * 0.04, hat * 0.12, hat * 0.2],
  });
}, 1000 / 60);
