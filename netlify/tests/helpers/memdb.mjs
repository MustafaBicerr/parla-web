/**
 * Test yardımcısı: window.__PARLA_FIREBASE için bellek içi Realtime Database taklidi.
 */
const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));

export function createMemDb(initial) {
  const state = { tree: clone(initial || {}), counter: 0, log: [] };

  const segs = (p) => String(p).split("/").filter(Boolean);
  const getAt = (p) => segs(p).reduce((a, k) => (a == null ? a : a[k]), state.tree);
  const setAt = (p, val) => {
    const parts = segs(p);
    if (!parts.length) { state.tree = clone(val) || {}; return; }
    let node = state.tree;
    parts.slice(0, -1).forEach((k) => {
      if (node[k] == null || typeof node[k] !== "object") node[k] = {};
      node = node[k];
    });
    const last = parts[parts.length - 1];
    if (val === null || val === undefined) delete node[last];
    else node[last] = clone(val);
  };
  const snap = (v) => ({
    exists: () => v != null,
    val: () => clone(v),
  });

  const db = {
    ref: (_database, path) => ({ path: segs(path).join("/") }),
    push: (r) => {
      state.counter += 1;
      const key = `k${String(state.counter).padStart(6, "0")}`;
      return { path: `${r.path}/${key}`, key };
    },
    set: async (r, v) => { state.log.push(["set", r.path]); setAt(r.path, v); },
    update: async (r, patch) => {
      state.log.push(["update", r.path, Object.keys(patch)]);
      Object.entries(patch).forEach(([k, v]) => setAt(`${r.path}/${k}`, v));
    },
    remove: async (r) => { state.log.push(["remove", r.path]); setAt(r.path, null); },
    get: async (r) => {
      let v = getAt(r.path);
      if (r.q && v && typeof v === "object") {
        let entries = Object.entries(v);
        if (r.q.orderByChild !== undefined && r.q.equalTo !== undefined) {
          entries = entries.filter(([, item]) => item && item[r.q.orderByChild] === r.q.equalTo);
        }
        if (r.q.orderByChild !== undefined && r.q.limitToLast) {
          entries.sort((a, b) => String(a[1]?.[r.q.orderByChild] ?? "").localeCompare(String(b[1]?.[r.q.orderByChild] ?? "")));
          entries = entries.slice(-r.q.limitToLast);
        } else if (r.q.limitToLast) {
          entries = entries.slice(-r.q.limitToLast);
        }
        v = Object.fromEntries(entries);
      }
      return snap(v);
    },
    query: (r, ...parts) => ({ path: r.path, q: Object.assign({}, r.q, ...parts) }),
    orderByChild: (f) => ({ orderByChild: f }),
    equalTo: (v) => ({ equalTo: v }),
    limitToLast: (n) => ({ limitToLast: n }),
    runTransaction: async (r, fn) => {
      const next = fn(getAt(r.path) ?? null);
      setAt(r.path, next);
      return { committed: true, snapshot: { val: () => next } };
    },
  };
  return { db, state, getAt, setAt };
}

export function installFirebase(mem, user) {
  globalThis.window = globalThis.window || {};
  window.__PARLA_FIREBASE = {
    database: {},
    app: { options: {} },
    auth: { currentUser: user || null },
    authFn: {},
    db: mem.db,
  };
}
