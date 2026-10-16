import { addClient, addPayment, deleteClient, deletePayment, getClients, getPayments, getPaymentsByClientDate } from "./db.js";
import { requireAuth, logout } from "./auth.js";
import { buildReports } from "./reports.js";
import { exportJSON, importJSONFile } from "./export_import.js";
import { registerServiceWorker } from "./sw-register.js";

registerServiceWorker();
const session = requireAuth();
const rub = new Intl.NumberFormat("ru-RU", { style: "currency", currency: "RUB", maximumFractionDigits: 2 });

const el = {
  roleBadge: document.getElementById("roleBadge"), userBadge: document.getElementById("userBadge"), btnLogout: document.getElementById("btnLogout"), btnTheme: document.getElementById("btnTheme"),
  clientsSelect: document.getElementById("clientsSelect"), reportClientSelect: document.getElementById("reportClientSelect"), clientName: document.getElementById("clientName"),
  btnAddClient: document.getElementById("btnAddClient"), btnDeleteClient: document.getElementById("btnDeleteClient"), paymentClient: document.getElementById("paymentClient"),
  paymentDate: document.getElementById("paymentDate"), paymentAmount: document.getElementById("paymentAmount"), paymentCommission: document.getElementById("paymentCommission"),
  paymentStatus: document.getElementById("paymentStatus"), paymentSuccess: document.getElementById("paymentSuccess"), btnAddPayment: document.getElementById("btnAddPayment"),
  paymentsBody: document.getElementById("paymentsBody"), reportPeriod: document.getElementById("reportPeriod"), reportValue: document.getElementById("reportValue"),
  btnBuildReports: document.getElementById("btnBuildReports"), personalReportBody: document.getElementById("personalReportBody"), summaryReportBody: document.getElementById("summaryReportBody"),
  summaryTotal: document.getElementById("summaryTotal"), btnExport: document.getElementById("btnExport"), btnImport: document.getElementById("btnImport"),
  importFile: document.getElementById("importFile"), toastHost: document.getElementById("toastHost")
};

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
  const clients = await getClients();
  const options = clients.map((c) => `<option value="${c.id}">${c.name}</option>`).join("");
  [el.clientsSelect, el.reportClientSelect, el.paymentClient].forEach((select) => { select.innerHTML = `<option value="">-- выбрать --</option>${options}`; });
}

async function refreshPaymentsTable() {
  const [payments, clients] = await Promise.all([getPayments(), getClients()]);
  const nameById = new Map(clients.map((c) => [c.id, c.name]));
  el.paymentsBody.innerHTML = payments.map((p) => {
    const deleteBtn = `<button data-del="${p.id}" class="danger">Удалить</button>`;
    return `<tr><td>${p.id}</td><td>${nameById.get(p.client_id) || "Unknown"}</td><td>${p.date}</td><td>${rub.format(p.amount)}</td><td>${p.commission_percent}%</td><td>${p.status || ""}</td><td><span class="badge ${p.success ? "ok" : "fail"}">${p.success ? "Успех" : "Неуспех"}</span></td><td>${deleteBtn}</td></tr>`;
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

async function handleBuildReports() {
  const period = el.reportPeriod.value;
  const value = el.reportValue.value.trim();
  const selectedClientId = el.reportClientSelect.value || null;
  if (!value) return toast("Укажите период.", "error");
  if (period === "month" && !/^\d{4}-\d{2}$/.test(value)) return toast("Формат месяца: YYYY-MM.", "error");
  if (period === "year" && !/^\d{4}$/.test(value)) return toast("Формат года: YYYY.", "error");
  if (period === "day" && !validateDateString(value)) return toast("Формат дня: YYYY-MM-DD.", "error");

  const data = await buildReports(period, value, selectedClientId);
  el.personalReportBody.innerHTML = data.personal.map((p) => `<tr><td>${p.client_name}</td><td>${p.date}</td><td>${rub.format(p.amount)}</td><td>${p.commission_percent}%</td><td>${rub.format(p.net)}</td></tr>`).join("") || '<tr><td colspan="5" class="muted">Нет данных</td></tr>';
  el.summaryReportBody.innerHTML = data.summaryRows.map((row) => `<tr><td>${row.client_name}</td><td>${row.payments_count}</td><td>${rub.format(row.total_amount)}</td><td>${rub.format(row.total_net)}</td></tr>`).join("") || '<tr><td colspan="4" class="muted">Нет данных</td></tr>';
  el.summaryTotal.textContent = rub.format(data.grandTotalNet);
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
  el.paymentClient.addEventListener("change", syncCommissionForClientDate);
  el.paymentDate.addEventListener("change", syncCommissionForClientDate);
  el.btnExport.addEventListener("click", handleExport);
  el.btnImport.addEventListener("click", handleImport);
}

async function bootstrap() {
  if (!session) return;
  initTheme(); setDefaultDate(); updatePeriodInput(); applyRoleRestrictions(); bindEvents();
  await refreshClients(); await refreshPaymentsTable(); await handleBuildReports();
}

bootstrap();
