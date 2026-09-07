import { parentPort } from "node:worker_threads";
parentPort.postMessage({ ready: true });
parentPort.on("message", ({ id, job }) => {
  if (job.data[0] === 255) process.exit(7);
  if (job.data[0] === 254) {
    parentPort.postMessage({ id: -1 });
    return;
  }
  const counts = new Int32Array(job.counts);
  const active = Atomics.add(counts, 0, 1) + 1;
  let peak = Atomics.load(counts, 1);
  while (active > peak) {
    const old = Atomics.compareExchange(counts, 1, peak, active);
    if (old === peak) break;
    peak = old;
  }
  Atomics.wait(counts, 2, 0, job.delay ?? 30);
  Atomics.sub(counts, 0, 1);
  parentPort.postMessage({ id, data: job.data }, [job.data.buffer]);
});
