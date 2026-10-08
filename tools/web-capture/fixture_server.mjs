// Synthetic protocol fixture, deliberately not a production WebSocket server.
import http from 'node:http';
import {gzipSync} from 'node:zlib';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
export async function fixtureServer() {
  const seen=[], sockets=new Set();
  const server=http.createServer(async(req,res)=>{
    const url=new URL(req.url,'http://localhost');seen.push(url.pathname);
    if(url.pathname==='/validation'||url.pathname==='/scripts/web_probe.js'){const script=url.pathname.endsWith('.js');res.setHeader('Content-Type',script?'application/javascript':'text/html');res.end(fs.readFileSync(new URL(script?'../../scripts/web_probe.js':'../../references/web-validation.html',import.meta.url)));return;}
    const json=(value,status=200)=>{const body=JSON.stringify(value);res.writeHead(status,{'Content-Type':'application/json','Content-Length':Buffer.byteLength(body)});res.end(body);};
    if(url.pathname==='/') {
      res.setHeader('Content-Type','text/html');res.end(`<!doctype html><title>Synthetic feature</title>
      <input id="query"><button id="search">Search</button><button id="streams">Streams</button><button id="popup">Popup</button><output id="result"></output><button id="next">Next</button><output id="page-result"></output>
      <form id="form"><input name="email" type="email" required><button>Submit</button></form><output id="form-result"></output><iframe src="/frame"></iframe>
      <script>
      fetch('/background');
      let number=1;
      next.onclick=async()=>{const data=await fetch('/list?page='+ ++number).then(r=>r.json());document.querySelector('#page-result').textContent=data.page};
      form.onsubmit=async e=>{e.preventDefault();const data=await fetch('/form',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams(new FormData(form))}).then(r=>r.json());document.querySelector('#form-result').textContent=data.state};
      search.onclick=async()=>{
        await Promise.all(['/redirect','/empty','/error','/large','/unknown','/abort'].map(x=>fetch(x).catch(()=>null)));
        const data=await fetch('/graphql',{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer TEST-SECRET'},body:JSON.stringify({operationName:'Search',variables:{q:query.value,token:'TEST-SECRET'}})}).then(r=>r.json());
        document.querySelector('#result').textContent=data.state;
      };
      streams.onclick=()=>{
        const es=new EventSource('/events');es.addEventListener('result',()=>{es.close();document.body.dataset.sse='done'});
        const ws=new WebSocket(location.origin.replace('http','ws')+'/socket');ws.onopen=()=>ws.send(JSON.stringify({operationName:'Watch',token:'TEST-SECRET'}));ws.onmessage=()=>{document.body.dataset.ws='done';ws.close()};
      };
      popup.onclick=()=>window.open('/popup');
      </script>`);return;
    }
    if(['/gzip','/gzip-large','/jsonp','/cache'].includes(url.pathname)) {
      const text=JSON.stringify({state:'ready',token:'TEST-SECRET',value:url.pathname==='/gzip-large'?'x'.repeat(10000):'small'});
      const body=url.pathname==='/jsonp'?'/**/callbackStack.queue[0]('+text+');':text;
      const gzip=url.pathname.startsWith('/gzip');const bytes=gzip?gzipSync(body):Buffer.from(body);
      res.writeHead(200,{'Content-Type':url.pathname==='/jsonp'?'text/javascript':'application/json','Content-Length':bytes.length,...(gzip?{'Content-Encoding':'gzip'}:{}),...(url.pathname==='/cache'?{'Cache-Control':'public, max-age=3600'}:{})});res.end(bytes);return;
    }
    if(url.pathname==='/stream-worker.js') {
      res.setHeader('Content-Type','application/javascript');res.end(`
      let count=0;const done=()=>{if(++count===2)postMessage('done')};
      const es=new EventSource('/events');es.addEventListener('result',()=>{es.close();done()});
      const ws=new WebSocket(location.origin.replace('http','ws')+'/socket');ws.onopen=()=>ws.send('{"state":"worker"}');ws.onmessage=()=>{ws.close();done()};
      `);return;
    }
    if(url.pathname==='/stream-frame') {
      res.setHeader('Content-Type','text/html');res.end(`<script>
      let count=0;const done=()=>{if(++count===2)document.body.dataset.done='yes'};
      const es=new EventSource('/events');es.addEventListener('result',()=>{es.close();done()});
      const ws=new WebSocket(location.origin.replace('http','ws')+'/socket');ws.onopen=()=>ws.send('{"state":"frame"}');ws.onmessage=()=>{ws.close();done()};
      </script>`);return;
    }
    if(url.pathname==='/sw.js'){res.writeHead(200,{'Content-Type':'application/javascript'});res.end("self.addEventListener('install',()=>self.skipWaiting());self.addEventListener('activate',e=>e.waitUntil(self.clients.claim()));self.addEventListener('fetch',e=>{if(new URL(e.request.url).pathname==='/sw-data')e.respondWith(new Response(JSON.stringify({state:'cached'}),{headers:{'Content-Type':'application/json','Content-Length':'18'}}))});");return;}
    if(url.pathname==='/list'){json({page:Number(url.searchParams.get('page')),items:[]});return;}
    if(url.pathname==='/style.css'){const css='body {color: black}';res.writeHead(200,{'Content-Type':'text/css','Content-Length':css.length});res.end(css);return;}
    if(url.pathname==='/form'){json({state:'saved'});return;}
    if(url.pathname==='/redirect'){res.writeHead(302,{Location:'/final'});res.end();return;}
    if(url.pathname==='/empty'){res.writeHead(204);res.end();return;}
    if(url.pathname==='/abort'){req.socket.destroy();return;}
    if(url.pathname==='/unknown'){res.writeHead(200,{'Content-Type':'application/json'});res.write('{"state":');res.end('"ok"}');return;}
    if(url.pathname==='/events') {res.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-cache'});res.write('event: result\nid: private-id\ndata: {"state":"ready","token":"TEST-SECRET"}\n\n');req.on('close',()=>res.end());return;}
    if(url.pathname==='/graphql'){for await(const chunk of req){};json({state:'ready',token:'TEST-SECRET'});return;}
    if(url.pathname==='/large'){json({value:'x'.repeat(3000)});return;}
    if(url.pathname==='/error'){json({state:'error'},500);return;}
    if(url.pathname==='/frame'||url.pathname==='/popup'){res.setHeader('Content-Type','text/html');res.end('<p>Fixture child</p>');return;}
    json({state:'ok'});
  });
  server.on('connection',s=>{sockets.add(s);s.on('close',()=>sockets.delete(s));});
  server.on('upgrade',(req,socket)=>{
    seen.push('/socket');
    const accept=createHash('sha1').update(req.headers['sec-websocket-key']+'258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
    socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: '+accept+'\r\n\r\n');
    socket.once('data',()=>{const payload=Buffer.from('{"state":"ready","token":"TEST-SECRET"}');socket.write(Buffer.concat([Buffer.from([0x81,payload.length]),payload]));});
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  return {url:'http://127.0.0.1:'+server.address().port,seen,close:()=>new Promise(resolve=>{for(const socket of sockets)socket.destroy();server.close(resolve);})};
}
