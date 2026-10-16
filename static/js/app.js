import { addClient, addPayment, deleteClient, deletePayment, getClients, getPayments, getPaymentsByClientDate, updatePayment } from "./db.js";
import { requireAuth, logout } from "./auth.js";
import { buildReports } from "./reports.js";
import { exportJSON, importJSONFile } from "./export_import.js";
import { exportPaymentsCSV, importPaymentsCSV } from "./csv.js";
import { registerServiceWorker } from "./sw-register.js";

registerServiceWorker();
const session = requireAuth();
const rub = new Intl.NumberFormat("ru-RU", { style: "currency", currency: "RUB", maximumFractionDigits: 2 });
let allClients = [];

const el = {
  roleBadge: document.getElementById("roleBadge"), userBadge: document.getElementById("userBadge"), btnLogout: document.getElementById("btnLogout"), btnTheme: document.getElementById("btnTheme"),
  clientsSelect: document.getElementById("clientsSelect"), clientName: document.getElementById("clientName"),
  btnAddClient: document.getElementById("btnAddClient"), btnDeleteClient: document.getElementById("btnDeleteClient"), paymentClient: document.getElementById("paymentClient"),
  paymentDate: document.getElementById("paymentDate"), paymentAmount: document.getElementById("paymentAmount"), paymentCommission: document.getElementById("paymentCommission"),
  paymentStatus: document.getElementById("paymentStatus"), paymentSuccess: document.getElementById("paymentSuccess"), btnAddPayment: document.getElementById("btnAddPayment"),
  paymentsBody: document.getElementById("paymentsBody"), reportPeriod: document.getElementById("reportPeriod"), reportValue: document.getElementById("reportValue"),
  btnBuildReports: document.getElementById("btnBuildReports"), reportAllClients: document.getElementById("reportAllClients"), reportClientsList: document.getElementById("reportClientsList"),
  reportBody: document.getElementById("reportBody"), summaryReportBody: document.getElementById("summaryReportBody"),
  summaryTotal: document.getElementById("summaryTotal"), btnExport: document.getElementById("btnExport"), btnImport: document.getElementById("btnImport"),
  importFile: document.getElementById("importFile"), toastHost: document.getElementById("toastHost"),
  btnExportCsv: document.getElementById("btnExportCsv"), btnImportCsv: document.getElementById("btnImportCsv"),
  csvFile: document.getElementById("csvFile"), importErrors: document.getElementById("importErrors")
};

function esc(v) {
  return String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function toast(msg, type = "ok") {
  const div = document.createElement("div");
  div.className = `toast ${type}`;
  div.textContent = msg;
  el.toastHost.appendChild(div);
  setTimeout(() => div.remove(), 3200);
}

function setDefaultDate() { el.paymentDate.value = new Date().toISOString().slice(0, 10); }
function validateDateString(date) { return /^\d{4}-\d{2}-\d{2}$/.test(date); }

function applyTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
  localStorage.setItem("theme", theme);
  el.btnTheme.textContent = theme === "dark" ? "Светлая тема" : "Темная тема";
}

function initTheme() { applyTheme(localStorage.getItem("theme") || "light"); }

async function refreshClients() {
  allClients = await getClients();
  const options = allClients.map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join("");
  [el.clientsSelect, el.paymentClient].forEach((select) => { select.innerHTML = `<option value="">-- выбрать --</option>${options}`; });
  renderReportClients();
}

// Список клиентов с галочками. Уже известные клиенты сохраняют свою галочку, новые отмечаются.
function renderReportClients() {
  const prev = new Map([...el.reportClientsList.querySelectorAll("input.rep-client")].map((i) => [Number(i.value), i.checked]));
  el.reportClientsList.innerHTML = allClients.map((c) => {
    const checked = prev.has(c.id) ? prev.get(c.id) : true;
    return `<label style="display:block;"><input type="checkbox" class="rep-client" value="${c.id}" ${checked ? "checked" : ""}> ${esc(c.name)}</label>`;
  }).join("") || '<span class="muted">Клиентов нет</span>';
  syncAllCheckbox();
}

function syncAllCheckbox() {
  const boxes = [...el.reportClientsList.querySelectorAll("input.rep-client")];
  const checkedCount = boxes.filter((b) => b.checked).length;
  el.reportAllClients.checked = boxes.length > 0 && checkedCount === boxes.length;
  el.reportAllClients.indeterminate = checkedCount > 0 && checkedCount < boxes.length;
}

function toggleAllClients() {
  const on = el.reportAllClients.checked;
  el.reportClientsList.querySelectorAll("input.rep-client").forEach((b) => { b.checked = on; });
  el.reportAllClients.indeterminate = false;
}

async function refreshPaymentsTable() {
  const [payments, clients] = await Promise.all([getPayments(), getClients()]);
  const nameById = new Map(clients.map((c) => [c.id, c.name]));
  el.paymentsBody.innerHTML = payments.map((p) => {
    const deleteBtn = `<button data-del="${p.id}" class="danger">Удалить</button>`;
    return `<tr><td>${p.id}</td><td>${esc(nameById.get(p.client_id) || "Unknown")}</td><td>${p.date}</td><td>${rub.format(p.amount)}</td><td>${p.commission_percent}%</td><td>${esc(p.status || "")}</td><td><span class="badge ${p.success ? "ok" : "fail"}">${p.success ? "Успех" : "Неуспех"}</span></td><td>${deleteBtn}</td></tr>`;
  }).join("");
}

async function syncCommissionForClientDate() {
  const clientId = el.paymentClient.value;
  const date = el.paymentDate.value;
  if (!clientId || !validateDateString(date)) return;
  const sameDay = await getPaymentsByClientDate(clientId, date);
  if (sameDay.length > 0) { el.paymentCommission.value = sameDay[0].commission_percent; el.paymentCommission.readOnly = true; }
  else el.paymentCommission.readOnly = false;
}

async function handleAddClient() {
  const name = el.clientName.value.trim();
  if (!name) return toast("Введите имя клиента.", "error");
  try { await addClient(name); el.clientName.value = ""; await refreshClients(); toast("Клиент добавлен."); }
  catch (e) { toast(e.message, "error"); }
}

async function handleDeleteClient() {
  const clientId = el.clientsSelect.value;
  if (!clientId) return toast("Выберите клиента.", "error");
  if (!confirm("Удалить клиента и все его платежи?")) return;
  await deleteClient(clientId); await refreshClients(); await refreshPaymentsTable(); toast("Клиент удален.");
}

async function handleAddPayment() {
  const clientId = Number(el.paymentClient.value);
  const date = el.paymentDate.value;
  const amount = Number(el.paymentAmount.value);
  const commissionInput = Number(el.paymentCommission.value);
  const status = el.paymentStatus.value.trim();
  const success = el.paymentSuccess.value === "true";

  if (!clientId) return toast("Выберите клиента.", "error");
  if (!validateDateString(date)) return toast("Дата должна быть в формате YYYY-MM-DD.", "error");
  if (!(amount > 0)) return toast("Сумма должна быть больше 0.", "error");

  const sameDay = await getPaymentsByClientDate(clientId, date);
  if (sameDay.length >= 20) return toast("Лимит: максимум 20 платежей на клиента в день.", "error");

  let commission = commissionInput;
  if (sameDay.length > 0) commission = sameDay[0].commission_percent;
  if (!(commission >= 0 && commission <= 100)) return toast("Комиссия должна быть от 0 до 100.", "error");

  await addPayment({ client_id: clientId, date, amount, commission_percent: commission, status, success });
  el.paymentAmount.value = ""; el.paymentStatus.value = "";
  await syncCommissionForClientDate();
  await refreshPaymentsTable();
  toast("Платеж добавлен.");
}

async function handlePaymentsDeleteClick(event) {
  const id = event.target?.dataset?.del;
  if (!id) return;
  if (!confirm("Удалить платеж?")) return;
  await deletePayment(id);
  await refreshPaymentsTable();
  toast("Платеж удален.");
}

function periodValueByType(type) {
  const now = new Date();
  if (type === "day") return now.toISOString().slice(0, 10);
  if (type === "month") return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  return String(now.getFullYear());
}

function updatePeriodInput() {
  const type = el.reportPeriod.value;
  el.reportValue.type = type === "day" ? "date" : "text";
  el.reportValue.placeholder = type === "month" ? "YYYY-MM" : type === "year" ? "YYYY" : "YYYY-MM-DD";
  el.reportValue.value = periodValueByType(type);
}

function renderReportRow(r) {
  const clientOptions = allClients.map((c) => `<option value="${c.id}" ${c.id === r.client_id ? "selected" : ""}>${esc(c.name)}</option>`).join("");
  return `<tr data-id="${r.id}">
    <td><select data-field="client_id">${clientOptions}</select></td>
    <td><input type="date" data-field="date" value="${esc(r.date)}"></td>
    <td><input type="number" step="0.01" min="0.01" data-field="amount" value="${esc(r.amount)}"></td>
    <td><input type="number" step="0.01" min="0" max="100" data-field="commission_percent" value="${esc(r.commission_percent)}"></td>
    <td><input type="text" data-field="status" value="${esc(r.status)}"></td>
    <td><select data-field="success"><option value="true" ${r.success ? "selected" : ""}>Успех</option><option value="false" ${r.success ? "" : "selected"}>Неуспех</option></select></td>
    <td>${rub.format(r.net)}</td>
  </tr>`;
}

async function handleBuildReports() {
  const period = el.reportPeriod.value;
  const value = el.reportValue.value.trim();
  const selectedIds = [...el.reportClientsList.querySelectorAll("input.rep-client:checked")].map((i) => Number(i.value));
  if (!value) return toast("Укажите период.", "error");
  if (period === "month" && !/^\d{4}-\d{2}$/.test(value)) return toast("Формат месяца: YYYY-MM.", "error");
  if (period === "year" && !/^\d{4}$/.test(value)) return toast("Формат года: YYYY.", "error");
  if (period === "day" && !validateDateString(value)) return toast("Формат дня: YYYY-MM-DD.", "error");

  const data = await buildReports(period, value, selectedIds);
  el.reportBody.innerHTML = data.rows.map(renderReportRow).join("") || '<tr><td colspan="7" class="muted">Нет данных</td></tr>';
  el.summaryReportBody.innerHTML = data.summaryRows.map((row) => `<tr><td>${esc(row.client_name)}</td><td>${row.payments_count}</td><td>${rub.format(row.total_amount)}</td><td>${rub.format(row.total_net)}</td></tr>`).join("") || '<tr><td colspan="4" class="muted">Нет данных</td></tr>';
  el.summaryTotal.textContent = rub.format(data.grandTotalNet);
}

// Сохранение правки в строке отчёта. Ошибка -> сообщение, поле возвращается к прежнему значению.
async function handleReportEdit(event) {
  const input = event.target;
  const field = input.dataset.field;
  const row = input.closest("tr");
  if (!field || !row) return;
  const id = row.dataset.id;
  const num = (raw) => (String(raw).trim() === "" ? NaN : Number(raw));
  const makePatch = {
    client_id: () => ({ client_id: Number(input.value) }),
    date: () => ({ date: input.value }),
    amount: () => ({ amount: num(input.value) }),
    commission_percent: () => ({ commission_percent: num(input.value) }),
    status: () => ({ status: input.value.trim() }),
    success: () => ({ success: input.value === "true" })
  };
  if (!makePatch[field]) return;

  let saved = false;
  try {
    await updatePayment(id, makePatch[field]());
    saved = true;
    toast("Платеж сохранен.");
  } catch (e) {
    toast(e.message, "error");
  }
  await refreshPaymentsTable();
  await handleBuildReports();
  if (saved && !el.reportBody.querySelector(`tr[data-id="${id}"]`)) {
    toast("Платеж сохранен, но он больше не входит в этот отчет.", "ok");
  }
}

async function handleExport() { await exportJSON(); toast("Экспорт выполнен."); }

async function handleImport() {
  const file = el.importFile.files[0];
  if (!file) return toast("Выберите JSON файл.", "error");
  if (!confirm("Импорт заменит текущие данные. Продолжить?")) return;
  try {
    await importJSONFile(file);
    await refreshClients(); await refreshPaymentsTable(); await handleBuildReports();
    toast("Импорт завершен.");
  } catch (e) { toast(e.message, "error"); }
}

async function handleExportCsv() {
  const count = await exportPaymentsCSV();
  toast(`CSV сохранен, платежей: ${count}.`);
}

async function handleImportCsv() {
  const file = el.csvFile.files[0];
  el.importErrors.innerHTML = "";
  if (!file) return toast("Выберите CSV файл.", "error");
  if (!confirm("Импорт заменит все платежи данными из CSV. Продолжить?")) return;
  try {
    const count = await importPaymentsCSV(file);
    await refreshClients(); await refreshPaymentsTable(); await handleBuildReports();
    toast(`Импорт CSV завершен, платежей: ${count}.`);
  } catch (e) {
    toast(e.message, "error");
    if (e.details) {
      const ul = document.createElement("ul");
      e.details.slice(0, 50).forEach((d) => { const li = document.createElement("li"); li.textContent = d; ul.appendChild(li); });
      el.importErrors.appendChild(ul);
    }
  }
}

function applyRoleRestrictions() {
  el.roleBadge.textContent = session.role;
  el.userBadge.textContent = session.username;
}

function bindEvents() {
  el.btnLogout.addEventListener("click", logout);
  el.btnTheme.addEventListener("click", () => applyTheme((document.documentElement.getAttribute("data-theme") || "light") === "dark" ? "light" : "dark"));
  el.btnAddClient.addEventListener("click", handleAddClient);
  el.btnDeleteClient.addEventListener("click", handleDeleteClient);
  el.btnAddPayment.addEventListener("click", handleAddPayment);
  el.paymentsBody.addEventListener("click", handlePaymentsDeleteClick);
  el.reportPeriod.addEventListener("change", updatePeriodInput);
  el.btnBuildReports.addEventListener("click", handleBuildReports);
  el.reportAllClients.addEventListener("change", toggleAllClients);
  el.reportClientsList.addEventListener("change", syncAllCheckbox);
  el.reportBody.addEventListener("change", handleReportEdit);
  el.paymentClient.addEventListener("change", syncCommissionForClientDate);
  el.paymentDate.addEventListener("change", syncCommissionForClientDate);
  el.btnExport.addEventListener("click", handleExport);
  el.btnImport.addEventListener("click", handleImport);
  el.btnExportCsv.addEventListener("click", handleExportCsv);
  el.btnImportCsv.addEventListener("click", handleImportCsv);
}

async function bootstrap() {
  if (!session) return;
  initTheme(); setDefaultDate(); updatePeriodInput(); applyRoleRestrictions(); bindEvents();
  await refreshClients(); await refreshPaymentsTable(); await handleBuildReports();
}

bootstrap();
