/**
 * Parla BT Ticket V2 — müşteri kodu ortak doğrulayıcısı (YON-08): biçim + tip öneki uyumu + benzersizlik + sıradaki kod önerisi.
 * Yeni firma oluşturan HER yer (Firmalar, Yeni Kullanıcı satır içi firma, Yeni Talep satır içi firma) bunu kullanmalıdır.
 */

const TYPES = ["CUS", "ARC"];
const NEW_CODE_RE = /^(CUS|ARC)\d{4}$/;

const norm = (v) => String(v == null ? "" : v).trim().toUpperCase();

/** Verilen tipe göre sıradaki boş müşteri kodu (CUS0001 …). */
export function suggestNextCode(type, companies) {
  const prefix = TYPES.includes(norm(type)) ? norm(type) : "CUS";
  const nums = (companies || [])
    .map((c) => norm(c.customer_code))
    .filter((code) => code.startsWith(prefix) && /^\d{4}$/.test(code.slice(3)))
    .map((code) => parseInt(code.slice(3), 10));
  const next = (nums.length ? Math.max(...nums) : 0) + 1;
  return `${prefix}${String(next).padStart(4, "0")}`;
}

/**
 * @param {{ code: string, type: string, companies: Array, excludeId?: string, keepLegacy?: string }} p
 *   excludeId: düzenlenen firma (kendi koduyla çakışma sayılmaz); keepLegacy: eski biçimli (3 harf+4 hane) mevcut kod — değişmediyse kabul
 * @returns {{ valid: boolean, error: string, code: string }}
 */
export function validateCustomerCode(p) {
  const code = norm(p.code);
  const type = norm(p.type);
  if (!code) return { valid: false, error: "Müşteri kodu zorunludur.", code };
  if (p.keepLegacy && code === norm(p.keepLegacy) && /^[A-Z]{3}\d{4}$/.test(code)) {
    return { valid: true, error: "", code }; // değişmemiş eski kod: yalnız benzersizlik aşağıda
  }
  if (!NEW_CODE_RE.test(code)) {
    return { valid: false, error: "Müşteri kodu CUS0001 ya da ARC0001 biçiminde olmalıdır.", code };
  }
  if (TYPES.includes(type) && !code.startsWith(type)) {
    return { valid: false, error: `${type} tipli firmanın kodu ${type} ile başlamalıdır.`, code };
  }
  const clash = (p.companies || []).find((c) => norm(c.customer_code) === code && (c.id || c.company_id) !== p.excludeId);
  if (clash) return { valid: false, error: `Bu müşteri kodu zaten "${clash.name || "başka bir firma"}" firmasında kullanılıyor.`, code };
  return { valid: true, error: "", code };
}
