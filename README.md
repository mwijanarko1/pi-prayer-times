# pi-masjidly-prayer-times

![Current prayer highlighted in the Pi footer](assets/prayer-times-highlight.png)

Pi extension that shows today's mosque prayer times beneath the editor.

Prayer data comes from Masjidly and includes mosques across multiple countries and cities.

## Install

```bash
pi install npm:pi-masjidly-prayer-times
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
5. Turn the next Adhan/Iqamah countdown on or off

The default is Muslim Welfare House Sheffield with Adhan-only times and the countdown on.

Settings are stored in:

```text
~/.pi/agent/pi-prayer-times.json
```

## Footer examples

Adhan only:

```text
Prayer: Fajr 03:46 · Dhuhr 13:12 · Asr 17:34 · Maghrib 21:30 · Isha 22:36
```

Adhan and Iqamah with countdown:

```text
Fajr 03:46/04:00 · Dhuhr 13:12/13:30 · Asr 17:34/18:15 · Maghrib 21:30/21:30 · Isha 22:36/22:36 · Next: Dhuhr Iqamah in 10m
```

The upcoming prayer is highlighted using the mosque's Iqamah schedule. When enabled, the countdown refreshes every minute and automatically selects the next Adhan or Iqamah.

## Development

```bash
bun test
npm pack --dry-run
pi -e /absolute/path/to/pi-prayer-times
```

## Data attribution

Prayer timetable data: Masjidly.

## License

MIT
