/**
 * 并发节流队列：
 *  - 控制最多 N 个并发请求
 *  - 每个任务执行前 sleep random(delayMin, delayMax)
 *  - 支持暂停 / 恢复
 *  - 任务结果通过回调返回
 */

export class Scheduler {
  constructor({ concurrency, delayMinMs, delayMaxMs, onResult, onStatus }) {
    this.concurrency = Math.max(1, concurrency | 0);
    this.delayMinMs = Math.max(0, delayMinMs | 0);
    this.delayMaxMs = Math.max(this.delayMinMs, delayMaxMs | 0);
    this.queue = [];
    this.inflight = 0;
    this.paused = false;
    this.onResult = onResult || (() => {});
    this.onStatus = onStatus || (() => {});
    this.seen = new Set();
    this.totalEnqueued = 0;
    this.totalDone = 0;
  }

  configure(patch) {
    if (patch.concurrency != null) this.concurrency = Math.max(1, patch.concurrency | 0);
    if (patch.delayMinMs != null) this.delayMinMs = Math.max(0, patch.delayMinMs | 0);
    if (patch.delayMaxMs != null) this.delayMaxMs = Math.max(this.delayMinMs, patch.delayMaxMs | 0);
  }

  enqueue(task) {
    // task = { id, run: async () => result }
    if (this.seen.has(task.id)) return false;
    this.seen.add(task.id);
    this.queue.push(task);
    this.totalEnqueued++;
    this._emitStatus();
    this._drain();
    return true;
  }

  enqueueMany(tasks) {
    let n = 0;
    for (const t of tasks) {
      if (this.enqueue(t)) n++;
    }
    return n;
  }

  pause() { this.paused = true; this._emitStatus(); }
  resume() { this.paused = false; this._emitStatus(); this._drain(); }

  reset() {
    this.queue = [];
    this.seen.clear();
    this.totalEnqueued = 0;
    this.totalDone = 0;
    this._emitStatus();
  }

  status() {
    return {
      paused: this.paused,
      inflight: this.inflight,
      queued: this.queue.length,
      totalEnqueued: this.totalEnqueued,
      totalDone: this.totalDone,
      concurrency: this.concurrency,
      delayMinMs: this.delayMinMs,
      delayMaxMs: this.delayMaxMs
    };
  }

  _emitStatus() {
    try { this.onStatus(this.status()); } catch (_) {}
  }

  async _drain() {
    while (!this.paused && this.inflight < this.concurrency && this.queue.length > 0) {
      const task = this.queue.shift();
      this.inflight++;
      this._emitStatus();
      this._runOne(task);
    }
  }

  async _runOne(task) {
    try {
      const delay = this.delayMinMs + Math.floor(Math.random() * Math.max(1, this.delayMaxMs - this.delayMinMs + 1));
      await new Promise(r => setTimeout(r, delay));
      const result = await task.run();
      this.onResult(task.id, result, null);
    } catch (e) {
      this.onResult(task.id, null, e);
    } finally {
      this.inflight--;
      this.totalDone++;
      this._emitStatus();
      this._drain();
    }
  }
}
