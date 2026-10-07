/**
 * Parla BT Ticket V2 — telefon girişi (intl-tel-input CDN)
 */
const itiInstances = new WeakMap();
let loadPromise = null;

// Alt kaynak bütünlüğü (SRI, ALT-03/SEC): sürüm sabit (23.0.4); özetler npm kayıt defterindeki paketten (npm pack) hesaplandı
// ve jsDelivr kopyasıyla birebir eşleştiği doğrulandı. Sürüm değişirse özetleri yenileyin: docs/runbook.md §"SRI özetlerini yenileme".
// utils.js (utilsScript) kütüphane tarafından yüklenir; SRI eklenemez (yalnızca telefon doğrulama yardımcısıdır).
const ITI_BASE = "https://cdn.jsdelivr.net/npm/intl-tel-input@23.0.4/build/";
const ITI_CSS_SRI = "sha384-WF0RAt8MGisWNsxq/lbm1i7nz61PKrW8z1neNPIJLbwqtsftpz3/xHsl/of5T8RR";
const ITI_JS_SRI = "sha384-OEti0Km7w2zVOhl3/8EikwWvAzlM4eJLA+qLHDv8tQUqHeAnZ2FqhfVfX/9RbELY";

function loadIntlTelInput() {
  if (loadPromise) return loadPromise;
  loadPromise = new Promise((resolve, reject) => {
    if (window.intlTelInput) {
      resolve();
      return;
    }
    if (!document.querySelector('link[data-iti-css]')) {
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = ITI_BASE + "css/intlTelInput.css";
      link.integrity = ITI_CSS_SRI;
      link.crossOrigin = "anonymous";
      link.dataset.itiCss = "1";
      document.head.appendChild(link);
    }
    const script = document.createElement("script");
    script.src = ITI_BASE + "js/intlTelInput.min.js";
    script.integrity = ITI_JS_SRI;
    script.crossOrigin = "anonymous";
    const timer = setTimeout(() => reject(new Error("Telefon bileşeni zamanında yüklenemedi.")), 15000);
    script.onload = () => {
      clearTimeout(timer);
      if (typeof window.intlTelInput === "function") resolve();
      else reject(new Error("Telefon bileşeni eksik yüklendi."));
    };
    script.onerror = () => {
      clearTimeout(timer);
      reject(new Error("Telefon bileşeni yüklenemedi."));
    };
    document.head.appendChild(script);
  });
  // Başarısız yükleme önbelleğe alınmaz: bağlantı düzelince yeniden denenebilir.
  loadPromise = loadPromise.catch((err) => {
    loadPromise = null;
    throw err;
  });
  return loadPromise;
}

export async function initPhoneInput(inputEl, options = {}) {
  if (!inputEl) return null;
  if (itiInstances.has(inputEl)) return itiInstances.get(inputEl);

  await loadIntlTelInput();
  const iti = window.intlTelInput(inputEl, {
    initialCountry: options.initialCountry || "tr",
    preferredCountries: ["tr", "de", "gb", "us", "nl", "fr"],
    separateDialCode: true,
    nationalMode: true,
    utilsScript: ITI_BASE + "js/utils.js",
  });
  itiInstances.set(inputEl, iti);
  return iti;
}

export function getPhoneInstance(inputEl) {
  return itiInstances.get(inputEl) || null;
}

export function normalizePhone(inputEl) {
  const iti = itiInstances.get(inputEl);
  if (iti) {
    if (iti.isValidNumber()) return iti.getNumber();
    const raw = String(inputEl.value || "").trim().replace(/\s/g, "");
    if (raw.startsWith("+")) return raw;
    const dial = iti.getSelectedCountryData()?.dialCode;
    if (dial && raw) return `+${dial}${raw.replace(/^0+/, "")}`;
  }
  return String(inputEl?.value || "").trim().replace(/[\s()-]/g, "");
}

export function setPhoneValue(inputEl, e164) {
  if (!inputEl || !e164) return;
  const iti = itiInstances.get(inputEl);
  if (iti) {
    iti.setNumber(String(e164));
  } else {
    inputEl.value = e164;
  }
}

export function formatPhoneDisplay(value) {
  if (!value) return "—";
  const v = String(value).replace(/[\s()-]/g, "");
  if (v.startsWith("+90") && v.length >= 12) {
    const rest = v.slice(3);
    return `+90 ${rest.slice(0, 3)} ${rest.slice(3, 6)} ${rest.slice(6, 8)} ${rest.slice(8)}`.trim();
  }
  if (v.startsWith("+") && v.length > 4) {
    return v.replace(/(\+\d{1,3})(\d{3})(\d{3})(\d+)/, "$1 $2 $3 $4").trim();
  }
  return String(value);
}

export function isValidPhoneValue(value) {
  const v = String(value || "").replace(/[\s()-]/g, "");
  if (v.startsWith("+")) return v.length >= 11 && /^\+[\d]+$/.test(v);
  return v.length >= 10 && /^[\d]+$/.test(v);
}
