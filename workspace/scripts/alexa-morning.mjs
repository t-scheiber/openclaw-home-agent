#!/usr/bin/env node
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { selectBriefing, briefingFacts, fallbackText, day, clean, splitSpeech, packSpeech } from './lib/morning-speech.mjs';
import { prepareSelectionEnglish, prepareEnglish } from './lib/spoken-english.mjs';
import { writeBriefing } from './lib/morning-writer.mjs';
const exec = promisify(execFile);
const workspace = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const config = JSON.parse(await fs.readFile(path.join(workspace,'config/morning-alexa.json'),'utf8'));
const quote = value => `'${String(value).replaceAll("'", "'\\''")}'`;
async function commandJson(binary, args) {
  const {stdout} = await exec(binary,args,{encoding:'utf8',timeout:90000,maxBuffer:16*1024*1024});
  return JSON.parse(stdout);
}
async function ha(apiPath, method='GET', body) {
  const args = ['-i',process.env.HOME_ASSISTANT_SSH_KEY || path.join(os.homedir(),'.ssh','homeassistant_weather'),'-o','BatchMode=yes','-o','StrictHostKeyChecking=yes','-o','ConnectTimeout=10',`root@${process.env.HOME_ASSISTANT_HOST || '192.0.2.30'}`];
  const command = `curl --max-time 45 -fsS -X ${method} -H "Authorization: Bearer $SUPERVISOR_TOKEN" -H 'Content-Type: application/json' ${body === undefined ? '' : `--data-binary ${quote(JSON.stringify(body))}`} ${quote('http://supervisor/core/api'+apiPath)}`;
  return commandJson('ssh',[...args,command]);
}
const googleArgs = ['--account',config.googleAccount,'--json','--no-input'];
async function calendars(now) {
  const result = [], today = day(now);
  // Query broadly around local midnight, then render only the local date window.
  const from = new Date(`${today}T00:00:00Z`); from.setUTCDate(from.getUTCDate()-1);
  const end = new Date(`${today}T00:00:00Z`); end.setUTCDate(end.getUTCDate()+config.calendarDays);
  const until = day(end);
  const verifiedRequiredCalendars = new Set();
  try {
    const list = await ha('/calendars');
    for (const cal of list) {
      try {
        const events = await ha(`/calendars/${encodeURIComponent(cal.entity_id)}?${new URLSearchParams({start:from.toISOString(),end:end.toISOString()})}`);
        result.push({name:cal.name, id:cal.entity_id, events:events.filter(e=>{const start=e.start?.dateTime||e.start?.date||e.start;const finish=e.end?.dateTime||e.end?.date||e.end||start;return day(start)<until && day(finish)>=today;})});
        if (config.requiredCalendarIds.includes(cal.entity_id)) verifiedRequiredCalendars.add(cal.entity_id);
      } catch { result.push({name:cal.name,error:'The calendar could not be read.'}); }
    }
  } catch { result.push({name:'Home Assistant calendars',error:'The calendar connection failed.'}); }
  try {
    const response = await commandJson('gog',['calendar','calendars',...googleArgs]);
    const list = Array.isArray(response) ? response : response.calendars || response.items;
    if (!Array.isArray(list)) throw new Error('Unexpected Google calendar response');
    for (const cal of list) {
      if (cal.deleted) continue;
      const name = clean(cal.summaryOverride || cal.summary) || 'Google calendar';
      try {
        const r = await commandJson('gog',['calendar','events',cal.id,'--from',from.toISOString(),'--to',end.toISOString(),'--all-pages','--max','250',...googleArgs]);
        const events = Array.isArray(r) ? r : r.events || r.items;
        if (!Array.isArray(events)) throw new Error('Unexpected event response');
        result.push({name,id:cal.id,events:events.filter(e=>{const start=e.start?.dateTime||e.start?.date;const finish=e.end?.dateTime||e.end?.date||start;return start && day(start)<until && day(finish)>=today;})});
        if (config.requiredCalendarIds.includes(cal.id)) verifiedRequiredCalendars.add(cal.id);
      } catch { result.push({name,error:'The calendar could not be read.'}); }
    }
  } catch { result.push({name:'Google Calendar',error:'Sign-in is required or the calendar service is unavailable.'}); }
  return {calendars:result,requiredCalendarsVerified:config.requiredCalendarIds.every(id=>verifiedRequiredCalendars.has(id))};
}
async function ticktick() {
  return Promise.all(config.projects.map(async project=>{
    try {
      if (!process.env.TICKTICK_ACCESS_TOKEN) throw new Error('Missing TickTick access');
      const response=await fetch(`https://api.ticktick.com/open/v1/project/${project.id}/data`,{headers:{Authorization:`Bearer ${process.env.TICKTICK_ACCESS_TOKEN}`},signal:AbortSignal.timeout(30000)});
      if(!response.ok) throw new Error('TickTick unavailable');
      const data=await response.json();
      if(!Array.isArray(data.tasks)) throw new Error('Invalid tasks response');
      return {...project,tasks:data.tasks};
    } catch { return {...project,error:'TickTick list unavailable'}; }
  }));
}
const now = new Date();
const [calendarData,projects,weather]=await Promise.all([
  calendars(now),ticktick(),commandJson('node',[path.join(workspace,'scripts/weather-brief.mjs')]).catch(()=>({available:false}))
]);
const data={generatedAt:now.toISOString(),...calendarData,projects,weather};
const output=path.join(workspace,'state/morning-alexa');
const languageOptions={cacheFile:path.join(output,'spoken-english-cache.json')};
const selection=selectBriefing(data);
const speechError='Your briefing could not be prepared for spoken English. Please check the written preview for your weather, appointments and tasks.';
let facts, paragraphs, speech, writer={ready:false};
try {
  const prepared=await prepareSelectionEnglish(selection,languageOptions);
  facts=briefingFacts(prepared.data);
  speech=prepared.status;
  ({paragraphs,status:writer}=await writeBriefing(facts));
} catch {
  // Never send raw German or emoji to Alexa after a failed language pass.
  paragraphs=[speechError];
  speech={ready:false,error:'Spoken English preparation failed'};
}
const briefing={text:paragraphs.join('\n\n'),chunks:packSpeech(paragraphs)};
let news={ready:false,available:false};
try {
  const sensor=await ha('/states/sensor.openclaw_daily_news');
  const attributes=sensor.attributes || {};
  const fresh=sensor.state===day(now) && Date.parse(attributes.generated_at)>now.getTime()-7200000;
  if (fresh && Array.isArray(attributes.alexa_chunks) && attributes.alexa_chunks.length) {
    const original=attributes.source_alexa_chunks || attributes.alexa_chunks;
    const prepared=await prepareEnglish(original.map(text=>({kind:'news narration; preserve every story and fact',text})),languageOptions);
    const narration=prepared.texts.join(' ');
    news={...prepared.status,available:true,chunks:splitSpeech(narration).length};
    if(process.argv.includes('--publish')) await ha('/states/sensor.openclaw_daily_news','POST',{
      state:sensor.state,attributes:{...attributes,source_alexa_chunks:original,alexa_chunks:splitSpeech(narration),spoken_english:true}
    });
  }
} catch { news={ready:false,available:false,error:'News unavailable or spoken English preparation failed'}; }
const failures=[...data.calendars.filter(c=>c.error).map(c=>c.name),...projects.filter(p=>p.error).map(p=>`TickTick ${p.label}`),...(!weather.available?['Weather']:[]),...(!data.requiredCalendarsVerified?['Required calendars not verified']:[])];
if(!speech.ready) failures.push('Spoken English preparation');
const status={generatedAt:data.generatedAt,complete:failures.length===0,unavailable:failures,speech,writer,news,calendarSources:data.calendars.map(c=>({name:c.name,id:c.id,events:c.events?.length??null,error:!!c.error})),projects:projects.map(p=>({label:p.label,incomplete:p.tasks?.filter(t=>(t.status??0)===0&&!t.completedTime).length??null})),chunks:briefing.chunks.length,characters:briefing.text.length};
await fs.mkdir(output,{recursive:true,mode:0o700});
// source.txt is the untranslated fallback; facts.json is what the writer was given.
for(const [name,value] of Object.entries({'source.txt':fallbackText(briefingFacts(selection))+'\n','facts.json':JSON.stringify(facts??null,null,2)+'\n','latest.txt':briefing.text+'\n','status.json':JSON.stringify(status,null,2)+'\n'})) {
  await fs.writeFile(path.join(output,name+'.tmp'),value,{mode:0o600});
  await fs.rename(path.join(output,name+'.tmp'),path.join(output,name));
}
if(process.argv.includes('--publish')) {
  await ha('/states/sensor.openclaw_morning_brief','POST',{state:day(now),attributes:{friendly_name:'OpenClaw Morning Brief',generated_at:data.generatedAt,complete:status.complete,unavailable:failures,spoken_english:speech.ready,speech_error:speech.ready?null:speechError,alexa_chunks:briefing.chunks,task_counts:status.projects}});
}
console.log(JSON.stringify(status));
