/**
 * Sahte Admin uygulaması (netlify/lib/admin.js arayüzü): bellek içi RTDB (kuralsız) + bellek içi Auth.
 * Hata enjeksiyonu: `admin.failures.push({ op: "db.set"|"db.update"|"auth.createUser"|..., match?: (args)=>bool, error?: Error, times?: number })`.
 */
const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));

function createFakeAdmin(initialDb, options) {
  const opts = options || {};
  const state = {
    tree: clone(initialDb || {}),
    users: new Map(), // uid -> { uid, email, disabled, password, createdAt, validSince }
    calls: [],
    failures: [],
    keySeq: 0,
    now: opts.now || (() => Date.now()),
  };

  const segs = (p) => String(p).split("/").filter(Boolean);
  const getAt = (p) => segs(p).reduce((a, k) => (a == null ? a : a[k]), state.tree);
  const setAt = (p, val) => {
    const parts = segs(p);
    if (!parts.length) {
      state.tree = clone(val) || {};
      return;
    }
    let node = state.tree;
    parts.slice(0, -1).forEach((k) => {
      if (node[k] == null || typeof node[k] !== "object") node[k] = {};
      node = node[k];
    });
    const last = parts[parts.length - 1];
    if (val === null || val === undefined) delete node[last];
    else node[last] = clone(val);
  };

  function maybeFail(op, args) {
    state.calls.push({ op, args: clone(args) });
    const idx = state.failures.findIndex((f) => f.op === op && (!f.match || f.match(args)));
    if (idx >= 0) {
      const f = state.failures[idx];
      if (f.times != null) {
        f.times -= 1;
        if (f.times <= 0) state.failures.splice(idx, 1);
      }
      throw f.error || Object.assign(new Error(`enjekte hata: ${op}`), { code: "injected" });
    }
  }

  const db = {
    async get(path, q) {
      maybeFail("db.get", [path, q]);
      let v = getAt(path);
      if (v === undefined) v = null;
      if (v && typeof v === "object" && q) {
        if (q.shallow) return Object.fromEntries(Object.keys(v).map((k) => [k, true]));
        let entries = Object.entries(v);
        if (q.orderBy && q.orderBy !== "$key" && q.equalTo !== undefined) {
          entries = entries.filter(([, item]) => item && typeof item === "object" && item[q.orderBy] === q.equalTo);
        }
        if (q.orderBy && q.limitToLast) {
          const field = q.orderBy;
          entries.sort((a, b) =>
            field === "$key" ? (a[0] < b[0] ? -1 : 1) : String(a[1] && a[1][field]).localeCompare(String(b[1] && b[1][field]))
          );
          entries = entries.slice(-q.limitToLast);
        }
        v = entries.length ? Object.fromEntries(entries) : null;
      }
      return clone(v);
    },
    async set(path, value) {
      maybeFail("db.set", [path, value]);
      setAt(path, value);
    },
    async update(path, patch) {
      maybeFail("db.update", [path, patch]);
      Object.entries(patch || {}).forEach(([k, v]) => setAt(`${path}/${k}`, v));
    },
    async remove(path) {
      maybeFail("db.remove", [path]);
      setAt(path, null);
    },
    newKey() {
      state.keySeq += 1;
      return `-K${String(state.keySeq).padStart(8, "0")}`;
    },
  };

  let uidSeq = 0;
  const publicUser = (u) => (u ? { uid: u.uid, email: u.email, disabled: u.disabled, createdAt: u.createdAt } : null);
  const auth = {
    async getUser(uid) {
      maybeFail("auth.getUser", [uid]);
      return publicUser(state.users.get(uid));
    },
    async getUserByEmail(email) {
      maybeFail("auth.getUserByEmail", [email]);
      const e = String(email || "").trim().toLowerCase();
      return publicUser([...state.users.values()].find((u) => u.email === e));
    },
    async createUser(input) {
      maybeFail("auth.createUser", [{ ...input, password: "***" }]);
      const email = String(input.email).trim().toLowerCase();
      if ([...state.users.values()].some((u) => u.email === email)) {
        throw Object.assign(new Error("EMAIL_EXISTS"), { code: "email_exists", status: 409 });
      }
      uidSeq += 1;
      const uid = `auth-${uidSeq}`;
      state.users.set(uid, { uid, email, disabled: input.disabled === true, password: input.password, createdAt: new Date(state.now()).toISOString(), validSince: 0 });
      return { uid, email };
    },
    async updateUser(uid, patch) {
      maybeFail("auth.updateUser", [uid, { ...patch, password: patch.password ? "***" : undefined }]);
      const u = state.users.get(uid);
      if (!u) throw Object.assign(new Error("USER_NOT_FOUND"), { code: "user_not_found", status: 404 });
      if (patch.disabled !== undefined) u.disabled = patch.disabled === true;
      if (patch.password) u.password = patch.password;
    },
    async deleteUser(uid) {
      maybeFail("auth.deleteUser", [uid]);
      if (!state.users.delete(uid)) throw Object.assign(new Error("USER_NOT_FOUND"), { code: "user_not_found", status: 404 });
    },
    async revokeRefreshTokens(uid) {
      maybeFail("auth.revokeRefreshTokens", [uid]);
      const u = state.users.get(uid);
      if (!u) throw Object.assign(new Error("USER_NOT_FOUND"), { code: "user_not_found", status: 404 });
      u.validSince = Math.floor(state.now() / 1000);
    },
    async generatePasswordResetLink(email, linkOptions) {
      maybeFail("auth.generatePasswordResetLink", [email, linkOptions]);
      const e = String(email || "").trim().toLowerCase();
      if (![...state.users.values()].some((u) => u.email === e)) {
        throw Object.assign(new Error("EMAIL_NOT_FOUND"), { code: "user_not_found", status: 404 });
      }
      const oobCode = `OOB-${Buffer.from(e).toString("hex").slice(0, 12)}-${state.calls.length}`;
      return { link: `https://parla-bt-web.firebaseapp.com/__/auth/action?mode=resetPassword&oobCode=${oobCode}&apiKey=x&lang=en`, oobCode };
    },
    async listUsers(listOptions) {
      maybeFail("auth.listUsers", [listOptions]);
      return { users: [...state.users.values()].map(publicUser), nextPageToken: "" };
    },
  };

  /** Auth hesabı ekler (profilsiz = yetim hesap). */
  function addAuthUser(uid, email, extra) {
    state.users.set(uid, { uid, email: String(email).toLowerCase(), disabled: false, password: "eski-parola", createdAt: new Date(state.now()).toISOString(), validSince: 0, ...(extra || {}) });
  }

  return { projectId: "parla-bt-web", db, auth, state, getAt, setAt, addAuthUser, failures: state.failures };
}

module.exports = { createFakeAdmin };
