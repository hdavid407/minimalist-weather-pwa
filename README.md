# Minimalist Weather (PWA) — Runners & Cyclists

Minimal, iOS-style weather app with a 12-hour vertical forecast and activity safety indicators tuned for running or cycling.

- Forecast & geocoding: **Open-Meteo**
- Air quality: **Farmsense** (optional) or **Open-Meteo Air Quality** fallback
- Built with **Vite + React + Tailwind CSS** and **vite-plugin-pwa**

## Quick start

```bash
npm i
npm run dev
```

Optional env vars (copy `.env.example` to `.env` and edit):
- `VITE_BASE` — set to `/<your-repo>/` for GitHub Pages
- `VITE_FARMSENSE_URL` — Farmsense-style endpoint with `{lat}` and `{lon}` placeholders
- `VITE_DEFAULT_CITY`, `VITE_DEFAULT_LAT`, `VITE_DEFAULT_LON` — fallback location

## Deploy to GitHub Pages (PWA)

1. Create a new GitHub repo and push this project.
2. Set your **base path** for Pages:

   - Edit `.env` (or set an env var) with your repo name:
     ```
     VITE_BASE=/<your-repo>/
     ```
   - Alternatively, edit `vite.config.js` and hardcode `base: '/<your-repo>/'`.

3. Build and publish the `dist/` folder to the `gh-pages` branch:
   ```bash
   npm run deploy
   ```

   The script builds and pushes to `gh-pages`. The first run may ask you to create the branch.

4. In **GitHub → Settings → Pages**, set:
   - **Source**: `Deploy from a branch`
   - **Branch**: `gh-pages` / `(root)`

5. Visit: `https://<your-username>.github.io/<your-repo>/`

### Notes for PWA on Pages
- HTTPS is automatic on Pages — great for PWA install.
- The PWA uses `registerType: 'autoUpdate'` and caches weather APIs with a short `NetworkFirst` strategy.
- If your app is under a subpath (`/<repo>/`), `VITE_BASE` ensures correct asset and service-worker paths.
- After first load, refresh once to ensure the service worker controls the page.

## Scripts
- `npm run dev` — local dev server
- `npm run build` — production build
- `npm run preview` — preview build locally
- `npm run deploy` — build & publish to `gh-pages`

## License
MIT — use it however you'd like.
