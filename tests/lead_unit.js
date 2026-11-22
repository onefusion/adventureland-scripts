// unit tests for AL.lead pure functions + protocol (stage 4)
const fs=require('fs'),vm=require('vm'),assert=require('assert');
const AL={now:()=>T,parse_cm:(m)=>{let d=m.message;return typeof d==='object'?d:null},call:(f)=>f()};let T=1000;
global.AL=AL;global.character={level:50,slots:{}};
vm.runInThisContext(fs.readFileSync(__dirname+'/../src/lib/lead.js','utf8').replace(/^AL\.lead/m,'AL.lead'));
const lead=AL.lead;
assert.strictEqual(lead.gear_level({a:{name:'x',level:3},b:null,c:{name:'y',level:7}}),10);
assert(Math.abs(lead.score(100,150)-1)<1e-9);
const ord=['ranger','warrior','priest'],cl={ranger:true,warrior:true,priest:true};
const c=[{name:'P',cls:'priest',level:99,gear:150},{name:'W',cls:'warrior',level:60,gear:50},{name:'R',cls:'ranger',level:40,gear:10}];
assert.strictEqual(lead.elect(c,ord,cl).name,'R');
assert.strictEqual(lead.elect(c,ord,{ranger:false,warrior:true,priest:true}).name,'W');
assert.strictEqual(lead.elect(c,ord,{ranger:false,warrior:false,priest:false}),null);
const r2=[{name:'B',cls:'ranger',level:50,gear:10},{name:'A',cls:'ranger',level:50,gear:10},{name:'C',cls:'ranger',level:70,gear:0}];
assert.strictEqual(lead.elect(r2,ord,cl).name,'C');
assert.strictEqual(lead.rank(r2.slice(0,2),ord)[0].name,'A');
// protocol: two characters, messages routed in-memory
const sent=[];global.send_cm=(to,msg)=>sent.push({to,msg});global.add_top_button=()=>{};global.stop_character=()=>{};
const mk=(name,cls,lead_name,can)=>{const logs=[];const st={};const L=lead.create({CFG:{PARTY_LEADER:lead_name},say:(s)=>logs.push(s),alive:()=>true,me:{name,cls},
 members:[{name:'R',cls:'ranger',slot:1},{name:'W',cls:'warrior',slot:2}],can_lead:can,election_ms:60000,hello_ms:15000,
 hooks:{info:()=>({level:50,gear:10}),export_state:()=>({focus:'bee'}),import_state:(s)=>{st.in=s},on_lead:()=>{st.lead=1},on_follow:(n)=>{st.f=n},announce:()=>{st.ann=1}}});return {L,logs,st}};
const R=mk('R','ranger','R',{ranger:true,warrior:true}),W=mk('W','warrior','R',{ranger:true,warrior:true});
let cur=null;global.send_cm=(to,msg)=>sent.push({to,msg,from:cur});
const as=(who,f)=>{const o=cur;cur=who;try{f()}finally{cur=o}};
const deliver=()=>{while(sent.length){const m=sent.shift();const t=m.to==='R'?R:W;as(m.to,()=>t.L.handle({name:m.from,message:m.msg}))}};
// W presses Lead: R hands over with state, W announces
as('W',()=>W.L.claim());deliver();
assert.strictEqual(W.L.lead(),'W');assert.strictEqual(R.L.lead(),'W');assert.deepStrictEqual(W.st.in,{focus:'bee'});assert(W.st.ann);
// election: W alone, lead R silent for 60 s
T+=61000;cur='W';W.L.L.lead='R';W.L.L.seen_at=T-61000;W.L.L.started=0;W.L.tick();
assert.strictEqual(W.L.lead(),'W');
// reload waits for a quiet moment; merchant auto-start is guarded
{
  let busy='a boss event',reloads=0,starts=[],online=false,fail=false;
  global.start_character=(n,sl)=>{starts.push(n+'/'+sl);return fail?{failed:true,reason:'nope'}:{}};
  const logs=[];const L=lead.create({CFG:{PARTY_LEADER:'R'},say:(x)=>logs.push(x),alive:()=>true,me:{name:'R',cls:'ranger'},members:[{name:'R',cls:'ranger'},{name:'W',cls:'warrior'}],
    can_lead:{ranger:true},busy:()=>busy,quiet_ms:10000,merchant:{name:'M',slot:'3',enabled:true,max_tries:2,retry_ms:60000,grace_ms:30000,is_online:()=>online},hooks:{reload:()=>reloads++}});
  const step=(sec)=>{T+=sec*1000;L.tick()};
  L.request_reload('test');
  step(5);step(30);assert.strictEqual(reloads,0,'busy: no reload');
  busy='';step(5);assert.strictEqual(reloads,0,'quiet not long enough');
  step(11);assert.strictEqual(reloads,1,'reload after 10 s quiet');
  step(30);assert.strictEqual(reloads,1,'only once');
  // merchant: attempts are limited, logged, spaced
  assert(starts.length>=1,'first attempt after the grace time');
  step(40);step(70);step(70);assert.strictEqual(starts.length,2,'max 2 attempts');
  assert(logs.some(x=>/giving up/.test(x)));
  // he turns up: no start at all
  starts.length=0;online=true;const L2=lead.create({CFG:{PARTY_LEADER:'R'},say:()=>{},alive:()=>true,me:{name:'R',cls:'ranger'},members:[{name:'R',cls:'ranger'}],can_lead:{ranger:true},merchant:{name:'M',slot:'3',enabled:true,is_online:()=>online},hooks:{}});
  T+=100000;L2.tick();T+=100000;online=false;L2.tick();assert.strictEqual(starts.length,0,'never started after he was seen');
  // a failed start stops the auto-start
  starts.length=0;fail=true;online=false;const L3=lead.create({CFG:{PARTY_LEADER:'R'},say:()=>{},alive:()=>true,me:{name:'R',cls:'ranger'},members:[{name:'R',cls:'ranger'}],can_lead:{ranger:true},merchant:{name:'M',slot:'3',enabled:true,max_tries:3,is_online:()=>online},hooks:{}});
  T+=40000;L3.tick();
  setTimeout(()=>{T+=70000;L3.tick();setTimeout(()=>{assert.strictEqual(starts.length,1,'failed start: one attempt only, got '+starts.length);console.log('lead_unit merchant/reload OK')},5)},5);
}
console.log('lead_unit OK');

// automatic reload triggers (build / lib id differ from the lead's, idle): requests only, guarded, never for the lead itself
{
  const store={};global.get=(k)=>store[k];global.set=(k,v)=>{store[k]=v};
  global.character={level:50,slots:{},map:'main',x:1,y:1,xp:5,gold:9,rip:false};
  const mkf=(name,idle_ms)=>{const o={reloads:0,logs:[]};o.L=lead.create({CFG:{PARTY_LEADER:'R'},say:(x)=>o.logs.push(x),alive:()=>true,me:{name,cls:'warrior'},members:[{name:'R',cls:'ranger'},{name,cls:'warrior'}],can_lead:{ranger:true},
    busy:()=>'',quiet_ms:1000,auto_reload:{idle_ms:idle_ms||900000,min_gap_ms:3600000},hooks:{reload:()=>{o.reloads++}}});return o};
  const hello=(f,from,d)=>f.L.handle({name:from,message:Object.assign({type:'lead_hello',level:60,gear:5,lead:'R',epoch:1},d)});
  globalThis.__AL_BUILD='aaa';globalThis.__AL_LIB_BUILD='lll';
  let f=mkf('W');
  hello(f,'R',{build:'aaa',lib:'lll'});T+=1000;f.L.tick();T+=2000;f.L.tick();assert.strictEqual(f.reloads,0,'same builds: no reload');
  hello(f,'R',{build:'bbb',lib:'lll'});T+=1000;f.L.tick();T+=2000;f.L.tick();assert.strictEqual(f.reloads,1,'script build differs from the lead: reload');
  assert(f.logs.some((x)=>/BUILD MISMATCH/.test(x)),'mismatch is logged loudly');
  hello(f,'R',{build:'bbb',lib:'lll'});T+=3000;f.L.tick();T+=3000;f.L.tick();assert.strictEqual(f.reloads,1,'guard: the same cause does not reload again within the gap');
  f=mkf('W');hello(f,'R',{build:'aaa',lib:'zzz'});T+=1000;f.L.tick();T+=2000;f.L.tick();assert.strictEqual(f.reloads,1,'lib build differs: reload');
  f=mkf('W');hello(f,'X',{build:'bbb',lib:'lll'});T+=3000;f.L.tick();T+=3000;f.L.tick();assert.strictEqual(f.reloads,0,'a mismatch with a non-lead peer is only logged');
  const prev=T;T+=4000000;
  f=mkf('W',60000);T+=1000;f.L.tick();T+=50000;f.L.tick();assert.strictEqual(f.reloads,0,'idle: not yet');
  T+=20000;f.L.tick();T+=2000;f.L.tick();T+=2000;f.L.tick();assert.strictEqual(f.reloads,1,'idle: nothing changed for idle_ms: reload');
  f=mkf('W',60000);T+=1000;f.L.tick();T+=40000;character.x=50;f.L.tick();T+=40000;f.L.tick();assert.strictEqual(f.reloads,0,'idle: moving resets the clock');
  console.log('lead_unit auto-reload OK');
}

// Stop / Start buttons for the Merchant: only the lead, a stop ends the auto-start
{
  const stopped=[],started=[];global.stop_character=(n)=>{stopped.push(n)};global.start_character=(n,sl)=>{started.push(n+'/'+sl);return {}};
  const mkm=(lead_name)=>{const logs=[];const L=lead.create({CFG:{PARTY_LEADER:lead_name},say:(x)=>logs.push(x),alive:()=>true,me:{name:'R',cls:'ranger'},members:[{name:'R',cls:'ranger'},{name:'W',cls:'warrior'}],can_lead:{ranger:true},
    merchant:{name:'M',slot:'2',enabled:true,max_tries:3,retry_ms:60000,grace_ms:30000,is_online:()=>false},hooks:{}});return {L,logs}};
  let o=mkm('W');o.L.stop_merchant();o.L.start_merchant();assert.strictEqual(stopped.length+started.length,0,'not the lead: neither works');
  o=mkm('R');o.L.stop_merchant();assert.deepStrictEqual(stopped,['M']);assert.strictEqual(o.L.L.m.done,true,'a stop ends the auto-start');
  o.L.start_merchant();assert.deepStrictEqual(started,['M/2']);assert.strictEqual(o.L.L.m.done,false,'Start re-arms the guard');
  console.log('lead_unit merchant stop/start OK');
}

// al_cmd console commands: only the lead, any case, merchant alias
{
  const stopped=[],started=[],told=[];global.stop_character=(n)=>{stopped.push(n)};global.start_character=(n,sl)=>{started.push(n+'/'+sl);return {}};
  const mk=(lead_name)=>{const logs=[];const L=lead.create({CFG:{PARTY_LEADER:lead_name},say:(x)=>logs.push(x),alive:()=>true,me:{name:'R',cls:'ranger'},members:[{name:'R',cls:'ranger'},{name:'Wex',cls:'warrior',slot:'4'}],can_lead:{ranger:true},
    merchant:{name:'Goodies',slot:'2',enabled:true,max_tries:3,retry_ms:60000,grace_ms:30000,is_online:()=>false},hooks:{start:(n,sl)=>started.push(n+'/'+sl)}});return {L,logs}};
  let o=mk('W');o.L.command('stop wex');o.L.command('stop merchant');assert.strictEqual(stopped.length,0,'not the lead: ignored');
  o=mk('R');o.L.command('stop goodies');assert.deepStrictEqual(stopped,['Goodies'],'stop by the Merchant name, any case');
  o.L.command('start merchant');assert.ok(started.indexOf('Goodies/2')>=0,'start merchant');
  o.L.command('start WEX');assert.ok(started.indexOf('Wex/4')>=0,'start a roster member, any case');
  const n=stopped.length;o.L.command('stop nobody');o.L.command('dance wex');o.L.command('stop');assert.strictEqual(stopped.length,n,'unknown name / verb / missing target: nothing happens');
  console.log('lead_unit al_cmd OK');
}

// al_cmd status: any character prints one console line
{
  const out=[];const oc=console.log;console.log=(...a)=>{out.push(a.join(' '))};
  try{const L=lead.create({CFG:{PARTY_LEADER:'W'},say:()=>{},alive:()=>true,me:{name:'R',cls:'ranger'},members:[{name:'R',cls:'ranger'},{name:'W',cls:'warrior'}],can_lead:{ranger:true},hooks:{}});L.command('status');}finally{console.log=oc}
  assert.ok(out.some((l)=>/^\[status\] R \| script build/.test(l)),'status prints a console line even when not the lead');
  console.log('lead_unit status OK');
}

// a plain "fight nearby" no longer holds a reload back forever; a boss / goal still does
{
  const T0=T;
  global.character={level:50,hp:900,max_hp:1000,slots:{},map:'main',x:1,y:1,xp:5,gold:9,rip:false};
  const store={};global.get=(k)=>store[k];global.set=(k,v)=>{store[k]=v};
  const mk=(busy)=>{const o={reloads:0};o.L=lead.create({CFG:{PARTY_LEADER:'R'},say:()=>{},alive:()=>true,me:{name:'R',cls:'ranger'},members:[{name:'R',cls:'ranger'},{name:'W',cls:'warrior'}],can_lead:{ranger:true},busy,quiet_ms:1000,soft_wait_ms:60000,hooks:{reload:()=>{o.reloads++}}});return o};
  let o=mk(()=>'a hawk is fighting W');o.L.request_reload('t');
  for(let i=0;i<10;i++){T+=5000;o.L.tick()}assert.strictEqual(o.reloads,0,'a plain fight still waits at first (50 s)');
  for(let i=0;i<5;i++){T+=5000;o.L.tick()}assert.strictEqual(o.reloads,1,'after soft_wait_ms a plain fight no longer blocks the reload');
  o=mk(()=>'a hawk is fighting W');character.hp=300;o.L.request_reload('t');
  for(let i=0;i<30;i++){T+=5000;o.L.tick()}assert.strictEqual(o.reloads,0,'hurt: keeps waiting');character.hp=900;
  o=mk(()=>'farm goal phoenix');o.L.request_reload('t');
  for(let i=0;i<60;i++){T+=5000;o.L.tick()}assert.strictEqual(o.reloads,0,'a goal / boss / forced farm still blocks it');
  console.log('lead_unit soft wait OK');
}
// the lead forces a follower that stays on an older build to reload; the forced reload ignores a plain fight
{
  const out=[];global.send_cm=(to,msg)=>out.push({to,msg});
  global.character={level:50,hp:900,max_hp:1000,slots:{},map:'main',x:1,y:1,xp:5,gold:9,rip:false};
  const store={};global.get=(k)=>store[k];global.set=(k,v)=>{store[k]=v};
  globalThis.__AL_BUILD='aaa';globalThis.__AL_LIB_BUILD='lll';
  const logs=[];const ld=lead.create({CFG:{PARTY_LEADER:'R'},say:(x)=>logs.push(x),alive:()=>true,me:{name:'R',cls:'ranger'},members:[{name:'R',cls:'ranger'},{name:'W',cls:'warrior'}],can_lead:{ranger:true},busy:()=>'',quiet_ms:1000,update:{enabled:false,follower_force_ms:120000},hooks:{}});
  ld.handle({name:'W',message:{type:'hello',level:50,gear:5,build:'bbb',lib:'lll',cls:'warrior'}});
  const lag=()=>out.filter((x)=>x.msg&&x.msg.cmd==='reload_now').length;
  ld.handle({name:'W',message:{type:'lead_hello',level:50,gear:5,lead:'R',epoch:1,build:'bbb',lib:'lll'}});
  ld.tick();T+=60000;ld.handle({name:'W',message:{type:'lead_hello',level:50,gear:5,lead:'R',epoch:1,build:'bbb',lib:'lll'}});ld.tick();assert.strictEqual(lag(),0,'not forced before follower_force_ms');
  T+=70000;ld.handle({name:'W',message:{type:'lead_hello',level:50,gear:5,lead:'R',epoch:1,build:'bbb',lib:'lll'}});ld.tick();
  assert.strictEqual(lag(),1,'forced after follower_force_ms');assert(logs.some((x)=>/forcing it to reload/.test(x)));
  T+=10000;ld.handle({name:'W',message:{type:'lead_hello',level:50,gear:5,lead:'R',epoch:1,build:'bbb',lib:'lll'}});ld.tick();assert.strictEqual(lag(),1,'not again within 5 min');
  let reloads=0;const fo=lead.create({CFG:{PARTY_LEADER:'R'},say:()=>{},alive:()=>true,me:{name:'W',cls:'warrior'},members:[{name:'R',cls:'ranger'},{name:'W',cls:'warrior'}],can_lead:{ranger:true},busy:()=>'a hawk is fighting W',quiet_ms:1000,soft_wait_ms:120000,hooks:{reload:()=>{reloads++}}});
  fo.handle({name:'R',message:{type:'lead_hello',level:60,gear:5,lead:'R',epoch:1}});
  fo.handle({name:'R',message:{type:'ctl',cmd:'reload_now'}});
  for(let i=0;i<4;i++){T+=1500;fo.tick()}
  assert.strictEqual(reloads,1,'reload_now reloads through a plain fight at once');
  console.log('lead_unit forced reload OK');
}
