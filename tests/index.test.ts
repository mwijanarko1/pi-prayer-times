import { expect, test } from "bun:test";
import {
  fetchPrayerStatus,
  formatPrayerStatus,
  iqamahForDay,
  normalizeMosque,
  resolveIqamah,
  type Mosque,
} from "../extensions/index";

const mosque: Mosque = {
  name: "Muslim Welfare House Sheffield",
  slug: "muslim-welfare-house",
  citySlug: "sheffield",
  cityName: "Sheffield",
  countryCode: "GB",
  countryName: "United Kingdom",
  timezone: "Europe/London",
};

const row = { date: 15, fajr: "03:46", dhuhr: "13:12", asr: "17:34", maghrib: "21:30", isha: "22:36" };
const range = { date_range: "11-20", fajr: "04:00", dhuhr: "13:30", asr: "18:15", isha: "Entry Time" };

test("normalizes legacy Sheffield mosque entries", () => {
  expect(normalizeMosque({ name: "MWHS", slug: "muslim-welfare-house" })).toMatchObject({
    citySlug: "sheffield",
    countryCode: "GB",
    timezone: "Europe/London",
  });
});

test("selects an iqamah date range and resolves relative values", () => {
  expect(iqamahForDay([range], 15)).toBe(range);
  expect(resolveIqamah("Adhan + 10 mins", "05:20", "fajr")).toBe("05:30");
  expect(resolveIqamah(undefined, "21:30", "maghrib")).toBe("21:30");
});

test("formats Adhan-only and Adhan/Iqamah statuses", () => {
  expect(formatPrayerStatus(row)).toBe(
    "Prayer: Fajr 03:46 · Dhuhr 13:12 · Asr 17:34 · Maghrib 21:30 · Isha 22:36",
  );
  expect(formatPrayerStatus(row, range, "adhan-iqamah")).toBe(
    "Fajr 03:46/04:00 · Dhuhr 13:12/13:30 · Asr 17:34/18:15 · Maghrib 21:30/21:30 · Isha 22:36/22:36",
  );
});

test("loads the selected mosque's local monthly timetable", async () => {
  let requested = "";
  const fetcher = (async (url: string | URL | Request) => {
    requested = String(url);
    return new Response(JSON.stringify({ prayer_times: [row], iqamah_times: [range] }));
  }) as typeof fetch;

  const status = await fetchPrayerStatus(mosque, "adhan", new Date("2026-07-15T12:00:00Z"), fetcher);

  expect(requested).toEndWith("/data/mosques/gb/sheffield/muslim-welfare-house/july.json");
  expect(status.text).toContain("Fajr 03:46");
});
