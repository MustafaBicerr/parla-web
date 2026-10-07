/**
 * Hız sınırı / kota / olay tekilleştirme için küçük anahtar-değer deposu (soyut arayüz).
 *
 * Arayüz (hepsi async):
 *   get(key)                         -> değer | null (süresi dolmuşsa null)
 *   set(key, value, { ttlMs })       -> void
 *   delete(key)                      -> void
 *   update(key, mutator, { ttlMs })  -> mutator'ın `result` değeri
 *        mutator(current|null) => { value, result }   (yaz)  ya da  { skip: true, result }   (yazma)
 *        Okuma-değiştirme-yazma "karşılaştır ve yaz" ile korunur (Blobs: ETag; bellek: tek iş parçacığı).
 *   list(prefix)                     -> [key]
 *
 * Uygulamalar:
 *   - MemoryStore: yerel geliştirme/test ve yedek (bir function örneği ömrü boyunca; örnekler arası paylaşılmaz).
 *   - Netlify Blobs (@netlify/blobs): üretim. Lambda-uyumlu function'larda `connectLambda(event)` gerekir.
 *   - ResilientStore: birincil depo hata verirse bellek deposuna düşer (kötü niyetli kullanımı tamamen
 *     denetimsiz bırakmamak için "açık" değil "bozulmuş" mod; hata günlüğe yazılır).
 *
 * Depoya yalnızca sayaç/zaman damgası/olay anahtarı yazılır; kişisel veri (e-posta adresi, mesaj metni) YAZILMAZ.
 * (Tek istisna: günlük özet kayıtları — talep no + başlık kısaltması; bkz. email-guard.js.)
 */

const CAS_ATTEMPTS = 10;

function jitter() {
  return new Promise((resolve) => setTimeout(resolve, 5 + Math.floor(Math.random() * 25)));
}

function clone(value) {
  return value === undefined ? null : JSON.parse(JSON.stringify(value));
}

class MemoryStore {
  constructor() {
    this.kind = "memory";
    this.map = new Map();
  }

  _live(key) {
    const entry = this.map.get(key);
    if (!entry) return null;
    if (entry.exp && entry.exp <= Date.now()) {
      this.map.delete(key);
      return null;
    }
    return entry;
  }

  async get(key) {
    const entry = this._live(key);
    return entry ? clone(entry.value) : null;
  }

  async set(key, value, options) {
    const ttlMs = options && options.ttlMs;
    this.map.set(key, { value: clone(value), exp: ttlMs ? Date.now() + ttlMs : 0 });
  }

  async delete(key) {
    this.map.delete(key);
  }

  async update(key, mutator, options) {
    // await içermediği için okuma-yazma arasında başka istek araya giremez.
    const entry = this._live(key);
    const out = mutator(entry ? clone(entry.value) : null);
    if (out && out.skip) return out.result;
    const ttlMs = options && options.ttlMs;
    this.map.set(key, { value: clone(out.value), exp: ttlMs ? Date.now() + ttlMs : 0 });
    return out.result;
  }

  async list(prefix) {
    const keys = [];
    for (const key of [...this.map.keys()]) {
      if (key.startsWith(prefix) && this._live(key)) keys.push(key);
    }
    return keys;
  }
}

/** @netlify/blobs sarmalayıcısı. Değerler { v, exp } zarfı içinde saklanır (Blobs'ta TTL yok). */
class BlobsStore {
  constructor(store) {
    this.kind = "blobs";
    this.store = store;
  }

  static _alive(envelope) {
    return envelope && typeof envelope === "object" && (!envelope.exp || envelope.exp > Date.now());
  }

  async get(key) {
    const envelope = await this.store.get(key, { type: "json" });
    return BlobsStore._alive(envelope) ? envelope.v : null;
  }

  async set(key, value, options) {
    const ttlMs = options && options.ttlMs;
    await this.store.setJSON(key, { v: value, exp: ttlMs ? Date.now() + ttlMs : 0 });
  }

  async delete(key) {
    await this.store.delete(key);
  }

  async update(key, mutator, options) {
    const ttlMs = options && options.ttlMs;
    for (let attempt = 0; attempt < CAS_ATTEMPTS; attempt += 1) {
      const current = await this.store.getWithMetadata(key, { type: "json" });
      const alive = current && BlobsStore._alive(current.data);
      const out = mutator(alive ? current.data.v : null);
      if (out && out.skip) return out.result;
      const envelope = { v: out.value, exp: ttlMs ? Date.now() + ttlMs : 0 };
      const written = current
        ? await this.store.setJSON(key, envelope, { onlyIfMatch: current.etag })
        : await this.store.setJSON(key, envelope, { onlyIfNew: true });
      if (written && written.modified) return out.result;
      await jitter(); // çakışan yazarlar aynı anda yeniden denemesin
    }
    // Aşırı çekişme: son yazan kazanır (sayaçlar yaklaşık değerdir; güvenlik sınırı için yeterli).
    const current = await this.store.get(key, { type: "json" });
    const out = mutator(BlobsStore._alive(current) ? current.v : null);
    if (out && out.skip) return out.result;
    await this.store.setJSON(key, { v: out.value, exp: ttlMs ? Date.now() + ttlMs : 0 });
    return out.result;
  }

  async list(prefix) {
    const keys = [];
    const page = await this.store.list({ prefix });
    (page.blobs || []).forEach((b) => keys.push(b.key));
    return keys;
  }
}

/** Birincil depo hata verirse (Blobs kapalı/yanlış yapılandırılmış) bellek yedeğine düşer. */
class ResilientStore {
  constructor(primary, fallback) {
    this.kind = `${primary.kind}+fallback`;
    this.primary = primary;
    this.fallback = fallback;
    this._warned = false;
  }

  async _run(op, args) {
    try {
      return await this.primary[op](...args);
    } catch (err) {
      if (!this._warned) {
        this._warned = true;
        console.error("[send-email] koruma deposu kullanılamıyor, bellek yedeğine geçildi", {
          op,
          msg: err && err.message,
        });
      }
      return this.fallback[op](...args);
    }
  }

  get(...args) {
    return this._run("get", args);
  }
  set(...args) {
    return this._run("set", args);
  }
  delete(...args) {
    return this._run("delete", args);
  }
  update(...args) {
    return this._run("update", args);
  }
  list(...args) {
    return this._run("list", args);
  }
}

let cached = null;
let injected = null;
const memoryFallback = new MemoryStore();

/** Testlerde belirli bir depoyu zorlamak için (null: sıfırla). */
function setStoreForTests(store) {
  injected = store;
  cached = null;
}

/**
 * Bu istek için depoyu döndürür. Üretimde (Lambda uyumlu function) `event.blobs` vardır ve Blobs kullanılır;
 * yerelde / testlerde bellek deposu. `GUARD_STORE=memory` her koşulda belleği zorlar.
 *
 * `options.blobs`: `@netlify/blobs` modülü. Çağıran function dosyası (netlify/functions/*) yükler; çünkü bağımlılık
 * `netlify/functions/package.json` altında kurulur ve esbuild çözümlemesi `netlify/lib` içinden orayı görmez.
 */
function getGuardStore(event, options) {
  if (injected) return injected;
  if (String(process.env.GUARD_STORE || "").toLowerCase() === "memory") return memoryFallback;
  // `native`: Functions v2 (zamanlanmış işlev vb.) — Blobs bağlamı çalışma zamanından otomatik gelir.
  const native = Boolean(options && options.native);
  if (native || (event && event.blobs)) {
    const blobs = options && options.blobs;
    if (blobs) {
      try {
        // Lambda uyumlu function'larda her çağrıda bağlam (token) event'ten yenilenmelidir.
        if (!native) blobs.connectLambda(event);
        if (!cached) {
          cached = new ResilientStore(
            new BlobsStore(blobs.getStore({ name: "email-guard", consistency: "strong" })),
            memoryFallback
          );
        }
        return cached;
      } catch (err) {
        console.error("[send-email] Blobs başlatılamadı", { msg: err && err.message });
      }
    }
  }
  return memoryFallback;
}

module.exports = { MemoryStore, BlobsStore, ResilientStore, getGuardStore, setStoreForTests };
