import { addUser, getMeta, getUsers, setMeta } from "./db.js";

const SESSION_KEY = "payments_pwa_session";

export async function hashPassword(password) {
  const data = new TextEncoder().encode(password);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function needsInitialSetup() {
  const setupDone = await getMeta("setup_done");
  const users = await getUsers();
  return !setupDone?.value || users.length < 1;
}

export async function initializeAccounts(userPassword) {
  if (!userPassword) throw new Error("Нужно указать пароль для user.");
  const users = await getUsers();
  if (users.length > 0) throw new Error("Инициализация уже выполнена.");
  const userHash = await hashPassword(userPassword);
  await addUser({ username: "user", role: "user", password_hash: userHash, created_at: new Date().toISOString() });
  await setMeta("setup_done", true);
}

export async function login(username, password) {
  const users = await getUsers();
  const found = users.find((u) => u.username === username);
  if (!found) throw new Error("Пользователь не найден.");
  const hash = await hashPassword(password);
  if (hash !== found.password_hash) throw new Error("Неверный пароль.");
  const session = { username: found.username, role: found.role, login_at: new Date().toISOString() };
  localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  return session;
}

export function getSession() {
  const raw = localStorage.getItem(SESSION_KEY);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { localStorage.removeItem(SESSION_KEY); return null; }
}

export function requireAuth() {
  const session = getSession();
  if (!session) { window.location.href = "/login"; return null; }
  return session;
}

export function logout() {
  localStorage.removeItem(SESSION_KEY);
  window.location.href = "/login";
}
