import { getClients, getPayments, replacePaymentsFromRows } from "./db.js";

const DELIM = ";";
const HEADER = ["id", "client_name", "date", "amount", "commission_percent", "status", "success"];
const REQUIRED = ["client_name", "date", "amount", "commission_percent", "success"];
const MAX_PER_DAY = 20;

function escapeField(value) {
  const s = value === null || value === undefined ? "" : String(value);
  const needsQuotes = s.includes(DELIM) || s.includes('"') || s.includes("\n") || s.includes("\r");
  return needsQuotes ? `"${s.replace(/"/g, '""')}"` : s;
}

// Excel в русской локали ожидает запятую как десятичный разделитель
function formatNumber(n) {
  return String(Number(n)).replace(".", ",");
}

export async function exportPaymentsCSV() {
  const [clients, payments] = await Promise.all([getClients(), getPayments()]);
  const nameById = new Map(clients.map((c) => [c.id, c.name]));
  const lines = [HEADER.join(DELIM)];
  [...payments].sort((a, b) => a.id - b.id).forEach((p) => {
    const row = [
      p.id,
      nameById.get(p.client_id) || "Unknown",
      p.date,
      formatNumber(p.amount),
      formatNumber(p.commission_percent),
      p.status || "",
      p.success ? "true" : "false"
    ];
    lines.push(row.map(escapeField).join(DELIM));
  });
  // BOM нужен, чтобы Excel правильно прочитал кириллицу
  const text = "\uFEFF" + lines.join("\r\n");
  const blob = new Blob([text], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  const d = new Date();
  const stamp = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  a.href = url;
  a.download = `payments-${stamp}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return payments.length;
}

function detectDelimiter(text) {
  const firstLine = text.split(/\r?\n/)[0] || "";
  const semicolons = (firstLine.match(/;/g) || []).length;
  const commas = (firstLine.match(/,/g) || []).length;
  return semicolons >= commas ? ";" : ",";
}

function parseCSV(text, delim) {
  const rows = [];
  let cells = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === delim) {
      cells.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      cells.push(field);
      rows.push(cells);
      cells = [];
      field = "";
    } else {
      field += ch;
    }
  }
  if (field !== "" || cells.length > 0) {
    cells.push(field);
    rows.push(cells);
  }
  // сохраняем номер строки файла (с учётом пустых строк)
  return rows.map((cells, i) => ({ n: i + 1, cells })).filter((r) => r.cells.some((c) => c.trim() !== ""));
}

// Принимает YYYY-MM-DD и ДД.ММ.ГГГГ (Excel в русской локали сохраняет даты во втором виде)
function normalizeDate(s) {
  let y, m, d;
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
  const ru = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(s);
  if (iso) [, y, m, d] = iso;
  else if (ru) [, d, m, y] = ru;
  else return null;
  const dt = new Date(Date.UTC(Number(y), Number(m) - 1, Number(d)));
  if (dt.getUTCFullYear() !== Number(y) || dt.getUTCMonth() !== Number(m) - 1 || dt.getUTCDate() !== Number(d)) return null;
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function parseNumber(s) {
  const t = String(s).trim().replace(",", ".");
  if (!/^-?\d+(\.\d+)?$/.test(t)) return NaN;
  return Number(t);
}

function parseBool(s) {
  const t = s.trim().toLowerCase();
  if (["true", "да", "1"].includes(t)) return true;
  if (["false", "нет", "0"].includes(t)) return false;
  return null;
}

function fail(errors) {
  const err = new Error(`Импорт отменен: ошибок ${errors.length}. Исправьте файл и повторите.`);
  err.details = errors;
  throw err;
}

function validateRows(lines) {
  if (lines.length === 0) throw new Error("Файл пустой.");
  const header = lines[0].cells.map((h) => h.trim().toLowerCase());
  const col = {};
  HEADER.forEach((h) => { col[h] = header.indexOf(h); });
  const missing = REQUIRED.filter((h) => col[h] < 0);
  if (missing.length) throw new Error(`В файле нет столбцов: ${missing.join(", ")}.`);

  const errors = [];
  const payments = [];
  for (const { n, cells } of lines.slice(1)) {
    const get = (name) => (col[name] >= 0 ? (cells[col[name]] ?? "").trim() : "");
    const rowErrors = [];
    const clientName = get("client_name");
    const date = normalizeDate(get("date"));
    const amount = parseNumber(get("amount"));
    const commission = parseNumber(get("commission_percent"));
    const success = parseBool(get("success"));

    if (!clientName) rowErrors.push("пустое имя клиента");
    if (!date) rowErrors.push(`дата «${get("date")}» не распознана (нужно YYYY-MM-DD или ДД.ММ.ГГГГ)`);
    if (!(amount > 0)) rowErrors.push(`сумма «${get("amount")}» должна быть числом больше 0`);
    if (!(commission >= 0 && commission <= 100)) rowErrors.push(`комиссия «${get("commission_percent")}» должна быть от 0 до 100`);
    if (success === null) rowErrors.push(`успех «${get("success")}» должен быть true или false`);

    if (rowErrors.length) {
      errors.push(`Строка ${n}: ${rowErrors.join("; ")}`);
      continue;
    }
    payments.push({ n, clientName, date, amount, commission, status: get("status"), success });
  }

  // Правила приложения: лимит в день и одинаковая комиссия клиента за день
  const groups = new Map();
  for (const p of payments) {
    const key = `${p.clientName.toLowerCase()}|${p.date}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(p);
  }
  for (const list of groups.values()) {
    const first = list[0];
    const where = `клиент «${first.clientName}», дата ${first.date} (строки ${list.map((p) => p.n).join(", ")})`;
    if (list.length > MAX_PER_DAY) errors.push(`${where}: ${list.length} платежей, лимит ${MAX_PER_DAY} в день`);
    if (new Set(list.map((p) => p.commission)).size > 1) errors.push(`${where}: разная комиссия за день`);
  }

  if (errors.length) fail(errors);
  if (payments.length === 0) throw new Error("В файле нет ни одного платежа. Импорт отменен, чтобы не удалить данные.");
  return payments;
}

export async function importPaymentsCSV(file) {
  if (!file) throw new Error("Файл не выбран.");
  const text = (await file.text()).replace(/^\uFEFF/, "");
  const lines = parseCSV(text, detectDelimiter(text));
  const payments = validateRows(lines);
  await replacePaymentsFromRows(payments);
  return payments.length;
}
