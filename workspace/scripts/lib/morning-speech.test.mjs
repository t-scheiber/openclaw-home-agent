import test from 'node:test';
import assert from 'node:assert/strict';
import {day, time, splitSpeech, packSpeech, selectBriefing, briefingFacts, fallbackText, TASK_LIMIT} from './morning-speech.mjs';
const now='2026-10-21T05:20:00Z';
const base={generatedAt:now,calendars:[],projects:[],weather:{available:false},requiredCalendarsVerified:true};
const facts=data=>briefingFacts(selectBriefing({...base,...data}));
const ids=list=>list.map(f=>f.id);
test('all-day TickTick dates are read in the task time zone, not as UTC dates',()=>{
  const study={title:'Sheet 10-21: Algorithms graphs and trees',dueDate:'2026-10-20T22:00:00.000+0000',isAllDay:true,timeZone:'Europe/Berlin',status:0};
  const list=facts({projects:[{label:'Study',tasks:[study]}]});
  assert.match(list.find(f=>f.id==='study1').text,/due today: Sheet 10-21/);
  const dayBefore=facts({generatedAt:'2026-10-20T05:20:00Z',projects:[{label:'Study',tasks:[study]}]});
  assert.ok(!ids(dayBefore).includes('study1'));
  assert.match(dayBefore.find(f=>f.id==='study-next').text,/tomorrow, Wednesday 21 October/);
});
test('only overdue and due-today tasks are read; the rest is counted',()=>{
  const list=facts({projects:[
    {label:'Work',tasks:[
      {title:'ABC-599 Check browser compatibility',dueDate:'2026-10-19T22:00:00.000+0000',isAllDay:true,status:0},
      {title:'Undated backlog item',status:0},{title:'Finished',dueDate:'2026-10-20T22:00:00.000+0000',isAllDay:true,status:2},
    ]},
    {label:'Study',tasks:[
      {title:'Programming Lab: form team',dueDate:'2026-10-21T16:00:00.000+0000',isAllDay:false,priority:5,status:0,items:[{title:'Email the group',status:0},{title:'Done step',status:2}]},
      {title:'Course: register for test 2',dueDate:'2027-01-21T09:00:00.000+0000',status:0},
    ]},
  ]});
  const text=fallbackText(list);
  assert.match(list.find(f=>f.id==='work1').text,/^Work, overdue since yesterday, Tuesday 20 October: Check browser compatibility\.$/);
  assert.match(list.find(f=>f.id==='study1').text,/^Study, high priority, due today at 18:00: Programming Lab: form team\.$/);
  assert.match(text,/Also open but not due yet: 1 Work and 1 Study tasks\./);
  assert.ok(!text.includes('Undated backlog')&&!text.includes('Finished')&&!text.includes('register for test')&&!text.includes('ABC-'));
  assert.equal(list.find(f=>f.id==='study-next').required,false);
});
test('the per-list limit keeps high priority tasks and counts the rest',()=>{
  const tasks=Array.from({length:TASK_LIMIT+2},(_,i)=>({title:`Overdue ${i}`,dueDate:`2026-10-${String(10+i).padStart(2,'0')}T10:00:00.000+0000`,priority:i===TASK_LIMIT+1?5:0,status:0}));
  const list=facts({projects:[{label:'Work',tasks}]});
  const read=list.filter(f=>/^work\d+$/.test(f.id));
  assert.equal(read.length,TASK_LIMIT);
  assert.ok(read.some(f=>f.text.includes(`Overdue ${TASK_LIMIT+1}`)));
  assert.match(list.find(f=>f.id==='work-more').text,/Plus 2 more Work tasks/);
  assert.equal(list.find(f=>f.id==='work-more').required,true);
});
test('calendar reads today, offers tomorrow and the coming week, flags overlaps and drops duplicates',()=>{
  const lecture={summary:'Lecture',start:{dateTime:'2026-10-21T08:00:00+02:00'},end:{dateTime:'2026-10-21T10:00:00+02:00'},location:'Room 4'};
  const list=facts({calendars:[{name:'Study',events:[lecture,{summary:'Cancelled',status:'cancelled',start:lecture.start},{summary:'Declined',attendees:[{self:true,responseStatus:'declined'}],start:lecture.start}]},
    {name:'Google',events:[lecture,{summary:'Meeting',start:'2026-10-21T09:00:00+02:00',end:'2026-10-21T11:00:00+02:00'},{summary:'Dentist',start:'2026-10-22T09:00:00+02:00',end:'2026-10-22T10:00:00+02:00'},{summary:"Birthday party",start:{date:'2026-10-26'},end:{date:'2026-10-27'}},{summary:'Far away',start:{date:'2026-11-20'},end:{date:'2026-11-21'}}]}]});
  const text=list.map(f=>f.text).join(' ');
  assert.equal((text.match(/Lecture\. Location: Room 4/g)||[]).length,1);
  assert.match(list.find(f=>f.id==='overlap1').text,/Lecture and Meeting overlap at 09:00/);
  assert.equal(list.find(f=>f.id==='tomorrow1').required,false);
  assert.match(list.find(f=>f.id==='soon1').text,/Monday 26 October: Birthday party/);
  assert.ok(!text.includes('Cancelled')&&!text.includes('Declined')&&!text.includes('Far away'));
});
test('failed sources become one problem fact at the end instead of daily boilerplate',()=>{
  const failing=facts({calendars:[{name:'Google Calendar',error:'Sign-in is required.'},{name:'Private',events:[]}],projects:[{label:'Work',error:'offline'}],requiredCalendarsVerified:false});
  assert.equal(failing.at(-1).id,'problems');
  assert.equal(failing.at(-1).text,"I couldn't check Google Calendar, the TickTick Work list and the weather, so this briefing may be incomplete.");
  assert.match(failing.find(f=>f.id==='calendar').text,/in the calendars I could check/);
  assert.ok(!ids(failing).includes('weather')&&!ids(failing).includes('tasks'));
  const unverified=facts({calendars:[{name:'Private',events:[]}],requiredCalendarsVerified:false,weather:{available:true,location:{name:'Exampletown'},current:{},today:{}}});
  assert.equal(unverified.at(-1).text,"I couldn't find your required calendars, so some appointments may be missing.");
  const healthy=facts({calendars:[{name:'Private',events:[]}],projects:[{label:'Work',tasks:[]}],weather:{available:true,location:{name:'Exampletown'},current:{},today:{}}});
  assert.ok(!ids(healthy).includes('problems'));
  assert.match(fallbackText(healthy),/No appointments today\. Nothing in TickTick is overdue or due today\./);
  assert.ok(!fallbackText(healthy).includes('warnings'));
});
test('weather rounds readings and mentions rain and wind only when they matter',()=>{
  const weather=today=>facts({weather:{available:true,location:{name:'Riverside'},current:{condition:'few clouds',temperatureC:7.4,feelsLikeC:3.2},today}}).find(f=>f.id==='weather').text;
  assert.equal(weather({lowC:6.6,highC:17.3,maxPrecipitationProbabilityPercent:0,windMaxKmh:20.1}),'Riverside: few clouds, 7 degrees. It feels like 3. Today between 7 and 17 degrees. Rain is unlikely.');
  assert.match(weather({maxPrecipitationProbabilityPercent:60,firstLikelyPrecipitation:'14:00',windMaxKmh:41.4}),/60 percent chance of rain, most likely from 14:00\. Wind up to 41 kilometres per hour\./);
});
test('midnight and daylight saving transitions use the correct date and offset in the configured zone',()=>{
  assert.equal(day('2026-09-20T22:30:00Z'),'2026-09-21');
  assert.equal(time('2026-10-25T00:30:00Z'),'02:30');
  assert.equal(time('2026-10-25T01:30:00Z'),'02:30');
});
test('long text keeps the final sentence and round-trips through chunks',()=>{
  const text=Array.from({length:200},(_,i)=>`Task ${i}: ${'complete the assignment '.repeat(10)}.`).join(' ');
  const chunks=splitSpeech(text);
  assert.equal(chunks.join(' '),text);assert.ok(chunks.at(-1).includes('Task 199'));
});
test('paragraphs are packed into as few chunks as fit and split only when too long',()=>{
  const chunks=packSpeech(['Short one.','Short two.','x '.repeat(400).trim()+'.']);
  assert.equal(chunks[0],'Short one. Short two.');
  assert.ok(chunks.every(c=>c.length<=700));
  assert.equal(chunks.join(' '),['Short one.','Short two.','x '.repeat(400).trim()+'.'].join(' '));
});
