"use strict";

const { Atomics, workerData } = require("node:worker_threads");
const http = require("node:http");

const { sab, port, url, path, tokenHeader, token, body, timeoutMs } = workerData;
const slot = new Int32Array(sab);

function postJson(targetUrl, headers, payload, timeout) {
  return new Promise((resolve) => {
    const endpoint = new URL(path, targetUrl);
    const requestBody = JSON.stringify(payload);
    const req = http.request({
      hostname: endpoint.hostname,
      port: endpoint.port,
      path: endpoint.pathname,
      method: "POST",
      headers: {
        ...headers,
        "content-type": "application/json",
        "content-length": Buffer.byteLength(requestBody),
      },
      timeout,
    }, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf8");
        let parsed = {};
        if (text.length > 0) {
          try { parsed = JSON.parse(text); } catch { parsed = {}; }
        }
        resolve({ status: res.statusCode ?? 0, body: parsed });
      });
    });
    req.on("timeout", () => {
      req.destroy();
      resolve({ status: 0, body: {} });
    });
    req.on("error", () => resolve({ status: 0, body: {} }));
    req.write(requestBody);
    req.end();
  });
}

void postJson(url, { [tokenHeader]: token, accept: "application/json" }, body, timeoutMs)
  .then((result) => {
    port.postMessage(result);
    Atomics.store(slot, 0, 1);
    Atomics.notify(slot, 0, 1);
  })
  .catch(() => {
    port.postMessage({ status: 0, body: {} });
    Atomics.store(slot, 0, 1);
    Atomics.notify(slot, 0, 1);
  });
