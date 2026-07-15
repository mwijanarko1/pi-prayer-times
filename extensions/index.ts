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

const DEFAULT_SETTINGS: Settings = { mosqueSlug: DEFAULT_MOSQUE, displayMode: "adhan" };
const PRAYERS = ["fajr", "dhuhr", "asr", "maghrib", "isha"] as const;

function loadSettings(): Settings {
  try {
    if (existsSync(SETTINGS_PATH)) {
      const value = JSON.parse(readFileSync(SETTINGS_PATH, "utf8")) as Partial<Settings>;
      if (value.mosqueSlug && (value.displayMode === "adhan" || value.displayMode === "adhan-iqamah")) {
        return { mosqueSlug: value.mosqueSlug, displayMode: value.displayMode };
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

function localDate(now: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    year: "numeric",
    month: "long",
    day: "numeric",
  }).formatToParts(now);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value ?? "";
  return {
    key: `${part("year")}-${part("month")}-${part("day")}`,
    month: part("month").toLowerCase(),
    day: Number(part("day")),
  };
}

function addMinutes(time: string, amount: number): string | null {
  const [hours, minutes] = time.split(":").map(Number);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null;
  const total = (hours * 60 + minutes + amount) % 1440;
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
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

export function formatPrayerStatus(row: PrayerRow, range?: IqamahRange, displayMode: DisplayMode = "adhan"): string {
  if (displayMode === "adhan") {
    return `Prayer: ${PRAYERS.map((prayer) => `${title(prayer)} ${row[prayer]}`).join(" · ")}`;
  }

  return PRAYERS.map((prayer) => {
    const iqamah = resolveIqamah(range?.[prayer], row[prayer], prayer);
    return `${title(prayer)} ${row[prayer]}/${iqamah}`;
  }).join(" · ");
}

function title(value: string): string {
  return value[0]!.toUpperCase() + value.slice(1);
}

export async function fetchPrayerStatus(
  mosque: Mosque,
  displayMode: DisplayMode,
  now = new Date(),
  fetcher: typeof fetch = fetch,
): Promise<{ key: string; text: string }> {
  const date = localDate(now, mosque.timezone);
  const url = `${SITE_URL}/data/mosques/${mosque.countryCode.toLowerCase()}/${mosque.citySlug}/${mosque.slug}/${date.month}.json`;
  const response = await fetcher(url);
  if (!response.ok) throw new Error(`Prayer times request failed: ${response.status}`);

  const data = await response.json() as MonthlyPrayerTimes;
  const row = data.prayer_times.find((item) => item.date === date.day);
  if (!row) throw new Error(`No prayer times found for day ${date.day}`);
  return {
    key: `${mosque.slug}:${displayMode}:${date.key}`,
    text: formatPrayerStatus(row, iqamahForDay(data.iqamah_times, date.day), displayMode),
  };
}

export default function (pi: ExtensionAPI) {
  let settings = loadSettings();
  let mosqueCache: Mosque[] | undefined;
  let loadedKey = "";

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
      const dateKey = `${mosque.slug}:${settings.displayMode}:${localDate(new Date(), mosque.timezone).key}`;
      if (!force && loadedKey === dateKey) return;

      const status = await fetchPrayerStatus(mosque, settings.displayMode);
      loadedKey = status.key;
      ctx.ui.setStatus("prayer-times", ctx.ui.theme.fg("dim", status.text));
    } catch {
      ctx.ui.setStatus("prayer-times", ctx.ui.theme.fg("dim", "Prayer times unavailable"));
    }
  }

  pi.on("session_start", (_event, ctx) => update(ctx));
  pi.on("turn_start", (_event, ctx) => update(ctx));

  pi.registerCommand("prayer-settings", {
    description: "Choose country, city, mosque, and Adhan/Iqamah display",
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

      settings = {
        mosqueSlug: mosque.slug,
        displayMode: modeLabel === "Adhan and Iqamah" ? "adhan-iqamah" : "adhan",
      };
      saveSettings(settings);
      await update(ctx, true);
      ctx.ui.notify(`Prayer times: ${mosque.name} · ${modeLabel}`, "info");
    },
  });
}
