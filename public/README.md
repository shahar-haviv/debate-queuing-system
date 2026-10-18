# Static assets

## `ru-debate.png` — the app logo

Save the official RU DEBATE artwork here, **exactly** with this filename:

```
public/ru-debate.png
```

It is picked up automatically — no code change needed — and is used for:

- the browser tab icon (favicon) and the iOS/Android home-screen icon
- the brand mark on the sign-in screen
- the brand mark in the dashboard header
- the header of each candidate's public status page

A square image works best (the supplied logo is already square). 512×512 or
larger is ideal, since the same file is used for the favicon and the
home-screen icon.

Until the file exists, the UI falls back to a plain **CQ** badge rather than
showing a broken image, so it is safe to deploy before the artwork lands.
