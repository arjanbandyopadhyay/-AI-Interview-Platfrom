// Small in-memory stand-ins for Express req/res and Mongoose models, used by the unit tests.
// Every database call first yields to the event loop (like a real network round-trip) and then
// applies its read/modify/write synchronously, which is how MongoDB's single-document atomic
// operations behave. That makes check-then-act races in controllers visible in tests.

const tick = () => new Promise((resolve) => setImmediate(resolve));
const clone = (v) => (v === undefined ? v : structuredClone(v));

export const oid = (n) => String(n).padStart(24, "0"); // valid 24-hex ObjectId-looking string

export function makeRes() {
  return {
    statusCode: 200,
    body: undefined,
    headers: {},
    cookies: {},
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
    set(k, v) { this.headers[k] = v; return this; },
    cookie(name, value, options) { this.cookies[name] = { value, options }; return this; },
  };
}

function matches(doc, filter) {
  return Object.entries(filter).every(([key, cond]) => {
    const value = doc[key];
    if (cond && typeof cond === "object" && !Array.isArray(cond)) {
      if ("$gte" in cond) return value >= cond.$gte;
      return false;
    }
    return String(value) === String(cond);
  });
}

function applyUpdate(doc, update) {
  for (const [k, v] of Object.entries(update.$inc ?? {})) doc[k] = (doc[k] ?? 0) + v;
  for (const [k, v] of Object.entries(update.$set ?? {})) doc[k] = v;
  for (const k of Object.keys(update.$unset ?? {})) delete doc[k];
}

export class FakeModel {
  constructor({ defaults = {}, failNextUpdate = false } = {}) {
    this.docs = [];
    this.defaults = defaults;
    this.seq = 0;
    this.failNextUpdate = failNextUpdate;
  }
  _live(doc) {
    // a copy with a Mongoose-like save() that writes back into the store
    const store = this;
    const copy = clone(doc);
    Object.defineProperty(copy, "save", {
      enumerable: false,
      value: async () => { await tick(); const i = store.docs.findIndex((d) => d._id === copy._id); store.docs[i] = clone(copy); return copy; },
    });
    return copy;
  }
  seed(doc) { const d = { _id: oid(++this.seq), ...this.defaults, ...clone(doc) }; this.docs.push(d); return d; }
  async create(doc) { await tick(); return this._live(this.seed(doc)); }
  // Mongoose queries are awaitable and chainable (.select(), .sort()); mimic just enough of that.
  _query(promise) { promise.select = () => promise; promise.sort = () => promise; return promise; }
  findOne(filter) {
    return this._query((async () => { await tick(); const d = this.docs.find((x) => matches(x, filter)); return d ? this._live(d) : null; })());
  }
  findById(id) { return this.findOne({ _id: id }); }
  find(filter = {}) {
    return this._query((async () => { await tick(); return this.docs.filter((x) => matches(x, filter)).map((d) => this._live(d)); })());
  }
  async exists(filter) { await tick(); const d = this.docs.find((x) => matches(x, filter)); return d ? { _id: d._id } : null; }
  async findOneAndUpdate(filter, update, opts = {}) {
    await tick();
    const d = this.docs.find((x) => matches(x, filter));
    if (!d) return null;
    const before = clone(d);
    applyUpdate(d, update);
    return clone(opts.new || opts.returnDocument === "after" ? d : before);
  }
  async findByIdAndUpdate(id, update, opts) {
    if (this.failNextUpdate) { this.failNextUpdate = false; throw new Error("simulated database failure"); }
    return this.findOneAndUpdate({ _id: id }, update, opts);
  }
  async updateOne(filter, update) {
    await tick();
    const d = this.docs.find((x) => matches(x, filter));
    if (d) applyUpdate(d, update);
    return { matchedCount: d ? 1 : 0 };
  }
}
