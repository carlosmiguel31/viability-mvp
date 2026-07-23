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
