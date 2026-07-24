import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

const SITE_URL = "https://www.sheffieldmasjids.com";
const MOSQUES_URL = `${SITE_URL}/data/mosques.json`;
const SETTINGS_PATH = join(homedir(), ".pi/agent/pi-prayer-times.json");
const DEFAULT_MOSQUE = "muslim-welfare-house";

type DisplayMode = "adhan" | "adhan-iqamah";

type Settings = {
  mosqueSlug: string;
  displayMode: DisplayMode;
  showCountdown: boolean;
};

export type Mosque = {
  name: string;
  slug: string;
  citySlug: string;
  cityName: string;
  countryCode: string;
  countryName: string;
  timezone: string;
};

type PrayerRow = {
  date: number;
  fajr: string;
  dhuhr: string;
  asr: string;
  maghrib: string;
  isha: string;
};

type IqamahRange = {
  date_range: string;
  fajr: string;
  dhuhr: string;
  asr: string;
  maghrib?: string;
  isha: string;
};

type MonthlyPrayerTimes = {
  prayer_times: PrayerRow[];
  iqamah_times?: IqamahRange[];
};

const DEFAULT_SETTINGS: Settings = { mosqueSlug: DEFAULT_MOSQUE, displayMode: "adhan", showCountdown: true };
const PRAYERS = ["fajr", "dhuhr", "asr", "maghrib", "isha"] as const;

function loadSettings(): Settings {
  try {
    if (existsSync(SETTINGS_PATH)) {
      const value = JSON.parse(readFileSync(SETTINGS_PATH, "utf8")) as Partial<Settings>;
      if (value.mosqueSlug && (value.displayMode === "adhan" || value.displayMode === "adhan-iqamah")) {
        return {
          mosqueSlug: value.mosqueSlug,
          displayMode: value.displayMode,
          showCountdown: value.showCountdown !== false,
        };
      }
    }
  } catch {
    // Use defaults when settings are missing or invalid.
  }
  return DEFAULT_SETTINGS;
}

function saveSettings(settings: Settings) {
  mkdirSync(dirname(SETTINGS_PATH), { recursive: true });
  writeFileSync(SETTINGS_PATH, `${JSON.stringify(settings, null, 2)}\n`);
}

export function normalizeMosque(value: unknown): Mosque | null {
  if (!value || typeof value !== "object") return null;
  const item = value as Record<string, unknown>;
  const name = typeof item.name === "string" ? item.name.trim() : "";
  const slug = typeof item.slug === "string" ? item.slug.trim() : "";
  if (!name || !slug) return null;

  return {
    name,
    slug,
    citySlug: typeof item.citySlug === "string" && item.citySlug.trim() ? item.citySlug.trim().toLowerCase() : "sheffield",
    cityName: typeof item.cityName === "string" && item.cityName.trim() ? item.cityName.trim() : "Sheffield",
    countryCode: typeof item.countryCode === "string" && item.countryCode.trim() ? item.countryCode.trim().toUpperCase() : "GB",
    countryName: typeof item.countryName === "string" && item.countryName.trim() ? item.countryName.trim() : "United Kingdom",
    timezone: typeof item.timezone === "string" && item.timezone.trim() ? item.timezone.trim() : "Europe/London",
  };
}

export async function fetchMosques(fetcher: typeof fetch = fetch): Promise<Mosque[]> {
  const response = await fetcher(MOSQUES_URL);
  if (!response.ok) throw new Error(`Mosque request failed: ${response.status}`);
  const payload = await response.json() as { mosques?: unknown[] };
  return (payload.mosques ?? [])
    .filter((item) => !(item as { isHidden?: boolean })?.isHidden)
    .map(normalizeMosque)
    .filter((item): item is Mosque => item !== null)
    .sort((a, b) => a.name.localeCompare(b.name));
}

const MONTHS = [
  "january", "february", "march", "april", "may", "june",
  "july", "august", "september", "october", "november", "december",
] as const;

function localDate(now: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    year: "numeric",
    month: "numeric",
    day: "numeric",
  }).formatToParts(now);
  const part = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((item) => item.type === type)?.value);
  const year = part("year");
  const monthIndex = part("month") - 1;
  const day = part("day");
  return { key: `${year}-${monthIndex + 1}-${day}`, year, monthIndex, month: MONTHS[monthIndex]!, day };
}

function nextDate(date: ReturnType<typeof localDate>) {
  const next = new Date(Date.UTC(date.year, date.monthIndex, date.day + 1));
  const year = next.getUTCFullYear();
  const monthIndex = next.getUTCMonth();
  const day = next.getUTCDate();
  return { key: `${year}-${monthIndex + 1}-${day}`, year, monthIndex, month: MONTHS[monthIndex]!, day };
}

function addMinutes(time: string, amount: number): string | null {
  const [hours, minutes] = time.split(":").map(Number);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null;
  const total = (hours * 60 + minutes + amount) % 1440;
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

function timeMinutes(time: string): number | null {
  const match = time.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  return hours < 24 && minutes < 60 ? hours * 60 + minutes : null;
}

function localTimeMinutes(now: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const part = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((item) => item.type === type)?.value);
  return part("hour") * 60 + part("minute");
}

export function formatNextEventCountdown(
  row: PrayerRow,
  range: IqamahRange | undefined,
  nextRow: PrayerRow | undefined,
  nextRange: IqamahRange | undefined,
  now: Date,
  timeZone: string,
): string | null {
  const events = (dayRow: PrayerRow, dayRange: IqamahRange | undefined, offset: number) => PRAYERS.flatMap((prayer) => {
    const adhan = timeMinutes(dayRow[prayer]);
    const iqamah = timeMinutes(resolveIqamah(dayRange?.[prayer], dayRow[prayer], prayer));
    return [
      ...(adhan === null ? [] : [{ label: `${title(prayer)} Adhan`, at: adhan + offset }]),
      ...(iqamah === null ? [] : [{ label: `${title(prayer)} Iqamah`, at: iqamah + offset }]),
    ];
  });
  const current = localTimeMinutes(now, timeZone);
  const next = [...events(row, range, 0), ...(nextRow ? events(nextRow, nextRange, 1440) : [])]
    .filter((event) => event.at >= current)
    .sort((a, b) => a.at - b.at)[0];
  if (!next) return null;

  const minutes = next.at - current;
  if (minutes === 0) return `Next: ${next.label} now`;
  const hours = Math.floor(minutes / 60);
  return `Next: ${next.label} in ${hours ? `${hours}h ` : ""}${minutes % 60}m`;
}

export function resolveIqamah(value: string | undefined, adhan: string, prayer: string): string {
  const text = value?.trim() || (prayer === "maghrib" ? "sunset" : "—");
  if (/^(sunset|entry time|various)$/i.test(text)) return adhan;
  if (/^(combined with maghrib|straight after maghrib|after maghrib)$/i.test(text)) return "After Maghrib";

  const relative = text.match(/^adhan\s*\+\s*(\d+)\s*(?:mins?|minutes?)?$/i)
    ?? text.match(/^(\d+)\s*(?:mins?|minutes?)\s*after\s*adhan$/i);
  return relative ? addMinutes(adhan, Number(relative[1])) ?? text : text;
}

export function iqamahForDay(ranges: IqamahRange[] = [], day: number): IqamahRange | undefined {
  return ranges.find((range) => {
    const [start, end = start] = range.date_range.split("-").map(Number);
    return Number.isFinite(start) && Number.isFinite(end) && day >= start && day <= end;
  });
}

export function getHighlightedPrayer(
  row: PrayerRow,
  range: IqamahRange | undefined,
  now: Date,
  timeZone: string,
): typeof PRAYERS[number] | null {
  const iqamahs = PRAYERS.map((prayer) => timeMinutes(resolveIqamah(range?.[prayer], row[prayer], prayer)));
  const current = localTimeMinutes(now, timeZone);

  for (let index = 0; index < PRAYERS.length; index++) {
    const end = iqamahs[index];
    const previous = iqamahs[index === 0 ? PRAYERS.length - 1 : index - 1];
    if (end === null || previous === null) continue;
    const start = previous + 10 - (index === 0 ? 1440 : 0);
    if (current >= start && current < end) return PRAYERS[index];
  }

  const isha = iqamahs.at(-1);
  return isha !== null && isha !== undefined && current >= isha + 10 ? "fajr" : null;
}

function prayerParts(row: PrayerRow, range?: IqamahRange, displayMode: DisplayMode = "adhan"): string[] {
  return PRAYERS.map((prayer) => {
    const adhan = `${title(prayer)} ${row[prayer]}`;
    return displayMode === "adhan" ? adhan : `${adhan}/${resolveIqamah(range?.[prayer], row[prayer], prayer)}`;
  });
}

export function formatPrayerStatus(row: PrayerRow, range?: IqamahRange, displayMode: DisplayMode = "adhan"): string {
  return `${displayMode === "adhan" ? "Prayer: " : ""}${prayerParts(row, range, displayMode).join(" · ")}`;
}

function title(value: string): string {
  return value[0]!.toUpperCase() + value.slice(1);
}

export async function fetchPrayerStatus(
  mosque: Mosque,
  displayMode: DisplayMode,
  now = new Date(),
  fetcher: typeof fetch = fetch,
): Promise<{
  key: string;
  text: string;
  row: PrayerRow;
  range?: IqamahRange;
  nextRow?: PrayerRow;
  nextRange?: IqamahRange;
}> {
  const date = localDate(now, mosque.timezone);
  const tomorrow = nextDate(date);
  const fetchMonth = async (month: string) => {
    const url = `${SITE_URL}/data/mosques/${mosque.countryCode.toLowerCase()}/${mosque.citySlug}/${mosque.slug}/${month}.json`;
    const response = await fetcher(url);
    if (!response.ok) throw new Error(`Prayer times request failed: ${response.status}`);
    return response.json() as Promise<MonthlyPrayerTimes>;
  };

  const data = await fetchMonth(date.month);
  const tomorrowData = tomorrow.month === date.month
    ? data
    : await fetchMonth(tomorrow.month).catch(() => undefined);
  const row = data.prayer_times.find((item) => item.date === date.day);
  if (!row) throw new Error(`No prayer times found for day ${date.day}`);
  const range = iqamahForDay(data.iqamah_times, date.day);
  return {
    key: `${mosque.slug}:${displayMode}:${date.key}`,
    text: formatPrayerStatus(row, range, displayMode),
    row,
    range,
    nextRow: tomorrowData?.prayer_times.find((item) => item.date === tomorrow.day),
    nextRange: iqamahForDay(tomorrowData?.iqamah_times, tomorrow.day),
  };
}

export default function (pi: ExtensionAPI) {
  let settings = loadSettings();
  let mosqueCache: Mosque[] | undefined;
  let loadedStatus: Awaited<ReturnType<typeof fetchPrayerStatus>> | undefined;
  let countdownTimer: ReturnType<typeof setInterval> | undefined;

  async function mosques() {
    return mosqueCache ??= await fetchMosques();
  }

  async function selectedMosque() {
    const available = await mosques();
    return available.find((item) => item.slug === settings.mosqueSlug)
      ?? available.find((item) => item.slug === DEFAULT_MOSQUE)
      ?? available[0];
  }

  async function update(ctx: ExtensionContext, force = false) {
    try {
      const mosque = await selectedMosque();
      if (!mosque) throw new Error("No mosques available");
      const now = new Date();
      const dateKey = `${mosque.slug}:${settings.displayMode}:${localDate(now, mosque.timezone).key}`;
      if (force || loadedStatus?.key !== dateKey) {
        loadedStatus = await fetchPrayerStatus(mosque, settings.displayMode, now);
      }

      const highlighted = getHighlightedPrayer(loadedStatus.row, loadedStatus.range, now, mosque.timezone);
      const text = prayerParts(loadedStatus.row, loadedStatus.range, settings.displayMode)
        .map((part, index) => PRAYERS[index] === highlighted
          ? ctx.ui.theme.fg("accent", ctx.ui.theme.bold(part))
          : ctx.ui.theme.fg("dim", part))
        .join(ctx.ui.theme.fg("dim", " · "));
      const prefix = settings.displayMode === "adhan" ? ctx.ui.theme.fg("dim", "Prayer: ") : "";
      const countdown = settings.showCountdown
        ? formatNextEventCountdown(
          loadedStatus.row,
          loadedStatus.range,
          loadedStatus.nextRow,
          loadedStatus.nextRange,
          now,
          mosque.timezone,
        )
        : null;
      const suffix = countdown ? ctx.ui.theme.fg("accent", ` · ${countdown}`) : "";
      ctx.ui.setStatus("prayer-times", prefix + text + suffix);
    } catch {
      ctx.ui.setStatus("prayer-times", ctx.ui.theme.fg("dim", "Prayer times unavailable"));
    }
  }

  function resetCountdownTimer(ctx: ExtensionContext) {
    if (countdownTimer) clearInterval(countdownTimer);
    countdownTimer = settings.showCountdown ? setInterval(() => void update(ctx), 60_000) : undefined;
  }

  pi.on("session_start", async (_event, ctx) => {
    await update(ctx);
    resetCountdownTimer(ctx);
  });
  pi.on("turn_start", (_event, ctx) => update(ctx));
  pi.on("session_shutdown", () => {
    if (countdownTimer) clearInterval(countdownTimer);
  });

  pi.registerCommand("prayer-settings", {
    description: "Choose mosque, prayer display, and next-event countdown",
    handler: async (_args, ctx) => {
      let available: Mosque[];
      try {
        available = await mosques();
      } catch {
        ctx.ui.notify("Could not load mosques", "error");
        return;
      }

      const countries = [...new Map(available.map((item) => [item.countryCode, item.countryName])).entries()]
        .sort((a, b) => a[1].localeCompare(b[1]));
      const countryName = await ctx.ui.select("Country:", countries.map(([, name]) => name));
      if (!countryName) return;
      const countryCode = countries.find(([, name]) => name === countryName)?.[0];

      const inCountry = available.filter((item) => item.countryCode === countryCode);
      const cities = [...new Map(inCountry.map((item) => [item.citySlug, item.cityName])).entries()]
        .sort((a, b) => a[1].localeCompare(b[1]));
      const cityName = await ctx.ui.select("City:", cities.map(([, name]) => name));
      if (!cityName) return;
      const citySlug = cities.find(([, name]) => name === cityName)?.[0];

      const inCity = inCountry.filter((item) => item.citySlug === citySlug);
      const mosqueName = await ctx.ui.select("Mosque:", inCity.map((item) => item.name));
      if (!mosqueName) return;
      const mosque = inCity.find((item) => item.name === mosqueName);
      if (!mosque) return;

      const modeLabel = await ctx.ui.select("Display:", ["Adhan only", "Adhan and Iqamah"]);
      if (!modeLabel) return;
      const countdownLabel = await ctx.ui.select("Countdown:", ["Off", "Next Adhan or Iqamah"]);
      if (!countdownLabel) return;

      settings = {
        mosqueSlug: mosque.slug,
        displayMode: modeLabel === "Adhan and Iqamah" ? "adhan-iqamah" : "adhan",
        showCountdown: countdownLabel !== "Off",
      };
      saveSettings(settings);
      await update(ctx, true);
      resetCountdownTimer(ctx);
      ctx.ui.notify(`Prayer times: ${mosque.name} · ${modeLabel} · Countdown ${countdownLabel}`, "info");
    },
  });
}
