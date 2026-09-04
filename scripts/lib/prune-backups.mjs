// Política de poda de backups: 14 diários + 8 semanais.
// Função pura (sem tocar em disco) para ser testável isoladamente.
//
// Estratégia: os N backups mais recentes (por data) são mantidos como
// "diários". Entre os mais antigos, mantém-se o mais recente de cada
// semana ISO, até o limite de semanais configurado. Tudo o que sobra é
// candidato a remoção.

/**
 * @param {{name: string, date: Date}[]} backups
 * @param {{dailyCount?: number, weeklyCount?: number}} [options]
 * @returns {{keep: string[], remove: string[]}}
 */
export function planPruning(backups, options = {}) {
  const dailyCount = options.dailyCount ?? 14;
  const weeklyCount = options.weeklyCount ?? 8;

  const sorted = [...backups].sort((a, b) => b.date.getTime() - a.date.getTime());
  const keepSet = new Set();

  const dailies = sorted.slice(0, dailyCount);
  for (const b of dailies) keepSet.add(b.name);

  const rest = sorted.slice(dailyCount);
  const seenWeeks = new Set();
  for (const b of rest) {
    const weekKey = isoWeekKey(b.date);
    if (seenWeeks.has(weekKey)) continue;
    if (seenWeeks.size >= weeklyCount) continue;
    seenWeeks.add(weekKey);
    keepSet.add(b.name);
  }

  const keep = sorted.filter((b) => keepSet.has(b.name)).map((b) => b.name);
  const remove = sorted.filter((b) => !keepSet.has(b.name)).map((b) => b.name);
  return { keep, remove };
}

/** Chave estável "ano-semana ISO" para agrupar datas por semana. */
export function isoWeekKey(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = (d.getUTCDay() + 6) % 7; // segunda = 0 ... domingo = 6
  d.setUTCDate(d.getUTCDate() - dayNum + 3); // quinta-feira da mesma semana ISO
  const firstThursday = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  const firstThursdayDayNum = (firstThursday.getUTCDay() + 6) % 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() - firstThursdayDayNum + 3);
  const week = 1 + Math.round((d.getTime() - firstThursday.getTime()) / (7 * 86400000));
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

/**
 * Extrai a data de um nome de arquivo de backup no formato
 * bar-YYYYMMDD-HHMMSS.sqlite3. Retorna null se não casar.
 */
export function parseBackupDate(name) {
  const m = /^bar-(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})\.sqlite3$/.exec(name);
  if (!m) return null;
  const [, y, mo, d, h, mi, s] = m;
  return new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s)));
}

/** Formata a hora atual (local) no padrão de nome de arquivo de backup. */
export function formatBackupName(date = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  const y = date.getFullYear();
  const mo = pad(date.getMonth() + 1);
  const d = pad(date.getDate());
  const h = pad(date.getHours());
  const mi = pad(date.getMinutes());
  const s = pad(date.getSeconds());
  return `bar-${y}${mo}${d}-${h}${mi}${s}.sqlite3`;
}
