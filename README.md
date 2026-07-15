# @mwijanarko1/pi-prayer-times

Pi extension that shows today's mosque prayer times beneath the editor.

Prayer data comes from the public [Sheffield Masjids](https://www.sheffieldmasjids.com) timetable feed, which includes mosques across multiple countries and cities.

## Install

```bash
pi install npm:@mwijanarko1/pi-prayer-times
```

Or from GitHub:

```bash
pi install git:github.com/mwijanarko1/pi-prayer-times
```

Then run `/reload` or restart Pi.

## Configure

Run:

```text
/prayer-settings
```

Choose:

1. Country
2. City
3. Mosque
4. `Adhan only` or `Adhan and Iqamah`

The default is Muslim Welfare House Sheffield with Adhan-only times.

Settings are stored in:

```text
~/.pi/agent/pi-prayer-times.json
```

## Footer examples

Adhan only:

```text
Prayer: Fajr 03:46 · Dhuhr 13:12 · Asr 17:34 · Maghrib 21:30 · Isha 22:36
```

Adhan and Iqamah:

```text
Prayer (Adhan/Iqamah): Fajr 03:46/04:00 · Dhuhr 13:12/13:30 · Asr 17:34/18:15 · Maghrib 21:30/21:30 · Isha 22:36/22:36
```

Times refresh when Pi starts and after midnight in the selected mosque's timezone.

## Development

```bash
bun test
npm pack --dry-run
pi -e /absolute/path/to/pi-prayer-times
```

## Data attribution

Prayer timetable data: [Sheffield Masjids](https://www.sheffieldmasjids.com).

## License

MIT
