import { makeProofDrawing } from './cad-proof.mjs';

// Even a future library change cannot send drawings to a conversion server.
const denyNetwork = () => { throw new Error('Network processing is disabled in the CAD proof.'); };
self.fetch = denyNetwork;
self.XMLHttpRequest = class { constructor() { denyNetwork(); } };
self.WebSocket = class { constructor() { denyNetwork(); } };
self.importScripts = denyNetwork;

self.onmessage = event => {
  try {
    const result = makeProofDrawing(event.data, stage => self.postMessage({ stage }));
    self.postMessage({ result }, [result.bytes.buffer]);
  } catch (error) {
    self.postMessage({ error: String(error?.message ?? error) });
  }
};
