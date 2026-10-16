const DB_NAME = "payments_pwa_db";
const DB_VERSION = 1;
let dbPromise;

export function initDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains("clients")) {
        const store = db.createObjectStore("clients", { keyPath: "id", autoIncrement: true });
        store.createIndex("name", "name", { unique: true });
      }
      if (!db.objectStoreNames.contains("payments")) {
        const store = db.createObjectStore("payments", { keyPath: "id", autoIncrement: true });
        store.createIndex("client_id", "client_id", { unique: false });
        store.createIndex("date", "date", { unique: false });
        store.createIndex("client_date", ["client_id", "date"], { unique: false });
      }
      if (!db.objectStoreNames.contains("users")) {
        const store = db.createObjectStore("users", { keyPath: "id", autoIncrement: true });
        store.createIndex("username", "username", { unique: true });
      }
      if (!db.objectStoreNames.contains("meta")) db.createObjectStore("meta", { keyPath: "key" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function tx(storeNames, mode = "readonly") {
  return initDB().then((db) => db.transaction(storeNames, mode));
}

function promisify(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function addClient(name) {
  const normalized = name.trim();
  if (!normalized) throw new Error("Имя клиента обязательно.");
  const all = await getClients();
  if (all.some((c) => c.name.toLowerCase() === normalized.toLowerCase())) throw new Error("Клиент с таким именем уже существует.");
  const tr = await tx(["clients"], "readwrite");
  const id = await promisify(tr.objectStore("clients").add({ name: normalized }));
  return { id, name: normalized };
}

export async function getClients() {
  const tr = await tx(["clients"]);
  const data = await promisify(tr.objectStore("clients").getAll());
  return data.sort((a, b) => a.name.localeCompare(b.name, "ru"));
}

export async function deleteClient(clientId) {
  const tr = await tx(["clients", "payments"], "readwrite");
  await promisify(tr.objectStore("clients").delete(Number(clientId)));
  const paymentsStore = tr.objectStore("payments");
  const allPayments = await promisify(paymentsStore.getAll());
  await Promise.all(allPayments.filter((p) => p.client_id === Number(clientId)).map((p) => promisify(paymentsStore.delete(p.id))));
}

export async function getPayments() {
  const tr = await tx(["payments"]);
  const data = await promisify(tr.objectStore("payments").getAll());
  return data.sort((a, b) => (a.date < b.date ? 1 : -1) || b.id - a.id);
}

export async function addPayment(payment) {
  const tr = await tx(["payments"], "readwrite");
  return promisify(tr.objectStore("payments").add(payment));
}

export async function deletePayment(id) {
  const tr = await tx(["payments"], "readwrite");
  await promisify(tr.objectStore("payments").delete(Number(id)));
}

export async function getPaymentsByClientDate(clientId, date) {
  const all = await getPayments();
  return all.filter((p) => p.client_id === Number(clientId) && p.date === date);
}

export async function getUsers() {
  const tr = await tx(["users"]);
  return promisify(tr.objectStore("users").getAll());
}

export async function addUser(user) {
  const tr = await tx(["users"], "readwrite");
  return promisify(tr.objectStore("users").add(user));
}

export async function getMeta(key) {
  const tr = await tx(["meta"]);
  return promisify(tr.objectStore("meta").get(key));
}

export async function setMeta(key, value) {
  const tr = await tx(["meta"], "readwrite");
  return promisify(tr.objectStore("meta").put({ key, value }));
}

export async function exportAll() {
  const [clients, payments, users] = await Promise.all([getClients(), getPayments(), getUsers()]);
  const setup = await getMeta("setup_done");
  return { version: 1, exported_at: new Date().toISOString(), clients, payments, users, meta: { setup_done: Boolean(setup?.value) } };
}

export async function importAll(payload) {
  const valid = payload && Array.isArray(payload.clients) && Array.isArray(payload.payments) && Array.isArray(payload.users) && payload.meta;
  if (!valid) throw new Error("Некорректная структура файла импорта.");
  const tr = await tx(["clients", "payments", "users", "meta"], "readwrite");
  const clientsStore = tr.objectStore("clients");
  const paymentsStore = tr.objectStore("payments");
  const usersStore = tr.objectStore("users");
  const metaStore = tr.objectStore("meta");
  await Promise.all([promisify(clientsStore.clear()), promisify(paymentsStore.clear()), promisify(usersStore.clear()), promisify(metaStore.clear())]);
  for (const c of payload.clients) await promisify(clientsStore.add(c));
  for (const p of payload.payments) await promisify(paymentsStore.add(p));
  for (const u of payload.users) await promisify(usersStore.add(u));
  await promisify(metaStore.put({ key: "setup_done", value: Boolean(payload.meta.setup_done) }));
}

// Заменяет все платежи; клиентов из файла, которых нет в базе, создаёт (сравнение имён без учёта регистра)
export async function replacePaymentsFromRows(rows) {
  const tr = await tx(["clients", "payments"], "readwrite");
  const clientsStore = tr.objectStore("clients");
  const paymentsStore = tr.objectStore("payments");
  const existing = await promisify(clientsStore.getAll());
  const idByName = new Map(existing.map((c) => [c.name.toLowerCase(), c.id]));
  for (const r of rows) {
    const key = r.clientName.toLowerCase();
    if (!idByName.has(key)) {
      const id = await promisify(clientsStore.add({ name: r.clientName }));
      idByName.set(key, id);
    }
  }
  await promisify(paymentsStore.clear());
  for (const r of rows) {
    await promisify(paymentsStore.add({
      client_id: idByName.get(r.clientName.toLowerCase()),
      date: r.date,
      amount: r.amount,
      commission_percent: r.commission,
      status: r.status,
      success: r.success
    }));
  }
}
