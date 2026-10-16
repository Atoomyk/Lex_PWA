import { getPayments, getClients } from "./db.js";

function matchesPeriod(date, period, value) {
  if (period === "day") return date === value;
  if (period === "month") return date.startsWith(value + "-");
  if (period === "year") return date.startsWith(value + "-");
  return false;
}

function netAmount(payment) {
  return payment.amount * (1 - payment.commission_percent / 100);
}

export async function buildReports(period, periodValue, selectedClientId = null) {
  const [payments, clients] = await Promise.all([getPayments(), getClients()]);
  const clientsMap = new Map(clients.map((c) => [c.id, c.name]));
  const filtered = payments.filter((p) => matchesPeriod(p.date, period, periodValue));

  const grouped = new Map();
  for (const p of filtered) {
    if (!grouped.has(p.client_id)) grouped.set(p.client_id, { client_id: p.client_id, client_name: clientsMap.get(p.client_id) || "Unknown", total_amount: 0, total_net: 0, payments_count: 0 });
    const row = grouped.get(p.client_id);
    row.total_amount += p.amount;
    row.total_net += netAmount(p);
    row.payments_count += 1;
  }

  const summaryRows = [...grouped.values()].sort((a, b) => a.client_name.localeCompare(b.client_name, "ru"));
  const grandTotalNet = summaryRows.reduce((acc, row) => acc + row.total_net, 0);

  let personalRows = filtered;
  if (selectedClientId) personalRows = filtered.filter((p) => p.client_id === Number(selectedClientId));
  const personal = personalRows.map((p) => ({ ...p, client_name: clientsMap.get(p.client_id) || "Unknown", net: netAmount(p) }));

  return { personal, summaryRows, grandTotalNet };
}
