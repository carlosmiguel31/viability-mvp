/**
 * Conversao "data de calendario no fuso IANA configurado" -> instante UTC,
 * sem offsets fixos (-03:00) e sem dependencias novas: usa Intl, que le a
 * base de fusos do proprio Node. Correta inclusive em transicoes de DST.
 */

export function isValidIanaTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return true;
  } catch {
    return false;
  }
}

/** Offset (ms) do fuso em relacao ao UTC no instante dado. */
function timeZoneOffsetMs(utcInstant: Date, timeZone: string): number {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const parts = Object.fromEntries(
    formatter.formatToParts(utcInstant).map((part) => [part.type, part.value])
  ) as Record<string, string>;
  const asUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour) % 24,
    Number(parts.minute),
    Number(parts.second)
  );
  return asUtc - utcInstant.getTime();
}

/**
 * Meia-noite do dia AAAA-MM-DD no fuso informado, como instante UTC.
 * Duas iteracoes acomodam mudancas de offset (horario de verao).
 */
export function zonedMidnightUtc(date: string, timeZone: string): Date {
  const base = Date.parse(`${date}T00:00:00Z`);
  if (Number.isNaN(base)) {
    throw new Error(`Data inválida: ${date}`);
  }
  let guess = base - timeZoneOffsetMs(new Date(base), timeZone);
  const secondOffset = timeZoneOffsetMs(new Date(guess), timeZone);
  guess = base - secondOffset;
  return new Date(guess);
}

/** Dia de calendario seguinte a AAAA-MM-DD (sem envolver fusos). */
export function nextCalendarDay(date: string): string {
  const next = new Date(`${date}T12:00:00Z`); // meio-dia evita bordas
  next.setUTCDate(next.getUTCDate() + 1);
  return next.toISOString().slice(0, 10);
}

/** Data de calendario (AAAA-MM-DD) de um instante no fuso informado. */
export function calendarDateInTimeZone(instant: Date, timeZone: string): string {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return formatter.format(instant); // en-CA => YYYY-MM-DD
}

/** Soma dias de calendario a AAAA-MM-DD (sem fuso). */
export function addCalendarDays(date: string, days: number): string {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

/** Diferenca em dias de calendario entre duas datas AAAA-MM-DD (b - a). */
export function calendarDaysBetween(a: string, b: string): number {
  const start = Date.parse(`${a}T00:00:00Z`);
  const end = Date.parse(`${b}T00:00:00Z`);
  return Math.round((end - start) / (24 * 60 * 60 * 1000));
}

/**
 * Valida uma data de calendário REAL no formato AAAA-MM-DD: além do formato,
 * confirma que ano/mês/dia existem de fato (2026-02-31, 2026-04-31 e
 * 2026-13-01 são rejeitados). Nenhuma normalização silenciosa de Date.parse.
 */
export function isValidCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map((part) => Number(part));
  if (month < 1 || month > 12 || day < 1) return false;
  const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  const daysInMonth = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return day <= daysInMonth[month - 1];
}
