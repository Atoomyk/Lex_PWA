import { exportAll, importAll } from "./db.js";

export async function exportJSON() {
  const payload = await exportAll();
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  const d = new Date();
  const stamp = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  a.href = url;
  a.download = `payments-backup-${stamp}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

export async function importJSONFile(file) {
  if (!file) throw new Error("Файл не выбран.");
  const text = await file.text();
  let payload;
  try { payload = JSON.parse(text); } catch { throw new Error("Файл не является корректным JSON."); }
  if (!payload || !Array.isArray(payload.clients) || !Array.isArray(payload.payments) || !Array.isArray(payload.users) || typeof payload.meta !== "object") {
    throw new Error("Структура файла не подходит для импорта.");
  }
  await importAll(payload);
}
