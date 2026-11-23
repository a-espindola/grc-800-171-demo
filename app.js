/* ===================== Utilities ===================== */
const $ = (s, r=document) => r.querySelector(s);
const $$ = (s, r=document) => [...r.querySelectorAll(s)];
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c]));
const today = () => new Date().toISOString().slice(0,10);
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2,8);
function addDays(d, n){ const x = new Date(d+"T00:00:00Z"); x.setUTCDate(x.getUTCDate()+n); return x.toISOString().slice(0,10); }
function addMonths(d, n){ const x = new Date(d+"T00:00:00Z"); x.setUTCMonth(x.getUTCMonth()+Number(n||0)); return x.toISOString().slice(0,10); }
function daysUntil(d){ if(!d) return null; return Math.round((new Date(d+"T00:00:00Z") - new Date(today()+"T00:00:00Z"))/86400000); }
function fmtDate(d){ if(!d) return "—"; const x=new Date(d+(d.length===10?"T00:00:00Z":"")); return isNaN(x)?d:x.toLocaleDateString(undefined,{year:"numeric",month:"short",day:"numeric",timeZone:"UTC"}); }
function csvCell(v){ v = Array.isArray(v) ? v.join("; ") : String(v ?? ""); return /[",\n]/.test(v) ? `"${v.replace(/"/g,'""')}"` : v; }
function toCSV(rows){ return rows.map(r => r.map(csvCell).join(",")).join("\n"); }
const tagsToArr = s => String(s||"").split(/[,;\s]+/).map(x=>x.trim()).filter(Boolean);

let toastT;
function toast(msg){ const t=$("#toast"); t.textContent=msg; t.classList.add("on"); clearTimeout(toastT); toastT=setTimeout(()=>t.classList.remove("on"),2400); }

function modal(html, buttons=[{label:"OK",value:true,pri:true}]){
  return new Promise(res=>{
    const m=$("#modal"); m.innerHTML=`<div class="box">${html}<div class="row" style="justify-content:flex-end;margin-top:16px">${buttons.map((b,i)=>`<button class="btn ${b.pri?'pri':''} ${b.danger?'danger':''}" data-i="${i}">${esc(b.label)}</button>`).join("")}</div></div>`;
    m.classList.add("on");
    m.onclick = e => { const b=e.target.closest("button[data-i]"); if(!b) return; const v=buttons[+b.dataset.i]; if(v.check && !v.check(m)) return; m.classList.remove("on"); res(typeof v.value==="function"?v.value(m):v.value); };
  });
}
const confirmBox = (title, body, label="Confirm", danger=false) => modal(`<h3>${esc(title)}</h3><p class="muted">${body}</p>`, [{label:"Cancel",value:false},{label,value:true,pri:!danger,danger}]);

/* ===================== Data layer ===================== */
const COLS = ["controls","poam","assessments","policies","risks","settings","assets","reviews","requests","signoffs"];
const S = Object.fromEntries(COLS.map(c=>[c,{}]));
/* DB / USER / DL are shared-storage, identity, and download services available when the app is hosted
   on a platform that provides them. This public demo never sets them: it always runs in local mode. */
let DB=null, USER=null, DL=null, ME=null, MODE="loading", READONLY=false, STALE=false;
const LS_KEY="grc-demo-v1";
const names = {};
const queue = {};

function settings(){ return S.settings.org || {}; }
function rec(col,id){ return S[col][id] || {}; }

async function initData(){
  MODE="local";
  let loaded=false;
  try{ const raw=localStorage.getItem(LS_KEY); if(raw){ const o=JSON.parse(raw); COLS.forEach(c=>S[c]=o[c]||{}); loaded=true; } }catch(e){}
  if(!loaded) await loadDemoData();
  render();
}
function persistLocal(){ try{ localStorage.setItem(LS_KEY, JSON.stringify(S)); }catch(e){} }

async function save(col, id, data, msg){
  if(READONLY){ toast("You have view-only access"); return false; }
  const prev = S[col][id];
  const d = JSON.parse(JSON.stringify(data));
  d.updatedAt = new Date().toISOString(); if(ME) d.updatedBy = ME;
  if(msg){ d.history = [{at:d.updatedAt, by:ME||null, msg}, ...(prev?.history||d.history||[])].slice(0,25); }
  S[col] = {...S[col], [id]: d};
  scheduleRender();
  if(MODE==="db"){
    const key=col+"/"+id;
    const run = async()=>{
      try{ await DB.collection(col).doc(id).set(d); }
      catch(e){
        if(e && e.code==="unavailable"){ await new Promise(r=>setTimeout(r,600+Math.random()*800)); try{ await DB.collection(col).doc(id).set(d); return; }catch(e2){ e=e2; } }
        if(e && e.code==="invalid_argument"){ READONLY=true; document.body.classList.add("ro"); toast("Save refused — you may have view-only access"); }
        else if(e && e.code==="quota_exceeded"){ toast("Storage limit reached: "+(e.message||"")); }
        else toast("Couldn't save — "+(e?.message||"try again"));
        if(prev) S[col]={...S[col],[id]:prev}; else { const o={...S[col]}; delete o[id]; S[col]=o; }
        scheduleRender();
      }
    };
    queue[key] = (queue[key]||Promise.resolve()).then(run);
    await queue[key];
  } else persistLocal();
  return true;
}
async function del(col, id){
  if(READONLY){ toast("You have view-only access"); return; }
  const o={...S[col]}; delete o[id]; S[col]=o; scheduleRender();
  if(MODE==="db"){ try{ await DB.collection(col).doc(id).delete(); }catch(e){ toast("Couldn't delete — "+(e?.message||"")); } }
  else persistLocal();
}
async function resolveNames(){
  if(!USER) return;
  const ids=[...new Set($$("[data-uid]").map(e=>e.dataset.uid).filter(Boolean))];
  if(!ids.length) return;
  try{ const ps = await USER.profiles(ids); $$("[data-uid]").forEach(e=>{ const p=ps?.[e.dataset.uid]; e.textContent = (p&&p.name)||"a teammate"; }); }catch(e){}
}
const who = id => id ? `<span data-uid="${esc(id)}">…</span>` : "";

async function offerFile(filename, data){
  // Generates the file in the browser and saves it with a temporary blob: URL. Nothing is uploaded.
  const types={csv:"text/csv",json:"application/json",md:"text/markdown",html:"text/html",docx:"application/vnd.openxmlformats-officedocument.wordprocessingml.document"};
  const ext=filename.split(".").pop().toLowerCase();
  const blob = data instanceof Blob ? data : new Blob([data],{type:(types[ext]||"text/plain")+";charset=utf-8"});
  const url=URL.createObjectURL(blob); const a=document.createElement("a");
  a.href=url; a.download=filename; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(()=>URL.revokeObjectURL(url),5000);
  toast("Downloaded "+filename);
}

/* ===================== Scoring & derived state ===================== */
function ctrlStatus(id){ return rec("controls",id).status || "not_assessed"; }
const isMet = st => st==="implemented" || st==="na";

function computeScore(getRec = id=>rec("controls",id)){
  let score=110, met=0; const unmet=[]; let sspMet=true;
  const counts=Object.fromEntries(STATUSES.map(s=>[s.k,0]));
  CONTROLS.forEach(c=>{
    const r=getRec(c.id)||{}; const st=r.status||"not_assessed"; counts[st]++;
    if(isMet(st)){ met++; return; }
    if(c.id==="3.12.4"){ sspMet=false; unmet.push({c,d:0,r}); return; }
    let d=c.pts; if(PARTIAL_RULES[c.id] && r.partialCredit && st!=="not_assessed") d=PARTIAL_RULES[c.id].pts;
    score-=d; unmet.push({c,d,r});
  });
  return {score, met, unmet, sspMet, counts};
}
function openPoamFor(id){ return Object.values(S.poam).filter(p=>p.ctrl===id && p.status!=="Closed"); }
function readiness(){
  const sc=computeScore(); const reasons=[]; const checks=[];
  const l1 = CONTROLS.filter(c=>c.l1); const l1met = l1.filter(c=>isMet(ctrlStatus(c.id))).length;
  checks.push({ok:sc.sspMet, t:"System Security Plan in place (CA.L2-3.12.4)", d: sc.sspMet?"SSP requirement marked implemented.":"Without a current SSP an assessment can't proceed."});
  checks.push({ok:sc.score>=88, t:`SPRS score ≥ 88 (currently ${sc.score})`, d:"80% of 110 is the floor for Conditional Level 2 status."});
  const inelig = sc.unmet.filter(u=>!(u.c.poamEligible && (u.c.id!=="3.13.11" || u.r.partialCredit)));
  checks.push({ok:inelig.length===0, t:`Every unmet requirement is POA&M-eligible`, d: inelig.length? `${inelig.length} unmet requirement(s) can't be deferred: ${inelig.slice(0,8).map(u=>u.c.id).join(", ")}${inelig.length>8?"…":""}` : "Only 1-point requirements (and non-FIPS 3.13.11) remain."});
  const noPoam = sc.unmet.filter(u=>openPoamFor(u.c.id).length===0);
  checks.push({ok:noPoam.length===0, t:"Every unmet requirement has an open POA&M item", d: noPoam.length? `${noPoam.length} unmet requirement(s) lack a POA&M item.` : "POA&M coverage complete."});
  let verdict, vcolor;
  if(sc.met===110){ verdict="Final Level 2 status — all 110 requirements MET"; vcolor="var(--good)"; }
  else if(checks.every(c=>c.ok)){ verdict="Eligible for Conditional Level 2 status (180-day POA&M closeout)"; vcolor="var(--warn)"; }
  else { verdict="Not yet eligible for Level 2 status"; vcolor="var(--crit)"; }
  return {sc, checks, verdict, vcolor, l1met, l1total:l1.length};
}
/* ---- 800-171A assessment objectives ---- */
const OBJ_ST = [["","Not assessed"],["met","Met"],["not_met","Not met"],["na","N/A"]];
const objLabel = (id,k) => k ? `${id}[${k}]` : id;
const capFirst = t => t.charAt(0).toUpperCase()+t.slice(1);
function objSummary(id, objMap){
  const list = NIST_171A[id]?.o || []; const m = objMap || rec("controls",id).obj || {};
  let met=0, notMet=0, na=0; list.forEach(([k])=>{ const st=m[k||"_"]?.st; if(st==="met") met++; else if(st==="not_met") notMet++; else if(st==="na") na++; });
  return {total:list.length, met, notMet, na, open:list.length-met-notMet-na};
}
function objSuggest(sm){
  if(!sm.total || sm.open===sm.total) return null;
  if(sm.open===0 && sm.notMet===0) return sm.na===sm.total ? "na" : "implemented";
  if(sm.notMet>0 && sm.met===0 && sm.open===0) return "not_implemented";
  if(sm.notMet>0) return "partial";
  return null;
}
function objTotals(){ let met=0,notMet=0,total=0; CONTROLS.forEach(c=>{const s=objSummary(c.id); met+=s.met+s.na; notMet+=s.notMet; total+=s.total;}); return {met,notMet,total,open:total-met-notMet}; }
function opsLinks(id){
  let h="";
  if(["3.4.1","3.4.2","3.13.11"].includes(id)){ const as=Object.values(S.assets).filter(x=>(x.status||"Active")!=="Retired"); const last=as.map(x=>x.reviewed||"").sort().pop(); h+=`<dt>Asset inventory</dt><dd><a href="#assets">${as.length} active asset(s)</a>${last?` · last verified ${fmtDate(last)}`:""}${id==="3.13.11"?` · ${as.filter(x=>x.fips==="Yes").length} with FIPS-validated crypto recorded`:""}</dd>`; }
  if(["3.1.1","3.1.2","3.1.5","3.1.7","3.5.6","3.9.2"].includes(id)){ const done=Object.values(S.reviews).filter(r=>r.status==="Completed").sort((a,b)=>(b.completedOn||"")>(a.completedOn||"")?1:-1); h+=`<dt>Access reviews</dt><dd>${done.length?`<a href="#access-reviews">${done.length} completed</a> · latest ${fmtDate(done[0].completedOn)} (${esc(done[0].system||"")})`:`<a href="#access-reviews">None completed yet</a>`}</dd>`; }
  const rq=Object.values(S.requests).filter(r=>(r.ctrls||[]).includes(id)&&reqOpen(r)); if(rq.length) h+=`<dt>Evidence requests</dt><dd><a href="#evidence-requests">${rq.length} open</a></dd>`;
  return h;
}
function policiesFor(ctrlId){ return Object.entries(S.policies).filter(([k,p])=>(p.ctrls||[]).includes(ctrlId) && p.status!=="Retired"); }
function riskScore(r){ return (Number(r.likelihood)||0)*(Number(r.impact)||0); }
function riskBand(s){ if(s>=20) return {l:"Critical",c:"var(--crit)"}; if(s>=12) return {l:"High",c:"var(--serious)"}; if(s>=5) return {l:"Medium",c:"var(--warn)"}; return {l:"Low",c:"var(--good)"}; }

const pill = st => { const s=STATUS_BY_K[st]||STATUS_BY_K.not_assessed; return `<span class="pill"><i style="background:${s.color}"></i>${esc(s.label)}</span>`; };
const pillC = (label,color) => `<span class="pill"><i style="background:${color}"></i>${esc(label)}</span>`;

/* ===================== Forms ===================== */
function formHTML(spec, v){
  return `<div class="form">${spec.map(f=>{
    if(f.sect) return `<div class="sect">${esc(f.sect)}</div>`;
    const val = v[f.k] ?? f.def ?? "";
    const id = "f_"+f.k; const full = f.full||f.type==="textarea" ? "full" : "";
    let input;
    if(f.type==="textarea") input=`<textarea id="${id}" data-k="${f.k}" rows="${f.rows||4}" placeholder="${esc(f.ph||"")}">${esc(val)}</textarea>`;
    else if(f.type==="select") input=`<select id="${id}" data-k="${f.k}">${f.options.map(o=>{const [ov,ol]=Array.isArray(o)?o:[o,o];return `<option value="${esc(ov)}" ${String(val)===String(ov)?"selected":""}>${esc(ol)}</option>`;}).join("")}</select>`;
    else if(f.type==="checkbox") return `<div class="f ${full} cb"><input type="checkbox" id="${id}" data-k="${f.k}" ${val?"checked":""}><label for="${id}" style="font-weight:500;color:var(--ink)">${esc(f.label)}</label></div>`;
    else if(f.type==="tags") input=`<input type="text" id="${id}" data-k="${f.k}" data-tags="1" value="${esc((val||[]).join(", "))}" placeholder="${esc(f.ph||"")}">`;
    else input=`<input type="${f.type||"text"}" id="${id}" data-k="${f.k}" value="${esc(val)}" placeholder="${esc(f.ph||"")}" ${f.min!=null?`min="${f.min}"`:""} ${f.max!=null?`max="${f.max}"`:""}>`;
    return `<div class="f ${full}"><label for="${id}">${esc(f.label)}</label>${input}${f.help?`<div class="help">${f.help}</div>`:""}</div>`;
  }).join("")}</div>`;
}
function readForm(root){
  const o={}; $$("[data-k]",root).forEach(el=>{ const k=el.dataset.k;
    if(el.type==="checkbox") o[k]=el.checked; else if(el.dataset.tags) o[k]=tagsToArr(el.value); else if(el.type==="number") o[k]=el.value===""?"":Number(el.value); else o[k]=el.value; });
  return o;
}

/* ===================== Drawer ===================== */
let drawerDirty=false;
function openDrawer({title, sub="", body, foot="", wide=false}){
  const d=$("#drawer"); d.classList.toggle("wide",wide);
  d.innerHTML=`<div class="dh"><div><h2>${title}</h2>${sub?`<div class="muted small" style="margin-top:3px">${sub}</div>`:""}</div><button class="btn ghost x" data-act="close-drawer" aria-label="Close">✕</button></div><div class="db">${body}</div>${foot?`<div class="df">${foot}</div>`:""}`;
  d.classList.add("on"); $("#scrim").classList.add("on"); drawerDirty=false;
  d.oninput=()=>{drawerDirty=true;};
  resolveNames();
}
async function closeDrawer(force){
  if(!force && drawerDirty && !READONLY){ const ok=await confirmBox("Discard changes?","You have unsaved edits in this panel.","Discard",true); if(!ok) return; }
  $("#drawer").classList.remove("on"); $("#scrim").classList.remove("on"); drawerDirty=false;
}

/* ===================== Views ===================== */
const VIEWS = {
  dashboard:{label:"Dashboard",icon:'<path d="M3 13h8V3H3zm10 8h8V11h-8zM3 21h8v-6H3zm10-18v6h8V3z"/>'},
  controls:{label:"Controls (800-171 / CMMC)",icon:'<path d="M12 2 4 5v6c0 5 3.4 9.7 8 11 4.6-1.3 8-6 8-11V5z"/>',grp:"Compliance"},
  poam:{label:"POA&M",icon:'<path d="M9 11l3 3 8-8M20 12v7a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h9"/>'},
  assessments:{label:"Assessments & Audits",icon:'<path d="M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM21 21l-4.3-4.3"/>'},
  "evidence-requests":{label:"Evidence Requests",icon:'<path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2M9 5a2 2 0 0 0 2 2h2a2 2 0 0 0 2-2M9 5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2M9 13h6M9 17h4"/>'},
  assets:{label:"Asset Inventory",icon:'<rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/>',grp:"Operations"},
  "access-reviews":{label:"Access Reviews",icon:'<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8M22 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8"/>'},
  policies:{label:"Policies",icon:'<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6M8 13h8M8 17h8"/>',grp:"Governance"},
  risks:{label:"Risk Register",icon:'<path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0zM12 9v4M12 17h.01"/>'},
  evidence:{label:"Evidence",icon:'<path d="M21.4 11.1 12.2 20.3a6 6 0 0 1-8.5-8.5l9.2-9.2a4 4 0 0 1 5.7 5.7l-9.2 9.2a2 2 0 0 1-2.8-2.8l8.5-8.5"/>'},
  reports:{label:"Reports & Export",icon:'<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/>',grp:"Admin"},
  "org-settings":{label:"Organization",icon:'<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>'}
};
let VIEW="dashboard";
const CREDIT_FOOTER = `<footer class="credit">Created by <a href="https://github.com/a-espindola" rel="noopener noreferrer">Andres Espindola</a> · Built with AI assistance (Claude by Anthropic) · <a href="https://github.com/a-espindola/grc-800-171-demo" rel="noopener noreferrer">Source on GitHub</a> · Demo for educational and practice use only</footer>`;
const UI = { ctrl:{q:"",fam:"",st:"",lvl:"",pts:"",owner:"",typ:""}, poam:{st:"open"}, pol:{tab:"library"}, risk:{st:""} };

function navHTML(){
  const openPoam=Object.values(S.poam).filter(p=>p.status!=="Closed").length;
  const pols=Object.keys(S.policies).length;
  return Object.entries(VIEWS).map(([k,v])=>{
    const openReq=Object.values(S.requests).filter(reqOpen).length;
    const cnt = k==="poam"&&openPoam?openPoam : k==="policies"&&pols?pols : k==="evidence-requests"&&openReq?openReq : null;
    return `${v.grp?`<div class="grp">${v.grp}</div>`:""}<a href="#${k}" class="${VIEW===k?"on":""}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${v.icon}</svg>${esc(v.label)}${cnt!=null?`<span class="cnt">${cnt}</span>`:""}</a>`;
  }).join("");
}
function bannerHTML(){
  if(VIEW!=="dashboard" && VIEW!=="org-settings") return "";
  return `<div class="banner info"><span><b>Demo workspace created by Andres Espindola with AI assistance.</b> Sample data for a fictional company. Everything you change is stored only in this browser (localStorage); nothing is sent anywhere.</span><span class="row" style="margin-left:auto"><button class="btn sm" data-act="demo-reset">Reset demo data</button><button class="btn sm" data-act="demo-clear">Start empty</button></span></div>`;
}
function head(title, sub, actions=""){ return `${bannerHTML()}<div class="top"><div><h1>${title}</h1>${sub?`<p>${sub}</p>`:""}</div><div class="row">${actions}</div></div>`; }

let rT=null;
function scheduleRender(){ clearTimeout(rT); rT=setTimeout(render,30); }
function render(){
  const a=document.activeElement; const aid=a&&a.id; const sel = a && "selectionStart" in a ? [a.selectionStart,a.selectionEnd] : null;
  $("#nav").innerHTML=navHTML();
  const org=settings();
  $("#orgname").textContent = org.org ? org.org : "Set up your organization";
  const fn = {dashboard:vDashboard, controls:vControls, poam:vPoam, assessments:vAssess, policies:vPolicies, risks:vRisks, assets:vAssets, "access-reviews":vReviews, "evidence-requests":vRequests, evidence:vEvidence, reports:vReports, "org-settings":vSettings}[VIEW] || vDashboard;
  $("#main").innerHTML = (MODE==="loading" ? `<div class="empty">Loading workspace…</div>` : fn()) + CREDIT_FOOTER;
  if(aid && !$("#drawer").contains(a)){ const n=document.getElementById(aid); if(n && n!==document.activeElement){ n.focus(); if(sel && n.setSelectionRange) try{n.setSelectionRange(sel[0],sel[1]);}catch(e){} } }
  resolveNames(); makeFocusable($("#main"));
}
/* Keyboard access: clickable rows and tiles get focus and respond to Enter / Space */
function makeFocusable(root){ $$("tr.click, .tile.click, .stack[data-act]", root).forEach(el=>{ el.tabIndex=0; el.setAttribute("role","button"); }); }
document.addEventListener("keydown", e=>{
  if(e.key!=="Enter" && e.key!==" ") return;
  const el=e.target; if(!el.matches || !el.matches("tr.click[data-act], .tile.click[data-act], .stack[data-act]")) return;
  e.preventDefault(); el.click();
});
function route(){ if($("#drawer").classList.contains("on")) closeDrawer(true); const h=(location.hash||"").slice(1); VIEW = VIEWS[h] ? h : "dashboard"; render(); window.scrollTo(0,0); }

/* ---------- Dashboard ---------- */
function famBars(){
  return Object.entries(FAMILIES).map(([fk,f])=>{
    const cs=CONTROLS.filter(c=>c.fam===fk); const cnt={}; cs.forEach(c=>{const s=ctrlStatus(c.id); cnt[s]=(cnt[s]||0)+1;});
    const met=cs.filter(c=>isMet(ctrlStatus(c.id))).length;
    const segs = STATUSES.filter(s=>cnt[s.k]).map(s=>`<span style="flex:${cnt[s.k]};background:${s.color}" data-tip="${esc(f.name)}\n${s.label}: ${cnt[s.k]} of ${cs.length}"></span>`).join("");
    return `<div class="fam"><div class="nm" title="${esc(f.name)}"><b>${fk}</b>${esc(f.name)}</div><div class="stack" data-act="goto-fam" data-fam="${fk}" style="cursor:pointer">${segs}</div><div class="pct">${Math.round(met/cs.length*100)}%</div></div>`;
  }).join("") + `<div class="legend">${STATUSES.map(s=>`<span><i style="background:${s.color}"></i>${s.label}</span>`).join("")}</div>`;
}
function vDashboard(){
  const R=readiness(), sc=R.sc, org=settings();
  const poams=Object.values(S.poam); const openP=poams.filter(p=>p.status!=="Closed"); const overdue=openP.filter(p=>p.due && daysUntil(p.due)<0);
  const pols=Object.values(S.policies).filter(p=>p.status!=="Retired"); const approved=pols.filter(p=>p.status==="Approved");
  const polDue=pols.filter(p=>p.nextReview && daysUntil(p.nextReview)<=30);
  const ctrlDue=CONTROLS.filter(c=>{const d=rec("controls",c.id).nextReview; return d && daysUntil(d)<=30;});
  const pct=Math.round(sc.met/110*100);
  const scoreColor = sc.score>=110?"var(--good-ink)":sc.score>=88?"var(--ink)":"var(--crit)";
  const upcoming = [
    ...overdue.map(p=>({d:p.due,t:`POA&M ${p.num?("#"+p.num):""} overdue — ${p.ctrl}`,h:"#poam"})),
    ...polDue.map(p=>({d:p.nextReview,t:`Policy review: ${p.title}`,h:"#policies"})),
    ...ctrlDue.map(c=>({d:rec("controls",c.id).nextReview,t:`Control review: ${c.id} ${c.title}`,h:"#controls"})),
    ...openP.filter(p=>p.due && daysUntil(p.due)>=0 && daysUntil(p.due)<=30).map(p=>({d:p.due,t:`POA&M due — ${p.ctrl}`,h:"#poam"})),
    ...Object.values(S.requests).filter(r=>reqOpen(r)&&r.status!=="Provided"&&r.due&&daysUntil(r.due)<=30).map(r=>({d:r.due,t:`Evidence request ER-${String(r.num||0).padStart(3,"0")}: ${r.title||""}`,h:"#evidence-requests"})),
    ...Object.values(S.reviews).filter(r=>r.status!=="Completed"&&r.due&&daysUntil(r.due)<=30).map(r=>({d:r.due,t:`Access review due: ${r.name||""}`,h:"#access-reviews"})),
    ...Object.values(S.reviews).filter(r=>reviewNextDue(r)&&daysUntil(reviewNextDue(r))<=30).map(r=>({d:reviewNextDue(r),t:`Next access review: ${r.system||""} · ${r.scope||""}`,h:"#access-reviews"}))
  ].sort((a,b)=>a.d<b.d?-1:1).slice(0,10);
  const unassessed=sc.counts.not_assessed;
  return head(esc(org.system||"Compliance overview"), `${org.org?esc(org.org)+" · ":""}NIST SP 800-171 Rev 2 · CMMC Level 2`)+
  (unassessed===110?`<div class="banner info"><span><b>Start here:</b> open <a href="#controls">Controls</a> and record the status of each requirement, then adopt policies from the <a href="#policies">template library</a>. Fill in <a href="#org-settings">Organization</a> details for your SSP.</span></div>`:"")+
  `<div class="grid g4">
    <div class="card tile"><div class="lbl">SPRS score</div><div class="val" style="color:${scoreColor}">${sc.score}<small> / 110</small></div><div class="meta">DoD Assessment Methodology · range −203 to 110${unassessed?` · ${unassessed} unassessed scored as NOT MET`:""}</div></div>
    <div class="card tile"><div class="lbl">Requirements MET</div><div class="val">${sc.met}<small> / 110</small></div><div class="meter"><i style="width:${pct}%"></i></div><div class="meta">${pct}% · includes N/A</div></div>
    <div class="card tile"><div class="lbl">CMMC Level 1 practices</div><div class="val">${R.l1met}<small> / ${R.l1total}</small></div><div class="meta">${R.l1met===R.l1total?"All FAR 52.204-21 practices met":"No POA&M allowed at Level 1"}</div></div>
    ${(()=>{const t=objTotals(); return `<div class="card tile"><div class="lbl">800-171A objectives met</div><div class="val">${t.met}<small> / ${t.total}</small></div><div class="meter"><i style="width:${Math.round(t.met/t.total*100)}%"></i></div><div class="meta">${t.notMet?`<span style="color:var(--crit);font-weight:600">${t.notMet} not met</span> · `:""}${t.open} not assessed</div></div>`;})()}
    <div class="card tile"><div class="lbl">Open POA&M items</div><div class="val">${openP.length}</div><div class="meta">${overdue.length?`<span style="color:var(--crit);font-weight:600">${overdue.length} overdue</span>`:"None overdue"} · ${poams.length-openP.length} closed</div></div>
    ${(()=>{const as=Object.values(S.assets).filter(x=>(x.status||"Active")!=="Retired"); const ins=as.filter(x=>x.category&&x.category!=="oos").length; const unc=as.filter(x=>!x.category).length; return `<div class="card tile"><div class="lbl">Assets in assessment scope</div><div class="val">${ins}<small> / ${as.length}</small></div><div class="meta">${unc?`<span style="color:var(--crit);font-weight:600">${unc} not categorized</span>`:as.length?"All assets categorized":"No assets recorded yet"}</div></div>`;})()}
    <div class="card tile"><div class="lbl">Policies approved</div><div class="val">${approved.length}<small> / ${pols.length}</small></div><div class="meta">${polDue.length?`${polDue.length} due for review ≤30 days`:"No reviews due"}</div></div>
  </div>
  <div class="grid g3" style="margin-top:14px">
    <div class="card"><h3>Implementation by family <span class="sub">click a bar to filter controls</span></h3>${famBars()}</div>
    <div class="card"><h3>CMMC Level 2 readiness</h3>
      <div class="verdict"><span class="pill"><i style="background:${R.vcolor}"></i>Status</span><b>${R.verdict}</b></div>
      ${R.checks.map(c=>`<div class="check"><div class="ic" style="background:${c.ok?"var(--good)":"var(--crit)"}">${c.ok?"✓":"✕"}</div><div><div style="font-weight:600">${esc(c.t)}</div><div class="muted small">${esc(c.d)}</div></div></div>`).join("")}
      <p class="muted small" style="margin-bottom:0">Per 32 CFR 170.21 & 170.24. Conditional status allows 180 days to close out POA&M items.</p>
    </div>
  </div>
  <div class="grid g2" style="margin-top:14px">
    <div class="card"><h3>Upcoming & overdue <span class="sub">next 30 days</span></h3>${upcoming.length?upcoming.map(u=>`<div class="list-item"><a href="${u.h}">${esc(u.t)}</a><span class="muted small" style="${daysUntil(u.d)<0?"color:var(--crit);font-weight:600":""}">${fmtDate(u.d)}</span></div>`).join(""):`<div class="muted">Nothing due. Set review dates on controls and policies to track them here.</div>`}</div>
    <div class="card"><h3>Largest score deductions <span class="sub">fix these first</span></h3>${sc.unmet.filter(u=>u.d>0).sort((a,b)=>b.d-a.d).slice(0,8).map(u=>`<div class="list-item"><a href="#controls" data-act="open-ctrl" data-id="${u.c.id}">${u.c.cmmc} · ${esc(u.c.title)}</a><span class="tag warn">−${u.d}</span></div>`).join("")||`<div class="muted">No deductions — all requirements met.</div>`}</div>
  </div>`;
}

/* ---------- Controls ---------- */
function filteredControls(){
  const f=UI.ctrl, q=f.q.toLowerCase();
  return CONTROLS.filter(c=>{
    const r=rec("controls",c.id), st=ctrlStatus(c.id);
    if(f.fam && c.fam!==f.fam) return false;
    if(f.st && (f.st==="unmet" ? isMet(st) : st!==f.st)) return false;
    if(f.lvl==="l1" && !c.l1) return false;
    if(f.pts && String(c.pts)!==f.pts) return false;
    if(f.typ && NIST_R2[c.id]?.t!==f.typ) return false;
    if(f.owner && (r.owner||"")!==f.owner) return false;
    if(q){ const hay=(c.id+" "+c.cmmc+" "+c.title+" "+c.text+" "+(r.owner||"")+" "+(r.impl||"")).toLowerCase(); if(!q.split(/\s+/).filter(Boolean).every(t=>hay.includes(t))) return false; }
    return true;
  });
}
function vControls(){
  const f=UI.ctrl; const owners=[...new Set(Object.values(S.controls).map(r=>r.owner).filter(Boolean))].sort();
  const list=filteredControls();
  return head("Security requirements", "110 NIST SP 800-171 Rev 2 requirements mapped to CMMC Level 2 practices.",
    `<button class="btn" data-act="export-controls">Export CSV</button>`)+
  `<div class="filters">
    <input type="search" id="cq" placeholder="Search ID, title, text, owner…" value="${esc(f.q)}" data-filter="ctrl.q">
    <select id="cfam" data-filter="ctrl.fam"><option value="">All families</option>${Object.entries(FAMILIES).map(([k,v])=>`<option value="${k}" ${f.fam===k?"selected":""}>${k} — ${v.name}</option>`).join("")}</select>
    <select id="cst" data-filter="ctrl.st"><option value="">All statuses</option><option value="unmet" ${f.st==="unmet"?"selected":""}>Not MET (any)</option>${STATUSES.map(s=>`<option value="${s.k}" ${f.st===s.k?"selected":""}>${s.label}</option>`).join("")}</select>
    <select id="clvl" data-filter="ctrl.lvl"><option value="">Level 1 + 2</option><option value="l1" ${f.lvl==="l1"?"selected":""}>Level 1 only</option></select>
    <select id="cpts" data-filter="ctrl.pts"><option value="">Any weight</option>${["5","3","1"].map(p=>`<option value="${p}" ${f.pts===p?"selected":""}>${p}-point</option>`).join("")}</select>
    <select id="ctyp" data-filter="ctrl.typ"><option value="">Basic + derived</option><option value="basic" ${f.typ==="basic"?"selected":""}>Basic only</option><option value="derived" ${f.typ==="derived"?"selected":""}>Derived only</option></select>
    ${owners.length?`<select id="cown" data-filter="ctrl.owner"><option value="">Any owner</option>${owners.map(o=>`<option ${f.owner===o?"selected":""}>${esc(o)}</option>`).join("")}</select>`:""}
    <span class="muted small">${list.length} shown</span>
  </div>
  <div class="tbl"><table><thead><tr><th>Requirement</th><th>Practice</th><th style="width:40%">Title</th><th>Pts</th><th>Status</th><th>Objectives</th><th>Owner</th><th>Evidence</th><th>Next review</th></tr></thead><tbody>
  ${list.map(c=>{const r=rec("controls",c.id); const nr=r.nextReview; const od=nr&&daysUntil(nr)<0;
    return `<tr class="click" data-act="open-ctrl" data-id="${c.id}"><td class="mono">${c.id}</td><td class="mono muted">${c.cmmc}${c.l1?' <span class="tag acc">L1</span>':""}</td><td>${esc(c.title)}<div class="muted small" style="margin-top:2px">${esc(c.text.length>110?c.text.slice(0,110)+"…":c.text)}</div></td><td class="mono">${c.pts||"—"}</td><td>${pill(ctrlStatus(c.id))}</td><td class="small mono">${(()=>{const o=objSummary(c.id); return `<span style="${o.notMet?"color:var(--crit);font-weight:600":""}">${o.met+o.na}/${o.total}</span>`;})()}</td><td>${esc(r.owner||"")}</td><td>${(r.evidence||[]).length||""}</td><td class="small" style="${od?"color:var(--crit);font-weight:600":""}">${nr?fmtDate(nr):""}</td></tr>`;}).join("")||`<tr><td colspan="9" class="empty">No requirements match these filters.</td></tr>`}
  </tbody></table></div>`;
}
const CTRL_SPEC = [
  {k:"status",label:"Implementation status",type:"select",options:STATUSES.map(s=>[s.k,s.label])},
  {k:"responsibility",label:"Responsibility",type:"select",options:["Organization","Shared (ESP / CSP)","Inherited (ESP / CSP)","Hybrid"]},
  {k:"owner",label:"Control owner",ph:"e.g., IT Manager"},
  {k:"implementer",label:"Implemented by / system",ph:"e.g., Microsoft 365 GCC High, Intune"},
  {k:"impl",label:"Implementation statement (SSP)",type:"textarea",rows:6,ph:"Describe how this requirement is met: technology, configuration, process, and responsible roles."},
  {k:"odp",label:"Organization-defined parameters",type:"textarea",rows:2,ph:"e.g., session lock = 15 minutes; lockout after 5 attempts"},
  {k:"notes",label:"Assessor / internal notes",type:"textarea",rows:3},
  {k:"reviewed",label:"Last reviewed",type:"date"},
  {k:"nextReview",label:"Next review",type:"date"}
];
function openControl(id){
  const c=CONTROL_BY_ID[id], r=rec("controls",id);
  const pol=policiesFor(id); const poams=Object.entries(S.poam).filter(([k,p])=>p.ctrl===id);
  const pr=PARTIAL_RULES[id];
  const ev=(r.evidence||[]);
  const body=`<div class="req">${esc(c.text)}
    <dl class="kv"><dt>Type</dt><dd>${NIST_R2[c.id]?.t==="basic"?"Basic security requirement":"Derived security requirement"}</dd><dt>Practice</dt><dd class="mono">${c.cmmc}${c.l1?" · also CMMC Level 1 (FAR 52.204-21)":""}</dd>
    <dt>SPRS weight</dt><dd>${c.id==="3.12.4"?"No point value — an SSP must exist for an assessment to proceed":`${c.pts} point${c.pts>1?"s":""}${pr?` (${pr.pts} if: ${esc(pr.label.charAt(0).toLowerCase()+pr.label.slice(1))})`:""}`}</dd>
    <dt>POA&M</dt><dd>${c.poamEligible?(id==="3.13.11"?"Eligible only if encryption is employed but not FIPS-validated":"Eligible for a Level 2 POA&M"):"<b>Not eligible</b> — must be MET at assessment"}</dd>
    ${opsLinks(id)}
    <dt>Policies</dt><dd>${pol.length?pol.map(([k,p])=>`<a href="#policies" data-act="open-policy" data-id="${k}">${esc(p.title)}</a> <span class="muted small">(${esc(p.status)})</span>`).join("<br>"):`<span class="muted">None linked — <a href="#policies">adopt a policy</a></span>`}</dd></dl></div>
    ${NIST_R2[c.id]?`<details class="disc"><summary>NIST discussion (SP 800-171 Rev 2)</summary>${NIST_R2[c.id].d.split(/\n\n+/).map(p=>`<p>${esc(p)}</p>`).join("")}</details>`:""}
    <div id="cform">${formHTML(CTRL_SPEC, {...r, status:r.status||"not_assessed", responsibility:r.responsibility||"Organization"})}
    ${pr?`<div style="margin-top:12px">${formHTML([{k:"partialCredit",label:pr.label+` (reduces deduction to ${pr.pts})`,type:"checkbox",full:true}],r)}</div>`:""}</div>
    <div class="sect" style="margin-top:20px">Assessment objectives — NIST SP 800-171A</div>
    <div id="objhint" class="objhint"></div>
    <div id="objlist">${(NIST_171A[id]?.o||[]).map(([k,t])=>{const o=(r.obj||{})[k||"_"]||{}; return `<div class="obj" data-o="${k||"_"}"><div class="oid mono">${objLabel(id,k)}</div><div class="otx">Determine if ${esc(t)}</div><select data-ok="st">${OBJ_ST.map(([v,l])=>`<option value="${v}" ${(o.st||"")===v?"selected":""}>${l}</option>`).join("")}</select><input type="text" data-ok="n" placeholder="Note / evidence reference" value="${esc(o.n||"")}"></div>`;}).join("")}</div>
    <div class="row wr" style="margin-top:6px"><button class="btn sm" data-act="obj-all" data-v="met">Mark all met</button><button class="btn sm ghost" data-act="obj-all" data-v="">Clear</button></div>
    ${NIST_171A[id]?`<details class="disc" style="margin-top:12px"><summary>Potential assessment methods (Examine · Interview · Test)</summary>${[["e","Examine"],["i","Interview"],["t","Test"]].map(([k,l])=>`<p><b>${l}:</b> ${esc((NIST_171A[id][k]||[]).join("; "))}</p>`).join("")}</details>`:""}
    <div class="sect" style="margin-top:20px">Evidence</div>
    <div id="evlist">${ev.map((e,i)=>evRow(e,i)).join("")}</div>
    <button class="btn sm wr" data-act="ev-add">+ Add evidence</button>
    <div class="help small muted" style="margin-top:6px">Record references (document names, SharePoint / repository links, screenshots IDs). Don't store CUI in this tool.</div>
    <div class="sect">POA&M items</div>
    ${poams.length?poams.map(([k,p])=>`<div class="list-item"><a href="#poam" data-act="open-poam" data-id="${k}">${p.num?"#"+p.num+" · ":""}${esc(p.weakness||"(no description)")}</a><span>${esc(p.status)} · due ${fmtDate(p.due)}</span></div>`).join(""):`<div class="muted small">None.</div>`}
    <div class="sect">Change history</div>
    <div class="hist">${(r.history||[]).map(h=>`<div>${fmtDate(h.at.slice(0,10))} — ${esc(h.msg)} ${h.by?"· "+who(h.by):""}</div>`).join("")||'<span class="muted">No changes recorded yet.</span>'}</div>`;
  openDrawer({title:`${c.id} · ${esc(c.title)}`, sub:`${FAMILIES[c.fam].name} · ${pill(ctrlStatus(id))}`, body,
    foot:`<button class="btn wr" data-act="ctrl-reviewed" data-id="${id}">Mark reviewed today</button>${!isMet(ctrlStatus(id))?`<button class="btn wr" data-act="poam-from-ctrl" data-id="${id}">Create POA&M</button>`:""}<button class="btn" data-act="close-drawer">Close</button><button class="btn pri wr" data-act="ctrl-save" data-id="${id}">Save</button>`});
  updateObjHint(id); const d=$("#drawer"); d.dataset.ctrl=id;
}
const evRow=(e,i)=>`<div class="ev" data-ev="${i}"><input type="text" placeholder="Evidence name" value="${esc(e.name)}" data-evk="name"><input type="text" placeholder="Location / link" value="${esc(e.loc)}" data-evk="loc"><input type="date" value="${esc(e.date)}" data-evk="date"><button class="btn sm ghost wr" data-act="ev-del" title="Remove">✕</button></div>`;
function readObjectives(){ const o={}; $$("#objlist .obj").forEach(r=>{ const st=$('[data-ok=st]',r).value, n=$('[data-ok=n]',r).value.trim(); if(st||n) o[r.dataset.o]={st,n}; }); return o; }
function updateObjHint(id){
  const h=$("#objhint"); if(!h) return; const sm=objSummary(id, readObjectives()); const cur=$("#f_status")?.value;
  const sug=objSuggest(sm);
  let html=`<span><b>${sm.met+sm.na}/${sm.total}</b> objectives met${sm.na?` (${sm.na} N/A)`:""}${sm.notMet?` · <b style="color:var(--crit)">${sm.notMet} not met</b>`:""}${sm.open?` · ${sm.open} not assessed`:""}</span>`;
  if(cur==="implemented" && sm.notMet>0) html+=`<span class="warnline">An assessor scores this requirement NOT MET while any objective is not met.</span>`;
  if(sug && sug!==cur) html+=`<button class="btn sm wr" data-act="obj-apply" data-v="${sug}">Set status to ${esc(STATUS_BY_K[sug].label)}</button>`;
  h.innerHTML=html;
}
function readEvidence(){ return $$("#evlist .ev").map(r=>({name:$('[data-evk=name]',r).value.trim(),loc:$('[data-evk=loc]',r).value.trim(),date:$('[data-evk=date]',r).value})).filter(e=>e.name||e.loc); }
async function saveControl(id, extra={}){
  const prev=rec("controls",id); const f=readForm($("#cform")); const evidence=readEvidence(); const obj=readObjectives();
  const next={...prev, ...f, evidence, obj, ...extra};
  const osm=objSummary(id,obj);
  if(next.status==="implemented" && osm.notMet>0 && !extra._force){
    const ok=await confirmBox("Mark as implemented?",`${osm.notMet} assessment objective(s) are marked Not met. Under NIST SP 800-171A and CMMC scoring, a requirement is only MET when every objective is met.`,"Save anyway");
    if(!ok) return;
  }
  const changes=[]; if((prev.status||"not_assessed")!==next.status) changes.push(`status → ${STATUS_BY_K[next.status].label}`);
  ["owner","impl","nextReview","responsibility"].forEach(k=>{ const pv=k==="responsibility"?(prev[k]||"Organization"):(prev[k]||""); if(pv!==(next[k]||"")) changes.push(k==="impl"?"implementation statement updated":`${k} updated`); });
  if(JSON.stringify(prev.evidence||[])!==JSON.stringify(evidence)) changes.push("evidence updated");
  if(JSON.stringify(prev.obj||{})!==JSON.stringify(obj)) changes.push(`objectives ${osm.met+osm.na}/${osm.total} met`);
  if(extra.reviewed) changes.push("reviewed");
  const ok=await save("controls", id, next, changes.join("; ")||"saved");
  if(ok){ drawerDirty=false; toast("Saved "+id); openControl(id); }
}

/* ---------- POA&M ---------- */
const POAM_SPEC = [
  {k:"ctrl",label:"Requirement",type:"select",options:CONTROLS.map(c=>[c.id,`${c.id} — ${c.title}`])},
  {k:"status",label:"Status",type:"select",options:["Open","In progress","Closed","Risk accepted"]},
  {k:"weakness",label:"Weakness / deficiency",type:"textarea",rows:3,ph:"What is missing or not working?"},
  {k:"plan",label:"Remediation plan",type:"textarea",rows:4},
  {k:"milestones",label:"Milestones",type:"textarea",rows:3,ph:"One per line, e.g. 2026-12-15 — deploy MFA to all users"},
  {k:"owner",label:"Owner"},{k:"resources",label:"Resources / cost estimate"},
  {k:"identified",label:"Date identified",type:"date"},{k:"due",label:"Scheduled completion",type:"date"},
  {k:"source",label:"Source",type:"select",options:["Self-assessment","C3PAO assessment","Internal audit","Vulnerability scan","Incident","Other"]},
  {k:"closed",label:"Date closed",type:"date"},
  {k:"closure",label:"Closure evidence / verification",type:"textarea",rows:2}
];
function poamDeadline(){ const cd=settings().conditionalDate; return cd?addDays(cd,180):null; }
function vPoam(){
  const all=Object.entries(S.poam).sort((a,b)=>(a[1].num||0)-(b[1].num||0));
  const list=all.filter(([k,p])=> UI.poam.st==="open"?p.status!=="Closed":UI.poam.st==="all"?true:p.status===UI.poam.st);
  const sc=computeScore(); const gaps=sc.unmet.filter(u=>openPoamFor(u.c.id).length===0);
  const dl=poamDeadline();
  return head("Plan of Action & Milestones", "Track remediation of every requirement not fully implemented. Level 2 POA&M items must close within 180 days of conditional status.",
   `<button class="btn" data-act="docx" data-k="poam">Export Word</button><button class="btn" data-act="export-poam">Export CSV</button><button class="btn pri wr" data-act="poam-new">+ New item</button>`)+
  (dl?`<div class="banner ${daysUntil(dl)<30?"bad":"info"}">Conditional status closeout deadline: <b>${fmtDate(dl)}</b> (${daysUntil(dl)} days). Set in Organization.</div>`:"")+
  `<div class="filters"><select id="pst" data-filter="poam.st">${[["open","Open & in progress"],["all","All"],["Closed","Closed"],["Risk accepted","Risk accepted"]].map(([v,l])=>`<option value="${v}" ${UI.poam.st===v?"selected":""}>${l}</option>`).join("")}</select><span class="muted small">${list.length} shown</span></div>
  <div class="tbl"><table><thead><tr><th>#</th><th>Requirement</th><th style="width:34%">Weakness</th><th>Owner</th><th>Due</th><th>Status</th><th>L2 eligibility</th></tr></thead><tbody>
  ${list.map(([k,p])=>{const c=CONTROL_BY_ID[p.ctrl]; const du=daysUntil(p.due); const od=p.status!=="Closed"&&du!=null&&du<0;
    return `<tr class="click" data-act="open-poam" data-id="${k}"><td class="mono">${p.num||""}</td><td class="mono">${esc(p.ctrl)}<div class="muted small" style="font-family:var(--font)">${esc(c?.title||"")}</div></td><td>${esc(p.weakness||"")}</td><td>${esc(p.owner||"")}</td><td class="small" style="${od?"color:var(--crit);font-weight:600":""}">${fmtDate(p.due)}${p.status!=="Closed"&&du!=null?`<div class="muted">${du<0?Math.abs(du)+" days late":du+" days left"}</div>`:""}</td><td>${pillC(p.status, {Open:"var(--crit)","In progress":"var(--warn)",Closed:"var(--good)","Risk accepted":"var(--na)"}[p.status]||"var(--na)")}</td><td>${c?(c.poamEligible?'<span class="tag">Eligible</span>':'<span class="tag warn">Not eligible</span>'):""}</td></tr>`;}).join("")||`<tr><td colspan="7" class="empty">No POA&M items${UI.poam.st==="open"?" open":""}.</td></tr>`}
  </tbody></table></div>
  ${gaps.length?`<div class="card" style="margin-top:14px"><h3>Unmet requirements without a POA&M item <span class="sub">${gaps.length}</span></h3>${gaps.slice(0,40).map(u=>`<div class="list-item"><span><span class="mono">${u.c.id}</span> ${esc(u.c.title)} ${u.d?`<span class="tag warn">−${u.d}</span>`:""} ${u.c.poamEligible?"":'<span class="tag">must be MET</span>'}</span><button class="btn sm wr" data-act="poam-from-ctrl" data-id="${u.c.id}">Create</button></div>`).join("")}${gaps.length>40?`<div class="muted small">…and ${gaps.length-40} more</div>`:""}</div>`:""}`;
}
function nextPoamNum(){ return Math.max(0,...Object.values(S.poam).map(p=>p.num||0))+1; }
function openPoam(id, preset){
  const p = id ? rec("poam",id) : {status:"Open", identified:today(), source:"Self-assessment", ...preset};
  const c=CONTROL_BY_ID[p.ctrl];
  openDrawer({title: id?`POA&M #${p.num}`:"New POA&M item", sub: c?`${c.cmmc} · ${esc(c.title)} · ${c.poamEligible?"POA&M-eligible":"<b style='color:var(--crit)'>Not POA&M-eligible for Level 2</b>"}`:"",
    body:`<div id="pform">${formHTML(POAM_SPEC,p)}</div><div class="sect">History</div><div class="hist">${(p.history||[]).map(h=>`<div>${fmtDate(h.at.slice(0,10))} — ${esc(h.msg)} ${h.by?"· "+who(h.by):""}</div>`).join("")||'<span class="muted">—</span>'}</div>`,
    foot:`${id?`<button class="btn danger wr" data-act="poam-del" data-id="${id}">Delete</button>`:""}<button class="btn" data-act="close-drawer">Close</button><button class="btn pri wr" data-act="poam-save" data-id="${id||""}">Save</button>`});
}
async function savePoam(id){
  const f=readForm($("#pform")); const prev=id?rec("poam",id):{};
  if(f.status==="Closed" && !f.closed) f.closed=today();
  const key=id||uid(); const next={...prev,...f, num: prev.num||nextPoamNum()};
  const msg = !id ? "created" : (prev.status!==f.status?`status → ${f.status}`:"updated");
  if(await save("poam",key,next,msg)){ drawerDirty=false; toast("POA&M saved"); closeDrawer(true); }
}

/* ---------- Assessments ---------- */
const ASSESS_SPEC=[
  {k:"name",label:"Name",ph:"e.g., FY27 annual self-assessment",full:true},
  {k:"type",label:"Type",type:"select",options:["CMMC Level 2 self-assessment","CMMC Level 2 C3PAO assessment","CMMC Level 1 self-assessment","NIST 800-171 DoD Basic (SPRS)","Internal audit","Gap assessment","Other"]},
  {k:"status",label:"Status",type:"select",options:["Planned","In progress","Complete"]},
  {k:"start",label:"Start date",type:"date"},{k:"end",label:"End date",type:"date"},
  {k:"assessor",label:"Lead assessor / auditor"},{k:"org",label:"Assessing organization",ph:"Internal / C3PAO name / certification body"},
  {k:"scope",label:"Scope",type:"textarea",rows:2},
  {k:"result",label:"Result / conclusion",type:"textarea",rows:3},
  {k:"sprsSubmitted",label:"SPRS submission date",type:"date"},{k:"affirm",label:"Annual affirmation date",type:"date"}
];
function vAssess(){
  const list=Object.entries(S.assessments).sort((a,b)=>(b[1].start||"")>(a[1].start||"")?1:-1);
  const snaps=list.filter(([k,a])=>a.snapshot).map(([k,a])=>({d:a.end||a.start||a.snapshot.at.slice(0,10),s:a.snapshot.score,n:a.name})).sort((a,b)=>a.d<b.d?-1:1);
  return head("Assessments & audits","Plan assessments, capture point-in-time snapshots of control status, and log findings.",`<button class="btn pri wr" data-act="assess-new">+ New assessment</button>`)+
  (snaps.length>=2?`<div class="card" style="margin-bottom:14px"><h3>SPRS score across snapshots</h3>${trendChart(snaps)}</div>`:"")+
  `<div class="tbl"><table><thead><tr><th>Assessment</th><th>Type</th><th>Dates</th><th>Status</th><th>Snapshot score</th><th>Findings (open)</th></tr></thead><tbody>
  ${list.map(([k,a])=>{const fo=(a.findings||[]).filter(f=>f.status!=="Closed").length; return `<tr class="click" data-act="open-assess" data-id="${k}"><td><b>${esc(a.name||"Untitled")}</b><div class="muted small">${esc(a.assessor||"")}</div></td><td class="small">${esc(a.type)}</td><td class="small">${fmtDate(a.start)}${a.end?" – "+fmtDate(a.end):""}</td><td>${esc(a.status)}</td><td class="mono">${a.snapshot?a.snapshot.score+" · "+a.snapshot.met+"/110"+(a.snapshot.objMet!=null?`<div class="muted small">obj. ${a.snapshot.objMet}/320</div>`:""):"—"}</td><td>${(a.findings||[]).length} (${fo})</td></tr>`;}).join("")||`<tr><td colspan="6" class="empty">No assessments yet. Create one to snapshot your current posture.</td></tr>`}
  </tbody></table></div>`;
}
function trendChart(pts){
  const W=1000,H=180,p={l:40,r:60,t:12,b:26}; const min=Math.min(-10,...pts.map(x=>x.s)), max=110;
  const x=i=>p.l+(pts.length===1?0:i*(W-p.l-p.r)/(pts.length-1)); const y=v=>p.t+(max-v)*(H-p.t-p.b)/(max-min);
  const ticks=[110,88,0].filter(t=>t>=min);
  return `<svg class="spark" viewBox="0 0 ${W} ${H}" role="img" aria-label="SPRS score trend">
   ${ticks.map(t=>`<line x1="${p.l}" x2="${W-p.r}" y1="${y(t)}" y2="${y(t)}" stroke="var(--line)" stroke-width="1" ${t===88?'stroke-dasharray="4 3"':""}/><text x="${p.l-6}" y="${y(t)+4}" text-anchor="end" font-size="11" fill="var(--ink-3)">${t}</text>`).join("")}
   <polyline fill="none" stroke="#2a78d6" stroke-width="2" points="${pts.map((q,i)=>x(i)+","+y(q.s)).join(" ")}"/>
   ${pts.map((q,i)=>`<circle cx="${x(i)}" cy="${y(q.s)}" r="4.5" fill="#2a78d6" stroke="var(--surface)" stroke-width="2" data-tip="${esc(q.n)}\n${fmtDate(q.d)} · score ${q.s}"/><text x="${x(i)}" y="${H-6}" text-anchor="${i===0?"start":i===pts.length-1?"end":"middle"}" font-size="11" fill="var(--ink-3)">${fmtDate(q.d)}</text>`).join("")}
  </svg><div class="muted small">Dashed line = 88, the Conditional Level 2 floor.</div>`;
}
function openAssess(id){
  const a = id ? rec("assessments",id) : {status:"Planned", type:"CMMC Level 2 self-assessment", start:today(), findings:[]};
  const snap=a.snapshot; const cur=computeScore();
  let snapHTML = snap ? `<div class="req"><b>Snapshot ${fmtDate(snap.at.slice(0,10))}:</b> SPRS ${snap.score}, ${snap.met}/110 MET. Current: ${cur.score} (${cur.score-snap.score>=0?"+":""}${cur.score-snap.score}).
     ${(()=>{const changed=CONTROLS.filter(c=>(snap.statuses[c.id]||"not_assessed")!==ctrlStatus(c.id)); return changed.length?`<div class="small" style="margin-top:6px">${changed.length} requirement(s) changed since: ${changed.slice(0,20).map(c=>`<span class="tag">${c.id}: ${STATUS_BY_K[snap.statuses[c.id]||"not_assessed"].short} → ${STATUS_BY_K[ctrlStatus(c.id)].short}</span>`).join("")}${changed.length>20?"…":""}</div>`:"<div class='small muted'>No status changes since snapshot.</div>";})()}</div>` : `<div class="muted small">No snapshot captured yet.</div>`;
  const findings=a.findings||[];
  openDrawer({title:id?esc(a.name||"Assessment"):"New assessment", wide:true,
    body:`<div id="lockbar"></div><div id="aform">${formHTML(ASSESS_SPEC,a)}</div>
    <div class="sect">Control status snapshot</div>${snapHTML}
    <button class="btn sm wr" data-act="assess-snap" style="margin-top:8px" data-lockable>${snap?"Replace snapshot with current status":"Capture current control status"}</button>
    <div class="sect">Findings</div>
    <div id="flist">${findings.map((f,i)=>findingRow(f,i)).join("")}</div>
    <button class="btn sm wr" data-act="finding-add" data-lockable>+ Add finding</button>
    ${id?`<div class="sect">Evidence requests</div>${(()=>{const rq=Object.entries(S.requests).filter(([k,r])=>r.assessment===id).sort((x,y)=>(x[1].num||0)-(y[1].num||0)); return (rq.length?rq.map(([k,r])=>`<div class="list-item"><a href="#evidence-requests" data-act="req-open" data-id="${k}">ER-${String(r.num||0).padStart(3,"0")} · ${esc(r.title||"")}</a>${pillC(r.status||"Open",REQ_COLOR[r.status||"Open"])}</div>`).join(""):`<div class="muted small">None linked.</div>`)+`<button class="btn sm wr" data-act="assess-req" data-id="${id}" style="margin-top:8px">+ Evidence request</button>`;})()}
    <div class="sect">Sign-off</div><div id="sigpanel"></div>`:""}`,
    foot:`${id?`<button class="btn danger wr" data-act="assess-del" data-id="${id}" style="margin-right:auto" data-lockable>Delete</button>`:""}<button class="btn" data-act="close-drawer">Close</button><button class="btn wr" data-act="assess-save" data-id="${id||""}" data-lockable>Save</button>${id?`<button class="btn pri wr" data-act="assess-sign" data-id="${id}" data-lockable>Sign off results</button>`:""}`});
  $("#drawer").dataset.snap = snap?JSON.stringify(snap):"";
  if(id) renderSignoffs("assessment", id, a, {lock:true, lockMsg:"These results match their sign-off. Reopen to edit; the record will then show it changed after signing."});
}
const findingRow=(f,i)=>`<div class="card" style="padding:10px 12px;margin-bottom:8px" data-f="${i}"><div class="row"><select data-fk="ctrl" style="max-width:260px"><option value="">— Requirement —</option>${CONTROLS.map(c=>`<option value="${c.id}" ${f.ctrl===c.id?"selected":""}>${c.id} ${esc(c.title)}</option>`).join("")}</select>
  <select data-fk="severity">${["Not MET","Other than satisfied","Observation","Opportunity for improvement"].map(s=>`<option ${f.severity===s?"selected":""}>${s}</option>`).join("")}</select>
  <select data-fk="status">${["Open","In remediation","Closed"].map(s=>`<option ${f.status===s?"selected":""}>${s}</option>`).join("")}</select>
  <button class="btn sm wr" data-act="finding-poam" title="Create POA&M from this finding">→ POA&M</button><button class="btn sm ghost wr" data-act="finding-del">✕</button></div>
  <textarea data-fk="text" rows="2" style="margin-top:8px;min-height:50px" placeholder="Finding description">${esc(f.text||"")}</textarea></div>`;
function readFindings(){ return $$("#flist [data-f]").map(r=>({ctrl:$('[data-fk=ctrl]',r).value,severity:$('[data-fk=severity]',r).value,status:$('[data-fk=status]',r).value,text:$('[data-fk=text]',r).value})); }
async function saveAssess(id){
  const f=readForm($("#aform")); const prev=id?rec("assessments",id):{}; const snapRaw=$("#drawer").dataset.snap;
  const next={...prev,...f,findings:readFindings(), snapshot: snapRaw?JSON.parse(snapRaw):null};
  if(!next.name){ toast("Give the assessment a name"); return; }
  const key=id||uid(); if(await save("assessments",key,next,id?"updated":"created")){ drawerDirty=false; toast("Assessment saved"); closeDrawer(true); }
}

/* ---------- Policies ---------- */
function policyBody(t){
  const org=settings().org||"[Organization]";
  const nist=t.ctrls.map(id=>`- ${id} / ${CONTROL_BY_ID[id].cmmc} — ${CONTROL_BY_ID[id].title}`).join("\n");
  return `# ${t.title}

## 1. Purpose
This policy establishes ${org}'s requirements for ${t.title.replace(/ Policy$/,"").toLowerCase()} to protect the confidentiality, integrity, and availability of organizational information and Controlled Unclassified Information (CUI), and to satisfy NIST SP 800-171 Rev 2 and CMMC Level 2.

## 2. Scope
This policy applies to all employees, contractors, and third parties who access ${org} information systems, and to all systems, facilities, and media within the CUI assessment boundary defined in the System Security Plan (SSP).

## 3. Roles and Responsibilities
- **Policy Owner:** maintains this policy and reviews it at least annually.
- **Information Security Officer:** oversees implementation, monitoring, and exceptions.
- **IT / System Owners:** implement and operate the technical and procedural controls.
- **Managers:** ensure their staff understand and follow this policy.
- **All Users:** comply with this policy and report suspected violations.

## 4. Policy Statements
${t.stmts.map((s,i)=>`4.${i+1} ${s}`).join("\n\n")}

## 5. Procedures
Supporting procedures, standards, and configuration baselines are maintained by the Policy Owner and referenced in the SSP.

## 6. Compliance and Enforcement
Compliance is verified through internal assessments, audits, and continuous monitoring. Violations may result in disciplinary action up to and including termination of employment or contract.

## 7. Exceptions
Exceptions require a documented business justification and compensating controls, approved by the Information Security Officer, and recorded in the risk register or POA&M. Exceptions are reviewed at least annually.

## 8. Review
This policy is reviewed at least annually and upon significant changes to the environment, threats, or regulatory requirements.

## 9. Related Requirements
**NIST SP 800-171 Rev 2 / CMMC Level 2**
${nist}
`;
}
function mdToHtml(md){
  const lines=esc(md).split("\n"); let out="", inList=false;
  const inline=s=>s.replace(/\*\*(.+?)\*\*/g,"<b>$1</b>").replace(/\[([^\]\n]{1,60})\]/g,"<mark>[$1]</mark>");
  lines.forEach(l=>{
    if(/^\s*-\s+/.test(l)){ if(!inList){out+="<ul>";inList=true;} out+=`<li>${inline(l.replace(/^\s*-\s+/,""))}</li>`; return; }
    if(inList){out+="</ul>";inList=false;}
    if(/^### /.test(l)) out+=`<h3>${inline(l.slice(4))}</h3>`;
    else if(/^## /.test(l)) out+=`<h2>${inline(l.slice(3))}</h2>`;
    else if(/^# /.test(l)) out+=`<h1>${inline(l.slice(2))}</h1>`;
    else if(l.trim()) out+=`<p>${inline(l)}</p>`;
  });
  if(inList) out+="</ul>"; return out;
}
function vPolicies(){
  const t=UI.pol.tab; const pols=Object.entries(S.policies).sort((a,b)=>(a[1].number||"").localeCompare(b[1].number||""));
  const adopted=new Set(pols.map(([k,p])=>p.templateKey));
  const tabs=`<div class="tabs"><button data-act="pol-tab" data-t="library" class="${t==="library"?"on":""}">Policy library (${pols.length})</button><button data-act="pol-tab" data-t="templates" class="${t==="templates"?"on":""}">Templates (${POLICY_TEMPLATES.length})</button><button data-act="pol-tab" data-t="coverage" class="${t==="coverage"?"on":""}">Coverage</button></div>`;
  const hdr=head("IT cybersecurity policies","Author, approve, version, and review the policies that govern your controls.",`<button class="btn wr" data-act="pol-blank">+ Blank policy</button><button class="btn pri wr" data-act="pol-tab" data-t="templates">Adopt from template</button>`)+tabs;
  if(t==="templates") return hdr+`<div class="grid g2">${POLICY_TEMPLATES.map(p=>`<div class="card"><h3>${esc(p.title)}</h3><div class="small muted" style="margin-bottom:8px">${p.stmts.length} policy statements · NIST ${p.fams.join(", ")}</div><div class="small" style="margin-bottom:10px">${p.ctrls.slice(0,10).map(c=>`<span class="tag">${c}</span>`).join("")}${p.ctrls.length>10?`<span class="tag">+${p.ctrls.length-10}</span>`:""}</div><div class="row"><button class="btn sm" data-act="tpl-preview" data-k="${p.key}">Preview</button>${adopted.has(p.key)?'<span class="muted small">Adopted ✓</span>':`<button class="btn sm pri wr" data-act="tpl-adopt" data-k="${p.key}">Adopt</button>`}</div></div>`).join("")}</div>`;
  if(t==="coverage"){
    const rows=Object.entries(FAMILIES).map(([fk,f])=>{const cs=CONTROLS.filter(c=>c.fam===fk); const cov=cs.filter(c=>policiesFor(c.id).some(([k,p])=>p.status==="Approved")).length; const anyLinked=cs.filter(c=>policiesFor(c.id).length).length; return `<tr><td class="mono">${fk}</td><td>${f.name}</td><td>${cov}/${cs.length}</td><td>${anyLinked}/${cs.length}</td><td>${cs.filter(c=>!policiesFor(c.id).length).map(c=>`<span class="tag">${c.id}</span>`).join("")||'<span class="muted small">All linked</span>'}</td></tr>`;}).join("");
    return hdr+`<div class="tbl"><table><thead><tr><th>Family</th><th>Name</th><th>Covered by approved policy</th><th>Linked (any status)</th><th>Requirements with no policy</th></tr></thead><tbody>${rows}</tbody></table></div><p class="muted small">CMMC assessors look for each requirement to be addressed in policy and procedure. Link controls on each policy to close gaps.</p>`;
  }
  const scol={Draft:"var(--na)","In review":"var(--warn)",Approved:"var(--good)",Retired:"var(--none)"};
  return hdr+`<div class="tbl"><table><thead><tr><th>No.</th><th style="width:34%">Policy</th><th>Version</th><th>Status</th><th>Owner</th><th>Approved</th><th>Next review</th><th>Controls</th></tr></thead><tbody>
  ${pols.map(([k,p])=>{const du=daysUntil(p.nextReview); return `<tr class="click" data-act="open-policy" data-id="${k}"><td class="mono">${esc(p.number||"")}</td><td><b>${esc(p.title)}</b></td><td class="mono">${esc(p.version||"0.1")}</td><td>${pillC(p.status||"Draft",scol[p.status]||"var(--na)")}</td><td>${esc(p.owner||"")}</td><td class="small">${p.approvedOn?fmtDate(p.approvedOn)+"<div class='muted'>"+esc(p.approver||"")+"</div>":"—"}</td><td class="small" style="${du!=null&&du<0?"color:var(--crit);font-weight:600":""}">${fmtDate(p.nextReview)}</td><td>${(p.ctrls||[]).length}</td></tr>`;}).join("")||`<tr><td colspan="8" class="empty">No policies yet. <a href="#policies" data-act="pol-tab" data-t="templates">Adopt from the template library</a> to start with ${POLICY_TEMPLATES.length} ready-made, mapped policies.</td></tr>`}
  </tbody></table></div>`;
}
const POL_SPEC=[
  {k:"title",label:"Title",full:true},{k:"number",label:"Policy number"},{k:"version",label:"Version"},
  {k:"owner",label:"Policy owner"},{k:"approver",label:"Approver",ph:"Name / title of approving executive"},
  {k:"effective",label:"Effective date",type:"date"},{k:"reviewMonths",label:"Review cycle (months)",type:"number",min:1,max:36},
  {k:"nextReview",label:"Next review",type:"date"},{k:"audience",label:"Audience",ph:"All workforce / IT staff / …"},
  {k:"ctrls",label:"Linked 800-171 requirements",type:"tags",full:true,ph:"3.1.1, 3.1.2 …"}
];
async function adoptTemplate(key){
  const t=POLICY_TEMPLATES.find(x=>x.key===key); const months=Number(settings().reviewMonths)||12;
  const id=uid();
  const p={templateKey:key,title:t.title,number:`POL-${key}`,version:"0.1",status:"Draft",owner:"",approver:"",reviewMonths:months,ctrls:[...t.ctrls],body:policyBody(t),effective:"",nextReview:""};
  if(await save("policies",id,p,"adopted from template")){ toast("Policy adopted as draft"); UI.pol.tab="library"; openPolicy(id); }
}
let polMode="edit";
function openPolicy(id){
  const p=rec("policies",id); const st=p.status||"Draft";
  const flow = st==="Draft"?`<button class="btn wr" data-act="pol-flow" data-to="In review" data-id="${id}">Submit for review</button>`:
    st==="In review"?`<button class="btn wr" data-act="pol-flow" data-to="Draft" data-id="${id}">Return to draft</button><button class="btn pri wr" data-act="pol-flow" data-to="Approved" data-id="${id}">Approve</button>`:
    st==="Approved"?`<button class="btn wr" data-act="pol-flow" data-to="Draft" data-id="${id}">Start revision</button><button class="btn wr" data-act="pol-flow" data-to="reviewed" data-id="${id}">Record annual review (no change)</button><button class="btn danger wr" data-act="pol-flow" data-to="Retired" data-id="${id}">Retire</button>`:
    `<button class="btn wr" data-act="pol-flow" data-to="Draft" data-id="${id}">Reinstate as draft</button>`;
  const odp=(p.body||"").match(/\[[^\]\n]{1,60}\]/g)||[];
  openDrawer({title:esc(p.title||"Policy"), wide:true, sub:`${esc(p.number||"")} · v${esc(p.version||"0.1")} · ${esc(st)}${p.updatedBy?" · last edited by "+who(p.updatedBy):""}`,
    body:`<div id="lockbar"></div><div id="polform">${formHTML(POL_SPEC,p)}</div>
     <div class="sect">Policy text</div>
     ${odp.length?`<div class="banner" style="margin-bottom:10px">${odp.length} organization-defined value(s) in [brackets] — tailor them before approval.</div>`:""}
     <div class="tabs"><button data-act="pol-mode" data-m="edit" class="${polMode==="edit"?"on":""}">Edit (Markdown)</button><button data-act="pol-mode" data-m="preview" class="${polMode==="preview"?"on":""}">Preview</button></div>
     <textarea id="polbody" rows="24" style="${polMode==="edit"?"":"display:none"};font-family:var(--mono);font-size:12.5px">${esc(p.body||"")}</textarea>
     <div id="polprev" class="doc" style="${polMode==="preview"?"":"display:none"}">${mdToHtml(p.body||"")}</div>
     <div class="sect">Sign-offs</div><div id="sigpanel"></div>
     <div class="sect">Revision history</div>
     <div class="hist">${(p.history||[]).map(h=>`<div>${fmtDate(h.at.slice(0,10))} — ${esc(h.msg)} ${h.by?"· "+who(h.by):""}</div>`).join("")||'<span class="muted">—</span>'}</div>`,
    foot:`<button class="btn danger wr" data-act="pol-del" data-id="${id}" style="margin-right:auto" data-lockable>Delete</button><button class="btn" data-act="pol-dl" data-f="md" data-id="${id}">Download .md</button><button class="btn" data-act="pol-dl" data-f="html" data-id="${id}">Download .html</button>${flow}<button class="btn" data-act="close-drawer">Close</button><button class="btn pri wr" data-act="pol-save" data-id="${id}" data-lockable>Save</button>`});
  renderSignoffs("policy", id, p, {lock: st==="Approved", lockMsg:"This approved version matches its sign-off. Use Start revision to change it."});
}
function readPolicy(id){ const f=readForm($("#polform")); return {...rec("policies",id),...f, body:$("#polbody").value}; }
async function namedSignoffs(list){
  const ids=[...new Set(list.map(s=>s.signer).filter(Boolean))]; let ps={};
  if(USER&&ids.length){ try{ ps=await USER.profiles(ids)||{}; }catch(e){} }
  return list.map(s=>({...s, name: s.signer ? ((ps[s.signer]&&ps[s.signer].name)||"Workspace member") : ((s.localName||"Local user")+" (unverified)")}));
}
function bumpVersion(v, major){ const [a,b]=String(v||"0.1").split(".").map(n=>parseInt(n)||0); return major?`${a+1}.0`:`${a}.${b+1}`; }
async function policyFlow(id,to){
  let p=readPolicy(id); let msg;
  if(to==="Approved"){
    const ans=await modal(`<h3>Approve policy</h3><div class="form"><div class="f full"><label>Approver</label><input type="text" id="apr" value="${esc(p.approver||"")}"></div><div class="f"><label>Approval date</label><input type="date" id="aprd" value="${today()}"></div><div class="f"><label>Effective date</label><input type="date" id="eff" value="${today()}"></div></div>`,
      [{label:"Cancel",value:null},{label:"Approve",pri:true,check:m=>{ if(!$("#apr",m).value.trim()){toast("Enter the approver");return false;} return true;},value:m=>({a:$("#apr",m).value.trim(),d:$("#aprd",m).value,e:$("#eff",m).value})}]);
    if(!ans) return;
    p={...p,status:"Approved",approver:ans.a,approvedOn:ans.d,effective:ans.e,version:bumpVersion(p.version,true),nextReview:addMonths(ans.d,p.reviewMonths||12)};
    msg=`v${p.version} approved by ${ans.a}`;
  } else if(to==="reviewed"){
    p={...p,lastReviewed:today(),nextReview:addMonths(today(),p.reviewMonths||12)}; msg=`annual review recorded — no changes (v${p.version})`;
  } else if(to==="Draft" && p.status==="Approved"){ p={...p,status:"Draft",version:bumpVersion(p.version,false)}; msg=`revision started (v${p.version})`; }
  else { p={...p,status:to}; msg=`status → ${to}`; }
  if(await save("policies",id,p,msg)){
    drawerDirty=false; toast(msg);
    if(to==="Approved") await signOff("policy",id,rec("policies",id),"Policy approved",`${p.title} v${p.version}`,"I approve this policy for publication and use by the organization.");
    if(to==="reviewed") await signOff("policy",id,rec("policies",id),"Annual review — no changes",`${p.title} v${p.version}`,"I reviewed this policy and it remains accurate and appropriate without changes.");
    $("#drawer").dataset.unlocked=""; openPolicy(id);
  }
}
function policyHTMLDoc(p, sigs=[]){
  const org=settings().org||"";
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${esc(p.title)}</title><style>body{font-family:Georgia,serif;max-width:760px;margin:40px auto;line-height:1.6;color:#111;padding:0 20px}table{border-collapse:collapse;margin:12px 0}td{border:1px solid #ccc;padding:4px 10px;font-size:13px}h1{font-size:24px}h2{font-size:17px;margin-top:26px}mark{background:#fde9b0}</style></head><body>
  <p style="background:#fde9b0;color:#3d2e00;padding:8px 12px;border-radius:6px;font-family:Arial,sans-serif;font-size:12px"><b>DEMO</b> — For educational and practice purposes only. All data is fictional.</p>
  <p style="font-size:12px;color:#555">${esc(org)}</p>
  <table><tr><td>Policy No.</td><td>${esc(p.number||"")}</td><td>Version</td><td>${esc(p.version||"")}</td></tr><tr><td>Status</td><td>${esc(p.status||"")}</td><td>Owner</td><td>${esc(p.owner||"")}</td></tr><tr><td>Approved by</td><td>${esc(p.approver||"")}</td><td>Approval date</td><td>${esc(p.approvedOn||"")}</td></tr><tr><td>Effective</td><td>${esc(p.effective||"")}</td><td>Next review</td><td>${esc(p.nextReview||"")}</td></tr></table>
  ${mdToHtml(p.body||"")}
  ${sigs.length?`<h2>Sign-offs</h2><table>${sigs.map(s=>`<tr><td>${esc(s.meaning)}</td><td>${esc(s.name)}</td><td>${esc(s.at.slice(0,16).replace("T"," "))} UTC</td><td>${esc(s.label)}</td><td style="font-family:monospace;font-size:11px">${esc(s.hash.slice(0,16))}…</td></tr>`).join("")}</table>`:""}
  <h2>Revision history</h2><table>${(p.history||[]).map(h=>`<tr><td>${esc(h.at.slice(0,10))}</td><td>${esc(h.msg)}</td></tr>`).join("")}</table></body></html>`;
}

/* ---------- Risks ---------- */
const RISK_SPEC=[
  {k:"title",label:"Risk",full:true},{k:"desc",label:"Description (threat, vulnerability, consequence)",type:"textarea",rows:3},
  {k:"category",label:"Category",type:"select",options:["Cyber / technical","Third-party / supply chain","People","Physical","Compliance / contractual","Operational"]},
  {k:"owner",label:"Risk owner"},
  {k:"likelihood",label:"Likelihood (1–5)",type:"select",options:[["1","1 — Rare"],["2","2 — Unlikely"],["3","3 — Possible"],["4","4 — Likely"],["5","5 — Almost certain"]]},
  {k:"impact",label:"Impact (1–5)",type:"select",options:[["1","1 — Negligible"],["2","2 — Minor"],["3","3 — Moderate"],["4","4 — Major"],["5","5 — Severe"]]},
  {k:"treatment",label:"Treatment",type:"select",options:["Mitigate","Accept","Transfer","Avoid"]},
  {k:"status",label:"Status",type:"select",options:["Open","Treating","Accepted","Closed"]},
  {k:"plan",label:"Treatment plan",type:"textarea",rows:3},
  {k:"rl",label:"Residual likelihood",type:"select",options:[["","—"],"1","2","3","4","5"]},{k:"ri",label:"Residual impact",type:"select",options:[["","—"],"1","2","3","4","5"]},
  {k:"ctrls",label:"Related 800-171 requirements",type:"tags",full:true},
  {k:"review",label:"Next review",type:"date"},{k:"acceptedBy",label:"Accepted by (if accepted)"}
];
function vRisks(){
  const all=Object.entries(S.risks); const list=all.filter(([k,r])=>!UI.risk.st||r.status===UI.risk.st).sort((a,b)=>riskScore(b[1])-riskScore(a[1]));
  const grid={}; all.filter(([k,r])=>r.status!=="Closed").forEach(([k,r])=>{const key=r.likelihood+"-"+r.impact; grid[key]=(grid[key]||0)+1;});
  let heat=`<div class="heat"><div class="ax"></div>${[1,2,3,4,5].map(i=>`<div class="ax">I${i}</div>`).join("")}`;
  for(let l=5;l>=1;l--){ heat+=`<div class="ax">L${l}</div>`; for(let i=1;i<=5;i++){ const b=riskBand(l*i); const n=grid[l+"-"+i]||0; heat+=`<div style="background:${b.c};opacity:${n?1:.28};color:${b.l==="Medium"?"#0b0b0b":"#fff"}" data-tip="Likelihood ${l} × Impact ${i} = ${l*i} (${b.l})\n${n} open risk(s)">${n||""}</div>`; } }
  heat+="</div>";
  return head("Risk register","Supports NIST SP 800-171 requirement 3.11.1 (periodic risk assessment).",`<button class="btn" data-act="export-risks">Export CSV</button><button class="btn pri wr" data-act="risk-new">+ New risk</button>`)+
  `<div class="grid g3"><div><div class="filters"><select id="rst" data-filter="risk.st"><option value="">All statuses</option>${["Open","Treating","Accepted","Closed"].map(s=>`<option ${UI.risk.st===s?"selected":""}>${s}</option>`).join("")}</select></div>
  <div class="tbl"><table><thead><tr><th>Risk</th><th>Owner</th><th>Inherent</th><th>Residual</th><th>Treatment</th><th>Status</th></tr></thead><tbody>
  ${list.map(([k,r])=>{const s=riskScore(r),b=riskBand(s); const rs=(Number(r.rl)||0)*(Number(r.ri)||0); return `<tr class="click" data-act="open-risk" data-id="${k}"><td><b>${esc(r.title)}</b><div class="muted small">${esc(r.category||"")}</div></td><td>${esc(r.owner||"")}</td><td>${pillC(s+" "+b.l,b.c)}</td><td>${rs?pillC(rs+" "+riskBand(rs).l,riskBand(rs).c):"—"}</td><td>${esc(r.treatment||"")}</td><td>${esc(r.status||"")}</td></tr>`;}).join("")||`<tr><td colspan="6" class="empty">No risks recorded.</td></tr>`}
  </tbody></table></div></div>
  <div class="card"><h3>Heat map <span class="sub">open risks</span></h3>${heat}<div class="legend">${[["Low","var(--good)"],["Medium","var(--warn)"],["High","var(--serious)"],["Critical","var(--crit)"]].map(([l,c])=>`<span><i style="background:${c}"></i>${l}</span>`).join("")}</div></div></div>`;
}
function openRisk(id){
  const r=id?rec("risks",id):{likelihood:"3",impact:"3",treatment:"Mitigate",status:"Open",category:"Cyber / technical"};
  openDrawer({title:id?esc(r.title):"New risk",body:`<div id="rform">${formHTML(RISK_SPEC,r)}</div><div class="sect">History</div><div class="hist">${(r.history||[]).map(h=>`<div>${fmtDate(h.at.slice(0,10))} — ${esc(h.msg)}</div>`).join("")||'<span class="muted">—</span>'}</div>`,
    foot:`${id?`<button class="btn danger wr" data-act="risk-del" data-id="${id}">Delete</button>`:""}<button class="btn" data-act="close-drawer">Close</button><button class="btn pri wr" data-act="risk-save" data-id="${id||""}">Save</button>`});
}

/* ---------- Evidence ---------- */
function vEvidence(){
  const rows=[]; CONTROLS.forEach(c=>(rec("controls",c.id).evidence||[]).forEach(e=>rows.push({c,e})));
  rows.sort((a,b)=>(a.e.date||"")<(b.e.date||"")?-1:1);
  const missing=CONTROLS.filter(c=>isMet(ctrlStatus(c.id))&&ctrlStatus(c.id)!=="na"&&!(rec("controls",c.id).evidence||[]).length);
  const stale=rows.filter(r=>r.e.date&&daysUntil(r.e.date)<-365);
  return head("Evidence","Evidence references recorded against each requirement. Assessors expect objective evidence (documents, screenshots, configurations, records) for every MET requirement.",`<button class="btn" data-act="export-evidence">Export CSV</button>`)+
  `<div class="grid g4" style="margin-bottom:14px"><div class="card tile"><div class="lbl">Evidence items</div><div class="val">${rows.length}</div></div><div class="card tile"><div class="lbl">MET without evidence</div><div class="val" style="${missing.length?"color:var(--crit)":""}">${missing.length}</div></div><div class="card tile"><div class="lbl">Older than 12 months</div><div class="val">${stale.length}</div></div></div>
  ${missing.length?`<div class="card" style="margin-bottom:14px"><h3>Implemented requirements with no evidence</h3>${missing.map(c=>`<a href="#evidence" class="tag" data-act="open-ctrl" data-id="${c.id}" style="text-decoration:none">${c.id}</a>`).join(" ")}</div>`:""}
  <div class="tbl"><table><thead><tr><th>Requirement</th><th>Evidence</th><th>Location</th><th>Collected</th></tr></thead><tbody>
  ${rows.map(({c,e})=>{const old=e.date&&daysUntil(e.date)<-365; return `<tr class="click" data-act="open-ctrl" data-id="${c.id}"><td class="mono">${c.id}</td><td>${esc(e.name)}</td><td class="small" style="word-break:break-all">${/^https?:\/\//.test(e.loc)?`<a href="${esc(e.loc)}" target="_blank" rel="noopener noreferrer">${esc(e.loc)}</a>`:esc(e.loc)}</td><td class="small" style="${old?"color:var(--crit);font-weight:600":""}">${fmtDate(e.date)}${old?" · stale":""}</td></tr>`;}).join("")||`<tr><td colspan="4" class="empty">No evidence recorded. Open a control and add evidence references.</td></tr>`}
  </tbody></table></div>`;
}

/* ---------- Reports ---------- */
function vReports(){
  const items=[
    ["ssp-docx","System Security Plan (Word)","Editable SSP with system identification, asset inventory summary, each requirement's implementation, objectives, evidence, and POA&M summary.",".docx"],
    ["poam-docx","Plan of Action & Milestones (Word)","Landscape POA&M with OMB-style fields: weakness, point of contact, resources, milestones, scheduled completion, source, status.",".docx"],
    ["ssp","System Security Plan (printable)","Same content as a single web page you can print or save as PDF.",".html"],
    ["sprs","SPRS score summary","Score, deductions, and unmet requirements per the DoD Assessment Methodology.",".html"],
    ["controls","Controls register","All 110 requirements with status, owner, and review dates.",".csv"],
    ["objectives","Assessment objectives worksheet","All 320 NIST SP 800-171A objectives with status, notes, and examine / interview / test methods.",".csv"],
    ["poam","POA&M","All POA&M items with milestones and eligibility.",".csv"],
    ["risks","Risk register",".csv export of all risks.",".csv"],
    ["signoffs","Sign-off register","Every sign-off with signer, time, what was signed, and its content fingerprint.",".csv"],
    ["backup","Full backup","Every record in this workspace, for restore or migration.",".json"]
  ];
  return head("Reports & export","Generate assessment-ready artifacts and back up your data.")+
  `<div class="grid g2">${items.map(([k,t,d,ext])=>`<div class="card"><h3>${t}<span class="sub">${ext}</span></h3><p class="muted small" style="margin-top:-4px">${d}</p><button class="btn" data-act="report" data-k="${k}">Generate</button></div>`).join("")}
  <div class="card wr"><h3>Restore from backup<span class="sub">.json</span></h3><p class="muted small" style="margin-top:-4px">Imports records from a backup file. Records with the same ID are overwritten.</p><input type="file" id="importf" accept=".json,application/json"></div></div>`;
}
function sspHTML(){
  const o=settings(); const sc=computeScore();
  const row=c=>{const r=rec("controls",c.id); return `<tr><td>${c.id}<br><small>${c.cmmc}</small></td><td><b>${esc(c.title)}</b><br><small>${esc(c.text)}</small></td><td>${STATUS_BY_K[ctrlStatus(c.id)].label}${r.partialCredit?" (partial credit)":""}</td><td>${esc(r.responsibility||"Organization")}</td><td>${esc(r.impl||"").replace(/\n/g,"<br>")||"<i>Not documented</i>"}${r.odp?`<br><small><b>Parameters:</b> ${esc(r.odp)}</small>`:""}<br><small><b>800-171A objectives met:</b> ${(()=>{const o=objSummary(c.id);return `${o.met+o.na}/${o.total}${o.notMet?` (${o.notMet} not met)`:""}`;})()}</small>${(r.evidence||[]).length?`<br><small><b>Evidence:</b> ${(r.evidence).map(e=>esc(e.name)).join("; ")}</small>`:""}</td><td>${esc(r.owner||"")}</td></tr>`;};
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>System Security Plan — ${esc(o.system||"")}</title><style>body{font-family:Arial,sans-serif;font-size:12px;margin:30px;color:#111}table{border-collapse:collapse;width:100%;margin:8px 0 20px}td,th{border:1px solid #bbb;padding:5px 7px;vertical-align:top;text-align:left}th{background:#eee}h1{font-size:22px}h2{font-size:15px;margin-top:26px;background:#1c5cab;color:#fff;padding:6px 10px}small{color:#444}</style></head><body>
  <h1>System Security Plan</h1><p style="background:#fde9b0;color:#3d2e00;padding:8px 12px;border-radius:6px;font-family:Arial,sans-serif;font-size:12px"><b>DEMO</b> — For educational and practice purposes only. All data is fictional.</p>
  <table><tr><th>Organization</th><td>${esc(o.org||"")}</td><th>System</th><td>${esc(o.system||"")}</td></tr><tr><th>CAGE / UEI</th><td>${esc(o.cage||"")} ${esc(o.uei||"")}</td><th>Generated</th><td>${today()}</td></tr><tr><th>System owner</th><td>${esc(o.sysOwner||"")}</td><th>Security officer</th><td>${esc(o.isso||o.iso||"")}</td></tr><tr><th>SPRS score</th><td>${sc.score} / 110</td><th>Requirements MET</th><td>${sc.met} / 110</td></tr></table>
  <h2>1. System description & boundary</h2><p>${esc(o.scope||"[Describe the system, its purpose, CUI processed, and the assessment boundary.]").replace(/\n/g,"<br>")}</p>
  <h2>2. Environment of operation</h2><p>${esc(o.env||"[Describe locations, cloud services, networks, and asset categories (CUI, Security Protection, Contractor Risk Managed, Specialized, Out-of-Scope).]").replace(/\n/g,"<br>")}</p>
  <h2>3. Interconnections & external service providers</h2><p>${esc(o.connections||"[List connections to other systems and ESPs/CSPs with their FedRAMP status.]").replace(/\n/g,"<br>")}</p>
  <h2>4. Security requirement implementation</h2>
  ${Object.entries(FAMILIES).map(([fk,f])=>`<h3>${f.n} ${f.name} (${fk})</h3><table><tr><th style="width:9%">Req.</th><th style="width:25%">Requirement</th><th style="width:10%">Status</th><th style="width:10%">Responsibility</th><th>Implementation</th><th style="width:9%">Owner</th></tr>${CONTROLS.filter(c=>c.fam===fk).map(row).join("")}</table>`).join("")}
  <h2>5. Plan of Action & Milestones</h2><table><tr><th>#</th><th>Req.</th><th>Weakness</th><th>Plan</th><th>Due</th><th>Status</th></tr>${Object.values(S.poam).sort((a,b)=>(a.num||0)-(b.num||0)).map(p=>`<tr><td>${p.num||""}</td><td>${esc(p.ctrl)}</td><td>${esc(p.weakness||"")}</td><td>${esc(p.plan||"")}</td><td>${esc(p.due||"")}</td><td>${esc(p.status||"")}</td></tr>`).join("")}</table>
  <h2>6. Approval</h2><table><tr><th>Name / Title</th><th>Signature</th><th>Date</th></tr><tr><td style="height:40px">&nbsp;</td><td></td><td></td></tr></table></body></html>`;
}
function sprsHTML(){
  const sc=computeScore(), R=readiness(), o=settings();
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>SPRS summary</title><style>body{font-family:Arial,sans-serif;margin:30px;font-size:13px}table{border-collapse:collapse;width:100%}td,th{border:1px solid #bbb;padding:5px 8px;text-align:left}th{background:#eee}.big{font-size:40px;font-weight:700}</style></head><body>
  <h1>NIST SP 800-171 DoD Assessment — score summary</h1><p style="background:#fde9b0;color:#3d2e00;padding:8px 12px;border-radius:6px;font-family:Arial,sans-serif;font-size:12px"><b>DEMO</b> — For educational and practice purposes only. All data is fictional.</p><p>${esc(o.org||"")} · ${esc(o.system||"")} · ${today()}</p>
  <div class="big">${sc.score} / 110</div><p>${sc.met} of 110 requirements MET. CMMC Level 2: <b>${esc(R.verdict)}</b>.</p>
  <ul>${R.checks.map(c=>`<li>${c.ok?"✔":"✘"} ${esc(c.t)} — ${esc(c.d)}</li>`).join("")}</ul>
  <h2>Unmet requirements</h2><table><tr><th>Req.</th><th>Practice</th><th>Title</th><th>Status</th><th>Deduction</th><th>POA&M eligible</th><th>POA&M</th></tr>
  ${sc.unmet.map(u=>`<tr><td>${u.c.id}</td><td>${u.c.cmmc}</td><td>${esc(u.c.title)}</td><td>${STATUS_BY_K[ctrlStatus(u.c.id)].label}</td><td>${u.d?"−"+u.d:"—"}</td><td>${u.c.poamEligible?"Yes":"No"}</td><td>${openPoamFor(u.c.id).map(p=>"#"+p.num).join(", ")}</td></tr>`).join("")}</table></body></html>`;
}
async function runReport(k){
  const o=settings(); const base=(o.system||o.org||"grc").replace(/[^\w-]+/g,"_").slice(0,40);
  if(k==="ssp-docx") return exportDocx("ssp");
  if(k==="poam-docx") return exportDocx("poam");
  if(k==="signoffs"){ const list=await namedSignoffs(allSignoffs()); return offerFile(`signoff_register_${today()}.csv`, toCSV([["Signed at (UTC)","Signer","Type","Meaning","Record","Statement","SHA-256 fingerprint","Storage"],...list.map(s=>[s.at,s.name,SIGN_KIND_LABEL[s.kind]||s.kind,s.meaning,s.label,s.statement||"",s.hash,s.mode==="db"?"Shared workspace":"Local"])])); }
  if(k==="ssp") return offerFile(`SSP_${base}_${today()}.html`, sspHTML());
  if(k==="sprs") return offerFile(`SPRS_summary_${base}_${today()}.html`, sprsHTML());
  if(k==="controls") return exportControls();
  if(k==="poam") return exportPoam();
  if(k==="objectives") return exportObjectives();
  if(k==="risks") return exportRisks();
  if(k==="backup") return offerFile(`grc_backup_${today()}.json`, JSON.stringify({app:"grc-800-171",version:1,exported:new Date().toISOString(),data:S},null,1));
}
const exportControls=()=>offerFile(`controls_${today()}.csv`, toCSV([["Requirement","CMMC practice","Family","Requirement type","Title","Requirement text","SPRS points","Objectives met","Level 1","POA&M eligible","Status","Partial credit","Responsibility","Owner","Implemented by","Implementation statement","Parameters","Evidence","Last reviewed","Next review"],
  ...CONTROLS.map(c=>{const r=rec("controls",c.id);return [c.id,c.cmmc,FAMILIES[c.fam].name,NIST_R2[c.id]?.t==="basic"?"Basic":"Derived",c.title,c.text,c.pts,(()=>{const o=objSummary(c.id);return `${o.met+o.na}/${o.total}`;})(),c.l1?"Yes":"",c.poamEligible?"Yes":"No",STATUS_BY_K[ctrlStatus(c.id)].label,r.partialCredit?"Yes":"",r.responsibility||"",r.owner||"",r.implementer||"",r.impl||"",r.odp||"",(r.evidence||[]).map(e=>e.name+(e.loc?" ("+e.loc+")":"")),r.reviewed||"",r.nextReview||""];})]));
const exportObjectives=()=>offerFile(`800-171A_objectives_${today()}.csv`, toCSV([["Requirement","CMMC practice","Objective","Determine if","Objective status","Note / evidence","Requirement status","Examine","Interview","Test"],
  ...CONTROLS.flatMap(c=>{const r=rec("controls",c.id), A=NIST_171A[c.id]; return (A?.o||[]).map(([k,t])=>{const o=(r.obj||{})[k||"_"]||{}; return [c.id,c.cmmc,objLabel(c.id,k),capFirst(t),(OBJ_ST.find(x=>x[0]===(o.st||""))||[])[1],o.n||"",STATUS_BY_K[ctrlStatus(c.id)].label,(A.e||[]).join("; "),(A.i||[]).join("; "),(A.t||[]).join("; ")];});})]));
const exportPoam=()=>offerFile(`poam_${today()}.csv`, toCSV([["#","Requirement","CMMC practice","Weakness","Remediation plan","Milestones","Owner","Resources","Identified","Scheduled completion","Status","Closed","Source","L2 eligible"],
  ...Object.values(S.poam).sort((a,b)=>(a.num||0)-(b.num||0)).map(p=>{const c=CONTROL_BY_ID[p.ctrl];return [p.num,p.ctrl,c?.cmmc,p.weakness,p.plan,p.milestones,p.owner,p.resources,p.identified,p.due,p.status,p.closed,p.source,c?.poamEligible?"Yes":"No"];})]));
const exportRisks=()=>offerFile(`risk_register_${today()}.csv`, toCSV([["Risk","Description","Category","Owner","Likelihood","Impact","Inherent score","Treatment","Plan","Residual L","Residual I","Status","Related requirements","Next review"],
  ...Object.values(S.risks).map(r=>[r.title,r.desc,r.category,r.owner,r.likelihood,r.impact,riskScore(r),r.treatment,r.plan,r.rl,r.ri,r.status,r.ctrls||[],r.review])]));
async function importBackup(file){
  let o; try{ o=JSON.parse(await file.text()); }catch(e){ toast("That file isn't valid JSON"); return; }
  const data=o.data||o; const cols=COLS.filter(c=>c!=="signoffs"&&data[c]&&typeof data[c]==="object");
  const n=cols.reduce((a,c)=>a+Object.keys(data[c]).length,0);
  if(!n){ toast("No GRC records found in that file"); return; }
  if(!await confirmBox("Restore backup?",`This writes ${n} records (${cols.join(", ")}). Existing records with the same IDs are overwritten.`,"Restore")) return;
  let i=0; for(const c of cols){ for(const [id,v] of Object.entries(data[c])){ i++; if(i%20===0) toast(`Restoring… ${i}/${n}`); await save(c,id,v); } }
  toast(`Restored ${n} records`);
}

/* ---------- Settings ---------- */
const ORG_SPEC=[
  {sect:"Demo"},{k:"demoUser",label:"Your name (shown on demo sign-offs)"},
  {sect:"Organization"},{k:"org",label:"Organization name"},{k:"system",label:"System / enclave name",ph:"e.g., CUI Enclave"},
  {k:"cage",label:"CAGE code"},{k:"uei",label:"UEI"},{k:"sysOwner",label:"System owner"},{k:"isso",label:"Information security officer"},
  {sect:"SSP content"},
  {k:"scope",label:"System description & assessment boundary",type:"textarea",rows:4},
  {k:"env",label:"Environment of operation",type:"textarea",rows:3},
  {k:"connections",label:"Interconnections & external service providers",type:"textarea",rows:3},
  {sect:"Compliance dates"},
  {k:"targetLevel",label:"Target CMMC level",type:"select",options:["Level 2 (C3PAO)","Level 2 (Self)","Level 1 (Self)","Level 3 (DIBCAC)"]},
  {k:"conditionalDate",label:"Conditional status date",type:"date",help:"POA&M closeout deadline = this date + 180 days"},
  {k:"assessDate",label:"Next planned assessment",type:"date"},{k:"reviewMonths",label:"Default review cycle (months)",type:"number",min:1,max:36,def:12}
];
function vSettings(){
  return head("Organization","These details populate the SSP and reports.")+
  `<div class="card" id="orgform">${formHTML(ORG_SPEC,settings())}<div class="row" style="justify-content:flex-end;margin-top:14px"><button class="btn pri wr" data-act="org-save">Save</button></div></div>
  <div class="card" style="margin-top:14px"><h3>Workspace</h3><p class="small muted" style="margin-top:-4px">Storage: <b>this browser only (localStorage)</b>. No data leaves your device. Requirements: NIST SP 800-171 Rev 2 (110), CMMC 2.0 Levels 1 and 2 (32 CFR 170).</p>
  <p class="small muted">Do not enter CUI, passwords, or other secrets into this tool — record references to where evidence is stored instead.</p>
  <button class="btn danger wr" data-act="wipe">Delete all workspace data…</button></div>`;
}

/* ===================== Events ===================== */
document.addEventListener("click", async e=>{
  const a=e.target.closest("[data-act]"); if(!a) return;
  const act=a.dataset.act, id=a.dataset.id;
  if(a.tagName==="A") e.preventDefault();
  switch(act){
    case "close-drawer": return closeDrawer();
    case "goto-fam": UI.ctrl={...UI.ctrl,fam:a.dataset.fam,st:"",q:""}; location.hash="controls"; return;
    case "open-ctrl": return openControl(id);
    case "ctrl-save": return saveControl(id);
    case "ctrl-reviewed": { const months=Number(settings().reviewMonths)||12; $("#f_reviewed").value=today(); $("#f_nextReview").value=addMonths(today(),months); return saveControl(id,{reviewed:today(),nextReview:addMonths(today(),months)}); }
    case "obj-all": $$("#objlist [data-ok=st]").forEach(s=>s.value=a.dataset.v); drawerDirty=true; updateObjHint($("#drawer").dataset.ctrl); return;
    case "obj-apply": $("#f_status").value=a.dataset.v; drawerDirty=true; updateObjHint($("#drawer").dataset.ctrl); return;
    case "ev-add": $("#evlist").insertAdjacentHTML("beforeend",evRow({date:today()},$$("#evlist .ev").length)); drawerDirty=true; return;
    case "ev-del": a.closest(".ev").remove(); drawerDirty=true; return;
    case "poam-new": return openPoam(null,{ctrl:"3.1.1"});
    case "poam-from-ctrl": { const c=CONTROL_BY_ID[id]; const r=rec("controls",id); await closeDrawer(true); return openPoam(null,{ctrl:id, weakness: r.notes||`${c.title} not fully implemented.`, owner:r.owner||"", due:addDays(today(),Math.min(180,90))}); }
    case "open-poam": return openPoam(id);
    case "poam-save": return savePoam(id);
    case "poam-del": if(await confirmBox("Delete POA&M item?","Consider closing it instead to keep an audit trail.","Delete",true)){ await del("poam",id); closeDrawer(true);} return;
    case "assess-new": return openAssess(null);
    case "open-assess": $("#drawer").dataset.unlocked=""; return openAssess(id);
    case "assess-save": return saveAssess(a.dataset.id);
    case "assess-del": if(await confirmBox("Delete assessment?","Its snapshot and findings are removed.","Delete",true)){ await del("assessments",id); closeDrawer(true);} return;
    case "assess-snap": { const sc=computeScore(); const ot=objTotals(); const snap={at:new Date().toISOString(),score:sc.score,met:sc.met,objMet:ot.met,objNotMet:ot.notMet,statuses:Object.fromEntries(CONTROLS.map(c=>[c.id,ctrlStatus(c.id)]))}; $("#drawer").dataset.snap=JSON.stringify(snap); drawerDirty=true; a.textContent=`Snapshot captured: score ${sc.score}, ${sc.met}/110 — save to keep`; return; }
    case "finding-add": $("#flist").insertAdjacentHTML("beforeend",findingRow({status:"Open"},$$("#flist [data-f]").length)); drawerDirty=true; return;
    case "finding-del": a.closest("[data-f]").remove(); drawerDirty=true; return;
    case "finding-poam": { const r=a.closest("[data-f]"); const ctrl=$('[data-fk=ctrl]',r).value; if(!CONTROL_BY_ID[ctrl]){ toast("Pick an 800-171 requirement first"); return; } const text=$('[data-fk=text]',r).value; const src=$("#f_type")?.value?.includes("C3PAO")?"C3PAO assessment":$("#f_type")?.value==="Internal audit"?"Internal audit":"Self-assessment"; if(drawerDirty){ if(!await confirmBox("Leave unsaved assessment?","Save the assessment first to keep your edits.","Continue",true)) return; } closeDrawer(true); return openPoam(null,{ctrl,weakness:text,source:src,due:addDays(today(),90)}); }
    case "pol-tab": UI.pol.tab=a.dataset.t; if(VIEW!=="policies") location.hash="policies"; else render(); return;
    case "tpl-preview": { const t=POLICY_TEMPLATES.find(x=>x.key===a.dataset.k); return openDrawer({title:esc(t.title),sub:"Template preview",wide:true,body:`<div class="doc">${mdToHtml(policyBody(t))}</div>`,foot:`<button class="btn" data-act="close-drawer">Close</button><button class="btn pri wr" data-act="tpl-adopt" data-k="${t.key}">Adopt</button>`}); }
    case "tpl-adopt": return adoptTemplate(a.dataset.k);
    case "pol-blank": { const pid=uid(); if(await save("policies",pid,{title:"New policy",number:"POL-",version:"0.1",status:"Draft",reviewMonths:Number(settings().reviewMonths)||12,ctrls:[],body:"# New policy\n\n## 1. Purpose\n\n## 2. Scope\n\n## 3. Roles and Responsibilities\n\n## 4. Policy Statements\n\n## 5. Compliance and Enforcement\n\n## 6. Exceptions\n\n## 7. Review\n"},"created")){ UI.pol.tab="library"; openPolicy(pid);} return; }
    case "open-policy": $("#drawer").dataset.unlocked=""; return openPolicy(id);
    case "pol-mode": { polMode=a.dataset.m; $$(".tabs button[data-act=pol-mode]").forEach(b=>b.classList.toggle("on",b.dataset.m===polMode)); $("#polbody").style.display=polMode==="edit"?"":"none"; const pv=$("#polprev"); pv.style.display=polMode==="preview"?"":"none"; pv.innerHTML=mdToHtml($("#polbody").value); return; }
    case "pol-save": { const p=readPolicy(id); const prev=rec("policies",id); if(await save("policies",id,p,prev.body!==p.body?"text edited":"details updated")){drawerDirty=false;toast("Policy saved");openPolicy(id);} return; }
    case "pol-flow": return policyFlow(id,a.dataset.to);
    case "pol-del": if(await confirmBox("Delete policy?","Retiring keeps the record and history. Delete removes it permanently.","Delete",true)){ await del("policies",id); closeDrawer(true);} return;
    case "pol-dl": { const p=readPolicy(id); const fn=(p.number||"policy")+"_"+(p.title||"").replace(/[^\w]+/g,"_")+"_v"+(p.version||""); if(a.dataset.f==="md") return offerFile(fn+".md",p.body||""); const sigs=await namedSignoffs(signoffsFor("policy",id)); return offerFile(fn+".html",policyHTMLDoc(p,sigs)); }
    case "risk-new": return openRisk(null);
    case "open-risk": return openRisk(id);
    case "risk-save": { const f=readForm($("#rform")); if(!f.title){toast("Name the risk");return;} const prev=id?rec("risks",id):{}; if(await save("risks",id||uid(),{...prev,...f},id?(prev.status!==f.status?`status → ${f.status}`:"updated"):"created")){drawerDirty=false;toast("Risk saved");closeDrawer(true);} return; }
    case "risk-del": if(await confirmBox("Delete risk?","This can't be undone.","Delete",true)){ await del("risks",id); closeDrawer(true);} return;
    case "org-save": { const f=readForm($("#orgform")); if(await save("settings","org",{...settings(),...f})) toast("Organization saved"); return; }
    case "report": return runReport(a.dataset.k);
    case "export-controls": return exportControls();
    case "export-poam": return exportPoam();
    case "export-risks": return exportRisks();
    case "export-evidence": { const rows=[]; CONTROLS.forEach(c=>(rec("controls",c.id).evidence||[]).forEach(e=>rows.push([c.id,c.cmmc,e.name,e.loc,e.date]))); return offerFile(`evidence_${today()}.csv`,toCSV([["Requirement","Practice","Evidence","Location","Collected"],...rows])); }
    case "wipe": { const ok=await modal(`<h3>Delete all workspace data</h3><p class="muted">This permanently removes every control status, POA&M item, assessment, policy, and risk${MODE==="db"?" for everyone using this workspace":""}. Export a backup first. Type <b>DELETE</b> to confirm.</p><input type="text" id="wipec" style="width:100%">`,[{label:"Cancel",value:false},{label:"Delete everything",danger:true,check:m=>$("#wipec",m).value==="DELETE",value:true}]); if(!ok) return; for(const c of COLS){ for(const k of Object.keys(S[c])){ if(c==="signoffs" && k!==(ME||"local")) continue; await del(c,k);} } toast("Workspace cleared"); return; }
  }
});
document.addEventListener("input", e=>{
  const f=e.target.dataset?.filter; if(!f) return; const [grp,key]=f.split("."); UI[grp][key]=e.target.value; scheduleRender();
});
document.addEventListener("change", e=>{ if((e.target.closest("#objlist")||e.target.id==="f_status") && $("#drawer").dataset.ctrl && $("#objlist")) updateObjHint($("#drawer").dataset.ctrl); if(e.target.id==="importf" && e.target.files[0]) importBackup(e.target.files[0]); });
document.addEventListener("keydown", e=>{ if(e.key==="Escape" && $("#drawer").classList.contains("on") && !$("#modal").classList.contains("on")) closeDrawer(); });
$("#scrim").addEventListener("click",()=>closeDrawer());
const tip=$("#tip");
document.addEventListener("mousemove", e=>{ const t=e.target.closest?.("[data-tip]"); if(!t){ tip.style.display="none"; return; } tip.textContent=t.dataset.tip; tip.style.display="block"; const x=Math.min(e.clientX+14, innerWidth-tip.offsetWidth-8); tip.style.left=x+"px"; tip.style.top=(e.clientY+14)+"px"; });
window.addEventListener("hashchange", route);
/* bootstrap moved to end of bundle */
