/* ===================== Extensions: assets, access reviews, evidence requests, sign-offs, Word export ===================== */
const fmtDateTime = iso => { if(!iso) return "—"; const x=new Date(iso); return isNaN(x)?iso:x.toLocaleString(undefined,{year:"numeric",month:"short",day:"numeric",hour:"numeric",minute:"2-digit"}); };
const whoOrLocal = (id,name) => id ? who(id) : `<span>${esc(name||"Local user (unverified)")}</span>`;

function parseCSV(text){
  const rows=[]; let row=[], f="", q=false;
  for(let i=0;i<text.length;i++){ const ch=text[i];
    if(q){ if(ch==='"'){ if(text[i+1]==='"'){ f+='"'; i++; } else q=false; } else f+=ch; }
    else if(ch==='"') q=true; else if(ch===','||ch==='\t'){ row.push(f); f=""; }
    else if(ch==='\n'||ch==='\r'){ if(ch==='\r'&&text[i+1]==='\n') i++; row.push(f); rows.push(row); row=[]; f=""; }
    else f+=ch; }
  if(f!==""||row.length){ row.push(f); rows.push(row); }
  return rows.map(r=>r.map(c=>c.trim())).filter(r=>r.some(c=>c));
}
function csvObjects(text, aliases){
  const rows=parseCSV(text); if(!rows.length) return [];
  const hdr=rows[0].map(h=>h.toLowerCase().replace(/[^a-z0-9]/g,""));
  const idx={}; Object.entries(aliases).forEach(([k,al])=>{ const i=hdr.findIndex(h=>al.includes(h)); if(i>=0) idx[k]=i; });
  if(!Object.keys(idx).length) return null;
  return rows.slice(1).map(r=>Object.fromEntries(Object.entries(idx).map(([k,i])=>[k,r[i]||""])));
}
const yes = v => /^(y|yes|true|1|x|privileged|admin)$/i.test(String(v||"").trim());

/* ---------------- Sign-offs ---------------- */
async function sha256(obj){
  const txt=JSON.stringify(obj);
  try{ const buf=await crypto.subtle.digest("SHA-256", new TextEncoder().encode(txt)); return [...new Uint8Array(buf)].map(b=>b.toString(16).padStart(2,"0")).join(""); }
  catch(e){ let h=2166136261; for(let i=0;i<txt.length;i++){ h^=txt.charCodeAt(i); h=Math.imul(h,16777619); } return "fnv-"+(h>>>0).toString(16); }
}
const SIGN_CONTENT = {
  policy: p=>({title:p.title||"",number:p.number||"",version:p.version||"",body:p.body||"",ctrls:p.ctrls||[]}),
  assessment: a=>({name:a.name||"",type:a.type||"",start:a.start||"",end:a.end||"",scope:a.scope||"",result:a.result||"",
    snapshot:a.snapshot?{score:a.snapshot.score,met:a.snapshot.met,objMet:a.snapshot.objMet??null}:null,
    findings:(a.findings||[]).map(f=>({ctrl:f.ctrl||"",severity:f.severity||"",status:f.status||"",text:f.text||""}))}),
  review: r=>({name:r.name||"",system:r.system||"",scope:r.scope||"",accounts:(r.accounts||[]).map(x=>({acct:x.acct||"",decision:x.decision||"",actioned:x.actioned||""}))})
};
const SIGN_KIND_LABEL = {policy:"Policy", assessment:"Assessment", review:"Access review"};
function allSignoffs(){
  const out=[]; Object.entries(S.signoffs||{}).forEach(([k,doc])=>Object.values(doc?.items||{}).forEach(it=>out.push({...it, signer:k==="local"?null:k})));
  return out.sort((a,b)=>a.at<b.at?1:-1);
}
const signoffsFor = (kind,ref) => allSignoffs().filter(s=>s.kind===kind && s.ref===ref);
async function signOff(kind, ref, record, meaning, label, statement){
  if(READONLY){ toast("You have view-only access"); return false; }
  if(MODE==="db" && !ME){ toast("Signing needs a signed-in identity"); return false; }
  const p = modal(`<h3>Sign off: ${esc(meaning)}</h3><p style="margin:6px 0 10px">${esc(label)}</p>
    <p class="muted small">${MODE==="db"?`You are signing as <b>${who(ME)}</b>. Your identity, the time, and a SHA-256 fingerprint of the record's current content are saved. Only you can write your sign-offs.`:`Signing as <b>${esc(settings().demoUser||"Local user")}</b>. This sign-off is stored in this browser only and isn't tied to a verified identity.`}</p>
    <label style="display:flex;gap:8px;align-items:flex-start;margin-top:10px"><input type="checkbox" id="sgc" style="margin-top:3px"><span>${esc(statement)}</span></label>`,
    [{label:"Cancel",value:false},{label:"Sign",pri:true,check:m=>{ if(!$("#sgc",m).checked){ toast("Tick the confirmation to sign"); return false; } return true; },value:true}]);
  resolveNames();
  if(!await p) return false;
  const hash = await sha256(SIGN_CONTENT[kind](record));
  const key = ME || "local"; const doc = S.signoffs[key] || {};
  const id = uid();
  const items = {...(doc.items||{}), [id]: {id, kind, ref, label, meaning, statement, at:new Date().toISOString(), hash, mode:MODE, ...(MODE==="local"?{localName:settings().demoUser||"Local user"}:{})}};
  const ok = await save("signoffs", key, {items});
  if(ok) toast("Signed");
  return ok;
}
async function signoffState(kind, ref, record){
  const list = signoffsFor(kind, ref); if(!list.length) return {list, current:false, cur:null};
  const cur = await sha256(SIGN_CONTENT[kind](record));
  return {list, cur, current: list[0].hash===cur};
}
async function renderSignoffs(kind, ref, record, opts={}){
  const el=$("#sigpanel"); if(!el) return;
  const st = await signoffState(kind, ref, record);
  el.innerHTML = st.list.length ? st.list.map(s=>`<div class="sig ${s.hash===st.cur?"ok":"stale"}"><div><b>${esc(s.meaning)}</b> · ${whoOrLocal(s.signer,s.localName)} · ${fmtDateTime(s.at)}${s.mode==="local"?' <span class="tag">local</span>':""}</div><div class="small muted">${esc(s.label)}</div><div class="small">${s.hash===st.cur?"✓ Record unchanged since this sign-off":"⚠ Record has changed since this sign-off"} <span class="mono muted" title="SHA-256 fingerprint">${esc(s.hash.slice(0,12))}…</span></div></div>`).join("") : `<div class="muted small">Not signed yet.</div>`;
  resolveNames();
  if(st.current && opts.lock) lockDrawer(opts.lockMsg||"Locked: this record matches its latest sign-off.");
  return st;
}
function lockDrawer(msg){
  const d=$("#drawer"); if(d.dataset.unlocked==="1") return;
  $$("#drawer .db input, #drawer .db select, #drawer .db textarea").forEach(e=>{ if(!e.closest(".sigkeep")) e.disabled=true; });
  $$("#drawer [data-lockable]").forEach(b=>b.disabled=true);
  const b=$("#lockbar"); if(b) b.innerHTML=`<div class="banner info" style="margin:0 0 14px"><span>🔒 ${esc(msg)}</span><button class="btn sm wr" data-act="sig-unlock" style="margin-left:auto">Reopen for edits</button></div>`;
}

/* ---------------- Asset inventory ---------------- */
const ASSET_CATS = [
  {k:"cui", label:"CUI Asset", color:"#d03b3b", desc:"Processes, stores, or transmits CUI. Assessed against all applicable Level 2 requirements."},
  {k:"spa", label:"Security Protection Asset", color:"#2a78d6", desc:"Provides security functions or capabilities to the assessment scope (e.g., firewall, IdP, SIEM, EDR console, MSP tools), whether or not it handles CUI. Assessed against relevant requirements."},
  {k:"crma", label:"Contractor Risk Managed Asset", color:"#fab219", desc:"Can, but is not intended to, process, store, or transmit CUI because of policy, procedures, and practices in place. Document in the inventory, SSP, and network diagram."},
  {k:"specialized", label:"Specialized Asset", color:"#8f5fd6", desc:"Government property, IoT/IIoT, operational technology, restricted information systems, or test equipment. Document in the inventory, SSP, and network diagram and manage under risk-based policy."},
  {k:"oos", label:"Out-of-Scope Asset", color:"#8f8e88", desc:"Cannot process, store, or transmit CUI and provides no security protection to CUI assets; physically or logically separated."},
  {k:"", label:"Not yet categorized", color:"#c3c2b7", desc:"Review and assign a CMMC asset category."}
];
const CAT_BY_K = Object.fromEntries(ASSET_CATS.map(c=>[c.k,c]));
const ASSET_TYPES = ["Server","Workstation","Laptop","Mobile device","Network device","Firewall / security appliance","Wireless access point","Printer / MFP","Storage / backup","Cloud service (SaaS/IaaS)","Application","Virtual machine","OT / IoT / test equipment","Removable media","Other"];
const ASSET_SPEC = [
  {k:"name",label:"Asset name",ph:"e.g., FS01 file server"},
  {k:"type",label:"Type",type:"select",options:ASSET_TYPES},
  {k:"category",label:"CMMC asset category",type:"select",options:ASSET_CATS.map(c=>[c.k,c.label]),help:"See CMMC Level 2 Scoping Guidance."},
  {k:"status",label:"Status",type:"select",options:["Active","Planned","Retired"]},
  {k:"owner",label:"Owner"},{k:"location",label:"Location",ph:"Site / room / cloud region"},
  {k:"environment",label:"Environment",type:"select",options:["On-premises","Cloud","Hybrid","Remote / telework"]},
  {k:"hostname",label:"Hostname / FQDN"},{k:"ip",label:"IP address(es)"},
  {k:"os",label:"OS / firmware / version"},{k:"serial",label:"Serial / asset tag"},
  {k:"baseline",label:"Configuration baseline",type:"select",options:["","CIS Benchmark","DISA STIG","Vendor hardening guide","Custom baseline","None"]},
  {k:"fips",label:"Uses FIPS-validated crypto for CUI",type:"select",options:["","Yes","No","N/A"]},
  {k:"fipsCert",label:"CMVP certificate #(s)",ph:"e.g., 4536"},
  {k:"provider",label:"Provider / ESP (if hosted)",ph:"e.g., Microsoft 365 GCC High"},
  {k:"reviewed",label:"Last verified",type:"date"},
  {k:"ctrls",label:"Related 800-171 requirements",type:"tags",full:true,ph:"3.4.1, 3.13.1 …"},
  {k:"notes",label:"Notes",type:"textarea",rows:3}
];
const ASSET_ALIASES = {name:["name","asset","assetname","device","devicename","computername"],type:["type","assettype","devicetype","class"],category:["category","cmmccategory","assetcategory","scope"],status:["status","state"],owner:["owner","assignedto","user","primaryuser"],location:["location","site","room"],environment:["environment","env"],hostname:["hostname","fqdn","dnsname"],ip:["ip","ipaddress","ipaddresses"],os:["os","operatingsystem","osversion","firmware"],serial:["serial","serialnumber","assettag","tag"],provider:["provider","vendor","esp"],notes:["notes","comments","description"]};
function mapCategory(v){ v=String(v||"").toLowerCase(); if(!v) return ""; if(/out/.test(v)) return "oos"; if(/special/.test(v)) return "specialized"; if(/risk|crma/.test(v)) return "crma"; if(/protect|spa|security/.test(v)) return "spa"; if(/cui/.test(v)) return "cui"; return ""; }
const UIX = { asset:{q:"",cat:"all",type:"",st:"Active"}, req:{st:"open",assess:""}, rev:{st:""} };

function vAssets(){
  const all=Object.entries(S.assets); const f=UIX.asset, q=f.q.toLowerCase();
  const active=all.filter(([k,a])=>(a.status||"Active")!=="Retired");
  const counts={}; active.forEach(([k,a])=>{counts[a.category||""]=(counts[a.category||""]||0)+1;});
  const list=all.filter(([k,a])=>(f.cat==="all"||(a.category||"")===f.cat)&&(!f.type||a.type===f.type)&&(!f.st||(a.status||"Active")===f.st)&&(!q||[a.name,a.hostname,a.ip,a.owner,a.location,a.os,a.serial,a.provider].join(" ").toLowerCase().includes(q))).sort((a,b)=>(a[1].name||"").localeCompare(b[1].name||""));
  const inScope=active.filter(([k,a])=>a.category&&a.category!=="oos").length;
  return head("Asset inventory","Hardware, software, and cloud services with their CMMC Level 2 asset category. Supports scoping and requirement 3.4.1.",
    `<button class="btn" data-act="asset-export">Export CSV</button><button class="btn wr" data-act="asset-import">Import CSV</button><button class="btn pri wr" data-act="asset-new">+ New asset</button>`)+
  `<div class="grid g4" style="margin-bottom:14px">${ASSET_CATS.map(c=>`<div class="card tile click" data-act="asset-cat" data-cat="${c.k}" style="cursor:pointer;${f.cat===c.k?"outline:2px solid var(--accent)":""}"><div class="lbl"><span class="pill" style="border:none;padding:0;background:none;white-space:normal;align-items:flex-start"><i style="background:${c.color}"></i>${esc(c.label)}</span></div><div class="val">${counts[c.k]||0}</div></div>`).join("")}</div>
  <div class="muted small" style="margin:-4px 0 12px">${inScope} active assets in the assessment scope (CUI, Security Protection, Contractor Risk Managed, Specialized). ${f.cat!=="all"?`<a href="#assets" data-act="asset-cat" data-cat="all">Show all categories</a> · ${esc(CAT_BY_K[f.cat]?.desc||"")}`:""}</div>
  <div class="filters"><input type="search" id="aq" placeholder="Search name, host, IP, owner…" value="${esc(f.q)}" data-filterx="asset.q">
    <select id="atype" data-filterx="asset.type"><option value="">All types</option>${ASSET_TYPES.map(t=>`<option ${f.type===t?"selected":""}>${t}</option>`).join("")}</select>
    <select id="ast" data-filterx="asset.st"><option value="">Any status</option>${["Active","Planned","Retired"].map(t=>`<option ${f.st===t?"selected":""}>${t}</option>`).join("")}</select>
    <span class="muted small">${list.length} shown</span></div>
  <div class="tbl"><table><thead><tr><th>Asset</th><th>Type</th><th>Category</th><th>Owner</th><th>Location</th><th>OS / version</th><th>Baseline</th><th>Verified</th></tr></thead><tbody>
  ${list.map(([k,a])=>{const c=CAT_BY_K[a.category||""]; const old=a.reviewed&&daysUntil(a.reviewed)<-365; return `<tr class="click" data-act="asset-open" data-id="${k}"><td><b>${esc(a.name||"(unnamed)")}</b><div class="muted small">${esc([a.hostname,a.ip].filter(Boolean).join(" · "))}</div></td><td class="small">${esc(a.type||"")}</td><td>${pillC(c.label,c.color)}</td><td>${esc(a.owner||"")}</td><td class="small">${esc(a.location||"")}</td><td class="small">${esc(a.os||"")}</td><td class="small">${esc(a.baseline||"")}</td><td class="small" style="${old?"color:var(--crit);font-weight:600":""}">${fmtDate(a.reviewed)}</td></tr>`;}).join("")||`<tr><td colspan="8" class="empty">No assets yet. Add them one at a time or import a CSV export from your RMM, Intune, or a spreadsheet.</td></tr>`}
  </tbody></table></div>`;
}
function openAsset(id){
  const a = id ? rec("assets",id) : {status:"Active",type:"Server",category:"",environment:"On-premises",reviewed:today()};
  const c=CAT_BY_K[a.category||""];
  openDrawer({title:id?esc(a.name||"Asset"):"New asset", sub:pillC(c.label,c.color),
    body:`<div class="req small" id="catdesc">${esc(c.desc)}</div><div id="asform">${formHTML(ASSET_SPEC,a)}</div><div class="sect">History</div><div class="hist">${(a.history||[]).map(h=>`<div>${fmtDate(h.at.slice(0,10))} — ${esc(h.msg)} ${h.by?"· "+who(h.by):""}</div>`).join("")||'<span class="muted">—</span>'}</div>`,
    foot:`${id?`<button class="btn danger wr" data-act="asset-del" data-id="${id}" style="margin-right:auto">Delete</button>`:""}<button class="btn" data-act="close-drawer">Close</button><button class="btn pri wr" data-act="asset-save" data-id="${id||""}">Save</button>`});
  $("#f_category").addEventListener("change",e=>{ $("#catdesc").textContent=CAT_BY_K[e.target.value]?.desc||""; });
}

/* ---------------- Access reviews ---------------- */
const REVIEW_SPEC = [
  {k:"name",label:"Review name",ph:"e.g., Q1 privileged access review — Entra ID",full:true},
  {k:"system",label:"System / application",ph:"e.g., Entra ID, AD, file server, ERP"},
  {k:"scope",label:"Scope",type:"select",options:["Privileged accounts","All accounts","Standard user accounts","Service accounts","Group memberships"]},
  {k:"reviewer",label:"Reviewer (name / title)"},
  {k:"cadence",label:"Repeat every (months)",type:"number",min:1,max:24},
  {k:"start",label:"Start date",type:"date"},{k:"due",label:"Due date",type:"date"},
  {k:"notes",label:"Notes",type:"textarea",rows:2}
];
const REV_DECISIONS = [["","—"],["keep","Keep"],["modify","Modify"],["remove","Remove"]];
function reviewProgress(r){ const acc=r.accounts||[]; const decided=acc.filter(a=>a.decision).length; const pending=acc.filter(a=>(a.decision==="remove"||a.decision==="modify")&&!a.actioned).length; const removed=acc.filter(a=>a.decision==="remove").length; return {total:acc.length, decided, pending, removed, priv:acc.filter(a=>a.privileged).length}; }
function reviewNextDue(r){ if(r.status!=="Completed"||!r.completedOn) return null; return addMonths(r.completedOn, r.cadence||3); }
function vReviews(){
  const all=Object.entries(S.reviews).sort((a,b)=>(b[1].start||"")>(a[1].start||"")?1:-1);
  const list=all.filter(([k,r])=>!UIX.rev.st||(r.status||"Open")===UIX.rev.st);
  const latestBySys={}; all.forEach(([k,r])=>{ const key=(r.system||"")+"|"+(r.scope||""); if(r.status==="Completed" && (!latestBySys[key]||r.completedOn>latestBySys[key].completedOn)) latestBySys[key]=r; });
  const dueNext=Object.values(latestBySys).map(r=>({r,d:reviewNextDue(r)})).filter(x=>x.d).sort((a,b)=>a.d<b.d?-1:1);
  return head("Access reviews","Periodic review of who has access, especially privileged access. Supports 3.1.1, 3.1.5, 3.1.7, 3.5.6, and 3.9.2.",
    `<button class="btn" data-act="rev-export">Export CSV</button><button class="btn pri wr" data-act="rev-new">+ New review</button>`)+
  (dueNext.length?`<div class="card" style="margin-bottom:14px"><h3>Next reviews due <span class="sub">based on each review's repeat cycle</span></h3>${dueNext.map(x=>`<div class="list-item"><span>${esc(x.r.system||"")} · ${esc(x.r.scope||"")}</span><span class="small" style="${daysUntil(x.d)<0?"color:var(--crit);font-weight:600":""}">${fmtDate(x.d)}${daysUntil(x.d)<0?" · overdue":""}</span></div>`).join("")}</div>`:"")+
  `<div class="filters"><select id="rvst" data-filterx="rev.st"><option value="">All statuses</option>${["Open","In progress","Completed"].map(s=>`<option ${UIX.rev.st===s?"selected":""}>${s}</option>`).join("")}</select></div>
  <div class="tbl"><table><thead><tr><th>Review</th><th>System</th><th>Scope</th><th>Due</th><th>Progress</th><th>Removals pending</th><th>Status</th><th>Signed</th></tr></thead><tbody>
  ${list.map(([k,r])=>{const p=reviewProgress(r); const od=r.status!=="Completed"&&r.due&&daysUntil(r.due)<0; const sg=signoffsFor("review",k)[0]; return `<tr class="click" data-act="rev-open" data-id="${k}"><td><b>${esc(r.name||"Untitled")}</b><div class="muted small">${esc(r.reviewer||"")}</div></td><td>${esc(r.system||"")}</td><td class="small">${esc(r.scope||"")}</td><td class="small" style="${od?"color:var(--crit);font-weight:600":""}">${fmtDate(r.due)}</td><td class="mono small">${p.decided}/${p.total}</td><td>${p.pending?`<span class="tag warn">${p.pending}</span>`:"—"}</td><td>${pillC(r.status||"Open",{Open:"var(--crit)","In progress":"var(--warn)",Completed:"var(--good)"}[r.status||"Open"])}</td><td class="small">${sg?`${whoOrLocal(sg.signer,sg.localName)}<div class="muted">${fmtDate(sg.at.slice(0,10))}</div>`:"—"}</td></tr>`;}).join("")||`<tr><td colspan="8" class="empty">No access reviews yet. Start one and import the account list exported from your directory.</td></tr>`}
  </tbody></table></div>`;
}
const accRow=(a,i)=>`<tr data-ai="${i}"><td><input type="text" data-ak="acct" value="${esc(a.acct||"")}" placeholder="account"></td><td><input type="text" data-ak="person" value="${esc(a.person||"")}" placeholder="name"></td><td><input type="text" data-ak="role" value="${esc(a.role||"")}" placeholder="role / groups"></td><td style="text-align:center"><input type="checkbox" data-ak="privileged" ${a.privileged?"checked":""}></td><td><input type="text" data-ak="lastLogin" value="${esc(a.lastLogin||"")}" placeholder="—" style="width:96px"></td><td><select data-ak="decision">${REV_DECISIONS.map(([v,l])=>`<option value="${v}" ${(a.decision||"")===v?"selected":""}>${l}</option>`).join("")}</select></td><td><input type="text" data-ak="note" value="${esc(a.note||"")}" placeholder="justification"></td><td><input type="date" data-ak="actioned" value="${esc(a.actioned||"")}"></td><td><button class="btn sm ghost wr" data-act="acc-del" data-lockable>✕</button></td></tr>`;
function readAccounts(){ return $$("#acctbl tbody tr[data-ai]").map(r=>{ const o={}; $$("[data-ak]",r).forEach(e=>{ o[e.dataset.ak]= e.type==="checkbox"?e.checked:e.value.trim(); }); return o; }).filter(a=>a.acct||a.person); }
function openReview(id, preset){
  const r = id ? rec("reviews",id) : {status:"Open",scope:"Privileged accounts",cadence:3,start:today(),due:addDays(today(),14),accounts:[],...preset};
  const p=reviewProgress(r);
  openDrawer({title:id?esc(r.name||"Access review"):"New access review", wide:true, sub:`${esc(r.status||"Open")} · ${p.decided}/${p.total} decided${p.pending?` · ${p.pending} removal/modification(s) not yet actioned`:""}`,
    body:`<div id="lockbar"></div><div id="rvform">${formHTML(REVIEW_SPEC,r)}</div>
    <div class="sect">Accounts <span class="muted" style="text-transform:none;letter-spacing:0">(${p.total}${p.priv?`, ${p.priv} privileged`:""})</span></div>
    <div class="row wr" style="margin-bottom:8px"><button class="btn sm" data-act="acc-add" data-lockable>+ Add account</button><button class="btn sm" data-act="acc-paste" data-lockable>Import / paste CSV</button><button class="btn sm" data-act="acc-keepall" data-lockable>Set undecided to Keep</button></div>
    <div class="tbl" style="max-height:420px"><table id="acctbl" class="dense"><thead><tr><th>Account</th><th>Name</th><th>Role / groups</th><th>Priv.</th><th>Last sign-in</th><th>Decision</th><th>Justification / note</th><th>Actioned</th><th></th></tr></thead><tbody>${(r.accounts||[]).map(accRow).join("")}</tbody></table></div>
    <div class="help small muted" style="margin-top:6px">Removals and modifications count as complete once you enter the date the change was made in the directory.</div>
    <div class="sect">Sign-off</div><div id="sigpanel"></div>`,
    foot:`${id?`<button class="btn danger wr" data-act="rev-del" data-id="${id}" style="margin-right:auto" data-lockable>Delete</button>`:""}${id&&r.status==="Completed"?`<button class="btn wr" data-act="rev-followup" data-id="${id}">Start next review</button>`:""}<button class="btn" data-act="close-drawer">Close</button><button class="btn wr" data-act="rev-save" data-id="${id||""}" data-lockable>Save</button>${id?`<button class="btn pri wr" data-act="rev-complete" data-id="${id}" data-lockable>${r.status==="Completed"?"Re-sign":"Complete & sign off"}</button>`:""}`});
  if(id) renderSignoffs("review", id, r, {lock:true, lockMsg:"This review matches its sign-off. Reopen it to make changes; the record will then show it changed after signing."});
}
async function saveReview(id, extra={}){
  const f=readForm($("#rvform")); const accounts=readAccounts();
  if(!f.name){ toast("Name the review"); return null; }
  if(accounts.length>1500){ toast("Over 1,500 accounts — split this review by system or scope"); return null; }
  const prev=id?rec("reviews",id):{}; const key=id||uid();
  const next={...prev,...f,accounts,...extra, status: extra.status || (prev.status==="Completed"?"Completed":(accounts.some(a=>a.decision)?"In progress":"Open"))};
  const p=reviewProgress(next);
  const msg = !id?"created":(extra.status==="Completed"?`completed — ${p.decided}/${p.total} decided, ${p.removed} removal(s)`:`updated — ${p.decided}/${p.total} decided`);
  if(await save("reviews",key,next,msg)){ drawerDirty=false; return key; }
  return null;
}

/* ---------------- Evidence requests ---------------- */
const REQ_STATUSES = ["Open","In progress","Provided","Accepted","Needs more info","Not applicable"];
const REQ_COLOR = {Open:"var(--crit)","In progress":"var(--warn)",Provided:"#2a78d6",Accepted:"var(--good)","Needs more info":"var(--serious)","Not applicable":"var(--na)"};
function reqSpec(){ return [
  {k:"title",label:"Request",ph:"e.g., Provide list of users with privileged access and approval records",full:true},
  {k:"assessment",label:"Assessment",type:"select",options:[["","— none —"],...Object.entries(S.assessments).map(([k,a])=>[k,a.name||"Untitled"])]},
  {k:"source",label:"Requested by",type:"select",options:["C3PAO assessor","Prime contractor","DCMA DIBCAC","Internal audit","Customer / contracting officer","Other"]},
  {k:"requester",label:"Requester name"},{k:"owner",label:"Owner (who gathers it)"},
  {k:"requested",label:"Date requested",type:"date"},{k:"due",label:"Due",type:"date"},
  {k:"status",label:"Status",type:"select",options:REQ_STATUSES},{k:"provided",label:"Date provided",type:"date"},
  {k:"ctrls",label:"Related requirements",type:"tags",ph:"3.1.1, 3.5.3 …"},{k:"objectives",label:"Objectives",type:"tags",ph:"3.1.1[a], 3.1.1[d] …"},
  {k:"detail",label:"Request detail",type:"textarea",rows:3},
  {k:"response",label:"Response / what was provided",type:"textarea",rows:3},
  {k:"links",label:"Evidence references (one per line)",type:"textarea",rows:3,ph:"SharePoint link, document name, screenshot ID…"}
]; }
const reqOpen = r => !["Accepted","Not applicable"].includes(r.status||"Open");
function nextReqNum(){ return Math.max(0,...Object.values(S.requests).map(r=>r.num||0))+1; }
function vRequests(){
  const all=Object.entries(S.requests).sort((a,b)=>(a[1].num||0)-(b[1].num||0)); const f=UIX.req;
  const list=all.filter(([k,r])=>(f.st==="open"?reqOpen(r):f.st==="all"?true:(r.status||"Open")===f.st)&&(!f.assess||r.assessment===f.assess));
  const open=all.filter(([k,r])=>reqOpen(r)); const overdue=open.filter(([k,r])=>r.due&&daysUntil(r.due)<0&&(r.status||"Open")!=="Provided"); const awaiting=all.filter(([k,r])=>r.status==="Provided");
  return head("Evidence requests","Track what assessors, primes, and auditors ask for, who owns it, and when it's due.",
    `<button class="btn" data-act="req-export">Export CSV</button><button class="btn wr" data-act="req-bulk">Bulk add</button><button class="btn pri wr" data-act="req-new">+ New request</button>`)+
  `<div class="grid g4" style="margin-bottom:14px"><div class="card tile"><div class="lbl">Open requests</div><div class="val">${open.length}</div></div><div class="card tile"><div class="lbl">Overdue</div><div class="val" style="${overdue.length?"color:var(--crit)":""}">${overdue.length}</div></div><div class="card tile"><div class="lbl">Provided, awaiting acceptance</div><div class="val">${awaiting.length}</div></div><div class="card tile"><div class="lbl">Accepted</div><div class="val">${all.filter(([k,r])=>r.status==="Accepted").length}</div></div></div>
  <div class="filters"><select id="rqst" data-filterx="req.st">${[["open","Open (not accepted)"],["all","All"],...REQ_STATUSES.map(s=>[s,s])].map(([v,l])=>`<option value="${v}" ${f.st===v?"selected":""}>${l}</option>`).join("")}</select>
  <select id="rqas" data-filterx="req.assess"><option value="">All assessments</option>${Object.entries(S.assessments).map(([k,a])=>`<option value="${k}" ${f.assess===k?"selected":""}>${esc(a.name||"Untitled")}</option>`).join("")}</select><span class="muted small">${list.length} shown</span></div>
  <div class="tbl"><table><thead><tr><th>#</th><th style="width:36%">Request</th><th>Requirements</th><th>Owner</th><th>Due</th><th>Status</th><th>Assessment</th></tr></thead><tbody>
  ${list.map(([k,r])=>{const od=reqOpen(r)&&(r.status||"Open")!=="Provided"&&r.due&&daysUntil(r.due)<0; return `<tr class="click" data-act="req-open" data-id="${k}"><td class="mono">ER-${String(r.num||0).padStart(3,"0")}</td><td>${esc(r.title||"")}<div class="muted small">${esc(r.source||"")}${r.requester?" · "+esc(r.requester):""}</div></td><td>${(r.ctrls||[]).slice(0,4).map(c=>`<span class="tag">${esc(c)}</span>`).join("")}${(r.ctrls||[]).length>4?`<span class="tag">+${r.ctrls.length-4}</span>`:""}</td><td>${esc(r.owner||"")}</td><td class="small" style="${od?"color:var(--crit);font-weight:600":""}">${fmtDate(r.due)}</td><td>${pillC(r.status||"Open",REQ_COLOR[r.status||"Open"])}</td><td class="small">${esc(S.assessments[r.assessment]?.name||"")}</td></tr>`;}).join("")||`<tr><td colspan="7" class="empty">No requests${f.st==="open"?" open":""}.</td></tr>`}
  </tbody></table></div>`;
}
function suggestedEvidence(ctrls){
  const out=[]; (ctrls||[]).forEach(id=>{ const r=rec("controls",id); (r.evidence||[]).forEach(e=>out.push({id,name:e.name,loc:e.loc,date:e.date})); Object.entries(r.obj||{}).forEach(([k,o])=>{ if(o.n) out.push({id:objLabel(id,k==="_"?"":k),name:o.n,loc:"",date:""}); }); });
  return out;
}
function openRequest(id, preset){
  const r = id ? rec("requests",id) : {status:"Open",source:"C3PAO assessor",requested:today(),due:addDays(today(),5),...preset};
  const sug=suggestedEvidence(r.ctrls);
  openDrawer({title:id?`ER-${String(r.num).padStart(3,"0")}`:"New evidence request", sub:esc(r.title||""),
    body:`<div id="rqform">${formHTML(reqSpec(),r)}</div>
    <div class="sect">Evidence already recorded for these requirements</div>
    ${sug.length?sug.map(s=>`<div class="list-item"><span><span class="tag">${esc(s.id)}</span> ${esc(s.name)}${s.loc?` <span class="muted small">— ${/^https?:\/\//.test(s.loc)?`<a href="${esc(s.loc)}" target="_blank" rel="noopener noreferrer">${esc(s.loc)}</a>`:esc(s.loc)}</span>`:""}</span><span class="small muted">${s.date?fmtDate(s.date):""}</span></div>`).join(""):`<div class="muted small">${(r.ctrls||[]).length?"None recorded yet on the linked requirements.":"Link requirements above to see evidence you've already recorded."}</div>`}
    <div class="sect">History</div><div class="hist">${(r.history||[]).map(h=>`<div>${fmtDate(h.at.slice(0,10))} — ${esc(h.msg)} ${h.by?"· "+who(h.by):""}</div>`).join("")||'<span class="muted">—</span>'}</div>`,
    foot:`${id?`<button class="btn danger wr" data-act="req-del" data-id="${id}" style="margin-right:auto">Delete</button>`:""}<button class="btn" data-act="close-drawer">Close</button><button class="btn pri wr" data-act="req-save" data-id="${id||""}">Save</button>`});
}

/* ---------------- Word export ---------------- */
let _docxP=null;
function loadDocx(){
  if(window.docx) return Promise.resolve(window.docx);
  if(_docxP) return _docxP;
  _docxP=new Promise((res,rej)=>{ const s=document.createElement("script"); s.src="lib/docx.iife.js"; s.onload=()=>window.docx?res(window.docx):rej(new Error("Word export library didn't load")); s.onerror=()=>{ _docxP=null; rej(new Error("Couldn't load the Word export library")); }; document.head.appendChild(s); });
  return _docxP;
}
function docxKit(D){
  const {Paragraph,TextRun,Table,TableRow,TableCell,WidthType,BorderStyle,ShadingType}=D;
  const F="Arial";
  const run=(text,o={})=>new TextRun({text:String(text??""),font:F,size:o.size||22,bold:o.bold,italics:o.italic,color:o.color});
  const P=(text,o={})=>new Paragraph({heading:o.heading,alignment:o.align,keepNext:o.keepNext,spacing:{after:o.after??80,before:o.before??0},children:Array.isArray(text)?text:[run(text,o)]});
  const paras=(text,o={})=>{ const parts=String(text??"").split(/\r?\n/); return parts.map(t=>P(t,o)); };
  const B={style:BorderStyle.SINGLE,size:4,color:"BFBFBF"}; const borders={top:B,bottom:B,left:B,right:B};
  const cell=(content,w,o={})=>new TableCell({width:{size:w,type:WidthType.DXA},borders,shading:o.head?{type:ShadingType.CLEAR,color:"auto",fill:"E6EEF8"}:undefined,margins:{top:50,bottom:50,left:90,right:90},
    children:Array.isArray(content)?content:paras(content,{size:o.size||18,bold:o.head||o.bold,after:20})});
  const table=(widths,rows,headRow,o={})=>new Table({width:{size:widths.reduce((a,b)=>a+b,0),type:WidthType.DXA},columnWidths:widths,
    rows:[...(headRow?[new TableRow({tableHeader:true,children:headRow.map((h,i)=>cell(h,widths[i],{head:true,size:o.size}))})]:[]),
      ...rows.map(r=>new TableRow({children:r.map((c,i)=>cell(c,widths[i],{size:o.size,bold:o.boldFirst&&i===0}))}))]});
  const kv=(pairs,widths=[2700,6660])=>new Table({width:{size:widths[0]+widths[1],type:WidthType.DXA},columnWidths:widths,rows:pairs.map(([k,v])=>new TableRow({children:[cell(k,widths[0],{head:true}),cell(v,widths[1])]}))});
  const H=(text,level)=>new Paragraph({heading:level,children:[new TextRun({text,font:F})]});
  return {run,P,paras,cell,table,kv,H};
}
function docStyles(){
  const h=(size,before,after)=>({run:{font:"Arial",size,bold:true,color:"1F3864"},paragraph:{spacing:{before,after},keepNext:true,keepLines:true}});
  return {default:{document:{run:{font:"Arial",size:22}},title:{run:{font:"Arial",size:40,bold:true,color:"1F3864"},paragraph:{spacing:{before:0,after:120}}},heading1:h(30,360,140),heading2:h(26,280,120),heading3:{run:{font:"Arial",size:22,bold:true,color:"0B0B0B"},paragraph:{spacing:{before:220,after:80},keepNext:true,keepLines:true}}}};
}
function headerFooter(D, left){
  const {Header,Footer,Paragraph,TextRun,PageNumber,AlignmentType,BorderStyle}=D;
  return {
    headers:{default:new Header({children:[new Paragraph({border:{bottom:{style:BorderStyle.SINGLE,size:4,color:"BFBFBF",space:4}},children:[new TextRun({text:left,font:"Arial",size:16,color:"595959"})]})]})},
    footers:{default:new Footer({children:[new Paragraph({alignment:AlignmentType.RIGHT,children:[new TextRun({font:"Arial",size:16,color:"595959",children:["Page ",PageNumber.CURRENT," of ",PageNumber.TOTAL_PAGES]})]})]})}
  };
}
async function buildSSPDoc(){
  const D=await loadDocx(); const {Document,HeadingLevel}=D; const K=docxKit(D);
  const o=settings(); const sc=computeScore(); const ot=objTotals();
  const assets=Object.values(S.assets).filter(a=>(a.status||"Active")!=="Retired");
  const cnt=k=>assets.filter(a=>(a.category||"")===k).length;
  const ch=[];
  ch.push(new D.Paragraph({heading:HeadingLevel.TITLE,children:[new D.TextRun({text:"System Security Plan",font:"Arial"})]}));
  ch.push(K.P(`${o.org||"[Organization]"} — ${o.system||"[System name]"}`,{size:26,after:60}));
  ch.push(K.P(`NIST SP 800-171 Rev 2 · CMMC Level 2 · Generated ${fmtDate(today())}`,{size:20,color:"595959",after:120}));
  ch.push(K.P("Demonstration document for educational and practice purposes only. All organization and system details are fictional.",{size:20,bold:true,color:"9C5700",after:240}));
  ch.push(K.H("1. System identification",HeadingLevel.HEADING_1));
  ch.push(K.kv([["Organization",o.org||""],["System / enclave",o.system||""],["CAGE / UEI",[o.cage,o.uei].filter(Boolean).join(" / ")],["System owner",o.sysOwner||""],["Information security officer",o.isso||o.iso||""],["Target CMMC level",o.targetLevel||""],["SPRS score (DoD Assessment Methodology)",`${sc.score} / 110`],["Requirements MET",`${sc.met} / 110`],["SP 800-171A objectives met",`${ot.met} / ${ot.total}`]]));
  ch.push(K.H("2. System description and assessment boundary",HeadingLevel.HEADING_1)); ch.push(...K.paras(o.scope||"[Describe the system, its purpose, the CUI it processes, and the assessment boundary.]"));
  ch.push(K.H("3. Environment of operation",HeadingLevel.HEADING_1)); ch.push(...K.paras(o.env||"[Describe locations, cloud services, networks, and users.]"));
  ch.push(K.H("4. Interconnections and external service providers",HeadingLevel.HEADING_1)); ch.push(...K.paras(o.connections||"[List connections to other systems and ESPs/CSPs, including FedRAMP status.]"));
  ch.push(K.H("5. Asset inventory summary",HeadingLevel.HEADING_1));
  ch.push(K.table([4680,1560,3120],ASSET_CATS.filter(c=>c.k).map(c=>[c.label,String(cnt(c.k)),c.k==="oos"?"Not in assessment scope":"In assessment scope"]).concat(cnt("")?[["Not yet categorized",String(cnt("")),"Review required"]]:[]),["CMMC asset category","Active assets","Treatment"]));
  const inScope=assets.filter(a=>a.category&&a.category!=="oos").sort((a,b)=>(a.category+a.name).localeCompare(b.category+b.name));
  if(inScope.length){ ch.push(K.P("In-scope assets",{bold:true,before:200,after:80,keepNext:true})); ch.push(K.table([2300,1600,1900,1700,1860],inScope.map(a=>[a.name||"",a.type||"",CAT_BY_K[a.category]?.label||"",a.location||"",a.os||""]),["Asset","Type","Category","Location","OS / version"],{size:16})); }
  ch.push(K.H("6. Security requirement implementation",HeadingLevel.HEADING_1));
  Object.entries(FAMILIES).forEach(([fk,f])=>{
    ch.push(K.H(`${f.n} ${f.name} (${fk})`,HeadingLevel.HEADING_2));
    CONTROLS.filter(c=>c.fam===fk).forEach(c=>{
      const r=rec("controls",c.id); const os=objSummary(c.id);
      ch.push(K.H(`${c.id} ${c.title} (${c.cmmc})`,HeadingLevel.HEADING_3));
      ch.push(K.P(c.text,{italic:true,size:20,after:100}));
      ch.push(K.table([2340,2340,2340,2340],[[STATUS_BY_K[ctrlStatus(c.id)].label+(r.partialCredit?" (partial credit)":""),r.responsibility||"Organization",r.owner||"",`${os.met+os.na} / ${os.total}${os.notMet?` (${os.notMet} not met)`:""}`]],["Status","Responsibility","Owner","800-171A objectives met"]));
      ch.push(K.P("Implementation",{bold:true,size:20,before:120,after:40,keepNext:true}));
      ch.push(...K.paras(r.impl||"[Not documented]",{size:20}));
      if(r.implementer) ch.push(K.P([K.run("Implemented by: ",{bold:true,size:20}),K.run(r.implementer,{size:20})]));
      if(r.odp) ch.push(K.P([K.run("Organization-defined parameters: ",{bold:true,size:20}),K.run(r.odp,{size:20})]));
      const nm=(NIST_171A[c.id]?.o||[]).filter(([k])=>(r.obj||{})[k||"_"]?.st==="not_met");
      if(nm.length){ ch.push(K.P("Objectives not met",{bold:true,size:20,before:80,after:40,keepNext:true})); ch.push(K.table([1500,4700,3160],nm.map(([k,t])=>[objLabel(c.id,k),capFirst(t),(r.obj||{})[k||"_"]?.n||""]),["Objective","Determine if","Note"],{size:16})); }
      if((r.evidence||[]).length){ ch.push(K.P("Evidence",{bold:true,size:20,before:80,after:40,keepNext:true})); ch.push(K.table([3400,4460,1500],r.evidence.map(e=>[e.name||"",e.loc||"",e.date||""]),["Evidence","Location","Collected"],{size:16})); }
    });
  });
  ch.push(K.H("7. Plan of action summary",HeadingLevel.HEADING_1));
  const pl=Object.values(S.poam).filter(p=>p.status!=="Closed").sort((a,b)=>(a.num||0)-(b.num||0));
  ch.push(pl.length?K.table([700,1300,4160,1800,1400],pl.map(p=>[String(p.num||""),p.ctrl||"",p.weakness||"",p.due||"",p.status||""]),["#","Req.","Weakness","Scheduled completion","Status"],{size:16}):K.P("No open POA&M items."));
  ch.push(K.H("8. Approval",HeadingLevel.HEADING_1));
  ch.push(K.table([3800,3400,2160],[["","",""],["","",""]],["Name / title","Signature","Date"]));
  return new Document({creator:o.org||"GRC Workspace",title:`System Security Plan — ${o.system||""}`,styles:docStyles(),
    sections:[{properties:{page:{size:{width:12240,height:15840},margin:{top:1440,right:1440,bottom:1440,left:1440}}},...headerFooter(D,`DEMO — educational/practice use only · Fictional data · ${o.org||""} — System Security Plan`),children:ch}]});
}
async function buildPOAMDoc(){
  const D=await loadDocx(); const {Document,HeadingLevel,PageOrientation}=D; const K=docxKit(D);
  const o=settings(); const sc=computeScore(); const dl=poamDeadline();
  const items=Object.values(S.poam).sort((a,b)=>(a.num||0)-(b.num||0));
  const ch=[new D.Paragraph({heading:HeadingLevel.TITLE,children:[new D.TextRun({text:"Plan of Action and Milestones",font:"Arial"})]}),
    K.P(`${o.org||"[Organization]"} — ${o.system||"[System name]"} · NIST SP 800-171 Rev 2 / CMMC Level 2`,{size:24,after:160}),
    K.kv([["Organization",o.org||""],["System / enclave",o.system||""],["CAGE / UEI",[o.cage,o.uei].filter(Boolean).join(" / ")],["Point of contact",o.isso||o.iso||""],["SPRS score",`${sc.score} / 110`],["Conditional status closeout deadline",dl?fmtDate(dl):"—"],["Prepared",fmtDate(today())]],[3400,9560]),
    K.P("",{after:120})];
  const W=[500,1700,2100,1150,1050,2300,1100,1100,1060,900];
  ch.push(items.length?K.table(W,items.map(p=>{const c=CONTROL_BY_ID[p.ctrl]; return [String(p.num||""),`${p.ctrl||""}${c?` ${c.title} (${c.cmmc})`:""}`,p.weakness||"",p.owner||"",p.resources||"",[p.plan,p.milestones].filter(Boolean).join("\n"),p.due||"",p.source||"",p.status+(p.closed?` (${p.closed})`:""),c?(c.poamEligible?"Yes":"No"):""];}),
    ["#","Security requirement","Weakness / deficiency","Point of contact","Resources required","Remediation plan and milestones","Scheduled completion","Source","Status","L2 eligible"],{size:16}):K.P("No POA&M items recorded."));
  return new Document({creator:o.org||"GRC Workspace",title:"Plan of Action and Milestones",styles:docStyles(),
    sections:[{properties:{page:{size:{width:12240,height:15840,orientation:PageOrientation.LANDSCAPE},margin:{top:1080,right:1440,bottom:1080,left:1440}}},...headerFooter(D,`DEMO — educational/practice use only · Fictional data · ${o.org||""} — Plan of Action and Milestones`),children:ch}]});
}
async function exportDocx(kind){
  try{
    toast("Preparing Word document…");
    const doc = kind==="ssp" ? await buildSSPDoc() : await buildPOAMDoc();
    const blob = await window.docx.Packer.toBlob(doc);
    const base=(settings().system||settings().org||"grc").replace(/[^\w-]+/g,"_").slice(0,40);
    await offerFile(`${kind==="ssp"?"SSP":"POAM"}_${base}_${today()}.docx`, blob);
  }catch(e){ toast(e.message||"Word export failed"); }
}

/* ---------------- Events for extensions ---------------- */
document.addEventListener("input", e=>{ const f=e.target.dataset?.filterx; if(!f) return; const [g,k]=f.split("."); UIX[g][k]=e.target.value; scheduleRender(); });
document.addEventListener("click", async e=>{
  const a=e.target.closest("[data-act]"); if(!a) return; const act=a.dataset.act, id=a.dataset.id;
  switch(act){
    case "sig-unlock": { $("#drawer").dataset.unlocked="1"; $$("#drawer .db input, #drawer .db select, #drawer .db textarea, #drawer [data-lockable]").forEach(x=>x.disabled=false); $("#lockbar").innerHTML=`<div class="banner" style="margin:0 0 14px">Editing a signed record. Saved changes will show as made after the sign-off until it's signed again.</div>`; return; }
    /* assets */
    case "asset-new": return openAsset(null);
    case "asset-open": return openAsset(id);
    case "asset-cat": UIX.asset.cat = (UIX.asset.cat===a.dataset.cat && a.dataset.cat!=="all") ? "all" : a.dataset.cat; return render();
    case "asset-save": { const f=readForm($("#asform")); if(!f.name){ toast("Name the asset"); return; } const prev=id?rec("assets",id):{}; const msg=!id?"created":(prev.category!==f.category?`category → ${CAT_BY_K[f.category]?.label}`:"updated"); if(await save("assets",id||uid(),{...prev,...f},msg)){ drawerDirty=false; toast("Asset saved"); closeDrawer(true);} return; }
    case "asset-del": if(await confirmBox("Delete asset?","Consider marking it Retired instead to keep the record.","Delete",true)){ await del("assets",id); closeDrawer(true);} return;
    case "asset-export": return offerFile(`asset_inventory_${today()}.csv`, toCSV([["Name","Type","CMMC category","Status","Owner","Location","Environment","Hostname","IP","OS / version","Serial / tag","Baseline","FIPS crypto","CMVP cert","Provider","Last verified","Related requirements","Notes"],...Object.values(S.assets).map(x=>[x.name,x.type,CAT_BY_K[x.category||""].label,x.status,x.owner,x.location,x.environment,x.hostname,x.ip,x.os,x.serial,x.baseline,x.fips,x.fipsCert,x.provider,x.reviewed,x.ctrls||[],x.notes])]));
    case "asset-import": {
      const res=await modal(`<h3>Import assets from CSV</h3><p class="muted small">First row must be headers. Recognized columns: name, type, category, status, owner, location, environment, hostname, ip, os, serial, provider, notes. Category text such as "CUI", "Security Protection", "CRMA", "Specialized", or "Out of scope" is mapped automatically.</p><input type="file" id="acsvf" accept=".csv,text/csv"><p class="muted small" style="margin:10px 0 4px">…or paste CSV:</p><textarea id="acsvt" style="min-height:140px;font-family:var(--mono);font-size:11.5px" placeholder="name,type,category,owner,location&#10;FS01,Server,CUI,IT,HQ server room"></textarea>`,
        [{label:"Cancel",value:null},{label:"Import",pri:true,value:async m=>{ const fl=$("#acsvf",m).files[0]; return fl?await fl.text():$("#acsvt",m).value; }}]);
      const text=await res; if(!text) return;
      const rows=csvObjects(text,ASSET_ALIASES); if(!rows||!rows.length){ toast("No rows recognized — check the header row"); return; }
      const ok=await confirmBox("Import assets?",`${rows.length} asset(s) will be added.`,"Import"); if(!ok) return;
      let n=0; for(const r of rows){ if(!r.name) continue; const t=ASSET_TYPES.find(x=>x.toLowerCase().startsWith(String(r.type||"").toLowerCase().slice(0,5)))||(r.type?"Other":"Other");
        await save("assets",uid(),{name:r.name,type:t,category:mapCategory(r.category),status:["Active","Planned","Retired"].find(s=>s.toLowerCase()===String(r.status||"").toLowerCase())||"Active",owner:r.owner||"",location:r.location||"",environment:r.environment||"",hostname:r.hostname||"",ip:r.ip||"",os:r.os||"",serial:r.serial||"",provider:r.provider||"",notes:r.notes||"",reviewed:today()},"imported"); n++; if(n%25===0) toast(`Imported ${n}/${rows.length}…`); }
      toast(`Imported ${n} assets`); return; }
    /* access reviews */
    case "rev-new": return openReview(null);
    case "rev-open": $("#drawer").dataset.unlocked=""; return openReview(id);
    case "rev-save": { const k=await saveReview(id); if(k){ toast("Review saved"); $("#drawer").dataset.unlocked=""; openReview(k);} return; }
    case "rev-del": if(await confirmBox("Delete access review?","Its decisions and history are removed. Sign-offs remain in the signer's record.","Delete",true)){ await del("reviews",id); closeDrawer(true);} return;
    case "acc-add": $("#acctbl tbody").insertAdjacentHTML("beforeend",accRow({},$$("#acctbl tbody tr").length)); drawerDirty=true; return;
    case "acc-del": a.closest("tr").remove(); drawerDirty=true; return;
    case "acc-keepall": $$("#acctbl [data-ak=decision]").forEach(s=>{ if(!s.value) s.value="keep"; }); drawerDirty=true; return;
    case "acc-paste": {
      const res=await modal(`<h3>Import accounts</h3><p class="muted small">Paste CSV with a header row (or choose a file). Recognized columns: account (or UPN / username), name (display name), role (groups / roles), privileged (yes/no), last sign-in.</p><input type="file" id="rcsvf" accept=".csv,text/csv"><textarea id="rcsvt" style="min-height:160px;margin-top:8px;font-family:var(--mono);font-size:11.5px" placeholder="account,name,role,privileged,lastsignin&#10;jdoe-adm,Jane Doe,Global Administrator,yes,2026-11-01"></textarea>`,
        [{label:"Cancel",value:null},{label:"Add accounts",pri:true,value:async m=>{ const fl=$("#rcsvf",m).files[0]; return fl?await fl.text():$("#rcsvt",m).value; }}]);
      const text=await res; if(!text) return;
      const rows=csvObjects(text,{acct:["account","upn","userprincipalname","username","samaccountname","login","acct","email"],person:["name","displayname","fullname","person","user"],role:["role","roles","groups","group","membership","access"],privileged:["privileged","admin","isprivileged","priv"],lastLogin:["lastsignin","lastlogin","lastlogon","lastsignindatetime","lastactivity"]});
      if(!rows||!rows.length){ toast("No rows recognized — check the header row"); return; }
      const start=$$("#acctbl tbody tr").length; $("#acctbl tbody").insertAdjacentHTML("beforeend",rows.map((r,i)=>accRow({...r,privileged:yes(r.privileged)},start+i)).join(""));
      drawerDirty=true; toast(`Added ${rows.length} accounts — save to keep them`); return; }
    case "rev-complete": {
      const accounts=readAccounts(); if(!accounts.length){ toast("Add the accounts reviewed first"); return; }
      const und=accounts.filter(x=>!x.decision).length; if(und){ toast(`${und} account(s) have no decision yet`); return; }
      const pend=accounts.filter(x=>(x.decision==="remove"||x.decision==="modify")&&!x.actioned).length;
      if(pend && !await confirmBox("Complete with changes not yet actioned?",`${pend} removal/modification(s) don't have an actioned date. Assessors expect evidence that access was actually removed.`,"Complete anyway")) return;
      const k=await saveReview(id,{status:"Completed",completedOn:today()}); if(!k) return;
      const r=rec("reviews",k); const p=reviewProgress(r);
      await signOff("review",k,r,"Access review completed",`${r.name} — ${r.system||""} · ${p.total} accounts, ${p.removed} removal(s)`,"I reviewed each account listed, and the decisions recorded reflect my determination of the access each person needs.");
      $("#drawer").dataset.unlocked=""; openReview(k); return; }
    case "rev-followup": { const r=rec("reviews",id); const accounts=(r.accounts||[]).filter(x=>x.decision!=="remove").map(x=>({acct:x.acct,person:x.person,role:x.role,privileged:x.privileged,lastLogin:""}));
      await closeDrawer(true); return openReview(null,{name:(r.name||"Access review").replace(/\s*\(follow-up.*\)$/,"")+` (follow-up ${today()})`,system:r.system,scope:r.scope,reviewer:r.reviewer,cadence:r.cadence,accounts}); }
    case "rev-export": { const rows=[]; Object.values(S.reviews).forEach(r=>(r.accounts||[]).forEach(x=>rows.push([r.name,r.system,r.scope,r.status,r.completedOn,x.acct,x.person,x.role,x.privileged?"Yes":"",x.lastLogin,x.decision,x.note,x.actioned]))); return offerFile(`access_reviews_${today()}.csv`,toCSV([["Review","System","Scope","Review status","Completed","Account","Name","Role / groups","Privileged","Last sign-in","Decision","Note","Actioned"],...rows])); }
    /* evidence requests */
    case "req-new": return openRequest(null,{assessment:UIX.req.assess||""});
    case "req-open": return openRequest(id);
    case "req-save": { const f=readForm($("#rqform")); if(!f.title){ toast("Describe the request"); return; } if(f.status==="Provided"&&!f.provided) f.provided=today(); const prev=id?rec("requests",id):{}; const k=id||uid(); const msg=!id?"created":(prev.status!==f.status?`status → ${f.status}`:"updated");
      if(await save("requests",k,{...prev,...f,num:prev.num||nextReqNum()},msg)){ drawerDirty=false; toast("Request saved"); closeDrawer(true);} return; }
    case "req-del": if(await confirmBox("Delete request?","This can't be undone.","Delete",true)){ await del("requests",id); closeDrawer(true);} return;
    case "req-bulk": {
      const res=await modal(`<h3>Bulk add requests</h3><p class="muted small">One request per line. Start a line with requirement IDs to link them, e.g. <span class="mono">3.1.1, 3.1.2 | Provide account management procedure</span>.</p>
        <div class="form" style="margin-bottom:8px"><div class="f"><label>Assessment</label><select id="bka"><option value="">— none —</option>${Object.entries(S.assessments).map(([k,x])=>`<option value="${k}">${esc(x.name||"Untitled")}</option>`).join("")}</select></div><div class="f"><label>Due</label><input type="date" id="bkd" value="${addDays(today(),5)}"></div></div>
        <textarea id="bkt" style="min-height:180px"></textarea>`,[{label:"Cancel",value:null},{label:"Add",pri:true,value:m=>({a:$("#bka",m).value,d:$("#bkd",m).value,t:$("#bkt",m).value})}]);
      const v=await res; if(!v||!v.t.trim()) return;
      const lines=v.t.split(/\r?\n/).map(l=>l.trim()).filter(Boolean); let n=nextReqNum();
      for(const l of lines){ let ctrls=[], title=l; const m=l.match(/^([\d.,\s]+)\|\s*(.+)$/); if(m){ ctrls=tagsToArr(m[1]).filter(x=>CONTROL_BY_ID[x]); title=m[2]; }
        await save("requests",uid(),{num:n++,title,ctrls,assessment:v.a,due:v.d,requested:today(),status:"Open",source:"C3PAO assessor"},"created (bulk)"); }
      toast(`Added ${lines.length} requests`); return; }
    case "req-export": return offerFile(`evidence_requests_${today()}.csv`, toCSV([["#","Request","Detail","Requested by","Requester","Assessment","Requirements","Objectives","Owner","Requested","Due","Status","Provided","Response","Evidence references"],...Object.values(S.requests).sort((a,b)=>(a.num||0)-(b.num||0)).map(r=>[`ER-${String(r.num||0).padStart(3,"0")}`,r.title,r.detail,r.source,r.requester,S.assessments[r.assessment]?.name||"",r.ctrls||[],r.objectives||[],r.owner,r.requested,r.due,r.status,r.provided,r.response,r.links])]));
    case "assess-req": { const aid=a.dataset.id; await closeDrawer(true); return openRequest(null,{assessment:aid}); }
    case "assess-sign": { if(drawerDirty){ toast("Save the assessment before signing"); return; } const r=rec("assessments",id); if(!r.snapshot){ toast("Capture a control snapshot before signing off results"); return; }
      await signOff("assessment",id,r,"Assessment results attested",`${r.name} — SPRS ${r.snapshot.score}, ${r.snapshot.met}/110 MET${r.snapshot.objMet!=null?`, ${r.snapshot.objMet}/320 objectives`:""}`,"I attest that these assessment results and findings are accurate and complete to the best of my knowledge.");
      $("#drawer").dataset.unlocked=""; return openAssess(id); }
    case "docx": return exportDocx(a.dataset.k);
  }
});
