/**
 * MixesDB set titles start with the published date, e.g.
 * "2020-11-30 - Roza Terenzi @ …", sometimes only "2020-11" or "2020".
 */
export function setDateFromTitle(title: string): string | null {
  const m = /^(\d{4})(?:-(\d{2}))?(?:-(\d{2}))?/.exec(title.trim());
  if (!m) return null;
  const [, y, mo, d] = m;
  const year = Number(y);
  if (year < 1950 || year > 2100) return null;
  return `${y}-${mo ?? "01"}-${d ?? "01"}`;
}

const MONTHS: Record<string, string> = {
  jan: "01",
  january: "01",
  feb: "02",
  february: "02",
  mar: "03",
  march: "03",
  apr: "04",
  april: "04",
  may: "05",
  jun: "06",
  june: "06",
  jul: "07",
  july: "07",
  aug: "08",
  august: "08",
  sep: "09",
  sept: "09",
  september: "09",
  oct: "10",
  october: "10",
  nov: "11",
  november: "11",
  dec: "12",
  december: "12",
};

function validIsoDay(year: string, month: string, day: string): string | null {
  const y = Number(year);
  const m = Number(month);
  const d = Number(day);
  if (y < 1950 || y > 2100 || m < 1 || m > 12 || d < 1 || d > 31) return null;
  return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
}

/**
 * Extract the date a set was played from titles that don't start with ISO dates,
 * e.g. SoundCloud uploads like "NTS February 08, 2019".
 */
export function eventDateFromTitle(title: string): string | null {
  const iso = setDateFromTitle(title);
  if (iso) return iso;

  const clean = title.replace(/\s+/g, " ").trim();
  const monthFirst = /\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t|tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\.?\s+(\d{1,2})(?:st|nd|rd|th)?\s*,?\s*(\d{4})\b/i.exec(
    clean,
  );
  if (monthFirst) {
    const month = MONTHS[monthFirst[1]!.toLowerCase().replace(/\.$/, "")];
    if (month) return validIsoDay(monthFirst[3]!, month, monthFirst[2]!);
  }

  const dayFirst = /\b(\d{1,2})(?:st|nd|rd|th)?\s+(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t|tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\.?\s+(\d{4})\b/i.exec(
    clean,
  );
  if (dayFirst) {
    const month = MONTHS[dayFirst[2]!.toLowerCase().replace(/\.$/, "")];
    if (month) return validIsoDay(dayFirst[3]!, month, dayFirst[1]!);
  }

  return null;
}

export function eventDateForSet(set: { title: string; date?: string | null }): string | null {
  const fromTitle = eventDateFromTitle(set.title);
  if (fromTitle) return fromTitle;
  if (!set.date) return null;
  const t = Date.parse(set.date);
  if (Number.isNaN(t)) return null;
  return new Date(t).toISOString().slice(0, 10);
}

export function setDateLabel(title: string): string {
  const iso = eventDateFromTitle(title);
  if (!iso) return "";
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "";
  return new Date(t).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

/**
 * Sort newest-first by the date in the title, falling back to the set's own
 * date field — NTS episodes carry a broadcast date instead of a dated title.
 */
export function sortSetsByTitleDate<T extends { title: string; date?: string | null }>(
  sets: T[],
): T[] {
  const at = (s: T) => eventDateForSet(s);
  return [...sets].sort((a, b) => {
    const da = at(a);
    const db = at(b);
    if (da && db) return db.localeCompare(da);
    if (da) return -1;
    if (db) return 1;
    return a.title.localeCompare(b.title);
  });
}
