'use strict';
/* Mandalux bridge: local WebSocket server shared by the Max device (bridge.js)
   and the fake device (fake-device.js). No Max dependency in this file. */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');

const HOST = '127.0.0.1';
const DEFAULT_PORT = 8787;
const PROTOCOL = 1;
const BAND_EDGES_HZ = [150, 500, 2000, 6000];       // bass | low-mid | mid | high-mid | treble
const MAX_BUFFERED = 64 * 1024;                      // drop frames for a client that falls behind
/* Browsers always send Origin. Non-browser clients (no Origin header) are local processes. */
const ORIGIN_OK = /^(https:\/\/tofabass\.github\.io|http:\/\/(localhost|127\.0\.0\.1)(:\d+)?)$/;

const clamp01 = x => (Number.isFinite(x) ? Math.min(1, Math.max(0, x)) : 0);
/* linear amplitude -> 0..1 over a dB window (floorDb..0 dBFS) */
const norm = (a, floorDb) => clamp01((20 * Math.log10(Math.max(a, 1e-6)) - floorDb) / -floorDb);

function createBridge({ port = DEFAULT_PORT, onStatus = () => {}, onClients = () => {} } = {}) {
  let server = null, wss = null, state = 'stopped';
  let floorDb = -60;
  let lastPeak = 0, lastRms = 0;
  const setState = (s, detail) => { state = s; onStatus(s, detail === undefined ? port : detail); };

  function start() {
    if (server) return;
    server = http.createServer((req, res) => {
      if (req.url === '/' || req.url === '/test.html') {
        try {
          const html = fs.readFileSync(path.join(__dirname, 'test.html'));
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
          res.end(html);
        } catch (e) { res.writeHead(404); res.end('test.html not found'); }
      } else { res.writeHead(404); res.end(); }
    });
    wss = new WebSocketServer({
      server, perMessageDeflate: false, maxPayload: 1024,
      verifyClient: info => !info.origin || ORIGIN_OK.test(info.origin),
    });
    const me = wss;   // sockets can close after stop() has cleared the shared reference
    wss.on('connection', ws => {
      ws.send(JSON.stringify({ v: PROTOCOL, t: 'hello', app: 'submersion-bridge', rate: 60, edges: BAND_EDGES_HZ, clock: true }));
      ws.on('error', () => {});
      onClients(me.clients.size);
      ws.on('close', () => onClients(me.clients.size));
    });
    wss.on('error', () => {});
    server.on('error', err => {
      const inUse = err && err.code === 'EADDRINUSE';
      try { wss.close(); } catch (e) {}
      server = wss = null;
      setState(inUse ? 'port-in-use' : 'error');
    });
    server.listen(port, HOST, () => setState('listening'));
  }

  function stop() {
    if (!server) return;
    try { for (const c of wss.clients) c.terminate(); wss.close(); server.close(); } catch (e) {}
    server = wss = null; setState('stopped'); onClients(0);
  }

  /* raw = { rms, peak, bands:[5], bpm, beat, playing }: amplitudes are linear, straight from the MSP analysis */
  function sendFrame(raw) {
    if (!wss || wss.clients.size === 0) return;
    lastRms = norm(raw.rms, floorDb);
    const pk = norm(raw.peak, floorDb);
    lastPeak = Math.max(pk, lastPeak * 0.92);        // fast attack, short release
    const f = { v: PROTOCOL, t: 'f', ts: Date.now(),
      rms: +lastRms.toFixed(4), peak: +lastPeak.toFixed(4),
      bands: raw.bands.slice(0, 5).map(b => +norm(b, floorDb).toFixed(4)) };
    while (f.bands.length < 5) f.bands.push(0);
    /* Live's transport (optional): tempo in BPM, song position in beats (quarter notes), 1 while playing */
    const bpm = Number(raw.bpm), beat = Number(raw.beat);
    if (Number.isFinite(bpm) && bpm >= 20 && bpm <= 999 && Number.isFinite(beat) && Math.abs(beat) < 1e7){
      f.bpm = +bpm.toFixed(3); f.beat = +beat.toFixed(4); f.playing = raw.playing ? 1 : 0;
    }
    const msg = JSON.stringify(f);
    for (const c of wss.clients) if (c.readyState === 1 && c.bufferedAmount < MAX_BUFFERED) c.send(msg);
  }

  return { start, stop, sendFrame,
    setFloorDb: d => { if (Number.isFinite(d) && d <= -20 && d >= -96) floorDb = d; },
    get state() { return state; } };
}

module.exports = { createBridge, DEFAULT_PORT, HOST, BAND_EDGES_HZ };
