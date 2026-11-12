export const ZONE = process.env.OPENCLAW_TIMEZONE || 'Europe/Berlin';
export const TASK_LIMIT = 6;
export function day(value = new Date(), zone = ZONE) {
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  return new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(value));
}
export const clean = value => String(value ?? '').replace(/<\/?[a-z][^>]*>/gi, '').replace(/https?:\/\/\S+/g, '').replace(/\s+/g, ' ').trim();
const sentence = value => { const s = clean(value); return s && /[.!?]$/.test(s) ? s : `${s}.`; };
export function time(value) { return new Intl.DateTimeFormat('en-GB', { timeZone: ZONE, hour: '2-digit', minute: '2-digit' }).format(new Date(value)); }
export function dateLabel(value) { return new Intl.DateTimeFormat('en-GB', { timeZone: ZONE, weekday: 'long', day: 'numeric', month: 'long' }).format(new Date(`${day(value)}T12:00:00Z`)); }
const addDays = (date, days) => { const d = new Date(`${date}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10); };
const joinAnd = items => items.length < 2 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`;
const rawDate = value => typeof value === 'object' && value !== null ? value.dateTime || value.date : value;
export function normalizeEvents(sources) {
  const seen = new Set(), result = [];
  for (const source of sources) for (const event of source.events || []) {
    if (event.status === 'cancelled' || event.attendees?.some(a => a.self && a.responseStatus === 'declined')) continue;
    const start = rawDate(event.start), end = rawDate(event.end);
    if (!start || Number.isNaN(Date.parse(start))) continue;
    const title = clean(event.summary || event.title || 'Untitled appointment');
    const key = `${title.toLowerCase()}|${Date.parse(start)}|${end ? Date.parse(end) : ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push({ title, start, end, allDay: start.length === 10, location: clean(event.location), calendar: source.name });
  }
  return result.sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
}
const covers = (event, date) => day(event.start) <= date && (event.allDay ? day(event.end || event.start) > date || day(event.start) === date : day(event.end || event.start) >= date);
// TickTick stores an all-day date as local midnight in UTC, e.g. 22:00 the previous day.
function dueDay(task) {
  if (!task.dueDate) return null;
  if (Number.isNaN(Date.parse(task.dueDate))) throw new Error('TickTick returned an invalid due date');
  return day(task.dueDate, task.isAllDay ? task.timeZone || ZONE : ZONE);
}
// The list name is spoken already, and ticket keys such as ABC-123 mean nothing aloud.
function taskTitle(task) {
  const title = clean(task.title).replace(/^[A-Z][A-Z0-9]*-\d+:?\s+/, '');
  return title || 'Untitled task';
}
const taskItem = (task) => ({ title: taskTitle(task), due: task.due, at: task.isAllDay ? null : time(task.dueDate), high: task.priority === 5 });
export function selectBriefing(data) {
  const today = day(data.generatedAt), tomorrow = addDays(today, 1), week = addDays(today, 7);
  const events = normalizeEvents(data.calendars.filter(c => !c.error));
  const todayEvents = events.filter(e => covers(e, today)), overlaps = [];
  for (let i = 0; i < todayEvents.length; i++) for (let j = i + 1; j < todayEvents.length; j++) {
    const a = todayEvents[i], b = todayEvents[j];
    if (!a.allDay && !b.allDay && a.end && b.end && Date.parse(a.start) < Date.parse(b.end) && Date.parse(b.start) < Date.parse(a.end)) overlaps.push([a, b]);
  }
  const byDue = (a, b) => a.due.localeCompare(b.due) || (a.dueDate || '').localeCompare(b.dueDate || '');
  const lists = data.projects.map(project => {
    if (project.error) return { label: project.label, error: true };
    const open = (project.tasks || []).filter(t => (t.status ?? 0) === 0 && !t.completedTime).map(t => ({ ...t, due: dueDay(t) }));
    const urgent = open.filter(t => t.due && t.due <= today);
    // High priority survives the limit; the spoken order stays oldest first.
    const read = [...urgent].sort((a, b) => (b.priority || 0) - (a.priority || 0) || byDue(a, b)).slice(0, TASK_LIMIT).sort(byDue);
    const next = open.filter(t => t.due && t.due > today).sort(byDue)[0];
    return { label: project.label, tasks: read.map(taskItem), more: urgent.length - read.length,
      later: open.length - urgent.length, next: next && taskItem(next) };
  });
  return {
    date: today, weather: data.weather, events: todayEvents, overlaps, lists,
    tomorrow: events.filter(e => !covers(e, today) && covers(e, tomorrow)),
    soon: events.filter(e => e.allDay && day(e.start) > tomorrow && day(e.start) <= week),
    failed: { calendars: data.calendars.filter(c => c.error).map(c => c.name), lists: lists.filter(l => l.error).map(l => l.label) },
    requiredCalendarsVerified: data.requiredCalendarsVerified,
  };
}
function relativeDay(date, today) {
  if (date === addDays(today, -1)) return `yesterday, ${dateLabel(date)}`;
  if (date === addDays(today, 1)) return `tomorrow, ${dateLabel(date)}`;
  return dateLabel(date);
}
function weatherText(weather) {
  const current = weather.current || {}, today = weather.today || {}, round = Math.round;
  const lines = [`${clean(weather.location?.name) || 'At home'}: ${[clean(current.condition), Number.isFinite(current.temperatureC) && `${round(current.temperatureC)} degrees`].filter(Boolean).join(', ') || 'no current reading'}.`];
  if (Number.isFinite(current.feelsLikeC) && Number.isFinite(current.temperatureC) && Math.abs(current.feelsLikeC - current.temperatureC) >= 3) lines.push(`It feels like ${round(current.feelsLikeC)}.`);
  if (Number.isFinite(today.lowC) && Number.isFinite(today.highC)) lines.push(`Today between ${round(today.lowC)} and ${round(today.highC)} degrees.`);
  const wet = today.snowMm > 0 ? 'rain or snow' : 'rain';
  if (today.maxPrecipitationProbabilityPercent >= 30) lines.push(`${today.maxPrecipitationProbabilityPercent} percent chance of ${wet}${today.firstLikelyPrecipitation ? `, most likely from ${today.firstLikelyPrecipitation}` : ''}.`);
  else if (Number.isFinite(today.maxPrecipitationProbabilityPercent)) lines.push('Rain is unlikely.');
  if (today.windMaxKmh >= 30) lines.push(`Wind up to ${round(today.windMaxKmh)} kilometres per hour.`);
  return lines.join(' ');
}
function taskText(label, task, today) {
  const due = task.due < today ? `overdue since ${relativeDay(task.due, today)}` : `due today${task.at ? ` at ${task.at}` : ''}`;
  return `${label}, ${task.high ? 'high priority, ' : ''}${due}: ${sentence(task.title)}`;
}
// Facts are complete sentences: the AI writer rewords them, and the fallback reads them as they are.
export function briefingFacts(s) {
  const facts = [], add = (id, required, text, title) => facts.push({ id, required, text, ...(title ? { title } : {}) });
  add('intro', true, `Good morning. Today is ${dateLabel(s.date)}.`);
  if (s.weather?.available) add('weather', true, weatherText(s.weather));
  if (!s.events.length) add('calendar', true, s.failed.calendars.length ? 'No appointments today in the calendars I could check.' : 'No appointments today.');
  s.events.forEach((e, i) => add(`event${i + 1}`, true, `Today${e.allDay ? '' : ` from ${time(e.start)}${e.end ? ` to ${time(e.end)}` : ''}`}: ${sentence(e.title)}${e.location ? ` Location: ${sentence(e.location)}` : ''}`, e.title));
  s.overlaps.forEach(([a, b], i) => add(`overlap${i + 1}`, true, `${a.title} and ${b.title} overlap at ${time(b.start)}.`, `${a.title} ${b.title}`));
  for (const list of s.lists.filter(l => !l.error)) {
    const key = list.label.toLowerCase();
    list.tasks.forEach((task, i) => add(`${key}${i + 1}`, true, taskText(list.label, task, s.date), task.title));
    if (list.more) add(`${key}-more`, true, `Plus ${list.more} more ${list.label} ${list.more === 1 ? 'task' : 'tasks'} that are overdue or due today.`);
  }
  const readable = s.lists.filter(l => !l.error);
  if (readable.length && readable.every(l => !l.tasks.length)) add('tasks', true, 'Nothing in TickTick is overdue or due today.');
  const later = s.lists.filter(l => !l.error && l.later), total = later.reduce((sum, l) => sum + l.later, 0);
  if (later.length) add('later', true, `Also open but not due yet: ${joinAnd(later.map(l => `${l.later} ${l.label}`))} ${total === 1 ? 'task' : 'tasks'}.`);
  for (const list of s.lists.filter(l => l.next)) add(`${list.label.toLowerCase()}-next`, false, `Next ${list.label} deadline: ${relativeDay(list.next.due, s.date)}${list.next.at ? ` at ${list.next.at}` : ''}, ${sentence(list.next.title)}`, list.next.title);
  s.tomorrow.forEach((e, i) => add(`tomorrow${i + 1}`, false, `Tomorrow${e.allDay ? '' : ` from ${time(e.start)}`}: ${sentence(e.title)}`, e.title));
  s.soon.forEach((e, i) => add(`soon${i + 1}`, false, `${dateLabel(e.start)}: ${sentence(e.title)}`, e.title));
  const missing = [...s.failed.calendars, ...s.failed.lists.map(l => `the TickTick ${l} list`), ...(s.weather?.available ? [] : ['the weather'])];
  const problems = [];
  if (missing.length) problems.push(`I couldn't check ${joinAnd(missing)}, so this briefing may be incomplete.`);
  if (!s.requiredCalendarsVerified && !s.failed.calendars.length) problems.push("I couldn't find your required calendars, so some appointments may be missing.");
  if (problems.length) add('problems', true, problems.join(' '), missing.join(' ') || 'required calendars');
  return facts;
}
export const fallbackText = facts => facts.filter(f => f.required).map(f => f.text).join(' ');
export function splitSpeech(text, limit = 700) {
  if (!Number.isInteger(limit) || limit < 40) throw new Error('Invalid chunk length');
  let rest = String(text).replace(/\s+/g, ' ').trim();
  const chunks = [];
  while (rest.length > limit) {
    const sample = rest.slice(0,limit + 1);
    const boundary = Math.max(sample.lastIndexOf('. '),sample.lastIndexOf('? '),sample.lastIndexOf('! '));
    const split = boundary > limit / 2 ? boundary + 1 : sample.lastIndexOf(' ');
    const cut = split > 0 ? split : limit;
    chunks.push(rest.slice(0,cut)); rest = rest.slice(cut).trim();
  }
  if (rest) chunks.push(rest);
  return chunks;
}
// Fewer chunks means fewer pauses on the Echo; chunk breaks prefer paragraph ends.
export function packSpeech(paragraphs, limit = 700) {
  const chunks = [];
  for (const piece of paragraphs.flatMap(p => splitSpeech(p, limit))) {
    if (chunks.length && chunks.at(-1).length + 1 + piece.length <= limit) chunks[chunks.length - 1] += ` ${piece}`;
    else chunks.push(piece);
  }
  return chunks;
}
