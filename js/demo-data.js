/* ============================================================================
   Demo dataset — "Northwind Aerospace LLC" is a FICTIONAL company.
   All names, accounts, hosts, and addresses below are invented for
   demonstration. Domains use the reserved .example TLD and IPs are private.
   Dates are generated relative to today so the demo never goes stale.
   ============================================================================ */
const rel = n => addDays(today(), n);
const relISO = n => new Date(Date.now() + n*86400000).toISOString();

const DEMO_FAMILY = {
  AC:{owner:"IT Manager", impl:"Access to the CUI enclave is managed in Microsoft Entra ID (GCC High). Accounts are provisioned through the IT ticketing process after manager approval, assigned to role-based security groups, and enforced with Conditional Access policies."},
  AT:{owner:"HR Manager", impl:"Security awareness training is delivered through the learning management system at onboarding and annually; completion is tracked by HR and reported quarterly to the ISSO."},
  AU:{owner:"Security Analyst", impl:"Audit logs from Entra ID, Microsoft 365, endpoints, servers, and the enclave firewall are forwarded to Microsoft Sentinel and retained for one year (90 days hot)."},
  CM:{owner:"Systems Administrator", impl:"Endpoints are managed with Intune using CIS-based configuration profiles and servers follow CIS Benchmarks. Changes are reviewed at the weekly change advisory board and logged in the ticketing system."},
  IA:{owner:"IT Manager", impl:"Every user, service, and device has a unique Entra ID identity. Phishing-resistant MFA (FIDO2 security keys) is required for all enclave access."},
  IR:{owner:"Security Analyst", impl:"The Incident Response Plan defines roles, severity levels, evidence handling, and DFARS 252.204-7012 72-hour reporting. Incidents are tracked in the IT ticketing system."},
  MA:{owner:"Systems Administrator", impl:"Maintenance is performed by IT staff or escorted vendors. Remote vendor sessions require MFA through the managed remote-access tool and are terminated when complete."},
  MP:{owner:"Facilities Manager", impl:"CUI media is stored in locked cabinets inside the engineering secure room. Removable media is restricted by Intune device control and sanitized per NIST SP 800-88 before disposal."},
  PS:{owner:"HR Manager", impl:"HR completes background screening before enclave access is granted. The offboarding checklist disables accounts within 24 hours and same-day for involuntary terminations."},
  PE:{owner:"Facilities Manager", impl:"The engineering secure room requires badge access. Visitors sign in, are escorted at all times, and badge logs are retained for one year."},
  RA:{owner:"Security Analyst", impl:"Risk assessments follow the Risk Management Policy annually and after significant change. Authenticated vulnerability scans run monthly and after critical advisories."},
  CA:{owner:"Security Analyst", impl:"The SSP is reviewed annually and after significant change. Controls are self-assessed annually against NIST SP 800-171A and monitored continuously in this GRC workspace."},
  SC:{owner:"Systems Administrator", impl:"The enclave sits behind a FortiGate firewall with default-deny rules in both directions. Public-facing services are isolated in a separate DMZ VLAN, and traffic between zones is inspected and logged."},
  SI:{owner:"Security Analyst", impl:"Microsoft Defender for Endpoint provides EDR and malware protection with automatic updates. Patches are deployed monthly through Intune and WSUS; critical patches within 15 days."}
};
const DEMO_CTRL = {
  "3.1.1":{impl:"Enclave accounts exist only in the 'ENC-Users' and 'ENC-Admins' Entra ID groups. Access requests require manager approval in the ticketing system; devices must be Intune-compliant and hybrid-joined before Conditional Access allows a session.", odp:"Access reviews: privileged quarterly, standard semiannually"},
  "3.1.8":{odp:"Lockout after 5 failed attempts for 15 minutes (Entra smart lockout)"},
  "3.1.10":{odp:"Screen lock after 15 minutes of inactivity via Intune policy"},
  "3.1.21":{status:"partial", impl:"USB storage is blocked on managed endpoints by Intune device control. There is not yet a technical control preventing staff from using organization-issued portable storage on customer-site systems."},
  "3.3.4":{status:"not_implemented", impl:"Sentinel analytics alert on missing heartbeat from servers, but there is no alert when the Entra ID or firewall log connectors stop sending data."},
  "3.4.9":{status:"planned", impl:"Standard users cannot install software (no local admin). A Company Portal catalog with approval workflow is planned to formalize and monitor user-requested installs."},
  "3.5.3":{impl:"Conditional Access requires phishing-resistant MFA (FIDO2) for all users, all cloud apps, and all enclave workstation sign-ins, including privileged roles managed through Privileged Identity Management."},
  "3.8.6":{status:"partial", impl:"BitLocker To Go is enforced on organization-issued USB drives, but legacy encrypted drives from before 2025 have not all been reissued."},
  "3.10.6":{status:"partial", impl:"Telework agreements require a private workspace and screen privacy. Annual telework self-inspections have not started yet."},
  "3.12.4":{impl:"This System Security Plan describes the CUI enclave boundary, environment of operation, requirement implementations, and connections. It is reviewed annually by the ISSO and approved by the Director of IT."},
  "3.13.11":{status:"partial", partialCredit:true, impl:"Microsoft 365 GCC High, BitLocker (FIPS mode), and the VPN use FIPS 140-validated modules. Two legacy engineering laptops still run BitLocker without FIPS mode enabled."},
  "3.13.13":{status:"planned", impl:"Browsers block Java and Flash by default. A formal mobile-code policy covering macros and scripts is planned, with Office macro restrictions to be enforced through Intune."},
  "3.13.14":{status:"na", impl:"Not applicable: no VoIP systems exist inside the enclave boundary. Teams calling is disabled for enclave accounts in the GCC High tenant."}
};

async function loadDemoData(){
  COLS.forEach(c=>S[c]={});
  S.settings.org = {org:"Northwind Aerospace LLC (fictional)", system:"CUI Enclave", cage:"0DEM0", uei:"DEMO00000000",
    sysOwner:"Director of IT", isso:"Information Security Analyst", demoUser:"Demo User", targetLevel:"Level 2 (C3PAO)",
    reviewMonths:12, conditionalDate:rel(-30), assessDate:rel(75),
    scope:"The CUI Enclave supports engineering work on export-controlled drawings for DoD subcontracts. It includes 25 engineering workstations and laptops, one file server, a backup appliance, and Microsoft 365 GCC High.\nCUI handled: CTI and export-controlled technical data received from prime contractors.",
    env:"Headquarters engineering secure room (badge-controlled), approved telework locations, and Microsoft 365 GCC High. The enclave network is a separate VLAN behind a dedicated firewall.",
    connections:"Microsoft 365 GCC High (FedRAMP High) — email, Teams, SharePoint, Entra ID, Intune, Defender, Sentinel.\nPrime contractor secure file portal (outbound HTTPS only).\nNo other interconnections."};

  const failingObjs = {"3.1.21":["b"],"3.3.4":null,"3.4.9":null,"3.8.6":null,"3.10.6":["b","d"],"3.13.11":null,"3.13.13":null};
  CONTROLS.forEach((c,i)=>{
    const fam=DEMO_FAMILY[c.fam], o=DEMO_CTRL[c.id]||{};
    const status=o.status||"implemented";
    const pol=POLICY_TEMPLATES.find(t=>t.ctrls.includes(c.id))||POLICY_TEMPLATES.find(t=>t.fams[0]===c.fam);
    const reviewed=rel(-(20+(i*7)%300));
    const rec={status, owner:fam.owner, responsibility:["3.13.8","3.13.16","3.8.9","3.3.1"].includes(c.id)?"Shared (ESP / CSP)":"Organization",
      implementer:c.fam==="PE"||c.fam==="PS"?"Facilities / HR process":"Microsoft 365 GCC High, Intune, Entra ID",
      impl:o.impl || `${fam.impl} Requirement ${c.id} (${c.title}) is governed by the ${pol?pol.title:"Information Security Program Policy"}.`,
      odp:o.odp||"", reviewed, nextReview:addDays(reviewed,365), partialCredit:!!o.partialCredit,
      evidence: status==="na"?[]:[{name:`${c.title} — configuration or record export`, loc:`SharePoint › Compliance › Evidence › ${c.fam} › ${c.id}`, date:c.id==="3.9.1"?rel(-420):rel(-(15+(i*11)%200))}],
      history:[{at:relISO(-(20+(i*7)%300)), by:null, msg:`status → ${STATUS_BY_K[status].label}`}]};
    // 800-171A objectives: PE and MA families left unassessed to show work in progress
    if(!["PE","MA"].includes(c.fam)){
      const obj={}; const fails=failingObjs[c.id];
      (NIST_171A[c.id]?.o||[]).forEach(([k])=>{ const key=k||"_";
        let st = status==="na" ? "na" : "met";
        if(c.id in failingObjs && (fails===null || fails.includes(k))) st="not_met";
        obj[key]={st, n: st==="not_met" ? "See POA&M" : ""}; });
      if(c.id==="3.13.11") obj["_"]={st:"not_met",n:"Two legacy laptops (LT-ENG-07, LT-ENG-08) not in FIPS mode"};
      if(c.id==="3.1.1") obj["c"]={st:"met",n:"Intune device inventory export, enclave compliance report"};
      rec.obj=obj;
    }
    S.controls[c.id]=rec;
  });

  const poams=[
    ["3.3.4","No alert when Entra ID or firewall log connectors stop sending data to Sentinel.","Create Sentinel analytics rules for connector health and route alerts to the security mailbox.",`${rel(-20)} — draft analytics rules\n${rel(10)} — test failure scenarios\n${rel(25)} — production`,"Security Analyst","Analyst time (16 hrs)",rel(30),"In progress"],
    ["3.4.9","User-requested software installs are not formally approved or monitored.","Publish Company Portal catalog with approval workflow; monitor installs via Defender software inventory.",`${rel(15)} — catalog published\n${rel(45)} — monitoring report`,"Systems Administrator","Intune admin time",rel(60),"Open"],
    ["3.1.21","No technical control for organization-issued portable storage used on customer-site systems.","Issue hardware-encrypted, managed USB drives with logging; update Media Protection Policy.",`${rel(20)} — procure drives\n${rel(50)} — issue and train staff`,"IT Manager","$1,800 hardware",rel(75),"Open"],
    ["3.8.6","Legacy USB drives from before 2025 may not be encrypted.","Recall and reissue all legacy drives; sanitize returned media per SP 800-88.",`${rel(14)} — recall notice\n${rel(40)} — reissue complete`,"Facilities Manager","$600 hardware",rel(45),"In progress"],
    ["3.10.6","Telework safeguards are not verified.","Launch annual telework self-inspection checklist with manager sign-off.",`${rel(21)} — checklist issued`,"HR Manager","HR time",rel(40),"Open"],
    ["3.13.11","Two legacy laptops use BitLocker without FIPS mode.","Enable FIPS mode via Intune policy and re-encrypt; replace hardware if unsupported.",`${rel(7)} — enable policy\n${rel(20)} — verify CMVP-validated configuration`,"Systems Administrator","Admin time; possible laptop replacement ($3,200)",rel(25),"In progress"],
    ["3.13.13","Office macros and scripts are not restricted by policy.","Enforce Microsoft-recommended macro restrictions through Intune and publish mobile-code standard.",`${rel(30)} — pilot group\n${rel(60)} — all enclave devices`,"Systems Administrator","Admin time",rel(70),"Open"],
    ["3.5.3","MFA was not enforced for local workstation sign-in (found in FY26 baseline).","Deploy FIDO2 keys and Windows Hello for Business; enforce Conditional Access.",`${rel(-120)} — keys deployed\n${rel(-70)} — enforcement on`,"IT Manager","$2,400 for FIDO2 keys",rel(-60),"Closed"]
  ];
  poams.forEach(([ctrl,weakness,plan,milestones,owner,resources,due,status],i)=>{
    S.poam["demo-poam-"+(i+1)]={num:i+1,ctrl,weakness,plan,milestones,owner,resources,identified:i<7?rel(-31):rel(-230),due,status,source:i<7?"Self-assessment":"Self-assessment",
      closed:status==="Closed"?rel(-60):"",closure:status==="Closed"?"Verified Conditional Access sign-in logs show MFA on 100% of enclave sign-ins.":"",
      history:[{at:relISO(i<7?-31:-230),by:null,msg:"created"}].concat(status==="Closed"?[{at:relISO(-60),by:null,msg:"status → Closed"}]:[])};
  });

  const assets=[
    ["M365 GCC High tenant","Cloud service (SaaS/IaaS)","cui","Cloud","Microsoft 365 GCC High (FedRAMP High)","","","Yes"],
    ["Entra ID (GCC High)","Cloud service (SaaS/IaaS)","spa","Cloud","Microsoft 365 GCC High (FedRAMP High)","","","Yes"],
    ["Microsoft Sentinel","Cloud service (SaaS/IaaS)","spa","Cloud","Microsoft Azure Government","","",""],
    ["Defender for Endpoint","Cloud service (SaaS/IaaS)","spa","Cloud","Microsoft 365 GCC High (FedRAMP High)","","",""],
    ["FW-ENC-01","Firewall / security appliance","spa","On-premises","","10.20.0.1","FortiOS 7.4","Yes"],
    ["ENC-FS01","Server","cui","On-premises","","10.20.10.5","Windows Server 2022","Yes"],
    ["ENC-BK01","Storage / backup","cui","On-premises","","10.20.10.9","Vendor appliance 9.2","Yes"],
    ["ENG-WS-01","Workstation","cui","On-premises","","10.20.20.21","Windows 11 Enterprise 24H2","Yes"],
    ["ENG-WS-02","Workstation","cui","On-premises","","10.20.20.22","Windows 11 Enterprise 24H2","Yes"],
    ["LT-ENG-07","Laptop","cui","Remote / telework","","DHCP","Windows 11 Enterprise 23H2","No"],
    ["PRN-ENG-01","Printer / MFP","cui","On-premises","","10.20.30.10","Vendor firmware 5.1","N/A"],
    ["Corporate IT laptops (pool)","Laptop","crma","Hybrid","","DHCP","Windows 11 Enterprise","N/A"],
    ["CMM-LAB-01 coordinate measuring machine","OT / IoT / test equipment","specialized","On-premises","","10.20.40.5","Vendor controller","N/A"],
    ["Guest Wi-Fi","Wireless access point","oos","On-premises","","192.168.200.0/24","","N/A"],
    ["LT-ENG-09 (new hire laptop)","Laptop","","On-premises","","","Windows 11 Enterprise 24H2",""],
    ["FS-OLD (decommissioned file server)","Server","cui","On-premises","","","Windows Server 2016",""]
  ];
  assets.forEach(([name,type,category,environment,provider,ip,os,fips],i)=>{
    const status = name.startsWith("FS-OLD")?"Retired":name.startsWith("LT-ENG-09")?"Planned":"Active";
    S.assets["demo-asset-"+(i+1)]={name,type,category,status,environment,provider,ip,os,fips,
      owner:["cui","specialized"].includes(category)?"Engineering Manager":"IT Manager", location:environment==="Cloud"?"Azure Government":environment==="Remote / telework"?"Telework":"HQ",
      hostname: /^[A-Z]/.test(name)&&!name.includes(" ")?name.toLowerCase()+".northwind.example":"",
      baseline: ["Server","Workstation","Laptop"].includes(type)?"CIS Benchmark":type.startsWith("Firewall")?"Vendor hardening guide":"",
      reviewed: rel(-(10+i*9)), notes: name==="LT-ENG-07"?"BitLocker not in FIPS mode — see POA&M #6.":"",
      ctrls: category==="spa"?["3.13.1","3.3.1"]:[], history:[{at:relISO(-(10+i*9)),by:null,msg:"created"}]};
  });

  const accts1=[["jdoe-adm@northwind.example","Jordan Doe (admin)","Global Administrator",true,rel(-50),"keep","IT Manager — required for tenant administration",""],
    ["sanchez-adm@northwind.example","Riley Sanchez (admin)","Intune Administrator",true,rel(-48),"keep","Systems Administrator",""],
    ["kpatel-adm@northwind.example","Kai Patel (admin)","Security Administrator",true,rel(-47),"keep","Security Analyst",""],
    ["oldvendor-adm@northwind.example","Former MSP account","Exchange Administrator",true,rel(-200),"remove","MSP contract ended; no sign-in in 200 days",rel(-44)],
    ["svc-backup@northwind.example","Backup service","Backup Operator",true,"","modify","Remove interactive sign-in; restrict to backup appliance",rel(-43)],
    ["breakglass1@northwind.example","Emergency access","Global Administrator",true,rel(-90),"keep","Break-glass account; monitored by alert rule",""]];
  const accts2=[["aturner@northwind.example","Alex Turner","ENG-Drawings (Modify)",false,rel(-2),"keep","Design engineer",""],
    ["bwong@northwind.example","Blake Wong","ENG-Drawings (Read)",false,rel(-1),"keep","Quality inspector",""],
    ["cmorris@northwind.example","Casey Morris","ENG-Drawings (Modify)",false,rel(-95),"remove","Transferred to sales; no enclave need",""],
    ["dlee@northwind.example","Dana Lee","ENG-Archive (Read)",false,rel(-10),"keep","Program manager",""],
    ["ekim@northwind.example","Emery Kim","ENG-Drawings (Modify)",false,rel(-3),"keep","Design engineer",""],
    ["fgarcia@northwind.example","Finley Garcia","ENG-Drawings (Read)",false,rel(-30),"","",""],
    ["gnovak@northwind.example","Gray Novak","ENG-Archive (Modify)",false,rel(-60),"","",""],
    ["svc-scan@northwind.example","Scanner service","ENG-Drawings (Read)",false,"","","",""]];
  const toAcc=a=>a.map(([acct,person,role,privileged,lastLogin,decision,note,actioned])=>({acct,person,role,privileged,lastLogin,decision,note,actioned}));
  S.reviews["demo-rev-1"]={name:"Q3 privileged access review — Entra ID",system:"Entra ID (GCC High)",scope:"Privileged accounts",reviewer:"Director of IT",cadence:3,start:rel(-60),due:rel(-46),status:"Completed",completedOn:rel(-45),accounts:toAcc(accts1),notes:"",history:[{at:relISO(-60),by:null,msg:"created"},{at:relISO(-45),by:null,msg:"completed — 6/6 decided, 1 removal(s)"}]};
  S.reviews["demo-rev-2"]={name:"Semiannual access review — ENC-FS01 shares",system:"ENC-FS01 file server",scope:"All accounts",reviewer:"Engineering Manager",cadence:6,start:rel(-5),due:rel(9),status:"In progress",accounts:toAcc(accts2),notes:"",history:[{at:relISO(-5),by:null,msg:"created"}]};

  // Assessments: FY26 baseline (older posture) and FY27 readiness (current), plus a planned mock C3PAO
  const olderUnmet=["3.5.3","3.11.2","3.1.12","3.4.8","3.3.5","3.14.6","3.12.3"];
  const oldRec=id=>olderUnmet.includes(id)?{status:"not_implemented"}:S.controls[id];
  const oldScore=computeScore(oldRec); const curScore=computeScore(); const curObj=objTotals();
  S.assessments["demo-assess-1"]={name:"FY26 baseline self-assessment",type:"NIST 800-171 DoD Basic (SPRS)",status:"Complete",start:rel(-240),end:rel(-230),assessor:"Information Security Analyst",org:"Internal",scope:"CUI Enclave",result:"Baseline established. Major gaps in MFA, vulnerability scanning, and log correlation.",sprsSubmitted:rel(-228),affirm:"",
    snapshot:{at:relISO(-230),score:oldScore.score,met:oldScore.met,statuses:Object.fromEntries(CONTROLS.map(c=>[c.id,(oldRec(c.id)||{}).status||"not_assessed"]))},
    findings:[{ctrl:"3.5.3",severity:"Not MET",status:"Closed",text:"MFA not enforced for local workstation sign-in."},{ctrl:"3.11.2",severity:"Not MET",status:"Closed",text:"No authenticated vulnerability scanning."}],history:[{at:relISO(-230),by:null,msg:"created"}]};
  S.assessments["demo-assess-2"]={name:"FY27 readiness self-assessment",type:"CMMC Level 2 self-assessment",status:"Complete",start:rel(-35),end:rel(-28),assessor:"Information Security Analyst",org:"Internal",scope:"CUI Enclave",result:"Eligible for Conditional Level 2 status. Seven 1-point requirements on POA&M; 3.13.11 partially implemented (non-FIPS on two laptops).",sprsSubmitted:rel(-27),affirm:rel(-27),
    snapshot:{at:relISO(-28),score:curScore.score,met:curScore.met,objMet:curObj.met,objNotMet:curObj.notMet,statuses:Object.fromEntries(CONTROLS.map(c=>[c.id,ctrlStatus(c.id)]))},
    findings:[{ctrl:"3.3.4",severity:"Not MET",status:"In remediation",text:"No alerting on audit log pipeline failure."},{ctrl:"3.13.11",severity:"Not MET",status:"In remediation",text:"Two laptops lack FIPS-mode BitLocker."},{ctrl:"3.9.1",severity:"Observation",status:"Open",text:"Screening evidence is more than 12 months old; refresh the HR attestation."}],history:[{at:relISO(-28),by:null,msg:"created"}]};
  S.assessments["demo-assess-3"]={name:"Mock C3PAO assessment",type:"CMMC Level 2 C3PAO assessment",status:"Planned",start:rel(75),end:rel(78),assessor:"External consultant (mock)",org:"Independent consultant",scope:"CUI Enclave",result:"",findings:[],history:[{at:relISO(-10),by:null,msg:"created"}]};

  [["Provide account management procedure and last two access review records",["3.1.1","3.1.5"],"Accepted",rel(-6),rel(-9)],
   ["Show Conditional Access policy requiring phishing-resistant MFA",["3.5.3"],"Provided",rel(-1),rel(-2)],
   ["Network diagram showing enclave boundary, DMZ, and data flows",["3.13.1","3.13.5"],"In progress",rel(4),""],
   ["Sentinel retention settings and sample correlated alert",["3.3.1","3.3.5"],"Open",rel(-2),""],
   ["CMVP certificate numbers for encryption modules protecting CUI",["3.13.11"],"Needs more info",rel(6),""]
  ].forEach(([title,ctrls,status,due,provided],i)=>{
    S.requests["demo-req-"+(i+1)]={num:i+1,title,ctrls,objectives:[],assessment:"demo-assess-3",source:"C3PAO assessor",requester:"Mock assessor",owner:i%2?"Security Analyst":"IT Manager",requested:rel(-12),due,status,provided,response:provided?"Uploaded to the assessment evidence folder.":"",links:"",history:[{at:relISO(-12),by:null,msg:"created (bulk)"}]};
  });

  // Policies adopted from the template library
  const fixODP = b => b.replace(/\[defined condition\]/g,"8 hours").replace(/\[defined\]/g,"15 minutes").replace(/\[([^\]\n]{1,60})\]/g,"$1");
  const pols=[["ISP","Approved","1.0",-120],["AC","Approved","1.0",-95],["IA","Approved","1.0",-95],["IR","Approved","1.0",-80],["AUP","Approved","2.0",-400],["CM","In review","0.2",null],["SC","Draft","0.1",null],["AT","Draft","0.1",null]];
  pols.forEach(([key,status,version,appr])=>{
    const t=POLICY_TEMPLATES.find(x=>x.key===key); let body=policyBody(t); if(status==="Approved") body=fixODP(body);
    const p={templateKey:key,title:t.title,number:`POL-${key}`,version,status,owner:key==="AUP"||key==="AT"?"HR Manager":"Information Security Analyst",approver:status==="Approved"?"Director of IT":"",
      approvedOn:appr!=null?rel(appr):"",effective:appr!=null?rel(appr):"",reviewMonths:12,nextReview:appr!=null?addMonths(key==="AUP"?rel(-35):rel(appr),12):"",ctrls:[...t.ctrls],body,
      history:[{at:relISO(appr??-14),by:null,msg:status==="Approved"?`v${version} approved by Director of IT`:"adopted from template"}]};
    if(key==="AUP") p.history.unshift({at:relISO(-35),by:null,msg:"annual review recorded — no changes (v2.0)"});
    S.policies["demo-pol-"+key]=p;
  });

  [["Ransomware encrypts enclave file server","Phishing or exploited vulnerability leads to encryption of CUI on ENC-FS01, disrupting engineering deliveries.","Cyber / technical","4","5","Mitigate","Treating","Immutable backups, EDR, MFA, tested restores.","2","4",["3.14.2","3.8.9","3.6.1"]],
   ["Insider exfiltration of export-controlled drawings","A departing employee copies CUI to personal storage.","People","3","5","Mitigate","Treating","DLP policies, USB blocking, offboarding checklist, insider-threat training.","2","4",["3.1.3","3.8.7","3.2.3"]],
   ["Non-FIPS encryption on legacy laptops","Two laptops encrypt CUI with non-validated crypto; contract noncompliance risk.","Compliance / contractual","4","3","Mitigate","Treating","Enable FIPS mode or replace hardware (POA&M #6).","1","3",["3.13.11"]],
   ["Cloud provider outage","Microsoft 365 GCC High outage halts collaboration with primes.","Third-party / supply chain","2","3","Accept","Accepted","Documented manual fallback; accepted by Director of IT.","2","3",[]],
   ["Lost or stolen laptop during travel","Laptop containing cached CUI is lost.","Physical","3","3","Mitigate","Open","FIPS BitLocker, remote wipe via Intune, travel briefing.","1","2",["3.1.19","3.8.6"]]
  ].forEach(([title,desc,category,likelihood,impact,treatment,status,plan,rl,ri,ctrls],i)=>{
    S.risks["demo-risk-"+(i+1)]={title,desc,category,likelihood,impact,treatment,status,plan,rl,ri,ctrls,owner:"Information Security Analyst",review:rel(60+i*20),acceptedBy:status==="Accepted"?"Director of IT":"",history:[{at:relISO(-50),by:null,msg:"created"}]};
  });

  // Sign-offs (local demo identity) with fingerprints that match the records above
  const items={}; let n=0;
  const sign=async(kind,ref,record,meaning,label,statement,daysAgo)=>{ const id="demo-sig-"+(++n); items[id]={id,kind,ref,label,meaning,statement,at:relISO(daysAgo),hash:await sha256(SIGN_CONTENT[kind](record)),mode:"local",localName:"Demo User"}; };
  for(const [key,,version,appr] of pols.filter(p=>p[1]==="Approved")){ const p=S.policies["demo-pol-"+key]; await sign("policy","demo-pol-"+key,p,"Policy approved",`${p.title} v${version}`,"I approve this policy for publication and use by the organization.",appr); }
  await sign("policy","demo-pol-AUP",S.policies["demo-pol-AUP"],"Annual review — no changes","Acceptable Use Policy v2.0","I reviewed this policy and it remains accurate and appropriate without changes.",-35);
  await sign("review","demo-rev-1",S.reviews["demo-rev-1"],"Access review completed","Q3 privileged access review — Entra ID · 6 accounts, 1 removal(s)","I reviewed each account listed, and the decisions recorded reflect my determination of the access each person needs.",-45);
  await sign("assessment","demo-assess-2",S.assessments["demo-assess-2"],"Assessment results attested",`FY27 readiness self-assessment — SPRS ${curScore.score}, ${curScore.met}/110 MET, ${curObj.met}/320 objectives`,"I attest that these assessment results and findings are accurate and complete to the best of my knowledge.",-27);
  S.signoffs.local={items};
  persistLocal();
}

async function resetDemo(){
  if(!await confirmBox("Reset demo data?","This replaces everything in this browser with the original sample data.","Reset")) return;
  closeDrawer(true); await loadDemoData(); render(); toast("Demo data restored");
}
async function startEmpty(){
  if(!await confirmBox("Start with an empty workspace?","This removes the sample data from this browser so you can try the app with your own entries. You can restore the demo at any time.","Start empty",true)) return;
  closeDrawer(true); COLS.forEach(c=>S[c]={}); S.settings.org={demoUser:"Demo User",reviewMonths:12}; persistLocal(); render(); toast("Workspace cleared");
}
document.addEventListener("click", e=>{
  const a=e.target.closest("[data-act]"); if(!a) return;
  if(a.dataset.act==="demo-reset") resetDemo();
  if(a.dataset.act==="demo-clear") startEmpty();
});
