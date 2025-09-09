// Minimalist Weather App for Runners & Cyclists
// Single-file React app. Tailwind CSS recommended. No extra UI libs required.
// 
// APIs used:
// - Open-Meteo Forecast: https://api.open-meteo.com/v1/forecast
// - Open-Meteo Geocoding: https://geocoding-api.open-meteo.com/v1/search
// - Farmsense (optional): Set VITE_FARMSENSE_URL to a pollen/air-quality endpoint if you have one.
//   If not provided or unreachable, the app falls back to Open-Meteo Air Quality: https://air-quality-api.open-meteo.com/v1/air-quality
//
// Env vars (optional):
// - VITE_FARMSENSE_URL (e.g., "https://your-farmsense.example.com/air?lat={lat}&lon={lon}")
// - VITE_DEFAULT_CITY (fallback city name; default "New York")
// - VITE_DEFAULT_LAT, VITE_DEFAULT_LON (fallback coordinates; default NYC)
//
// Notes:
// - This file exports a default React component. Drop it into a Vite/CRA app and ensure Tailwind is configured.
// - The design is intentionally minimalist, inspired by iOS Weather.
// - No external chart libs; the 12-hour forecast is shown as clean, scrollable cards.
//
// ---------------------------------------------------------------
import React, { useEffect, useMemo, useRef, useState } from "react";

// ---------- Types ----------
type Units = "metric" | "imperial"; // metric = C, km/h; imperial = F, mph

type Activity = "running" | "cycling";

type HourPoint = {
  time: string; // ISO
  tempC: number;
  precipMm: number;
  precipProb: number; // 0-100
  windKmh: number;
  weatherCode: number; // Open-Meteo weathercode
  aqiUS?: number | null;
};

type CurrentWeather = {
  tempC: number;
  windKmh: number;
  weatherCode: number;
  aqiUS?: number | null;
};

type ForecastPack = {
  current: CurrentWeather | null;
  next12h: HourPoint[];
};

// ---------- Utilities ----------
const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "auto";

const DEFAULT_CITY = (import.meta as any)?.env?.VITE_DEFAULT_CITY || "New York";
const DEFAULT_LAT = parseFloat((import.meta as any)?.env?.VITE_DEFAULT_LAT) || 40.7128;
const DEFAULT_LON = parseFloat((import.meta as any)?.env?.VITE_DEFAULT_LON) || -74.0060;
const FARMSENSE_URL_TEMPLATE = (import.meta as any)?.env?.VITE_FARMSENSE_URL || ""; // optional

function cToF(c: number) { return (c * 9) / 5 + 32; }
function kmhToMph(k: number) { return k / 1.60934; }

function fmtTemp(tempC: number, units: Units) {
  return units === "imperial" ? Math.round(cToF(tempC)) + "°F" : Math.round(tempC) + "°C";
}

function fmtWind(kmh: number, units: Units) {
  return units === "imperial" ? Math.round(kmhToMph(kmh)) + " mph" : Math.round(kmh) + " km/h";
}

function hourLabel(iso: string) {
  const d = new Date(iso);
  const h = d.getHours();
  const ampm = h >= 12 ? "PM" : "AM";
  const hour12 = h % 12 || 12;
  return `${hour12}${ampm}`;
}

function weatherEmoji(code: number) {
  // Minimal iconography mapping for Open-Meteo weather codes
  if ([0].includes(code)) return "☀️"; // clear
  if ([1, 2].includes(code)) return "🌤️"; // mostly clear/partly cloudy
  if ([3].includes(code)) return "☁️"; // overcast
  if ([45, 48].includes(code)) return "🌫️"; // fog
  if ([51, 53, 55, 61, 63, 65, 80, 81, 82].includes(code)) return "🌧️"; // drizzle/rain
  if ([66, 67, 71, 73, 75, 85, 86].includes(code)) return "🌨️"; // freezing rain/snow
  if ([95, 96, 99].includes(code)) return "⛈️"; // thunder
  return "🌡️";
}

// Risk scoring tuned for runners/cyclists
function safetyScore(p: { activity: Activity; tempC: number; windKmh: number; precipMm: number; precipProb: number; aqiUS?: number | null; weatherCode?: number; }) {
  const { activity, tempC, windKmh, precipMm, precipProb, aqiUS } = p;
  let score = 0;

  // Temperature
  if (activity === "running") {
    if (tempC >= 7 && tempC <= 18) score += 0; // ideal
    else if ((tempC > 18 && tempC <= 26) || (tempC >= -5 && tempC < 7)) score += 1;
    else score += 2; // < -5 or > 26
  } else { // cycling
    if (tempC >= 10 && tempC <= 24) score += 0;
    else if ((tempC > 24 && tempC <= 30) || (tempC >= 0 && tempC < 10)) score += 1;
    else score += 2; // < 0 or > 30
  }

  // Wind
  if (activity === "running") {
    if (windKmh <= 25) score += 0;
    else if (windKmh <= 39) score += 1;
    else score += 2;
  } else {
    if (windKmh <= 20) score += 0;
    else if (windKmh <= 32) score += 1;
    else score += 2;
  }

  // Precipitation
  if (precipMm >= 3) score += 2; // heavy
  else if (precipMm >= 1 || precipProb >= 50) score += 1;

  // Air Quality (US AQI if available)
  if (typeof aqiUS === "number") {
    if (aqiUS <= 50) score += 0;
    else if (aqiUS <= 100) score += 1;
    else score += 2;
  }
  return score; // 0-? lower is better
}

function scoreToLevel(score: number): "green" | "yellow" | "red" {
  if (score <= 2) return "green";
  if (score <= 4) return "yellow";
  return "red";
}

function levelLabel(level: "green" | "yellow" | "red") {
  if (level === "green") return "Ideal for outdoors";
  if (level === "yellow") return "Caution advised";
  return "Not recommended";
}

function levelClasses(level: "green" | "yellow" | "red") {
  return {
    green: "bg-green-500 text-white",
    yellow: "bg-yellow-500 text-black",
    red: "bg-red-600 text-white",
  }[level];
}

function dotClasses(level: "green" | "yellow" | "red") {
  return {
    green: "bg-green-500",
    yellow: "bg-yellow-500",
    red: "bg-red-600",
  }[level];
}

// ---------- Local Storage Hook ----------
function useLocalStorage<T>(key: string, initial: T) {
  const [state, setState] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(key);
      return raw ? (JSON.parse(raw) as T) : initial;
    } catch {
      return initial;
    }
  });
  useEffect(() => {
    try { localStorage.setItem(key, JSON.stringify(state)); } catch {}
  }, [key, state]);
  return [state, setState] as const;
}

// ---------- Data Fetchers ----------
async function geocodeCity(name: string) {
  const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(name)}&count=1&language=en&format=json`;
  const r = await fetch(url);
  if (!r.ok) throw new Error("Geocoding failed");
  const j = await r.json();
  if (!j?.results?.length) throw new Error("No results for that place");
  const g = j.results[0];
  return { lat: g.latitude as number, lon: g.longitude as number, city: g.name as string, country: g.country as string };
}

async function fetchForecast(lat: number, lon: number): Promise<ForecastPack> {
  const now = new Date();
  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
    `&hourly=temperature_2m,precipitation,precipitation_probability,windspeed_10m,weathercode` +
    `&current_weather=true&timezone=${encodeURIComponent(tz)}`;

  const r = await fetch(url);
  if (!r.ok) throw new Error("Weather fetch failed");
  const j = await r.json();

  const hourly = j.hourly;
  const times: string[] = hourly.time || [];
  const tC: number[] = hourly.temperature_2m || [];
  const pr: number[] = hourly.precipitation || [];
  const prp: number[] = hourly.precipitation_probability || [];
  const wind: number[] = hourly.windspeed_10m || [];
  const codes: number[] = hourly.weathercode || [];

  // Find index for now and collect next 12 hours
  const idxNow = times.findIndex((iso: string) => new Date(iso).getTime() >= now.getTime() - 30 * 60 * 1000);
  const start = Math.max(0, idxNow);
  const next12: HourPoint[] = Array.from({ length: 12 }).map((_, i) => {
    const k = start + i;
    return {
      time: times[k],
      tempC: tC[k],
      precipMm: pr[k],
      precipProb: prp[k] ?? 0,
      windKmh: wind[k],
      weatherCode: codes[k],
    };
  }).filter(Boolean);

  const curr: CurrentWeather | null = j.current_weather
    ? { tempC: j.current_weather.temperature, windKmh: j.current_weather.windspeed, weatherCode: j.current_weather.weathercode }
    : null;

  return { current: curr, next12h: next12 };
}

async function fetchAirQuality(lat: number, lon: number, useFarmSenseFirst = true): Promise<{ currentAQI?: number | null; perHourAQI?: Record<string, number>; note?: string; }> {
  // Try Farmsense-style endpoint if provided, otherwise fallback to Open-Meteo AQI
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "auto";
  if (useFarmSenseFirst && (import.meta as any)?.env?.VITE_FARMSENSE_URL) {
    try {
      const href = (import.meta as any).env.VITE_FARMSENSE_URL
        .replace("{lat}", String(lat))
        .replace("{lon}", String(lon));
      const rf = await fetch(href);
      if (!rf.ok) throw new Error("Farmsense fetch failed");
      const jf = await rf.json();
      // Expecting schema like { aqi_us: number, hourly: [{ time, aqi_us }] }
      const currentAQI = (jf?.aqi_us ?? jf?.aqi ?? null) as number | null;
      const perHourAQI: Record<string, number> = {};
      if (Array.isArray(jf?.hourly)) {
        for (const h of jf.hourly) {
          if (h?.time && typeof h?.aqi_us === "number") perHourAQI[h.time] = h.aqi_us;
        }
      }
      return { currentAQI, perHourAQI, note: "Using Farmsense endpoint" };
    } catch (e) {
      // fall through to Open-Meteo AQ
    }
  }

  // Fallback: Open-Meteo Air Quality
  try {
    const url = `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${lat}&longitude=${lon}&hourly=us_aqi&timezone=${encodeURIComponent(tz)}`;
    const r = await fetch(url);
    if (!r.ok) throw new Error("AQ fetch failed");
    const j = await r.json();
    const out: Record<string, number> = {};
    const times: string[] = j.hourly?.time || [];
    const aqi: number[] = j.hourly?.us_aqi || [];
    times.forEach((t: string, i: number) => { if (typeof aqi[i] === "number") out[t] = aqi[i]; });

    // pick nearest hour to now
    let currentAQI: number | null = null;
    const now = new Date();
    let minDiff = Infinity;
    times.forEach((t: string, i: number) => {
      const diff = Math.abs(new Date(t).getTime() - now.getTime());
      if (diff < minDiff) { minDiff = diff; currentAQI = aqi[i]; }
    });

    return { currentAQI, perHourAQI: out, note: "Using Open-Meteo Air Quality" };
  } catch (e) {
    return { currentAQI: null, perHourAQI: {}, note: "Air quality unavailable" };
  }
}

// ---------- Main Component ----------
export default function WeatherApp() {
  const [units, setUnits] = useLocalStorage<Units>("units", "metric");
  const [activity, setActivity] = useLocalStorage<Activity>("activity", "running");
  const [city, setCity] = useLocalStorage<string>("city", DEFAULT_CITY);
  const [coords, setCoords] = useLocalStorage<{ lat: number; lon: number }>("coords", { lat: DEFAULT_LAT, lon: DEFAULT_LON });
  const [search, setSearch] = useState("");

  const [pack, setPack] = useState<ForecastPack>({ current: null, next12h: [] });
  const [aqNote, setAqNote] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Geolocate on first load (best effort)
  const geolocatedRef = useRef(false);
  useEffect(() => {
    if (geolocatedRef.current) return;
    geolocatedRef.current = true;
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const { latitude, longitude } = pos.coords;
          setCoords({ lat: latitude, lon: longitude });
          reverseGeocode(latitude, longitude).then((name) => name && setCity(name)).catch(() => {});
        },
        () => {},
        { enableHighAccuracy: true, timeout: 8000 }
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function reverseGeocode(lat: number, lon: number): Promise<string | null> {
    try {
      const url = `https://geocoding-api.open-meteo.com/v1/reverse?latitude=${lat}&longitude=${lon}&count=1&language=en&format=json`;
      const r = await fetch(url);
      if (!r.ok) return null;
      const j = await r.json();
      const hit = j?.results?.[0];
      return hit ? `${hit.name}` : null;
    } catch {
      return null;
    }
  }

  // Fetch data on coords change & every 10 minutes
  useEffect(() => {
    let alive = true;
    async function load() {
      setLoading(true); setError(null);
      try {
        const [fc, aq] = await Promise.all([
          fetchForecast(coords.lat, coords.lon),
          fetchAirQuality(coords.lat, coords.lon, true),
        ]);

        if (!alive) return;

        // Blend AQI into hourly points and current
        const perHourAQI = aq.perHourAQI || {};
        const next12h = fc.next12h.map((h) => ({ ...h, aqiUS: perHourAQI[h.time] ?? null }));
        const current = fc.current ? { ...fc.current, aqiUS: aq.currentAQI ?? null } : null;

        setPack({ current, next12h });
        setAqNote(aq.note || "");
      } catch (e: any) {
        setError(e?.message || "Failed to load data");
      } finally {
        setLoading(false);
      }
    }
    load();

    const id = setInterval(load, 10 * 60 * 1000); // 10 minutes
    return () => { alive = false; clearInterval(id); };
  }, [coords.lat, coords.lon]);

  const currentLevel = useMemo(() => {
    if (!pack.current) return null;
    const s = safetyScore({
      activity,
      tempC: pack.current.tempC,
      windKmh: pack.current.windKmh,
      precipMm: pack.next12h[0]?.precipMm ?? 0,
      precipProb: pack.next12h[0]?.precipProb ?? 0,
      aqiUS: pack.current.aqiUS ?? undefined,
      weatherCode: pack.current.weatherCode,
    });
    return scoreToLevel(s);
  }, [pack.current, pack.next12h, activity]);

  // Handlers
  async function onSearch(e: React.FormEvent) {
    e.preventDefault();
    if (!search.trim()) return;
    try {
      setLoading(true); setError(null);
      const g = await geocodeCity(search.trim());
      setCoords({ lat: g.lat, lon: g.lon });
      setCity(`${g.city}${g.country ? ", " + g.country : ""}`);
      setSearch("");
    } catch (e: any) {
      setError(e?.message || "Could not find that place");
    } finally {
      setLoading(false);
    }
  }

  // Use the browser geolocation to set current coords and city (best-effort)
  function useCurrentLocation(e?: React.MouseEvent) {
    e?.preventDefault();
    if (!navigator.geolocation) {
      setError("Geolocation not supported in this browser");
      return;
    }
    setLoading(true);
    setError(null);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const { latitude, longitude } = pos.coords;
        setCoords({ lat: latitude, lon: longitude });
        try {
          const name = await reverseGeocode(latitude, longitude);
          if (name) setCity(name);
        } catch {
          // ignore reverse geocode failure, coords are set at least
        }
        setLoading(false);
      },
      (err) => {
        setError(err?.message || "Failed to get current location");
        setLoading(false);
      },
      { enableHighAccuracy: true, timeout: 8000 }
    );
  }

  // Derived
  const unitTemp = (v: number) => fmtTemp(v, units);
  const unitWind = (v: number) => fmtWind(v, units);

  return (
    <div className="min-h-screen w-full bg-gradient-to-b from-slate-900 to-slate-800 text-slate-100 flex flex-col items-stretch">
      {/* Top Bar */}
      <header className="px-4 pt-6 pb-3 flex items-center justify-between">
        <div className="flex flex-col">
          <div className="text-slate-300 text-xs">Location</div>
          <div className="text-xl font-semibold tracking-tight">{city}</div>
        </div>
        <div className="flex items-center gap-2">
          <button
            className={`px-3 py-1 rounded-full text-xs border border-slate-600 ${units === "metric" ? "bg-slate-700" : "bg-transparent"}`}
            onClick={() => setUnits("metric")}
          >°C</button>
          <button
            className={`px-3 py-1 rounded-full text-xs border border-slate-600 ${units === "imperial" ? "bg-slate-700" : "bg-transparent"}`}
            onClick={() => setUnits("imperial")}
          >°F</button>
        </div>
      </header>

      {/* Current */}
      <section className="px-4">
        <div className="rounded-3xl bg-slate-800/60 border border-slate-700 p-5 flex items-center justify-between">
          <div className="flex-1">
            <div className="text-slate-300 text-sm">Now</div>
            <div className="flex items-baseline gap-3">
              <div className="text-6xl font-bold leading-none">
                {pack.current ? unitTemp(pack.current.tempC) : "--"}
              </div>
              {pack.current && (
                <div className="text-slate-300">
                  {weatherEmoji(pack.current.weatherCode)}
                </div>
              )}
            </div>
            <div className="mt-2 text-sm text-slate-300">
              Wind {pack.current ? unitWind(pack.current.windKmh) : "--"}
              {typeof pack.current?.aqiUS === "number" && (
                <span className="ml-3">AQI {Math.round(pack.current.aqiUS!)}</span>
              )}
            </div>
          </div>
          <div className="w-px h-16 bg-slate-700 mx-4" />
          <div className="flex flex-col items-end gap-2">
            <div className={`px-3 py-1 rounded-full text-xs font-medium ${currentLevel ? levelClasses(currentLevel) : "bg-slate-700"}`}>
              {currentLevel ? levelLabel(currentLevel) : "Loading..."}
            </div>
            <div className="text-[10px] text-slate-400">{aqNote}</div>
          </div>
        </div>
      </section>

      {/* Forecast 12h */}
      <section className="px-4 mt-6">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm uppercase tracking-widest text-slate-400">Next 12 hours</h2>
          <ActivityToggle activity={activity} onChange={setActivity} />
        </div>
        <div className="flex flex-col gap-2 pb-3">
          {pack.next12h.length ? (
            pack.next12h.map((h) => {
              const s = safetyScore({
                activity,
                tempC: h.tempC,
                windKmh: h.windKmh,
                precipMm: h.precipMm,
                precipProb: h.precipProb,
                aqiUS: h.aqiUS ?? undefined,
                weatherCode: h.weatherCode,
              });
              const level = scoreToLevel(s);
              return (
                <div key={h.time} className="snap-start rounded-2xl bg-slate-800/60 border border-slate-700 p-3 flex items-center justify-between">
                  <div className="text-xs text-slate-300">{hourLabel(h.time)}</div>
                  <div className="text-2xl font-semibold mt-1">{unitTemp(h.tempC)}</div>
                  <div className="mt-1 text-lg">{weatherEmoji(h.weatherCode)}</div>
                  <div className="mt-2 text-[11px] text-slate-300">{Math.round(h.precipProb)}% • {unitWind(h.windKmh)}</div>
                  <div className="ml-3 flex items-center gap-2">
                    <span className={`inline-block w-2.5 h-2.5 rounded-full ${dotClasses(level)}`} />
                    <span className="text-[11px] text-slate-300">{level}</span>
                  </div>
                </div>
              );
            })
          ) : (
            <SkeletonCards />
          )}
        </div>
      </section>

      {/* Search / Settings */}
      <section className="px-4 mt-auto pb-6">
        <form onSubmit={onSearch} className="flex gap-2">
          <input
            className="flex-1 rounded-xl bg-slate-800/60 border border-slate-700 px-3 py-2 text-sm placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-slate-600"
            placeholder="Search city (e.g., Boston)"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <button
            className="px-3 py-2 rounded-xl bg-slate-700/60 border border-slate-700 text-sm text-slate-100 hover:bg-slate-600 transition flex items-center gap-2"
            type="button"
            onClick={useCurrentLocation}
            disabled={loading}
          >
            <span className="text-lg">📍</span>
            <span className="hidden sm:inline">Current</span>
          </button>
          <button
            className="px-4 py-2 rounded-xl bg-slate-100 text-slate-900 text-sm font-medium hover:bg-white transition"
            type="submit"
            disabled={loading}
          >Go</button>
        </form>

        {error && (
          <div className="mt-3 text-sm text-red-300 bg-red-900/30 border border-red-700 px-3 py-2 rounded-xl">
            {error}
          </div>
        )}

        <div className="mt-3 text-[11px] text-slate-400">
          Tip: Allow location access for automatic weather. If data can’t be retrieved, try another city or check your network.
        </div>
      </section>
    </div>
  );
}

// ---------- Activity Toggle ----------
function ActivityToggle({ activity, onChange }: { activity: Activity; onChange: (a: Activity) => void }) {
  return (
    <div className="inline-flex items-center bg-slate-800/60 border border-slate-700 rounded-full p-1 text-xs">
      <button
        onClick={() => onChange("running")}
        className={`px-3 py-1 rounded-full transition ${activity === "running" ? "bg-slate-700" : "opacity-70"}`}
      >Running</button>
      <button
        onClick={() => onChange("cycling")}
        className={`px-3 py-1 rounded-full transition ${activity === "cycling" ? "bg-slate-700" : "opacity-70"}`}
      >Cycling</button>
    </div>
  );
}

// ---------- Skeleton Cards ----------
function SkeletonCards() {
  return (
    <>
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="rounded-2xl bg-slate-800/60 border border-slate-700 p-3 animate-pulse">
          <div className="h-3 w-12 bg-slate-700 rounded" />
          <div className="h-6 w-16 bg-slate-700 rounded mt-2" />
          <div className="h-5 w-8 bg-slate-700 rounded mt-2" />
          <div className="h-3 w-20 bg-slate-700 rounded mt-2" />
          <div className="h-3 w-14 bg-slate-700 rounded mt-3" />
        </div>
      ))}
    </>
  );
}
