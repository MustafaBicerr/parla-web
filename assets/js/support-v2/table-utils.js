/**
 * Parla BT Ticket V2 — liste yardımcıları: sıralama, sayfalama, debounce ve sütun başlığı sıralaması.
 * Saf işlevler birim testlenir; DOM yardımcısı yalnız tarayıcıda çağrılır.
 */

const collator = new Intl.Collator("tr", { sensitivity: "base", numeric: true });

/** Karşılaştırma: boş değerler sonda; sayılar sayısal; ISO tarih dizeleri zamansal; diğerleri Türkçe sırayla. */
export function compareValues(a, b) {
  const aEmpty = a === null || a === undefined || a === "";
  const bEmpty = b === null || b === undefined || b === "";
  if (aEmpty && bEmpty) return 0;
  if (aEmpty) return 1;
  if (bEmpty) return -1;
  if (typeof a === "number" && typeof b === "number") return a - b;
  if (typeof a === "boolean" && typeof b === "boolean") return Number(a) - Number(b);
  return collator.compare(String(a), String(b));
}

/**
 * @param {object[]} rows
 * @param {{key?: string, dir?: "asc"|"desc"}} sort
 * @param {Record<string, (row: object) => any>} [accessors] anahtar → sıralama değeri
 */
export function sortRows(rows, sort, accessors) {
  if (!sort || !sort.key) return [...rows];
  const get = (accessors && accessors[sort.key]) || ((r) => r[sort.key]);
  const factor = sort.dir === "desc" ? -1 : 1;
  return rows
    .map((row, i) => ({ row, i, v: get(row) }))
    .sort((x, y) => {
      const aEmpty = x.v === null || x.v === undefined || x.v === "";
      const bEmpty = y.v === null || y.v === undefined || y.v === "";
      // Boşlar yönden bağımsız hep sonda
      if (aEmpty !== bEmpty) return aEmpty ? 1 : -1;
      return compareValues(x.v, y.v) * factor || x.i - y.i;
    })
    .map((x) => x.row);
}

export function paginateRows(rows, page, pageSize) {
  const size = Math.max(1, pageSize || 25);
  const total = rows.length;
  const totalPages = Math.max(1, Math.ceil(total / size));
  const p = Math.min(Math.max(1, page || 1), totalPages);
  return { rows: rows.slice((p - 1) * size, p * size), page: p, totalPages, total, pageSize: size };
}

/** Son çağrıdan `ms` sonra çalışır; `cancel()` bekleyeni iptal eder. */
export function debounce(fn, ms) {
  let timer = null;
  const wrapped = (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      fn(...args);
    }, ms);
  };
  wrapped.cancel = () => {
    clearTimeout(timer);
    timer = null;
  };
  wrapped.flush = (...args) => {
    clearTimeout(timer);
    timer = null;
    fn(...args);
  };
  return wrapped;
}

/** Sıralama durumunu bir sütun tıklamasına göre günceller (asc → desc → asc). */
export function nextSort(current, key, defaultDir) {
  if (current && current.key === key) return { key, dir: current.dir === "asc" ? "desc" : "asc" };
  return { key, dir: defaultDir || "asc" };
}

/**
 * `renderDataTable` çıktısındaki başlık hücrelerini sıralanabilir düğmelere çevirir.
 * @param {Element} container tablonun bulunduğu kap
 * @param {Array<{key:string, sortable?:boolean, label?:string}>} columns renderDataTable sütunları (aynı sıra)
 * @param {{key?: string, dir?: string}} sort geçerli sıralama
 * @param {(key: string) => void} onSort
 */
export function makeHeadersSortable(container, columns, sort, onSort) {
  if (!container) return;
  const ths = container.querySelectorAll("table.sv2-table thead th");
  columns.forEach((col, i) => {
    const th = ths[i];
    if (!th || !col.sortable) return;
    const active = sort && sort.key === col.key;
    const label = th.textContent;
    th.setAttribute("aria-sort", active ? (sort.dir === "desc" ? "descending" : "ascending") : "none");
    th.textContent = "";
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "sv2-sort-btn";
    btn.dataset.sortKey = col.key;
    btn.setAttribute("style", "background:none;border:0;padding:0;font:inherit;color:inherit;text-transform:inherit;letter-spacing:inherit;cursor:pointer;display:inline-flex;gap:0.3rem;align-items:center");
    btn.title = `${label} sütununa göre sırala`;
    const text = document.createElement("span");
    text.textContent = label;
    const arrow = document.createElement("span");
    arrow.setAttribute("aria-hidden", "true");
    arrow.style.opacity = active ? "1" : "0.35";
    arrow.textContent = active ? (sort.dir === "desc" ? "▼" : "▲") : "↕";
    btn.append(text, arrow);
    btn.addEventListener("click", () => onSort(col.key));
    th.appendChild(btn);
  });
}
