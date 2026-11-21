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
