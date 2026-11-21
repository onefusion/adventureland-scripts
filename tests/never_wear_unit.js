// strip_never_wear unit check: node tests/never_wear_unit.js (run from the repo root after node build/build.js)
const fs=require("fs"),vm=require("vm");
const logs=[],un=[];
const ctx={console,globalThis:null,game_log:()=>{},get:()=>null,set:()=>{},character:{slots:{shoes:{name:"iceskates",level:2},helmet:{name:"hat"}}},unequip:(s)=>{un.push(s);return Promise.resolve({})},require_code:()=>null,parent:{},G:{items:{},sets:{}},setTimeout,clearTimeout,setInterval,clearInterval,Date,Math,JSON,Object,Array,Promise};
ctx.globalThis=ctx;vm.createContext(ctx);
const src=fs.readFileSync("dist/AL Libs v6.js","utf8");
const mod={exports:{}};
try{vm.runInContext("(function(exports,module){"+src+"\n})",ctx)(mod.exports,mod)}catch(e){console.log("load",e.message)}
const AL=mod.exports;
AL.runtime.strip_never_wear((m)=>logs.push(m));
setTimeout(()=>{console.log(JSON.stringify(un),logs.length&&logs[0].slice(0,60));process.exit(un.join()==="shoes"?0:1)},50);
