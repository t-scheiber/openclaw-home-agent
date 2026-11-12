import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { prepareEnglish, prepareSelectionEnglish, validateBatch } from './spoken-english.mjs';
import { selectBriefing, briefingFacts, fallbackText } from './morning-speech.mjs';

const reply = items => ({ items: items.map(({ id, text }) => ({ id, spoken: text })) });

test('rejects missing, duplicate and invented entries, changed numbers, emoji and markup', () => {
  const items = [{ id:'a', text:'Prüfung 4' }, { id:'b', text:'IT&AI' }];
  for (const response of [
    {items:[{id:'a',spoken:'Exam 4'}]},
    {items:[{id:'a',spoken:'Exam 4'},{id:'a',spoken:'Exam 4'}]},
    {items:[{id:'a',spoken:'Exam 4'},{id:'c',spoken:'IT and AI'}]},
    {items:[{id:'a',spoken:'Exam 5'},{id:'b',spoken:'IT and AI'}]},
    {items:[{id:'a',spoken:'Exam 4 🎓'},{id:'b',spoken:'IT and AI'}]},
    {items:[{id:'a',spoken:'Exam 4'},{id:'b',spoken:'<speak>IT and AI</speak>'}]},
  ]) assert.throws(()=>validateBatch(items,response));
});

test('language editing translates the selected facts and keeps dates, priorities, overlaps and every list', async () => {
  const event={summary:'🎓 Prüfung 4',start:{dateTime:'2026-09-21T10:00:00+02:00'},end:{dateTime:'2026-09-21T12:00:00+02:00'},location:'Example University, Hörsaal 2'};
  const meeting={summary:'Teamsitzung',start:{dateTime:'2026-09-21T11:00:00+02:00'},end:{dateTime:'2026-09-21T12:30:00+02:00'}};
  const data={generatedAt:'2026-09-21T05:20:00Z',requiredCalendarsVerified:true,weather:{available:false},
    calendars:[{name:'Study',events:[event,{...event},meeting]},{name:'Arbeit',error:'The calendar could not be read.'}],
    projects:['Personal','Work','Study'].map(label=>({label,tasks:[{title:'📞 Arzt anrufen',priority:5,dueDate:'2026-09-21T09:00:00Z',items:[{title:'Termin bestätigen',status:0}]}]}))};
  const selection=selectBriefing(data), original=structuredClone(selection);
  const translations={'🎓 Prüfung 4':'Exam 4','Example University, Hörsaal 2':'Example University, lecture hall 2','Teamsitzung':'Team meeting','📞 Arzt anrufen':'Call the doctor','Termin bestätigen':'Confirm the appointment','Arbeit':'Work'};
  const result=await prepareSelectionEnglish(selection,{translate:async items=>({items:items.map(({id,text})=>({id,spoken:translations[text]}))})});
  assert.deepEqual(selection,original);
  assert.equal(result.data.lists[0].tasks[0].high,true);
  const speech=fallbackText(briefingFacts(result.data));
  assert.match(speech,/Today from 10:00 to 12:00: Exam 4\. Location: Example University, lecture hall 2\./);
  assert.match(speech,/Exam 4 and Team meeting overlap at 11:00/);
  assert.equal((speech.match(/from 10:00 to 12:00: Exam 4/g)||[]).length,1);
  assert.equal((speech.match(/high priority, due today at 11:00: Call the doctor\./g)||[]).length,3);
  assert.ok(!speech.includes('Confirm the appointment'));
  assert.match(speech,/I couldn't check Work and the weather, so this briefing may be incomplete/);
  assert.ok(!speech.includes('🎓')&&!speech.includes('Prüfung')&&!speech.includes('Arbeit'));
});

test('batching and cache retain every entry and work when AI is unavailable later', async t => {
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'spoken-english-'));
  t.after(()=>fs.rm(directory,{recursive:true,force:true}));
  const cacheFile=path.join(directory,'cache.json');
  const items=Array.from({length:95},(_,i)=>({kind:'task',text:`Task ${i}`}));
  let calls=0;
  const first=await prepareEnglish(items,{cacheFile,translate:async batch=>{calls++;return reply(batch);}});
  assert.equal(calls,3); assert.equal(first.texts.length,95); assert.equal(first.texts.at(-1),'Task 94');
  const second=await prepareEnglish(items,{cacheFile,translate:async()=>{throw new Error('offline');}});
  assert.deepEqual(second.texts,first.texts); assert.equal(second.status.cached,95);
});

test('invalid output retries then fails instead of returning unprepared source text',async()=>{
  let calls=0;
  await assert.rejects(prepareEnglish([{kind:'task',text:'Prüfung 🎓'}],{translate:async()=>{calls++;return {items:[]};}}));
  assert.equal(calls,2);
});

test('news preparation retains every chunk and every numeric fact',async()=>{
  const items=[{kind:'news',text:'Köln meldet 12 neue Projekte.'},{kind:'news',text:'Berlin meldet 8 Projekte.'}];
  const result=await prepareEnglish(items,{translate:async batch=>({items:batch.map(({id,text})=>({id,spoken:text.startsWith('Köln')?'Cologne reports 12 new projects.':'Berlin reports 8 projects.'}))})});
  assert.deepEqual(result.texts,['Cologne reports 12 new projects.','Berlin reports 8 projects.']);
});
