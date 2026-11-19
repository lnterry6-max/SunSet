# SunSet ☀️

**Find your golden hour.** A responsive web app for exploring real mapped places to watch sunrise and sunset near any city or town.

## Features

- Search by city, state, country, or (with permission) current device location.
- Set a radius from **1–50 miles**.
- Switch between **sunrise** and **sunset**, with today's astronomical time for the location.
- Filter scenic locations into **waterfront, mountains, coast, lookouts, and parks**.
- Browse an interactive OpenStreetMap map, sort by scenic estimate or distance, and open Google Maps directions.
- Save favorite spots and add **your own 1–5 star rating** locally in your browser.
- Mobile-friendly, accessible controls, loading/error/empty states, and no account or API keys required.

## Getting started

This is a static website with no build step.

```bash
python3 -m http.server 5173
```

Open `http://localhost:5173` in your browser. Or deploy the repository to **GitHub Pages** (root of `main`) or **Vercel** as a static site.

> Do not open `index.html` with a `file://` URL; browser restrictions may prevent API calls. Use a local web server or public deployment.

## Where the data comes from

- **Cities:** [Open-Meteo Geocoding API](https://open-meteo.com/en/docs/geocoding-api)
- **Sunrise and sunset:** [Open-Meteo Forecast API](https://open-meteo.com/en/docs)
- **Scenic places:** [OpenStreetMap](https://www.openstreetmap.org/copyright) via public [Overpass API](https://wiki.openstreetmap.org/wiki/Overpass_API)
- **Map:** [Leaflet](https://leafletjs.com/) and OpenStreetMap tile servers
- **Photos:** thematic illustrations from [Unsplash](https://unsplash.com/), **not photographs of the specific recommended places**

## How ratings work

The **estimated view score** is a simple heuristic based on a place's mapped type (viewpoint, peak, beach, park, etc.) plus some available tags. It is **not** an average of visitor reviews, terrain analysis, a verified obstruction-free sightline, a guarantee of solar visibility, or a recommendation of safe public access. A person's **own 1–5 star rating** is saved only to their browser's local storage, along with favorites. For real community averages, add authentication, a backend, and moderation in a later version.

Distances are **straight-line miles**, not travel distances; directions links use Google Maps. Parks and trails may close before sunrise or sunset. Verify access, safety, terrain, and weather before traveling.

## Development and production notes

- Public Overpass servers are shared community infrastructure. They may be slow, rate-limited, or temporarily unavailable. The app falls back to a second public endpoint and shows an error instead of inventing locations. For high traffic, add server-side caching and a dedicated data source/hosted provider.
- The public geocoding service is intended for reasonable use, and [Open-Meteo's conditions](https://open-meteo.com/en/terms) may require a paid subscription for commercial use.
- OpenStreetMap tiles require proper attribution; larger deployments should use a tile provider aligned with its [usage policy](https://operations.osmfoundation.org/policies/tiles/).
- `app.js` has no server component, which makes this starter easy to host. Real crowdsourced ratings and real location photos need later integrations.

## Potential next steps

Verified viewpoint orientation and horizon obstructions; cloud forecast at the actual solar event; GPS navigation and saved itineraries; public spot submissions with moderated image reviews; town-by-town pages and social sharing.

## Faster searching (v2)

- Place search and sunrise/sunset times load independently of slower scenic-data requests; the map's search area appears as soon as a city is resolved.
- Recent geocoding and solar lookups are cached in the browser (30 days and 30 minutes respectively).
- Scenic results are cached for **7 days** in the browser; repeat searches and narrower radii can appear instantly. Results older than 3 days are refreshed in the background, while existing results remain visible.
- The radius slider automatically updates the search after you release it.
- Public Overpass responses are deliberately bounded and timeout/fallback behavior is explicit rather than allowing an indefinite spinner.
- Result photos load lazily, with a smaller hero photo.

The **first uncached search** may still take several seconds when public OpenStreetMap/Overpass servers are busy. For guaranteed fast results at scale, the next step is a hosted cache or a dedicated indexed scenic-place database. Cached locations may change in the real world; always confirm public access.

## Version 3: Personal spot contributions (November 2026)

SunSet now supports **locally saved personal spot submissions** in the existing responsive website:

- **Add my spot** opens a form with the viewing point's name, scenery, sunrise/sunset suitability, latitude/longitude, access classification, optional travel methods, local tips, and the user's own star rating.
- The **map pin picker** lets visitors select the actual viewing coordinates from the map. Enter *only the publicly accessible viewing point*; never submit private-property coordinates or imply landowner permission.
- User spots appear alongside mapped places inside the search radius and are removable via **Delete**. They survive reloads through browser local storage; clearing browser data removes them.
- New **My spots**, **Access**, and **Get there** filters distinguish locally reported information from OpenStreetMap tags. Only explicitly tagged transport access is treated as known; unspecified access is unverified.
- Each visible spot gets its own astronomical sunrise/sunset time from a **batched Open-Meteo coordinate request**, with an **arrive 30 minutes early** suggestion. Results are cached; times depend on the spot's reported coordinates and do not guarantee a clear horizon.
- Default sorting is nearest first, not a made-up community ranking. Prior scenic estimates remain clearly labeled as estimates. Personal stars are **not** public community averages.

> **Important beta limitation:** The app has **no shared user database yet**. Added spots and ratings are visible only on the device where they were saved; they are **not published or submitted to SunSet's servers**, and there is no login, photo upload, verified access status, or public rating average. Avoid promising visitors features that require the next backend phase.

### Next phase — secure shared community

Use a dedicated SunSet backend, separate from unrelated projects (e.g. AutoType). Before enabling public contributions:

1. Enable authentication or abuse-resistant, moderated submission controls.
2. Store spots with owner, **public viewing coordinates**, category, known access modes, scenery description, opening-hour notes, and pending/approved/rejected moderation state.
3. Store each member's 1–5 star review separately (one active rating per member/spot); compute displayed averages from **approved reviews**, with a review count. Ratings from personal devices cannot be aggregated without consent and user accounts.
4. Moderate photos and reports, guard against private-property and unsafe location submissions, and allow corrections/takedowns.
5. Apply row-level security so submitted pending spots remain private, only approved spots/reviews appear publicly, and only authorized users can edit their own submissions.
6. Confirm access using user reports, map tags, and authoritative parks/trails information. Label uncertainty and never imply an unknown location is publicly accessible.
7. Optimize shared caching and map searches using a server-side index so first-time searches do not depend on slow public Overpass responses.

No backend project was created or billed as part of this release.