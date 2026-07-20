#!/usr/bin/env node
// Builds a self-contained local grading-review dashboard (grading-review.html)
// from the four teacher gradebooks. Re-run after any grade change to refresh.
// Contains student PII -> stays a LOCAL file; do not publish/host.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { SECTIONS as CFG, paths } from "../lib/config.mjs";
const SECTIONS = CFG.map(s => ({ key: s.key, subject: s.subject, section: s.section, dir: s.dir }));

// GRAIN theme, consumed from the installed @tjakoen/grain package at BUILD time and inlined, so
// the dashboard stays a single self-contained offline file (no node_modules / CDN at view time).
const grainCss = n => fs.readFileSync(fileURLToPath(import.meta.resolve("@tjakoen/grain/styles/" + n)), "utf8");
const grainFont = f => "data:font/woff2;base64," + fs.readFileSync(fileURLToPath(import.meta.resolve("@tjakoen/grain/fonts/" + f))).toString("base64");
const GRAIN = grainCss("variables.css")
  .replace(/@import\s+"themes\/[^"]+";\s*/g, "")                                          // drop optional flavors (Sourdough is the :root default)
  .replace(/url\("\/fonts\/([^"]+\.woff2)"\)/g, (_m, f) => 'url("' + grainFont(f) + '")')  // embed Redaction woff2 offline
  + "\n" + grainCss("grain.css")                                                           // the grade-as-signal mechanism (data-grade / .field)
  + "\n" + grainCss("themes/baguette.css");                                                // the Baguette flavor (data-theme="baguette")

const parse = (line) => { const o=[];let c="",q=false;for(let i=0;i<line.length;i++){const ch=line[i];if(q){if(ch==='"'&&line[i+1]==='"'){c+='"';i++;}else if(ch==='"')q=false;else c+=ch;}else if(ch==='"')q=true;else if(ch===','){o.push(c);c="";}else c+=ch;}o.push(c);return o;};
const dec = (s) => { try { return s ? Buffer.from(s,"base64").toString("utf8") : ""; } catch { return ""; } };
const pointsFor = (passed, total, pp) => (!total ? null : Math.round((passed/total)*pp));

function loadSection(sc) {
  const pol = JSON.parse(fs.readFileSync(path.join(sc.dir, "grader/assignments.json"), "utf8"));
  const policy = new Map(pol.map(a => [a.id, a]));
  const assignments = pol.map(a => ({
    id: a.id, totalPoints: a.totalPoints ?? null, autoPoints: a.autoPoints ?? null,
    aiGraded: !!a["ai-grading"], manual: !!a.manual, locked: !!a.locked, publish: !!a.publish,
    feedback: a.feedback || null,
  }));
  const csv = fs.readFileSync(path.join(sc.dir, "gradebook/grades.csv"), "utf8").replace(/\n$/,"").split("\n");
  const h = parse(csv[0]); const gi = (n) => h.indexOf(n);
  const noteDir = (id, repo) => path.join(sc.dir, "gradebook/notes", id, `${repo}.md`);

  const byStudent = new Map();
  for (let i=1;i<csv.length;i++) {
    const f = parse(csv[i]); if (!f[gi("repo")]) continue;
    const id = f[gi("assignment")]; const a = policy.get(id); if (!a) continue;
    const num = (f[gi("studentNumber")]||"").trim();
    const key = num || `norepo:${f[gi("fullName")]||f[gi("repo")]}`;
    if (!byStudent.has(key)) byStudent.set(key, {
      number: num, name: f[gi("fullName")]||"", github: f[gi("githubAccount")]||"", activities: {},
    });
    const st = byStudent.get(key);
    if (!st.name && f[gi("fullName")]) st.name = f[gi("fullName")];
    if (!st.github && f[gi("githubAccount")]) st.github = f[gi("githubAccount")];
    const passed = +f[gi("passed")]||0, total = +f[gi("total")]||0;
    const aiScore = f[gi("aiScore")]==="" ? null : +f[gi("aiScore")];
    const held = a["ai-grading"] ? true : false;
    const pp = a.totalPoints ?? a.autoPoints ?? null;
    let canvasPts = null, kind = "push";
    if (a.manual) { kind = "manual"; }
    else if (held) { kind = "held"; }
    else if (pp != null) canvasPts = pointsFor(passed, total, a.autoPoints ?? a.totalPoints);
    else canvasPts = passed; // no declared points -> raw test count, scaled to Canvas on push
    let note = "";
    const nf = noteDir(id, f[gi("repo")]);
    if (fs.existsSync(nf)) note = fs.readFileSync(nf, "utf8");
    else note = dec(f[gi("notes")]);
    // pull the AI-authored likelihood ("vibecode") flag + any triage flag from the note
    let aiFlag = null, triage = null;
    if (note) {
      const m = note.match(/AI-authored likelihood:\s*([^\n]+)/i); if (m) aiFlag = m[1].trim();
      const t = note.match(/\nFlag:\s*([^\n]+)/i); if (t) triage = t[1].trim();
    }
    st.activities[id] = {
      repo: f[gi("repo")], passed, total, raw: `${passed}/${total}`,
      canvasPts, proposed: aiScore, proposedMax: (a.totalPoints ?? a.autoPoints ?? total),
      held, kind, note: note || null, aiFlag, triage,
      sha: (f[gi("sha")]||"").slice(0,7), late: f[gi("late")]==="true",
    };
  }

  // tallies
  const students = [...byStudent.values()].map(st => {
    let push = 0, heldSum = 0, pushMax = 0, heldMax = 0;
    for (const a of assignments) {
      const r = st.activities[a.id]; if (!r) continue;
      const max = a.totalPoints ?? a.autoPoints ?? (r.total || 0);
      if (r.kind === "held") { heldSum += (r.proposed ?? 0); heldMax += max; }
      else if (r.kind === "push") { push += (r.canvasPts ?? 0); pushMax += max; }
    }
    return { ...st, tally: { push, pushMax, held: heldSum, heldMax } };
  }).sort((x,y)=> (x.name||"").localeCompare(y.name||""));

  const heldCount = assignments.filter(a=>a.aiGraded).length;
  const blank = students.filter(s=>!s.number).length;
  return { ...sc, assignments, students,
    stats: { students: students.length, activities: assignments.length, held: heldCount, blankStudentJson: blank } };
}

const SHOTS_FILE = paths.shotsManifest;
const SHOTS = fs.existsSync(SHOTS_FILE) ? JSON.parse(fs.readFileSync(SHOTS_FILE, "utf8")) : {};
const DATA = { generatedAt: new Date().toISOString(), sections: SECTIONS.map(loadSection) };

const html = TEMPLATE(DATA);
fs.writeFileSync(paths.dashboardHtml, html);
const tot = DATA.sections.reduce((n,s)=>n+s.students.length,0);
console.log(`grading-review.html written | ${DATA.sections.length} sections | ${tot} students`);

function TEMPLATE(data) {
  const json = JSON.stringify(data).replace(/</g,"\\u003c");
  return `<!doctype html><html lang="en" data-theme="baguette"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>HAU Grading Review</title>
<style>${CSS()}</style></head><body>
<div id="app"></div>
${fs.existsSync(paths.codeBundle) ? '<script src="grading-review-code.js"></script>' : "<script>window.CODE={};</script>"}
<script>const DATA=${json};const SHOTS=${JSON.stringify(SHOTS).replace(/</g,"\\u003c")};</script>
<script>${JS()}</script>
</body></html>`;
}

function CSS(){ return `
${GRAIN}
/* ---- grader-ui bridge: map its layout aliases onto grain's real tokens (grain stays the source of truth) ---- */
:root{--bg:var(--color-bg);--panel2:var(--paper-2);--line:var(--line-soft);--mut:var(--ink-muted);--acc:var(--color-accent);--on-acc:var(--color-accent-contrast);--radius:var(--radius-md);
  --good:#3f6d3a;--warn:#8a6410;--bad:#a12f22;--held:#5a3fa0;--tc:#6a7a52;--ts:#9a5b2a;--tn:#4a7a4a;--tk:#3a5a8a;--tg:#5a7a6a}
@media(prefers-color-scheme:dark){:root:not([data-color-scheme=light]){--good:#7fae70;--warn:#d0a24a;--bad:#e08a7a;--held:#b79af0;--tc:#9ab07a;--ts:#d0a07a;--tn:#a0c090;--tk:#8aa0d0;--tg:#8ab0a0}}
:root[data-color-scheme=dark]{--good:#7fae70;--warn:#d0a24a;--bad:#e08a7a;--held:#b79af0;--tc:#9ab07a;--ts:#d0a07a;--tn:#a0c090;--tk:#8aa0d0;--tg:#8ab0a0}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.55 var(--font-smooth)}
h1,h2,h3{font-family:var(--font-accent)}
a{color:var(--acc)}
.wrap{max-width:1500px;margin:0 auto;padding:20px}
h1{font-size:20px;margin:0 0 2px}.sub{color:var(--mut);font-size:13px}
.tabs{display:flex;gap:6px;flex-wrap:wrap;margin:16px 0}
.tab{padding:8px 14px;border:1px solid var(--line);background:var(--panel);color:var(--ink);border-radius:99px;cursor:pointer;font-size:13px}
.tab.on{background:var(--acc);border-color:var(--acc);color:var(--on-acc);font-weight:600}
.tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;margin:12px 0}
.tile{background:var(--panel);border:1px solid var(--line);border-radius:var(--radius);padding:12px 14px}
.tile .n{font-size:22px;font-weight:700}.tile .l{color:var(--mut);font-size:12px}
.card{background:var(--panel);border:1px solid var(--line);border-radius:var(--radius);margin:14px 0;overflow:hidden}
.card h2{font-size:14px;margin:0;padding:12px 14px;border-bottom:1px solid var(--line);background:var(--panel2)}
.card .bd{padding:12px 14px}
.scroll{overflow-x:auto}
table{border-collapse:collapse;width:100%;font-size:13px}
th,td{padding:7px 9px;border-bottom:1px solid var(--line);text-align:left;white-space:nowrap}
th{color:var(--mut);font-weight:600;position:sticky;top:0;background:var(--panel2);z-index:2}
.matrix td.stu,.matrix th.stu{position:sticky;left:0;background:var(--panel);z-index:1;max-width:230px;overflow:hidden;text-overflow:ellipsis}
.matrix th.stu{z-index:3;background:var(--panel2)}
.cell{cursor:pointer;text-align:center;font-variant-numeric:tabular-nums;border-radius:6px}
.cell:hover{outline:2px solid var(--acc);outline-offset:-2px}
.b{display:inline-block;padding:1px 7px;border-radius:99px;font-size:11px;font-weight:600}
.b.held{background:color-mix(in srgb,var(--held) 22%,transparent);color:var(--held)}
.b.push{background:color-mix(in srgb,var(--good) 20%,transparent);color:var(--good)}
.b.manual{background:color-mix(in srgb,var(--mut) 22%,transparent);color:var(--mut)}
.b.warn{background:color-mix(in srgb,var(--warn) 22%,transparent);color:var(--warn)}
.mut{color:var(--mut)}.rt{text-align:right}.center{text-align:center}
.pill{font-size:11px;color:var(--mut)}
.tot{font-weight:700;font-variant-numeric:tabular-nums}
button.act{background:var(--acc);color:var(--on-acc);border:0;border-radius:8px;padding:8px 14px;cursor:pointer;font-size:13px;font-weight:600}
button.gh{background:var(--panel2);color:var(--ink);border:1px solid var(--line);border-radius:8px;padding:6px 12px;cursor:pointer;font-size:12px}
input.search{background:var(--panel2);border:1px solid var(--line);color:var(--ink);border-radius:8px;padding:7px 10px;width:240px;font-size:13px}
.drawer{position:fixed;inset:0;background:rgba(0,0,0,.5);display:none;z-index:50}
.drawer.on{display:block}
.dp{position:absolute;right:0;top:0;height:100%;width:min(720px,94vw);background:var(--panel);border-left:1px solid var(--line);overflow:auto;padding:18px 20px}
.dp h3{margin:0 0 2px}.dp .x{float:right;cursor:pointer;color:var(--mut);font-size:20px;border:0;background:none}
pre{white-space:pre-wrap;word-wrap:break-word;background:var(--panel2);border:1px solid var(--line);border-radius:8px;padding:12px;font:12.5px/1.55 ui-monospace,SFMono-Regular,Menlo,monospace}
.legend{display:flex;gap:14px;flex-wrap:wrap;color:var(--mut);font-size:12px;margin:6px 0}
.tglbtn{float:right;cursor:pointer;background:var(--panel2);border:1px solid var(--line);color:var(--ink);border-radius:8px;padding:5px 10px;font-size:12px}
/* wide 2-col review panel */
.dp.wide{width:min(1240px,97vw)}
.rvhead{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:4px}
.rvnav{margin-left:auto;display:flex;align-items:center;gap:6px}
.rvnav .cnt{color:var(--mut);font-size:12px;font-variant-numeric:tabular-nums;min-width:52px;text-align:center}
.chip{display:inline-block;padding:2px 10px;border-radius:99px;font-size:12px;font-weight:700}
.chip.todo{background:color-mix(in srgb,var(--mut) 22%,transparent);color:var(--mut)}
.chip.ok{background:color-mix(in srgb,var(--good) 22%,transparent);color:var(--good)}
.chip.ov{background:color-mix(in srgb,var(--held) 24%,transparent);color:var(--held)}
.chip.fl{background:color-mix(in srgb,var(--warn) 24%,transparent);color:var(--warn)}
.rev2{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:16px;margin-top:12px}
@media(max-width:900px){.rev2{grid-template-columns:1fr}}
.shots{display:flex;flex-direction:column;gap:12px}
.shot{border:1px solid var(--line);border-radius:8px;overflow:hidden;background:var(--panel2)}
.shot .cap{font-size:11px;color:var(--mut);padding:5px 8px;border-bottom:1px solid var(--line);text-transform:uppercase;letter-spacing:.04em}
.shot img{display:block;width:100%;height:auto;cursor:zoom-in}
.noshot{border:1px dashed var(--line);border-radius:8px;padding:24px;text-align:center;color:var(--mut);font-size:13px}
.rvcol{min-width:0}
.lvtoggle{display:inline-flex;border:1px solid var(--line);border-radius:8px;overflow:hidden;margin-bottom:10px}
.lvbtn{background:var(--panel2);color:var(--ink);border:0;border-right:1px solid var(--line);padding:5px 12px;font-size:12px;cursor:pointer}
.lvbtn:last-child{border-right:0}
.lvbtn.on{background:var(--acc);color:var(--on-acc);font-weight:600}
.lvbtn:disabled{opacity:.4;cursor:not-allowed}
.codepre{white-space:pre;overflow:auto;max-height:74vh;background:var(--panel2);border:1px solid var(--line);border-radius:8px;padding:10px 12px;font:12px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace;tab-size:2}
.codepre .tc{color:var(--tc);font-style:italic}.codepre .ts{color:var(--ts)}.codepre .tn{color:var(--tn)}.codepre .tk{color:var(--tk)}.codepre .tg{color:var(--tg)}
select.cfile{width:100%;margin-bottom:8px;background:var(--panel2);border:1px solid var(--line);color:var(--ink);border-radius:8px;padding:7px 10px;font:12px ui-monospace,Menlo,monospace}
.ftlab{display:block;font-size:12px;font-weight:600;margin:10px 0 4px}
.fta{width:100%;background:var(--panel2);border:1px solid var(--line);color:var(--ink);border-radius:8px;padding:10px;font-size:14px;line-height:1.55;resize:vertical}
.fta.mono{font:12px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace}
.fta:focus{outline:2px solid var(--acc);outline-offset:-1px}
`;}

function JS(){ return `
const $=(s,r=document)=>r.querySelector(s), el=(t,c,h)=>{const e=document.createElement(t);if(c)e.className=c;if(h!=null)e.innerHTML=h;return e};
const esc=s=>String(s==null?"":s).replace(/[&<>]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;"}[c]));
let cur=0, q="", mode="book", revAct=null;
const app=$("#app");
function curScheme(){ return document.documentElement.getAttribute("data-color-scheme")||(matchMedia("(prefers-color-scheme:dark)").matches?"dark":"light"); }
function cellColor(pct){ if(pct==null)return""; const g=Math.round(pct*120); const dark=curScheme()==="dark"; return "background:hsl("+g+"deg "+(dark?"30%":"55%")+" "+(dark?"24%":"90%")+")"; }
// ---- review decisions (persisted in this browser) ----
const DKEY="hau-grade-decisions-v1";
let DEC={}; try{DEC=JSON.parse(localStorage.getItem(DKEY)||"{}")}catch(e){DEC={}}
const dkey=(sec,act,skey)=>sec+"|"+act+"|"+skey;
const getDec=(sec,act,skey)=>DEC[dkey(sec,act,skey)]||null;
const setDec=(sec,act,skey,v)=>{const k=dkey(sec,act,skey);if(v)DEC[k]=v;else delete DEC[k];localStorage.setItem(DKEY,JSON.stringify(DEC));};
const skeyOf=st=>st.number||st.name;
function exportDecisions(){
  const n=Object.keys(DEC).length;
  if(!n&&!confirm("You have 0 saved decisions. Export an empty file anyway?"))return;
  const payload={_meta:{key:DKEY,exportedAt:new Date().toISOString(),count:n},decisions:DEC};
  const a=document.createElement("a");
  a.href=URL.createObjectURL(new Blob([JSON.stringify(payload,null,2)],{type:"application/json"}));
  a.download="hau-grade-decisions-"+new Date().toISOString().slice(0,10)+".json";
  a.click(); setTimeout(()=>URL.revokeObjectURL(a.href),1000);
}
function importDecisions(file){
  const rd=new FileReader();
  rd.onload=()=>{
    let obj; try{obj=JSON.parse(rd.result)}catch(e){alert("Not valid JSON: "+e.message);return}
    const inc=obj&&obj.decisions&&typeof obj.decisions==="object"?obj.decisions:(obj&&typeof obj==="object"&&!Array.isArray(obj)?obj:null);
    if(!inc){alert("No decisions object found in that file.");return}
    const keys=Object.keys(inc);
    if(!keys.length){alert("That file has 0 decisions.");return}
    if(!confirm("Import "+keys.length+" decision(s)? This MERGES into your current "+Object.keys(DEC).length+" (imported values win on conflicts)."))return;
    keys.forEach(k=>{DEC[k]=inc[k]});
    localStorage.setItem(DKEY,JSON.stringify(DEC));
    render();
    alert("Imported "+keys.length+" decision(s). Total now "+Object.keys(DEC).length+".");
  };
  rd.readAsText(file);
}

function render(){
 const s=DATA.sections[cur];
 app.innerHTML="";
 const w=el("div","wrap");
 const head=el("div"); head.innerHTML='<div style="float:right;display:flex;gap:6px;align-items:center"><button class="gh" id="expDec" title="Download all review decisions as a JSON backup">⭳ Export decisions</button><button class="gh" id="impDec" title="Merge decisions from a JSON backup file">⭱ Import</button><input type="file" id="impFile" accept="application/json,.json" style="display:none"></div><button class="tglbtn" id="theme">◐ theme</button><h1>HAU Grading Review</h1><div class="sub">generated '+new Date(DATA.generatedAt).toLocaleString()+' · <b>local file, contains student data</b></div>';
 w.append(head);
 const tabs=el("div","tabs");
 DATA.sections.forEach((x,i)=>{const t=el("div","tab"+(i===cur?" on":""),esc(x.subject)+" · "+x.section);t.onclick=()=>{cur=i;q="";revAct=null;render()};tabs.append(t)});
 w.append(tabs);
 // mode toggle
 const mt=el("div","tabs"); mt.style.marginTop="-4px";
 [["book","Gradebook"],["ai","AI Review ("+s.stats.held+")"]].forEach(([k,l])=>{const b=el("div","tab"+(mode===k?" on":""),l);b.style.borderStyle="dashed";b.onclick=()=>{mode=k;render()};mt.append(b)});
 w.append(mt);
 app.append(w);
 if(mode==="ai") renderAI(s,w); else renderBook(s,w);
 $("#theme").onclick=toggleTheme;
 $("#expDec").onclick=exportDecisions;
 $("#impDec").onclick=()=>$("#impFile").click();
 $("#impFile").onchange=e=>{const f=e.target.files[0];if(f)importDecisions(f);e.target.value="";};
}

function renderBook(s,w){
 const tiles=el("div","tiles");
 const avgP=avg(s.students.map(x=>x.tally.pushMax?x.tally.push/x.tally.pushMax:null));
 tiles.innerHTML=[
  ["Students",s.stats.students],["Activities",s.stats.activities],
  ["Held for review",s.stats.held+' <span class="pill">AI, not auto-pushed</span>'],
  ["Blank student.json",s.stats.blankStudentJson],
  ["Avg auto-push",avgP==null?"—":Math.round(avgP*100)+"%"],
 ].map(([l,n])=>'<div class="tile"><div class="n">'+n+'</div><div class="l">'+l+'</div></div>').join("");
 w.append(tiles);
 const ctl=el("div"); ctl.style.margin="6px 0 0";
 ctl.innerHTML='<input class="search" id="q" placeholder="Filter students…" value="'+esc(q)+'"> <button class="act" id="prompt">Generate apply-grades prompt →</button>';
 w.append(ctl);
 w.append(matrix(s));
 w.append(canvasPanel(s));
 $("#q").oninput=e=>{q=e.target.value.toLowerCase();renderMatrixOnly(s)};
 $("#prompt").onclick=()=>showPrompt(s);
}
function renderMatrixOnly(s){ const old=$("#matrixcard"); if(old){const n=matrix(s);old.replaceWith(n);} }

// ================= AI REVIEW =================
function heldActs(s){return s.assignments.filter(a=>a.aiGraded)}
function reviewRows(s,aid){return s.students.filter(st=>st.activities[aid]).map(st=>({st,r:st.activities[aid],dec:getDec(s.section,aid,skeyOf(st))}))}
const isDecided=d=>!!(d&&d.status);
function decStatus(row){ const d=row.dec; if(!isDecided(d))return{k:"todo",l:d&&(d.studentText||d.instructorText||d.comment)?"edited":"unreviewed"}; if(d.status==="approve")return{k:"ok",l:"approved"}; if(d.status==="override")return{k:"ov",l:"override "+d.score}; return{k:"fl",l:"flagged"}; }
function finalScore(row){ const d=row.dec; if(!d)return null; if(d.status==="override")return d.score; if(d.status==="approve")return row.r.proposed; return null; }
// split an AI note into the student-facing prose and the instructor-only block
function parseNote(note){
 if(!note) return {student:"",instructor:""};
 const idx=note.indexOf("\\n---");
 let head=idx>=0?note.slice(0,idx):note;
 let instructor=idx>=0?note.slice(idx).replace(/^\\s*\\n?-{3,}\\s*/,"").trim():"";
 const lines=head.split("\\n");
 while(lines.length && (/^#/.test(lines[0].trim())||/^_.*_$/.test(lines[0].trim())||lines[0].trim()==="")) lines.shift();
 return {student:lines.join("\\n").trim(), instructor};
}

function renderAI(s,w){
 const acts=heldActs(s);
 if(!acts.length){w.append(el("div","card",'<div class="bd mut">No AI-graded activities in this section.</div>'));return;}
 if(!revAct||!acts.find(a=>a.id===revAct)) revAct=acts[0].id;
 const sub=el("div","tabs");
 acts.forEach(a=>{const rows=reviewRows(s,a.id);const done=rows.filter(x=>isDecided(x.dec)).length;const b=el("div","tab"+(revAct===a.id?" on":""),esc(a.id)+" <span class='pill'>"+done+"/"+rows.length+"</span>");b.onclick=()=>{revAct=a.id;render()};sub.append(b)});
 w.append(sub);
 const rows=reviewRows(s,revAct);
 const done=rows.filter(x=>isDecided(x.dec)).length, appr=rows.filter(x=>x.dec&&x.dec.status==="approve").length, ov=rows.filter(x=>x.dec&&x.dec.status==="override").length, fl=rows.filter(x=>x.dec&&x.dec.status==="flag").length;
 // progress + actions
 const bar=el("div","card"); const pct=rows.length?Math.round(done/rows.length*100):0;
 bar.innerHTML='<div class="bd"><div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap">'+
  '<div><b>'+esc(revAct)+'</b> — reviewed <b>'+done+'/'+rows.length+'</b> · <span class="b push">'+appr+' approved</span> <span class="b held">'+ov+' override</span> <span class="b warn">'+fl+' flagged</span></div>'+
  '<div><button class="gh" id="apprAll">Approve all unreviewed</button> <button class="gh" id="reset">Reset</button> <button class="act" id="applyAI">Apply reviewed → prompt</button> <button class="act" id="finalize">Finalize → publish + Canvas</button></div></div>'+
  '<div style="height:6px;background:var(--panel2)"><div style="height:100%;width:'+pct+'%;background:var(--acc)"></div></div>';
 w.append(bar);
 // queue table
 const card=el("div","card"); card.append(el("h2",null,"Review queue — click a row to read the feedback and decide"));
 const scr=el("div","scroll"); const t=el("table");
 const max=s.assignments.find(a=>a.id===revAct).totalPoints;
 t.innerHTML="<tr><th>Student</th><th>#</th><th class='center'>Proposed</th><th class='center'>AI-authored likelihood</th><th class='center'>Decision</th><th class='center'>Final</th></tr>"+
 rows.map(row=>{
   const stt=decStatus(row), fin=finalScore(row);
   const flag=row.r.aiFlag||"—"; const fl=/high/i.test(flag)?"bad":/medium/i.test(flag)?"warn":"push";
   const skey=esc(skeyOf(row.st));
   return "<tr data-s='"+skey+"' style='cursor:pointer'><td>"+esc(row.st.name||"(blank)")+(row.r.triage?" <span class='b warn' title='"+esc(row.r.triage)+"'>flag</span>":"")+"</td><td class='mut'>"+esc(row.st.number||"—")+"</td>"+
     "<td class='center'>"+(row.r.proposed!=null?row.r.proposed+"/"+max:"<span class='b warn'>no score</span>")+"</td>"+
     "<td class='center'><span class='b "+fl+"'>"+esc(flag.split(" - ")[0])+"</span></td>"+
     "<td class='center'><span class='b "+({todo:"manual",ok:"push",ov:"held",fl:"warn"}[stt.k])+"'>"+stt.l+"</span></td>"+
     "<td class='center tot'>"+(fin!=null?fin+"/"+max:"—")+"</td></tr>";
 }).join("");
 scr.append(t); card.append(scr); w.append(card);
 setTimeout(()=>{
   t.querySelectorAll("tr[data-s]").forEach(tr=>tr.onclick=()=>openReview(s,revAct,tr.dataset.s));
   $("#apprAll").onclick=()=>{rows.forEach(row=>{if(!isDecided(row.dec)&&row.r.proposed!=null)setDec(s.section,revAct,skeyOf(row.st),Object.assign({},row.dec,{status:"approve"}))});render()};
   $("#reset").onclick=()=>{if(confirm("Clear all decisions for "+revAct+"?")){rows.forEach(row=>setDec(s.section,revAct,skeyOf(row.st),null));render()}};
   $("#applyAI").onclick=()=>showApplyAI(s,revAct);
   $("#finalize").onclick=()=>showFinalize(s,revAct);
 },0);
}

function shotsHTML(sec,repo){
 const list=(SHOTS[sec+"|"+repo])||[];
 if(!list.length) return "<div class='noshot'>No screenshots for this submission.<br><span style='font-size:12px'>(not a design activity, or no preview was published)</span></div>";
 return list.map(sh=>"<div class='shot'><div class='cap'>"+esc(sh.label)+"</div><a href='"+esc(sh.file)+"' target='_blank' rel='noopener'><img loading='lazy' src='"+esc(sh.file)+"' alt='"+esc(sh.label)+" screenshot'></a></div>").join("");
}
const codeAvail=(sec,repo)=>(window.CODE&&window.CODE[sec+"|"+repo])||null;
function codeHTML(sec,repo){
 const files=codeAvail(sec,repo);
 if(!files||!files.length) return "<div class='noshot'>No code cached for this submission.<br><span style='font-size:12px'>run <b>node fetch-code.mjs</b> at the HAU root to fetch source</span></div>";
 return "<select class='cfile' id='cfile'>"+files.map((f,i)=>"<option value='"+i+"'>"+esc(f.path)+"</option>").join("")+"</select>"+
   "<pre class='codepre' id='cpre'>"+hl(files[0].content,files[0].lang)+"</pre>";
}
// tiny self-contained syntax highlighter (no external lib; local file:// safe)
const HLKW=new Set("await async break case catch class const continue debugger default delete do else export extends false finally for from function if implements import in instanceof interface let new null of return super switch this throw true try typeof var void while with yield static get set public private protected abstract final dynamic bool int double num String List Map Widget build override late required as is enum mixin extension typedef on part show hide library".split(/\\s+/));
function hlCode(s){
 const re=/(\\/\\/[^\\n]*|\\/\\*[\\s\\S]*?\\*\\/)|(\`(?:\\\\[\\s\\S]|[^\`\\\\])*\`|"(?:\\\\[\\s\\S]|[^"\\\\])*"|'(?:\\\\[\\s\\S]|[^'\\\\])*')|(\\b\\d[\\w.]*\\b)|([A-Za-z_$][\\w$]*)/g;
 let out="",last=0,m;
 while((m=re.exec(s))){ out+=esc(s.slice(last,m.index)); last=re.lastIndex;
  if(m[1])out+="<span class=tc>"+esc(m[1])+"</span>";
  else if(m[2])out+="<span class=ts>"+esc(m[2])+"</span>";
  else if(m[3])out+="<span class=tn>"+esc(m[3])+"</span>";
  else out+=(HLKW.has(m[4])?"<span class=tk>"+esc(m[4])+"</span>":esc(m[4])); }
 return out+esc(s.slice(last));
}
function hlMarkup(s){
 const re=/(<!--[\\s\\S]*?-->)|(<\\/?[A-Za-z][^>]*>)/g;
 let out="",last=0,m;
 while((m=re.exec(s))){ out+=esc(s.slice(last,m.index)); last=re.lastIndex;
  if(m[1])out+="<span class=tc>"+esc(m[1])+"</span>";
  else out+="<span class=tg>"+esc(m[2]).replace(/("[^"]*"|'[^']*')/g,x=>"<span class=ts>"+x+"</span>")+"</span>"; }
 return out+esc(s.slice(last));
}
function hl(code,lang){ return /^(html?|xml|vue|svelte)$/.test(lang||"")?hlMarkup(String(code)):hlCode(String(code)); }
function openReview(s,aid,skey){
 const max=s.assignments.find(a=>a.id===aid).totalPoints;
 const order=reviewRows(s,aid).map(row=>skeyOf(row.st));
 let idx=Math.max(0,order.indexOf(skey));
 let leftView=null;   // "shots" | "code" - persists across prev/next in this drawer
 const d=el("div","drawer on"); const p=el("div","dp wide"); d.append(p); document.body.append(d);
 const close=()=>{d.remove();document.removeEventListener("keydown",onKey);render()};
 const onKey=e=>{ if(e.key==="Escape")close(); else if(e.key==="ArrowRight"&&idx<order.length-1)paint(idx+1); else if(e.key==="ArrowLeft"&&idx>0)paint(idx-1); };
 function paint(i){
  idx=i; const sk=order[i];
  const st=s.students.find(x=>skeyOf(x)===sk); const r=st.activities[aid];
  const orig=parseNote(r.note);
  const hasShots=((SHOTS[s.section+"|"+r.repo])||[]).length>0;
  const hasCode=!!codeAvail(s.section,r.repo);
  if(leftView===null||(leftView==="shots"&&!hasShots&&hasCode)||(leftView==="code"&&!hasCode&&hasShots)) leftView=hasShots?"shots":(hasCode?"code":"shots");
  const lv=leftView;
  const curDec=getDec(s.section,aid,sk);
  const stt=decStatus({dec:curDec});
  const chip="<span class='chip "+stt.k+"'>"+stt.l+"</span>";
  const flag=r.aiFlag?r.aiFlag.split(" - ")[0]:null;
  p.innerHTML="<button class='x'>×</button>"+
   "<div class='rvhead'><h3 style='margin:0'>"+esc(st.name||"(blank)")+"</h3>"+chip+
     "<div class='rvnav'><button class='gh' id='prev'"+(i<=0?" disabled":"")+">← Prev</button>"+
     "<span class='cnt'>"+(i+1)+" / "+order.length+"</span>"+
     "<button class='gh' id='next'"+(i>=order.length-1?" disabled":"")+">Next →</button></div></div>"+
   "<div class='sub'>"+esc(aid)+" · "+esc(sk)+" · @"+esc(st.github||"")+" · repo "+esc(r.repo)+"</div>"+
   "<div class='legend'><span>Automated: <b>"+r.raw+"</b></span><span>AI proposed: <b data-grade='grain'>"+(r.proposed!=null?r.proposed+"/"+max:"—")+"</b></span>"+(flag?"<span>AI-authored: <b data-grade='grain'>"+esc(flag)+"</b></span>":"")+"</div>"+
   "<div class='rev2'>"+
    "<div class='rvcol'>"+
     "<div class='lvtoggle'>"+
      "<button class='lvbtn"+(lv==='shots'?' on':'')+"' data-lv='shots'"+(hasShots?'':' disabled')+">Screenshots</button>"+
      "<button class='lvbtn"+(lv==='code'?' on':'')+"' data-lv='code'"+(hasCode?'':' disabled')+">Code"+(hasCode?" <span class='pill'>"+codeAvail(s.section,r.repo).length+"</span>":"")+"</button>"+
     "</div>"+
     "<div class='shots' id='lvShots' style='display:"+(lv==='shots'?'flex':'none')+"'>"+shotsHTML(s.section,r.repo)+"</div>"+
     "<div id='lvCode' style='display:"+(lv==='code'?'block':'none')+"'>"+codeHTML(s.section,r.repo)+"</div>"+
    "</div>"+
    "<div class='rvcol'>"+
     "<div class='card' style='margin:0 0 12px'><div class='bd'>"+
      "<div style='display:flex;gap:8px;flex-wrap:wrap;align-items:center'>"+
      "<button class='act' id='dApprove'>✓ Approve "+(r.proposed!=null?r.proposed+"/"+max:"")+"</button>"+
      "<span>Override <input id='dOv' class='search' style='width:70px' type='number' min='0' max='"+max+"' value='"+(curDec&&curDec.status==='override'?curDec.score:(r.proposed!=null?r.proposed:''))+"'> /"+max+" <button class='gh' id='dOvBtn'>Set</button></span>"+
      "<button class='gh' id='dFlag'>⚑ Flag</button>"+
      "<button class='gh' id='dClear'>Clear</button></div>"+
      "<input class='search' id='dComment' style='width:100%;margin-top:8px' placeholder='Private note to yourself (goes to the apply prompt)…' value='"+esc(curDec&&curDec.comment||"")+"'>"+
     "</div></div>"+
     "<label class='ftlab'>Student-facing feedback <span class='mut'>— delivered as FEEDBACK.md, prose only</span>"+(curDec&&curDec.studentText!=null?" <span class='chip ov' style='font-size:10px'>edited</span>":"")+"</label>"+
     "<textarea id='dStudent' class='fta'"+(curDec&&curDec.studentText!=null?"":" data-grade='grain'")+" rows='10'>"+esc(curDec&&curDec.studentText!=null?curDec.studentText:orig.student)+"</textarea>"+
     "<label class='ftlab'>Instructor-only notes <span class='mut'>— never delivered to the student</span>"+(curDec&&curDec.instructorText!=null?" <span class='chip ov' style='font-size:10px'>edited</span>":"")+"</label>"+
     "<textarea id='dInstr' class='fta mono' rows='12'>"+esc(curDec&&curDec.instructorText!=null?curDec.instructorText:orig.instructor)+"</textarea>"+
     "<div style='display:flex;gap:8px;align-items:center;margin-top:8px'><button class='act' id='dSave'>Save edits</button> <button class='gh' id='dRevert'>Revert to AI text</button> <span class='mut' id='dSaved' style='font-size:12px'></span></div>"+
    "</div>"+
   "</div>";
  p.querySelector(".x").onclick=close;
  const prev=$("#prev"),next=$("#next");
  if(prev)prev.onclick=()=>{if(idx>0)paint(idx-1)};
  if(next)next.onclick=()=>{if(idx<order.length-1)paint(idx+1)};
  // left-pane toggle (screenshots <-> code) - no repaint, just show/hide
  p.querySelectorAll(".lvbtn[data-lv]").forEach(b=>b.onclick=()=>{ if(b.disabled)return; leftView=b.dataset.lv;
    $("#lvShots").style.display=leftView==="shots"?"flex":"none"; $("#lvCode").style.display=leftView==="code"?"block":"none";
    p.querySelectorAll(".lvbtn").forEach(x=>x.classList.toggle("on",x.dataset.lv===leftView)); });
  const cf=$("#cfile"); if(cf){ const files=codeAvail(s.section,r.repo); cf.onchange=()=>{ const f=files[+cf.value]; $("#cpre").innerHTML=hl(f.content,f.lang); }; }
  // gather the current text edits + comment, keeping only what differs from the AI original
  const collect=(extra)=>{ const d=Object.assign({},getDec(s.section,aid,sk)||{},extra);
    const stv=$("#dStudent").value, inv=$("#dInstr").value, cm=$("#dComment").value;
    if(stv.trim()!==orig.student.trim())d.studentText=stv; else delete d.studentText;
    if(inv.trim()!==orig.instructor.trim())d.instructorText=inv; else delete d.instructorText;
    if(cm)d.comment=cm; else delete d.comment;
    return d; };
  const save=v=>{setDec(s.section,aid,sk,v);if(idx<order.length-1)paint(idx+1);else paint(idx);};
  $("#dApprove").onclick=()=>save(collect(r.proposed!=null?{status:"approve"}:{status:"override",score:+$("#dOv").value}));
  $("#dOvBtn").onclick=()=>save(collect({status:"override",score:+$("#dOv").value}));
  $("#dFlag").onclick=()=>save(collect({status:"flag"}));
  $("#dClear").onclick=()=>{setDec(s.section,aid,sk,null);paint(idx);};
  $("#dSave").onclick=()=>{const d=collect({});setDec(s.section,aid,sk,Object.keys(d).length?d:null);$("#dSaved").textContent="saved ✓";const stt2=decStatus({dec:getDec(s.section,aid,sk)});const c=p.querySelector(".chip");if(c){c.className="chip "+stt2.k;c.textContent=stt2.l;}};
  $("#dRevert").onclick=()=>{$("#dStudent").value=orig.student;$("#dInstr").value=orig.instructor;const d=collect({});setDec(s.section,aid,sk,Object.keys(d).length?d:null);paint(idx);};
 }
 d.onclick=e=>{if(e.target===d)close()};
 document.addEventListener("keydown",onKey);
 paint(idx);
}

function showApplyAI(s,aid){
 const rows=reviewRows(s,aid); const max=s.assignments.find(a=>a.id===aid).totalPoints;
 const decided=rows.filter(x=>isDecided(x.dec)&&x.dec.status!=="flag");
 const flagged=rows.filter(x=>x.dec&&x.dec.status==="flag");
 const undone=rows.filter(x=>!isDecided(x.dec));
 const edited=decided.filter(x=>x.dec.studentText!=null||x.dec.instructorText!=null);
 const lines=decided.map(x=>{const fin=finalScore(x);const tags=[x.dec.status==="override"?"OVERRIDE — was "+(x.r.proposed==null?"none":x.r.proposed):"approved"];if(x.dec.studentText!=null)tags.push("edited student feedback");if(x.dec.instructorText!=null)tags.push("edited instructor note");return "  - "+(x.st.name||x.r.repo)+" ("+(x.st.number||"?")+") · "+x.r.repo+": "+fin+"/"+max+"  ["+tags.join("; ")+"]"+(x.dec.comment?" — note: "+x.dec.comment:"");}).join("\\n");
 const editBlocks=edited.map(x=>{
   let b="### "+x.r.repo+"  (final "+finalScore(x)+"/"+max+")\\n";
   if(x.dec.studentText!=null)b+="STUDENT-FACING — replace the prose half of gradebook/notes/"+aid+"/"+x.r.repo+".md (between the italic disclaimer line and the '---' instructor separator):\\n<<<\\n"+x.dec.studentText+"\\n>>>\\n";
   if(x.dec.instructorText!=null)b+="INSTRUCTOR-ONLY — replace the instructor half (everything after the '---'):\\n<<<\\n"+x.dec.instructorText+"\\n>>>\\n";
   return b;
 }).join("\\n");
 const txt=
"# Apply reviewed AI grades — "+s.subject+" (section "+s.section+") — "+aid+"\\n\\n"+
"I have reviewed the held AI grades for "+aid+". Apply my decisions below. Work from: "+s.dir+"\\n\\n"+
"## Reviewed decisions (final score / "+max+")\\n"+(lines||"  (none decided yet)")+"\\n\\n"+
(editBlocks?"## Edited feedback to write (use this EXACT text, verbatim)\\n"+editBlocks+"\\n":"")+
(flagged.length?"## Flagged for deeper review — do NOT apply, publish, or push; re-examine and report back to me\\n"+
"For each student below, do a thorough second pass on "+aid+":\\n"+
"  1. Read the current assessment in gradebook/notes/"+aid+"/<repo>.md and the rubric in grader/"+aid+"/RUBRIC.md (plus grader/class-prompt.md).\\n"+
"  2. Clone the submission repo at its graded SHA and read the ACTUAL code; if it is a design activity, open its screenshots (gradebook/previews/"+aid+"/<repo>/ or the previews branch).\\n"+
"  3. Produce a fresh per-criterion breakdown, a revised proposed score out of "+max+", and a revised student-facing feedback draft, explicitly addressing my flag note. Call out anything that looks off (over/under-scored, mismatch with the code, possible integrity issue).\\n"+
"  4. Present it all to me in chat for a decision. Do NOT write grades.csv, notes, publish, or push Canvas for these students.\\n\\n"+
flagged.map(x=>"  - "+(x.st.name||x.r.repo)+" ("+(x.st.number||"?")+") · "+x.r.repo+" @"+(x.r.sha||"?")+" · current proposed "+(x.r.proposed!=null?x.r.proposed+"/"+max:"none")+(x.r.aiFlag?" · AI-likelihood "+x.r.aiFlag.split(" - ")[0]:"")+(x.dec.comment?" — my note: "+x.dec.comment:"")).join("\\n")+"\\n\\n":"")+
(undone.length?"## Not yet reviewed ("+undone.length+") — do NOT apply\\n\\n":"")+
"## Steps\\n"+
"1. For each OVERRIDE student, set gradebook/grades.csv aiScore to the final score I gave (do not touch the objective test score column). Approved students keep the AI's proposed aiScore.\\n"+
"2. For every FLAGGED or NOT-YET-REVIEWED student on "+aid+", BLANK their aiScore cell in gradebook/grades.csv. A blank aiScore holds a student out of the Canvas push (canvas-push skips it) and marks them not-cleared for delivery.\\n"+
"3. For every student under \\"Edited feedback to write\\", overwrite gradebook/notes/"+aid+"/<repo>.md with my exact text: replace the student-facing prose half and/or the instructor half as labelled, keeping the title line and the italic disclaimer line intact. For OVERRIDE students with no edited instructor text, still update the instructor note's proposed total to match my score, adjust the per-criterion bullets to sum to it, and record the human-review note on the proposed-total line (so it stays out of the Canvas comment).\\n"+
"4. Verify the gradebook: overrides show my score, flagged/unreviewed aiScore are blank, approved are unchanged. Rebuild the dashboard (node src/build-dashboard.mjs) so I can review the applied grades before delivery.\\n\\n"+
"Do NOT publish or push Canvas from this prompt, and do NOT flip \\"publish\\": true. This prompt writes grades only. Delivery (flip publish:true, publish to students, push Canvas, verify) is the separate Finalize step (the Finalize button emits that prompt), gated on my go. The student-facing FEEDBACK.md and the Canvas comment must stay free of any \\"AI\\" mention and of the instructor-only likelihood/vibecode line. The <<< >>> markers are delimiters only — do not include them in the files.\\n";
 const d=el("div","drawer on"); const p=el("div","dp");
 p.innerHTML="<button class='x'>×</button><h3>Apply reviewed AI grades — "+esc(aid)+"</h3><div class='sub'>"+decided.length+" to apply · "+flagged.length+" flagged · "+undone.length+" not reviewed</div><div style='margin:10px 0'><button class='act' id='cp'>Copy prompt</button> <button class='gh' id='csv'>Download CSV</button></div><pre id='ptxt'>"+esc(txt)+"</pre>";
 d.append(p); document.body.append(d);
 const close=()=>d.remove(); p.querySelector(".x").onclick=close; d.onclick=e=>{if(e.target===d)close()};
 $("#cp").onclick=()=>navigator.clipboard.writeText(txt).then(()=>$("#cp").textContent="Copied ✓");
 $("#csv").onclick=()=>{
   const hdr="studentNumber,name,repo,proposed,decision,finalScore,max,comment\\n";
   const body=rows.map(x=>{const fin=finalScore(x);const st=isDecided(x.dec)?x.dec.status:"unreviewed";return [x.st.number||"",'"'+(x.st.name||"").replace(/"/g,'""')+'"',x.r.repo,x.r.proposed==null?"":x.r.proposed,st,fin==null?"":fin,max,'"'+((x.dec&&x.dec.comment||"")).replace(/"/g,'""')+'"'].join(",")}).join("\\n");
   const blob=new Blob([hdr+body],{type:"text/csv"});const u=URL.createObjectURL(blob);const a=el("a");a.href=u;a.download="ai-review-"+s.section+"-"+aid+".csv";a.click();URL.revokeObjectURL(u);
 };
}

function showFinalize(s,aid){
 const rows=reviewRows(s,aid); const max=s.assignments.find(a=>a.id===aid).totalPoints;
 const delivered=rows.filter(x=>isDecided(x.dec)&&x.dec.status!=="flag");
 const heldOut=rows.filter(x=>!(isDecided(x.dec)&&x.dec.status!=="flag"));
 const delList=delivered.map(x=>"  - "+x.r.repo+": "+finalScore(x)+"/"+max).join("\\n")||"  (none cleared yet)";
 const heldList=heldOut.map(x=>"  - "+x.r.repo+(x.dec&&x.dec.status==="flag"?" (flagged)":" (not reviewed)")).join("\\n")||"  (none)";
 const txt=
"# Finalize and deliver — "+s.subject+" (section "+s.section+") — "+aid+"\\n\\n"+
"The reviewed grades for "+aid+" are already written to the gradebook (approved + overrides applied; held/flagged aiScore blanked). Now deliver ONLY the cleared students to their workspaces and to Canvas. Work from: "+s.dir+"\\n\\n"+
"## Cleared to deliver ("+delivered.length+")\\n"+delList+"\\n\\n"+
"## Held OUT — do NOT deliver ("+heldOut.length+")\\n"+heldList+"\\n\\n"+
"## Rules (do not violate)\\n"+
"- Dry-run first for BOTH publish and Canvas; execute only on my explicit \\"go\\".\\n"+
"- Student FEEDBACK.md and the Canvas comment carry NO scores-as-AI, no \\"AI\\" mention, and never the instructor-only likelihood/vibecode line.\\n"+
"- publish-grades.mjs does not gate on aiScore, so an activity-wide publish would also deliver the held students' FEEDBACK. Deliver ONLY the cleared repos above: use the publish workflow's repo input (one run per cleared repo), OR if the aiScore gate has been added to publish-grades, a single publish only="+aid+" is safe.\\n\\n"+
"## Steps\\n"+
"1. Flip \\"publish\\": true on "+aid+" in grader/assignments.json (the readiness gate; nothing delivers yet).\\n"+
"2. Student publish (publish.yml), DRY RUN (publish=false), restricted to the cleared repos. Show me the plan; confirm it lists exactly the cleared repos above and no held student.\\n"+
"3. On my \\"go\\": run publish for real (publish=true) for the cleared repos only.\\n"+
"4. Canvas push in CHECK mode for "+aid+" (tools/canvas-push.mjs --section="+s.section+" --check). Show the report; confirm every cleared student maps and no held student appears (held students have blank aiScore and are skipped).\\n"+
"5. On my \\"go\\": canvas-push --execute. Each cleared student gets their final score PLUS a rubric-breakdown comment (per-criterion points + feedback prose).\\n"+
"6. VERIFY: each cleared student received FEEDBACK.md/GRADES.md and the correct Canvas grade + comment (spot-check 2-3), and NO held/flagged student got anything.\\n";
 const d=el("div","drawer on"); const p=el("div","dp");
 p.innerHTML="<button class='x'>×</button><h3>Finalize and deliver — "+esc(aid)+"</h3><div class='sub'>"+delivered.length+" cleared to deliver · "+heldOut.length+" held out</div><div style='margin:10px 0'><button class='act' id='cp'>Copy prompt</button></div><pre id='ptxt'>"+esc(txt)+"</pre>";
 d.append(p); document.body.append(d);
 const close=()=>d.remove(); p.querySelector(".x").onclick=close; d.onclick=e=>{if(e.target===d)close()};
 $("#cp").onclick=()=>navigator.clipboard.writeText(txt).then(()=>$("#cp").textContent="Copied ✓");
}

function matrix(s){
 const card=el("div","card"); card.id="matrixcard";
 card.append(el("h2",null,"Gradebook — students × activities <span class='mut' style='font-weight:400'>(click a cell for feedback)</span>"));
 const leg=el("div","legend"); leg.style.padding="0 14px";
 leg.innerHTML='<span><span class="b push">push</span> auto-pushed to Canvas</span><span><span class="b held">held</span> AI proposal, review first</span><span><span class="b manual">manual</span> hand-entered</span><span>cell = Canvas points / max</span>';
 card.append(leg);
 const sc=el("div","scroll"); const t=el("table","matrix");
 const cols=s.assignments;
 let thead="<tr><th class='stu'>Student</th><th>#</th>"+cols.map(a=>"<th class='center'>"+esc(a.id)+"<br><span class='pill'>"+(a.totalPoints!=null?a.totalPoints+"pt":(a.aiGraded?"AI":"tests"))+(a.aiGraded?" ·held":"")+"</span></th>").join("")+"<th class='center'>Push total</th><th class='center'>+Held</th></tr>";
 const rows=s.students.filter(st=>!q||(st.name||"").toLowerCase().includes(q)||(st.number||"").includes(q)||(st.github||"").toLowerCase().includes(q)).map(st=>{
   let tds="<td class='stu' title='"+esc(st.name)+"'>"+esc(st.name||"(blank)")+(st.github?" <span class='pill'>@"+esc(st.github)+"</span>":"")+"</td><td class='mut'>"+esc(st.number||"—")+"</td>";
   cols.forEach(a=>{
     const r=st.activities[a.id];
     if(!r){tds+="<td class='cell mut'>·</td>";return;}
     const max=a.totalPoints ?? a.autoPoints ?? r.total;
     let disp,pct=null,cls="";
     if(r.kind==="held"){disp=(r.proposed!=null?r.proposed:"?")+"/"+max;pct=r.proposed!=null&&max?r.proposed/max:null;cls="held";}
     else if(r.kind==="manual"){disp="—";cls="manual";}
     else {disp=(r.canvasPts!=null?r.canvasPts:"?")+"/"+max;pct=r.canvasPts!=null&&max?r.canvasPts/max:null;cls="push";}
     tds+="<td class='cell "+cls+"' style='"+cellColor(pct)+"' data-s='"+esc(st.number||st.name)+"' data-a='"+a.id+"'>"+disp+(r.late?" <span class=pill>late</span>":"")+"</td>";
   });
   tds+="<td class='center tot'>"+st.tally.push+"<span class='pill'>/"+st.tally.pushMax+"</span></td><td class='center mut'>"+(st.tally.held?"+"+st.tally.held+"/"+st.tally.heldMax:"—")+"</td>";
   return "<tr>"+tds+"</tr>";
 }).join("");
 t.innerHTML=thead+rows;
 sc.append(t); card.append(sc);
 setTimeout(()=>t.querySelectorAll("td.cell[data-a]").forEach(td=>td.onclick=()=>openNote(s,td.dataset.s,td.dataset.a)),0);
 return card;
}

function openNote(s,skey,aid){
 const st=s.students.find(x=>(x.number||x.name)===skey); if(!st)return;
 const r=st.activities[aid]; if(!r)return;
 const d=el("div","drawer on"); const p=el("div","dp");
 const a=s.assignments.find(x=>x.id===aid);
 const max=a.totalPoints ?? a.autoPoints ?? r.total;
 const val=r.kind==="held"?(r.proposed+"/"+max+" (held — review)"):r.kind==="manual"?"manual":(r.canvasPts+"/"+max);
 p.innerHTML="<button class='x'>×</button><h3>"+esc(st.name)+" — "+esc(aid)+"</h3><div class='sub'>"+esc(st.number||"")+" · @"+esc(st.github||"")+" · repo "+esc(r.repo)+" @"+esc(r.sha)+"</div>"+
  "<div class='legend'><span>Automated: <b>"+r.raw+"</b></span><span>Canvas: <b>"+val+"</b></span></div>"+
  "<pre>"+esc(r.note||"(no written feedback)")+"</pre>";
 d.append(p); document.body.append(d);
 const close=()=>d.remove(); p.querySelector(".x").onclick=close; d.onclick=e=>{if(e.target===d)close()};
}

function canvasPanel(s){
 const card=el("div","card");
 card.append(el("h2",null,"Canvas preview — what a push would do"));
 const bd=el("div","bd scroll");
 const t=el("table");
 t.innerHTML="<tr><th>Activity</th><th>Max</th><th>Graded</th><th>Status</th><th>Avg (of graded)</th></tr>"+
 s.assignments.map(a=>{
   const rs=s.students.map(st=>st.activities[a.id]).filter(Boolean);
   const max=a.totalPoints ?? a.autoPoints ?? "tests";
   let status,avgv;
   if(a.manual){status="<span class='b manual'>manual — skipped</span>";}
   else if(a.aiGraded){status="<span class='b held'>held for review</span>";}
   else{status="<span class='b push'>auto-push"+(a.locked?" · locked":"")+"</span>";}
   const vals=rs.map(r=>a.aiGraded?r.proposed:r.canvasPts).filter(v=>v!=null);
   avgv=vals.length?(Math.round(vals.reduce((x,y)=>x+y,0)/vals.length*10)/10):"—";
   return "<tr><td><b>"+esc(a.id)+"</b>"+(a.feedback?" <span class=pill>"+a.feedback+"</span>":"")+"</td><td>"+max+"</td><td>"+rs.length+"</td><td>"+status+"</td><td>"+avgv+"</td></tr>";
 }).join("");
 bd.append(t);
 const note=el("div","mut"); note.style.marginTop="10px"; note.style.fontSize="12px";
 note.innerHTML="Held (AI) activities are never auto-pushed — deliver them via publish after you review the notes. The exact push counts come from <code>canvas-push --check</code> (the prompt runs it).";
 bd.append(note); card.append(bd); return card;
}

function showPrompt(s){
 const held=s.assignments.filter(a=>a.aiGraded).map(a=>a.id);
 const push=s.assignments.filter(a=>!a.aiGraded&&!a.manual).map(a=>a.id);
 const rows=s.assignments.filter(a=>!a.aiGraded&&!a.manual).map(a=>{
   const rs=s.students.map(st=>st.activities[a.id]).filter(Boolean);
   return "  - "+a.id+": "+(a.totalPoints!=null?a.totalPoints+" pts":"raw tests")+", "+rs.length+" students graded";
 }).join("\\n");
 const txt=
"# Apply grades to Canvas — "+s.subject+" (section "+s.section+")\\n\\n"+
"You are my grading assistant for the HAU platform. Apply the reviewed grades for this section to Canvas. Work from the teacher repo:\\n"+
s.dir+"\\n\\n"+
"## Rules (do not violate)\\n"+
"- gradebook/grades.csv is the source of truth. Never hand-edit a grade.\\n"+
"- These AI/held activities must NOT be auto-pushed — I review + publish them separately: "+(held.join(", ")||"(none)")+".\\n"+
"- Dry-run first. Only execute on my explicit \\"go\\".\\n\\n"+
"## Steps\\n"+
"1. Re-run a grade sweep only if submissions changed since "+new Date(DATA.generatedAt).toLocaleDateString()+"; otherwise use the current gradebook.\\n"+
"2. Canvas push in CHECK mode for section "+s.section+" (tools/canvas-push.mjs --section="+s.section+" --check, or the Canvas push workflow in check mode). \\n"+
"3. Show me the report: # grades, # students matched, per-activity counts, and ANY unmatched students or points-possible mismatches.\\n"+
"4. Confirm it matches this expected preview (pushable activities only):\\n"+rows+"\\n"+
"5. On my \\"go\\", run the same command with --execute (workflow mode=execute).\\n"+
"6. VERIFY: re-read the push report; confirm pushed count == matched students × pushable activities, no new unmatched, and spot-check 3 students' Canvas values against gradebook/grades.csv.\\n\\n"+
"## Reminder\\nHeld activities ("+(held.join(", ")||"none")+") stay out of this push. To deliver those to students later: review gradebook/notes/, set \\"publish\\": true on the ready ones, and run publish.yml.\\n";
 const d=el("div","drawer on"); const p=el("div","dp");
 p.innerHTML="<button class='x'>×</button><h3>Apply-grades prompt — "+esc(s.section)+"</h3><div class='sub'>Copy this into a chat with your grading assistant.</div><div style='margin:10px 0'><button class='act' id='cp'>Copy</button></div><pre id='ptxt'>"+esc(txt)+"</pre>";
 d.append(p); document.body.append(d);
 const close=()=>d.remove(); p.querySelector(".x").onclick=close; d.onclick=e=>{if(e.target===d)close()};
 $("#cp").onclick=()=>{navigator.clipboard.writeText(txt).then(()=>{$("#cp").textContent="Copied ✓"})};
}

function toggleTheme(){const r=document.documentElement;const cur=r.getAttribute("data-color-scheme")|| (matchMedia("(prefers-color-scheme:dark)").matches?"dark":"light");r.setAttribute("data-color-scheme",cur==="dark"?"light":"dark");render();}
function avg(a){const v=a.filter(x=>x!=null);return v.length?v.reduce((x,y)=>x+y,0)/v.length:null}
render();
`;}
