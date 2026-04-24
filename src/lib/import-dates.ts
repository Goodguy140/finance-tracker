function toAsciiDigits(value: string) {
  return value.replace(/[０-９]/g, (char) => String.fromCharCode(char.charCodeAt(0) - 0xfee0));
}

function toValidDate(year: number, month: number, day: number) {
  const candidate = new Date(Date.UTC(year, month - 1, day));
  if (
    candidate.getUTCFullYear() !== year ||
    candidate.getUTCMonth() !== month - 1 ||
    candidate.getUTCDate() !== day
  ) {
    return null;
  }
  return candidate;
}

/** Strips a leading weekday as used in some locale date strings (e.g. "水曜日, 4月 1, 2026"). */
function stripLeadingJapaneseWeekdayPrefix(input: string): string {
  return input.replace(/^\s*[月火水木金土日]曜日\s*[,、，]?\s*/u, "").trim();
}

/** Strips trailing weekday labels used in Japanese "long" / locale date strings (e.g. bank CSV). */
function stripJapaneseLongDateSuffixes(input: string): string {
  let s = input.trim();
  const suffixPatterns = [
    /\s*,\s*[月火水木金土日]曜日\s*$/u,
    /\s*[（(][月火水木金土日]曜日[）)]\s*$/u,
    /\s*[（(][月火水木金土日][）)]\s*$/u,
    /\s*[月火水木金土日]曜日\s*$/u,
  ];

  for (;;) {
    let changed = false;
    for (const pattern of suffixPatterns) {
      const next = s.replace(pattern, "").trim();
      if (next !== s) {
        s = next;
        changed = true;
      }
    }
    if (!changed) break;
  }

  return s;
}

/**
 * Parses dates from expense CSV imports (transaction date / posted date).
 * Supports Gregorian and Japanese era forms, full-width digits, long-date
 * weekday suffixes, leading weekday + month/day/year (e.g. "水曜日, 4月 1, 2026"),
 * and month-first fragments like "4月1日2026年".
 */
export function parseImportedDate(value: string | undefined): Date | null {
  if (!value) return null;
  let normalized = toAsciiDigits(value).trim().replace(/\u3000/g, " ");
  if (!normalized) return null;

  normalized = stripLeadingJapaneseWeekdayPrefix(normalized);
  normalized = stripJapaneseLongDateSuffixes(normalized);
  if (!normalized) return null;

  // e.g. "4月1日2026年", "4月1日 2026年"
  const mdThenYWithDayKanji = normalized.match(
    /^(\d{1,2})\s*月\s*(\d{1,2})\s*日\s*(\d{4})\s*年?\s*$/,
  );
  if (mdThenYWithDayKanji) {
    return toValidDate(
      Number(mdThenYWithDayKanji[3]),
      Number(mdThenYWithDayKanji[1]),
      Number(mdThenYWithDayKanji[2]),
    );
  }

  // e.g. "4月 1, 2026", "4月1, 2026", "04月01 2026"
  const mdThenYWesternYear = normalized.match(
    /^(\d{1,2})\s*月\s*(\d{1,2})\s*日?\s*(?:[,，、]\s*|\s+)(\d{4})(?:\s*年)?\s*$/,
  );
  if (mdThenYWesternYear) {
    return toValidDate(
      Number(mdThenYWesternYear[3]),
      Number(mdThenYWesternYear[1]),
      Number(mdThenYWesternYear[2]),
    );
  }

  const gregorianMatch = normalized.match(/^(\d{4})\s*[\/\-.年]\s*(\d{1,2})\s*[\/\-.月]\s*(\d{1,2})\s*日?$/);
  if (gregorianMatch) {
    return toValidDate(Number(gregorianMatch[1]), Number(gregorianMatch[2]), Number(gregorianMatch[3]));
  }

  const eraMatch = normalized.match(
    /^(令和|平成|昭和|R|H|S)\s*(元|\d{1,2})\s*[\/\-.年]\s*(\d{1,2})\s*[\/\-.月]\s*(\d{1,2})\s*日?$/i,
  );
  if (eraMatch) {
    const era = eraMatch[1].toUpperCase();
    const eraYearRaw = eraMatch[2];
    const eraYear = eraYearRaw === "元" ? 1 : Number(eraYearRaw);
    const month = Number(eraMatch[3]);
    const day = Number(eraMatch[4]);
    const baseYear =
      era === "令和" || era === "R" ? 2018 : era === "平成" || era === "H" ? 1988 : 1925;
    return toValidDate(baseYear + eraYear, month, day);
  }

  const fallback = new Date(normalized);
  return Number.isNaN(fallback.getTime()) ? null : fallback;
}
