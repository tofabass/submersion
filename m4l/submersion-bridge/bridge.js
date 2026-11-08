'use strict';
/* node.script entry point for the Submersion Bridge Max for Live device.
   Max sends:   frame <rms> <peak> <b1> <b2> <b3> <b4> <b5>   (linear amplitudes, ~60/s)
                floor <dB>                                    (optional, default -60)
   Max receives: status <state> <port>   and   clients <n> */
const Max = require('max-api');
const { createBridge, DEFAULT_PORT } = require('./bridge-core');

const bridge = createBridge({
  port: DEFAULT_PORT,
  onStatus: (state, port) => Max.outlet('status', state === 'listening' ? 'listening on ' + port
    : state === 'port-in-use' ? 'port ' + port + ' in use' : state),
  onClients: n => Max.outlet('clients', n),
});

Max.addHandler('frame', (rms, peak, b1, b2, b3, b4, b5) =>
  bridge.sendFrame({ rms, peak, bands: [b1, b2, b3, b4, b5] }));
Max.addHandler('floor', d => bridge.setFloorDb(Number(d)));

bridge.start();
process.on('exit', () => bridge.stop());
