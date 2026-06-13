/**
 * Parla BT Ticket V2 — telefon girişi (intl-tel-input CDN)
 */
const itiInstances = new WeakMap();
let loadPromise = null;

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
      link.href =
        "https://cdn.jsdelivr.net/npm/intl-tel-input@23.0.4/build/css/intlTelInput.css";
      link.dataset.itiCss = "1";
      document.head.appendChild(link);
    }
    const script = document.createElement("script");
    script.src =
      "https://cdn.jsdelivr.net/npm/intl-tel-input@23.0.4/build/js/intlTelInput.min.js";
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Telefon bileşeni yüklenemedi."));
    document.head.appendChild(script);
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
    utilsScript:
      "https://cdn.jsdelivr.net/npm/intl-tel-input@23.0.4/build/js/utils.js",
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
  return value;
}

export function isValidPhoneValue(value) {
  const v = String(value || "").replace(/[\s()-]/g, "");
  if (v.startsWith("+")) return v.length >= 11 && /^\+[\d]+$/.test(v);
  return v.length >= 10 && /^[\d]+$/.test(v);
}
