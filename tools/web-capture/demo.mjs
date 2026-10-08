// Reproducible self-authored feature case. All artifacts go to the explicit output.
import {parseArgs} from 'node:util';
import fs from 'node:fs';
import path from 'node:path';
import {startCapture} from './capture.mjs';
import {fixtureServer} from './fixture_server.mjs';
const {values}=parseArgs({options:{out:{type:'string'}}});
if(!values.out)throw Error('Use node demo.mjs --out /outside/repo/new-directory');
const fixture=await fixtureServer();let capture;
try {
 capture=await startCapture({out:values.out,allowFields:['operationName','q','state','page'],allowQuery:['page'],bodyLimit:1024});
 const c=capture;
 await c.action('open',p=>p.goto(fixture.url));
 await c.action('search',async p=>{await p.locator('#query').fill('book');await p.locator('#search').click();await p.waitForFunction(()=>document.querySelector('#result').textContent==='ready');});
 await c.action('page',async p=>{await p.locator('#next').click();await p.waitForFunction(()=>document.querySelector('#page-result').textContent==='2');});
 await c.action('invalid-form',p=>p.locator('#form button').click());
 await c.action('form',async p=>{await p.locator('[name=email]').fill('private@example.test');await p.locator('#form button').click();await p.waitForFunction(()=>document.querySelector('#form-result').textContent==='saved');});
 await c.action('streams',async p=>{await p.locator('#streams').click();await p.waitForFunction(()=>document.body.dataset.sse==='done'&&document.body.dataset.ws==='done');});
 await c.stop();
 const evidence=[],claims=[],questions=[];
 for(const [id,endpoint,action,text] of [['search','/graphql','search','Search sends a named operation and renders ready.'],['page','/list','page','Next requests page 2 and renders 2.'],['form','/form','form','Valid form submits URL-encoded fields and renders saved.']]) {
   const r=c.store.records.find(r=>new URL(r.url).pathname===endpoint);
   if(!r||r.body_status!=='captured')throw Error('Missing fixture evidence '+endpoint);
   questions.push({id,text,critical:true});
   evidence.push({id:'e-'+id,source:'browser',kind:'network',locator:{target:'network.jsonl',position:r.request_id,session_id:c.store.session,request_id:r.request_id,action_id:action,body_status:r.body_status},observation:text,observed_at:r.started_at,conditions:['Self-authored fixture; no external service'],limitations:['Action association alone is a time-window candidate; UI completion is separately awaited in demo.mjs.']});
   claims.push({id:'c-'+id,question_id:id,text,scope:'runtime',basis:'direct',status:'PASS',evidence_ids:['e-'+id],rationale:'Captured request plus awaited known UI state in the fixture runner.',alternatives:[]});
 }
 c.store.write('report.json',{schema_version:1,context:{product:'Self-authored Web feature fixture',platform:'Chromium',version:c.browser.version(),goal:'Observe search, pagination, form validation and streaming',observed_at:c.store.manifest.started_at,target_depth:'L3',achieved_depth:'L3',gaps:['Synthetic implementation does not generalize to any competitor.','Full service-worker/cross-origin streaming coverage is not established.']},questions,evidence,claims,coverage:[{target:'Search/page/form/SSE/WebSocket',status:'observed',reason:'Real local HTTP server and real Chromium; server and client source in fixture_server.mjs.'},{target:'Production architecture',status:'not_observed',reason:'This fixture has no production backend.'}]});
 const timeline=c.store.actions.map(a=>`| ${a.action_id} | ${(a.end_ms-a.start_ms).toFixed(1)} | ${a.status} |`).join('\n');
 fs.writeFileSync(path.join(c.store.out,'report.md'),`# Synthetic Web feature report\n\nSession: ${c.store.session}. Environment and truncation: manifest.json.\n\n${fs.readFileSync(new URL('../../examples/web/feature-report.md',import.meta.url),'utf8')}\n\n## Actual action windows\n\nThese include UI automation and explicit state waits; they are not isolated server latency or calibrated user-perceived latency.\n\n| Action | Window ms | Status |\n|---|---:|---|\n${timeline}\n`,{mode:0o600});
 console.log(JSON.stringify({out:c.store.out,requests:c.store.records.length,stream_events:c.store.streams.length}));
} finally {if(capture)await capture.stop();await fixture.close();}
