#!/usr/bin/env node
import { execFileSync, spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';

// Used when the phone location is unavailable. Set HOME_LATITUDE and HOME_LONGITUDE
// in the service environment; without them the script uses the Home Assistant forecast.
const HOME = {
  latitude: Number(process.env.HOME_LATITUDE),
  longitude: Number(process.env.HOME_LONGITUDE),
  label: 'Home fallback',
};
const SSH_KEY = process.env.HOME_ASSISTANT_SSH_KEY || path.join(os.homedir(), '.ssh', 'homeassistant_weather');
const HA_HOST = process.env.HOME_ASSISTANT_HOST || '192.0.2.30';
const PERSON_ENTITY = process.env.HOME_ASSISTANT_PERSON_ENTITY || 'person.owner';
const WEATHER_ENTITY = process.env.HOME_ASSISTANT_WEATHER_ENTITY || 'weather.forecast_home';
const OP = '/home/linuxbrew/.linuxbrew/bin/op';
const OPENWEATHER_REF = process.env.OPENWEATHERMAP_OP_REF || 'op://Example Vault/openweathermap/API Key';

function homeAssistantJson(remote) {
  return JSON.parse(execFileSync('ssh', [
      '-i', SSH_KEY,
      '-o', 'BatchMode=yes',
      '-o', 'ConnectTimeout=10',
      '-o', 'StrictHostKeyChecking=yes',
      `root@${HA_HOST}`,
      remote,
    ], { encoding: 'utf8', timeout: 20000, maxBuffer: 4 * 1024 * 1024 }));
}

function phoneLocation() {
  try {
    const remote = `curl -fsS -H "Authorization: Bearer $SUPERVISOR_TOKEN" http://supervisor/core/api/states/${PERSON_ENTITY}`;
    const state = homeAssistantJson(remote);
    const latitude = Number(state.attributes?.latitude);
    const longitude = Number(state.attributes?.longitude);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) throw new Error('person entity has no coordinates');
    return {
      latitude,
      longitude,
      source: 'home_assistant_phone',
      state: state.state,
      lastUpdated: state.last_updated,
    };
  } catch (error) {
    return { ...HOME, source: 'home_fallback', error: String(error.message).slice(0, 300) };
  }
}

function homeAssistantWeatherFallback(openWeatherError) {
  const current = homeAssistantJson(
    `curl -fsS -H "Authorization: Bearer $SUPERVISOR_TOKEN" http://supervisor/core/api/states/${WEATHER_ENTITY}`);
  const forecastResponse = homeAssistantJson(
    `curl -fsS -X POST -H "Authorization: Bearer $SUPERVISOR_TOKEN" -H "Content-Type: application/json" --data '{"entity_id":"${WEATHER_ENTITY}","type":"daily"}' "http://supervisor/core/api/services/weather/get_forecasts?return_response"`);
  const forecast = forecastResponse.service_response?.[WEATHER_ENTITY]?.forecast?.[0] || {};
  return {
    available: true,
    provider: 'Home Assistant / met.no fallback',
    warning: String(openWeatherError.message).slice(0, 300),
    location: {
      name: current.attributes?.friendly_name || 'Home',
      source: 'home_assistant_weather_fallback',
      usedFallback: true,
    },
    current: {
      condition: current.state || null,
      temperatureC: round(current.attributes?.temperature, 1),
      feelsLikeC: null,
      humidityPercent: round(current.attributes?.humidity),
      windKmh: round(current.attributes?.wind_speed, 1),
    },
    today: {
      date: String(forecast.datetime || '').slice(0, 10) || null,
      lowC: round(forecast.templow, 1),
      highC: round(forecast.temperature, 1),
      maxPrecipitationProbabilityPercent: round(forecast.precipitation_probability),
      rainMm: round(forecast.precipitation, 1),
      snowMm: null,
      firstLikelyPrecipitation: null,
      windMaxKmh: current.attributes?.wind_speed_unit === 'km/h' ? round(forecast.wind_speed, 1) : null,
      sunrise: null,
      sunset: null,
    },
  };
}

function openWeatherKey() {
  if (process.env.OPENWEATHERMAP_API_KEY) return process.env.OPENWEATHERMAP_API_KEY;
  if (!process.env.OP_SERVICE_ACCOUNT_TOKEN) throw new Error('OpenWeatherMap key unavailable');
  const result = spawnSync(OP, ['read', OPENWEATHER_REF], {
    encoding: 'utf8', timeout: 30000,
  });
  if (result.status !== 0 || !result.stdout.trim()) throw new Error('Could not resolve OpenWeatherMap key');
  return result.stdout.trim();
}

async function weatherRequest(endpoint, location, apiKey) {
  const url = new URL(`https://api.openweathermap.org/data/2.5/${endpoint}`);
  url.search = new URLSearchParams({
    lat: String(location.latitude),
    lon: String(location.longitude),
    appid: apiKey,
    units: 'metric',
    lang: 'en',
  });
  const response = await fetch(url, { signal: AbortSignal.timeout(20000) });
  if (!response.ok) throw new Error(`OpenWeatherMap ${endpoint} returned ${response.status}`);
  return response.json();
}

function localDate(unixSeconds, offsetSeconds) {
  return new Date((unixSeconds + offsetSeconds) * 1000).toISOString().slice(0, 10);
}

function localTime(unixSeconds, offsetSeconds) {
  return new Date((unixSeconds + offsetSeconds) * 1000).toISOString().slice(11, 16);
}

function round(value, digits = 0) {
  if (!Number.isFinite(value)) return null;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

async function main() {
  const location = phoneLocation();
  let current;
  let forecast;
  try {
    if (!Number.isFinite(location.latitude) || !Number.isFinite(location.longitude)) {
      throw new Error('No location available');
    }
    const apiKey = openWeatherKey();
    [current, forecast] = await Promise.all([
      weatherRequest('weather', location, apiKey),
      weatherRequest('forecast', location, apiKey),
    ]);
  } catch (error) {
    console.log(JSON.stringify(homeAssistantWeatherFallback(error)));
    return;
  }
  const offset = Number(forecast.city?.timezone || current.timezone || 0);
  const today = localDate(Math.floor(Date.now() / 1000), offset);
  const todayEntries = (forecast.list || []).filter((entry) => localDate(entry.dt, offset) === today);
  const temperatures = [current.main?.temp, ...todayEntries.flatMap((entry) => [entry.main?.temp_min, entry.main?.temp_max])]
    .filter(Number.isFinite);
  const precipitationProbability = Math.max(0, ...todayEntries.map((entry) => Number(entry.pop || 0)));
  const rainMm = todayEntries.reduce((sum, entry) => sum + Number(entry.rain?.['3h'] || 0), 0);
  const snowMm = todayEntries.reduce((sum, entry) => sum + Number(entry.snow?.['3h'] || 0), 0);
  const wetEntry = todayEntries.find((entry) => Number(entry.pop || 0) >= 0.25);

  console.log(JSON.stringify({
    available: true,
    provider: 'OpenWeatherMap',
    location: {
      name: current.name || forecast.city?.name || location.label || 'Current location',
      country: current.sys?.country || forecast.city?.country || null,
      source: location.source,
      phoneState: location.state || null,
      lastUpdated: location.lastUpdated || null,
      usedFallback: location.source === 'home_fallback',
    },
    current: {
      condition: current.weather?.[0]?.description || null,
      temperatureC: round(current.main?.temp, 1),
      feelsLikeC: round(current.main?.feels_like, 1),
      humidityPercent: round(current.main?.humidity),
      windKmh: round(Number(current.wind?.speed) * 3.6, 1),
    },
    today: {
      date: today,
      lowC: temperatures.length ? round(Math.min(...temperatures), 1) : null,
      highC: temperatures.length ? round(Math.max(...temperatures), 1) : null,
      maxPrecipitationProbabilityPercent: round(precipitationProbability * 100),
      rainMm: round(rainMm, 1),
      snowMm: round(snowMm, 1),
      firstLikelyPrecipitation: wetEntry ? localTime(wetEntry.dt, offset) : null,
      windMaxKmh: todayEntries.length ? round(Math.max(...todayEntries.map(entry => Number(entry.wind?.speed || 0))) * 3.6, 1) : null,
      sunrise: current.sys?.sunrise ? localTime(current.sys.sunrise, offset) : null,
      sunset: current.sys?.sunset ? localTime(current.sys.sunset, offset) : null,
    },
  }));
}

main().catch((error) => {
  console.log(JSON.stringify({ available: false, error: String(error.message).slice(0, 500) }));
  process.exitCode = 1;
});
