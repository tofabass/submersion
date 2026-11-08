'use strict';
/* Automated checks for the bridge server (no Max or browser needed): node selftest.js */
const http = require('http');
const WebSocket = require('ws');
const { createBridge } = require('./bridge-core');

const PORT = 18787;
let failed = 0;
const ok = (cond, msg) => { console.log((cond ? 'PASS ' : 'FAIL ') + msg); if (!cond) failed = 1; };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const connect = (origin) => new Promise(res => {
  const ws = new WebSocket('ws://127.0.0.1:' + PORT, origin ? { origin } : {});
  const got = { ws, msgs: [], opened: false };
  ws.on('open', () => { got.opened = true; });
  ws.on('message', d => got.msgs.push(JSON.parse(d)));
  ws.on('error', () => {});
  ws.on('close', () => res(got)); ws.on('unexpected-response', () => res(got));
  setTimeout(() => res(got), 1500);
});

(async () => {
  let clients = 0, status = '';
  const b = createBridge({ port: PORT, onStatus: s => { status = s; }, onClients: n => { clients = n; } });
  b.start(); await sleep(200);
  ok(status === 'listening', 'server listens');

  // second instance on the same port reports "port-in-use" and does not crash
  let status2 = '';
  const b2 = createBridge({ port: PORT, onStatus: s => { status2 = s; } });
  b2.start(); await sleep(200);
  ok(status2 === 'port-in-use', 'second instance reports port-in-use');

  // hostile origin is rejected, allowed origins and no origin are accepted
  const bad = await connect('https://evil.example');
  ok(!bad.opened, 'foreign origin rejected');
  const good = []; for (const o of ['https://tofabass.github.io', 'http://localhost:8787', undefined]) {
    const ws = new WebSocket('ws://127.0.0.1:' + PORT, o ? { origin: o } : {});
    ws.on('error', () => {}); good.push(ws);
  }
  await sleep(300);
  ok(good.every(w => w.readyState === 1), 'allowed origins and local clients accepted');
  ok(clients === 3, 'client count is 3 (got ' + clients + ')');

  // frame rate and content: send 60/s for 2 s from an interval, count on a client
  const c = []; good[0].on('message', d => c.push(JSON.parse(d)));
  const iv = setInterval(() => b.sendFrame({ rms: 0.1, peak: 0.5, bands: [0.5, 0.1, 0.01, 0.001, 0] }), 1000 / 60);
  await sleep(2000); clearInterval(iv);
  const fr = c.filter(m => m.t === 'f');
  ok(fr.length >= 100 && fr.length <= 125, 'about 60 frames per second (got ' + fr.length / 2 + ')');
  const f = fr[fr.length - 1];
  ok(f && f.bands.length === 5 && [f.rms, f.peak, ...f.bands].every(x => x >= 0 && x <= 1), 'frame has 5 bands, all values within 0-1');
  ok(f && f.bands[0] > f.bands[1] && f.bands[1] > f.bands[2] && f.bands[4] === 0, 'dB scaling keeps band order, silence is 0');
  ok(fr.length && fr[0].v === 1 && typeof fr[0].ts === 'number', 'frame carries protocol version and timestamp');

  // Live transport fields: hello announces the clock, valid values pass through, junk is dropped
  ok(good[0].readyState === 1, 'client still open before clock checks');
  const hc = await connect(undefined); hc.ws.close(); const hello = hc.msgs[0];
  ok(hello && hello.t === 'hello' && hello.clock === true, 'hello announces clock support');
  c.length = 0;
  b.sendFrame({ rms: 0.1, peak: 0.1, bands: [0, 0, 0, 0, 0], bpm: 128.12345, beat: 17.123456, playing: 1 });
  b.sendFrame({ rms: 0.1, peak: 0.1, bands: [0, 0, 0, 0, 0], bpm: 0, beat: 4, playing: 1 });
  b.sendFrame({ rms: 0.1, peak: 0.1, bands: [0, 0, 0, 0, 0], bpm: 'x', beat: NaN, playing: 1 });
  b.sendFrame({ rms: 0.1, peak: 0.1, bands: [0, 0, 0, 0, 0], bpm: 120, beat: 2, playing: 0 });
  b.sendFrame({ rms: 0.1, peak: 0.1, bands: [0, 0, 0, 0, 0] });
  await sleep(200);
  const cf = c.filter(m => m.t === 'f');
  ok(cf.length === 5, 'five clock test frames arrived');
  ok(cf[0] && cf[0].bpm === 128.123 && cf[0].beat === 17.1235 && cf[0].playing === 1, 'valid tempo, beat and playing pass through, rounded');
  ok(cf[1] && cf[2] && cf[4] && !('bpm' in cf[1]) && !('bpm' in cf[2]) && !('bpm' in cf[4]), 'zero, junk and missing tempo are left out');
  ok(cf[3] && cf[3].playing === 0 && cf[3].bpm === 120, 'stopped transport sends playing 0');

  // test page is served
  const page = await new Promise(r => http.get('http://127.0.0.1:' + PORT + '/', res => { let s = ''; res.on('data', d => s += d); res.on('end', () => r({ code: res.statusCode, s })); }));
  ok(page.code === 200 && page.s.includes('Bridge test'), 'test page served at /');

  // clients leaving updates the count
  good.forEach(w => w.close()); await sleep(300);
  ok(clients === 0, 'client count returns to 0');

  b.stop(); await sleep(100);
  ok(status === 'stopped', 'stops cleanly');
  console.log(failed ? 'selftest: FAILED' : 'selftest: passed');
  process.exit(failed);
})();
