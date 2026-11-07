// Local browser preview of the same React Native screens. Never used for hosting.
import { createServer, request } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
const root=fileURLToPath(new URL('../dist/',import.meta.url));
const backend=new URL(process.env.MOBILE_PREVIEW_BACKEND||'http://127.0.0.1:3002');
if(!['127.0.0.1','localhost'].includes(backend.hostname))throw Error('Preview proxy accepts only a local backend.');
const server=createServer(async(req,res)=>{
 if(req.url.startsWith('/api/')){
  const proxy=request(new URL(req.url,backend),{method:req.method,headers:{...req.headers,host:backend.host,origin:backend.origin}},upstream=>{res.writeHead(upstream.statusCode,upstream.headers);upstream.pipe(res);});
  proxy.on('error',()=>{res.writeHead(503,{'Content-Type':'application/json'});res.end(JSON.stringify({error:'Start npm run demo:mobile in the repository root.'}));});req.pipe(proxy);return;
 }
 const path=new URL(req.url,'http://localhost').pathname;
 const file=resolve(root,'.'+(path==='/'||!extname(path)?'/index.html':decodeURIComponent(path)));
 if(!file.startsWith(root)){res.writeHead(404);res.end();return;}
 try{const data=await readFile(file);res.writeHead(200,{'Content-Type':{'.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png','.ico':'image/x-icon','.ttf':'font/ttf','.json':'application/json'}[extname(file)]||'application/octet-stream','Cache-Control':'no-store'});res.end(data);}catch{res.writeHead(404);res.end('Not found');}
});server.listen(8082,'127.0.0.1',()=>console.log('Mobile browser preview: http://127.0.0.1:8082'));
