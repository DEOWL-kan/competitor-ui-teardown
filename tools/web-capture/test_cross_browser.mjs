import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {startCapture} from './capture.mjs';
import {fixtureServer} from './fixture_server.mjs';

for(const browserName of ['firefox','webkit'])test(browserName+' HTTP/DOM/WebSocket and explicit CDP absence',{timeout:60000},async()=>{
  const root=await mkdtemp(path.join(tmpdir(),'web-'+browserName+'-')),fixture=await fixtureServer();let c;
  try {
    c=await startCapture({out:path.join(root,'out'),browserName,selector:'#query',allowFields:['state']});
    await c.page.goto(fixture.url+"/validation");
    assert.equal(await c.page.evaluate(()=>window.probeTest?.ok),true,"known DOM/style/animation truth fixture");
    await c.page.goto(fixture.url);
    await c.action('search',async p=>{await p.locator('#query').fill('book');await p.locator('#search').click();await p.waitForFunction(()=>document.querySelector('#result').textContent==='ready');});
    await c.action('streams',async p=>{await p.locator('#streams').click();await p.waitForFunction(()=>document.body.dataset.sse==='done'&&document.body.dataset.ws==='done');});
    await c.stop();
    assert.equal(c.store.records.find(r=>new URL(r.url).pathname==='/graphql').body.value.state,'ready');
    for(const direction of ['sent','received'])assert(c.store.streams.some(e=>e.kind==='websocket-frame'&&e.direction===direction&&e.body_status==='captured'));
    const snapshot=JSON.parse(await readFile(path.join(root,'out',c.store.actions[0].after.json),'utf8'));
    assert.equal(snapshot.elements[0].id,'query');assert(snapshot.elements[0].rect.width>0);
    assert.equal(c.store.manifest.capabilities.cdp,false);assert.equal(c.store.manifest.capabilities.native_eventsource,false);
    console.log(browserName+' '+c.browser.version());
  }finally {if(c)await c.stop();await fixture.close();await rm(root,{recursive:true,force:true});}
});
