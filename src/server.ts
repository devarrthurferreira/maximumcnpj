import http from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import { AppError, need, text, email, integer, token, digest, verifyPassword, hashPassword } from './security.ts';
import { collection, scope, workspace, rateLimit, audit, seed } from './store.ts';
import * as service from './service.ts';
import type { Actor } from './service.ts';
import { VERSION } from './domain.ts';
import { appOrigin, permittedOrigin } from './origins.ts';
import { routeV4 } from './lookup-http.ts';
import { provisionMaximumForLogin, provisionMaximumTeam } from './team.ts';
import { serveSimplesDocument } from './blob-documents.ts';
const PUBLIC = resolve(process.cwd(), 'public');
const cookieName = () => process.env.NODE_ENV === 'production' ? '__Host-maximum_session' : 'maximum_session';
const cookie = (value: string, age=43200) => `${cookieName()}=${value}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${age}${process.env.NODE_ENV==='production'?'; Secure':''}`;
const origin = appOrigin;
function json(res: ServerResponse, status: number, value: unknown) { res.writeHead(status, { 'Content-Type':'application/json; charset=utf-8', 'Cache-Control':'no-store' }); res.end(JSON.stringify(value)); }
async function body(req: IncomingMessage): Promise<any> {
  need((req.headers['content-type']||'').split(';')[0] === 'application/json', 'Envie JSON.', 415);
  const parsed=(req as IncomingMessage & {body?:unknown}).body;
  if(parsed !== undefined){ need(parsed && typeof parsed==='object' && !Array.isArray(parsed), 'JSON inválido.'); need(Buffer.byteLength(JSON.stringify(parsed))<=2800000, 'Parte acima do limite.', 413);return parsed; }
  const chunks: Buffer[]=[]; let size=0;
  for await (const chunk of req) { size+=chunk.length; need(size<=2800000, 'Parte do arquivo acima de 2,8 MB. Divida o envio.', 413); chunks.push(chunk); }
  try { const value=JSON.parse(Buffer.concat(chunks).toString('utf8')); need(value && typeof value==='object' && !Array.isArray(value), 'JSON inválido.'); return value; }
  catch (e) { if (e instanceof AppError) throw e; throw new AppError(400,'INVALID_JSON','JSON inválido.'); }
}
async function authentication(req: IncomingMessage): Promise<Actor & {mustChangePassword:boolean}> {
  const raw=(req.headers.cookie||'').split(';').map(v=>v.trim()).find(v=>v.startsWith(cookieName()+'='))?.slice(cookieName().length+1);
  need(raw && /^[\w-]{43}$/.test(raw), 'Entre para continuar.', 401, 'UNAUTHORIZED');
  const session=await (await collection('sessions')).findOne(scope({ _id:digest(raw), expiresAt:{$gt:new Date()} }));
  need(session, 'Sessão expirada. Entre novamente.', 401, 'UNAUTHORIZED');
  const user=await (await collection('users')).findOne(scope({ _id:session.userId, active:true }));
  need(user, 'Conta indisponível.', 401, 'UNAUTHORIZED');
  return { _id:user._id, name:user.name, email:user.email, role:user.role, mustChangePassword:user.mustChangePassword===true };
}
async function route(req: IncomingMessage, res: ServerResponse, url: URL) {
  const method=req.method||'GET', path=url.pathname;
  if (path==='/api/health' && method==='GET') return json(res,200,{ ok:true, version:VERSION });
  if (!['GET','HEAD'].includes(method)) need(permittedOrigin(req.headers), 'Origem da requisição não autorizada.', 403, 'ORIGIN');
  if (path==='/api/auth/login' && method==='POST') {
    const input=await body(req), account=email(input.email);
    await rateLimit('login-ip:'+digest(workspace()+':'+(req.socket.remoteAddress||'unknown')),100,15);
    await rateLimit('login-account:'+digest(workspace()+':'+account),10,15);
    await provisionMaximumForLogin(account,input.password);
    if(process.env.ADMIN_EMAIL?.trim().toLowerCase()===account && process.env.ADMIN_PASSWORD && typeof input.password==='string' && digest(input.password)===digest(process.env.ADMIN_PASSWORD) && !(await (await collection('users')).countDocuments(scope()))){
      try { await seed(); } catch(e:any) { if(e?.code!==11000 && e?.code!=='ADMIN_EXISTS')throw e; }
    }
    const user=await (await collection('users')).findOne(scope({ email:account, active:true }));
    const valid=await verifyPassword(input.password,user?.passwordHash || 'scrypt:00000000000000000000000000000000:'+ '0'.repeat(128));
    need(user && valid, 'E-mail ou senha incorretos.',401,'INVALID_LOGIN');
    const raw=token(); await (await collection('sessions')).insertOne({ _id:digest(raw), ...scope(), userId:user._id, expiresAt:new Date(Date.now()+43200000), createdAt:new Date() });
    res.setHeader('Set-Cookie',cookie(raw)); await audit(user._id,'auth.login',user._id);
    return json(res,200,{ ok:true });
  }
  if(path==='/api/auth/session' && method==='GET'){
    try {return json(res,200,{user:await authentication(req),version:VERSION});}catch(e){if(e instanceof AppError && e.status===401)return json(res,200,{user:null,version:VERSION});throw e;}
  }
  const actor=await authentication(req);
  if (path==='/api/auth/me' && method==='GET') return json(res,200,{ user:actor, version:VERSION });
  if (path==='/api/auth/logout' && method==='POST') {
    const raw=(req.headers.cookie||'').split(';').map(v=>v.trim()).find(v=>v.startsWith(cookieName()+'='))?.slice(cookieName().length+1)||'';
    await (await collection('sessions')).deleteOne(scope({ _id:digest(raw) })); res.setHeader('Set-Cookie',cookie('',0)); return json(res,200,{ ok:true });
  }
  if (path==='/api/auth/password' && method==='POST') {
    const input=await body(req), u=await (await collection('users')).findOne(scope({ _id:actor._id }));
    await rateLimit('password:'+actor._id,10,15);
    need(u && await verifyPassword(input.current,u.passwordHash),'Senha atual incorreta.',400);
    need(typeof input.password==='string' && input.password!==input.current,'Escolha uma nova senha diferente da senha atual.',400,'PASSWORD_REUSE');
    const passwordHash=await hashPassword(input.password);
    await (await collection('users')).updateOne(scope({ _id:actor._id }),{$set:{ passwordHash,mustChangePassword:false }});
    await (await collection('sessions')).deleteMany(scope({ userId:actor._id })); res.setHeader('Set-Cookie',cookie('',0));
    return json(res,200,{ ok:true });
  }
  need(!actor.mustChangePassword,'Redefina sua senha antes de continuar.',403,'PASSWORD_CHANGE_REQUIRED');
  if (!['GET','HEAD'].includes(method)) await rateLimit('write:'+actor._id,1200,15);
  const simplesFile=path.match(/^\/api\/v4\/simples-documents\/([a-f0-9-]{36})\/file$/);
  if(simplesFile && method==='GET') return serveSimplesDocument(actor,res,simplesFile[1],url.searchParams.get('kind')||'searchable');
  if(path.startsWith('/api/v4/'))return json(res,200,await routeV4(actor,method,url,method==='GET'?{}:await body(req)));
  const clientId=url.searchParams.get('clientId')||undefined, page=integer(url.searchParams.get('page')||1,1,100000);
  if (path==='/api/dashboard' && method==='GET') return json(res,200,await service.dashboard(clientId));
  if (path==='/api/clients' && method==='GET') return json(res,200,{ items:await service.clients() });
  if (path==='/api/clients' && method==='POST') return json(res,201,await service.saveClient(actor,await body(req)));
  const client=path.match(/^\/api\/clients\/([a-f0-9-]+)$/);
  if (client && method==='PATCH') return json(res,200,await service.saveClient(actor,await body(req),client[1]));
  if (path==='/api/batches' && method==='GET') return json(res,200,await service.listBatches(clientId,page));
  if (path==='/api/batches' && method==='POST') return json(res,201,await service.createBatch(actor,await body(req)));
  const b=path.match(/^\/api\/batches\/([a-f0-9-]+)(?:\/(rows|finalize|process|cancel|results|export))?$/);
  if (b) {
    const id=b[1], action=b[2];
    if (!action && method==='GET') return json(res,200,await service.batch(id));
    if (action==='results' && method==='GET') return json(res,200,await service.listResults(id,page,url.searchParams.get('status')||'',url.searchParams.get('search')||''));
    if (action==='export' && method==='GET') return json(res,200,await service.exportRows(id,integer(url.searchParams.get('offset')||0,0,50000)));
    if (method==='POST') {
      const input=await body(req);
      if (action==='rows') return json(res,200,await service.uploadRows(actor,id,input));
      if (action==='finalize') return json(res,200,await service.finishUpload(actor,id));
      if (action==='process') return json(res,200,await service.processBatch(actor,id));
      if (action==='cancel') return json(res,200,await service.cancel(actor,id));
    }
  }
  if (path==='/api/settings' && method==='GET') return json(res,200,{ version:VERSION, workspace:workspace(), mode:'API_MINIMAL_V1', maxRows:50000, source:'Minha Receita: resultados conforme a atualização da base externa.', database:'MongoDB', history:'Histórico de consultas e importações anteriores; não é histórico fiscal oficial.' });
  if (path==='/api/users' && method==='GET') { service.canAdmin(actor); return json(res,200,{ items:await (await collection('users')).find(scope()).project({ passwordHash:0 }).limit(100).toArray() }); }
  if (path==='/api/users/provision-maximum' && method==='POST') {
    service.canAdmin(actor);
    const input=await body(req);
    need(input.teamPassword===undefined || (typeof input.teamPassword==='string' && input.teamPassword.length>=8 && input.teamPassword.length<=128),'A senha temporária da equipe deve ter entre 8 e 128 caracteres.');
    need(input.adminPassword===undefined || (typeof input.adminPassword==='string' && input.adminPassword.length>=10 && input.adminPassword.length<=128),'A senha inicial do administrador deve ter entre 10 e 128 caracteres.');
    const config=('teamPassword' in input || 'adminPassword' in input) ? {teamPassword:input.teamPassword,adminPassword:input.adminPassword} : undefined;
    return json(res,200,await provisionMaximumTeam(config));
  }
  if (path==='/api/users' && method==='POST') {
    service.canAdmin(actor); const input=await body(req); need(['admin','operator','viewer'].includes(input.role),'Perfil inválido.');
    const id=randomUUID(); await (await collection('users')).insertOne({ _id:id,...scope(),name:text(input.name),email:email(input.email),passwordHash:await hashPassword(input.password),role:input.role,active:true,mustChangePassword:true,createdAt:new Date() });
    await audit(actor._id,'user.create',id); return json(res,201,{ id });
  }
  if (path==='/api/audit' && method==='GET') { service.canAdmin(actor); return json(res,200,{ items:await (await collection('audit')).find(scope()).sort({createdAt:-1}).limit(100).toArray() }); }
  throw new AppError(404,'NOT_FOUND','Rota não encontrada.');
}
export async function handler(req: IncomingMessage,res: ServerResponse) {
  const requestId=randomUUID();
  res.setHeader('X-Request-Id',requestId); res.setHeader('X-Content-Type-Options','nosniff'); res.setHeader('Referrer-Policy','same-origin'); res.setHeader('X-Frame-Options','DENY');
  res.setHeader('Permissions-Policy','camera=(), microphone=(), geolocation=()');
  res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self' https://*.private.blob.vercel-storage.com https://vercel.com/api/blob/; worker-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'");
  if(process.env.NODE_ENV==='production') res.setHeader('Strict-Transport-Security','max-age=31536000');
  try {
    const url=new URL(req.url||'/',origin());
    if(url.pathname.startsWith('/api/')) return await route(req,res,url);
    need(req.method==='GET'||req.method==='HEAD','Método não permitido.',405);
    const file=resolve(PUBLIC, '.'+(url.pathname==='/'?'/index.html':decodeURIComponent(url.pathname)));
    need(file.startsWith(PUBLIC+'/'),'Caminho inválido.',404);
    const allowed:Record<string,string>={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.txt':'text/plain; charset=utf-8','.woff2':'font/woff2'};
    need(allowed[extname(file)],'Arquivo não encontrado.',404);
    try { const s=await stat(file); need(s.isFile(),'Arquivo não encontrado.',404); const data=await readFile(file); res.writeHead(200,{'Content-Type':allowed[extname(file)],'Cache-Control':'no-cache'}); res.end(req.method==='HEAD'?undefined:data); }
    catch(e) { if(e instanceof AppError)throw e; throw new AppError(404,'NOT_FOUND','Arquivo não encontrado. Execute npm run build.'); }
  } catch(e:any) {
    const app=e instanceof AppError?e:e?.code===11000?new AppError(409,'DUPLICATE','Este registro já existe. Atualize a página.'):new AppError(503,'SERVICE_UNAVAILABLE','Serviço indisponível. Confira o MongoDB e as configurações do servidor.');
    console.error(JSON.stringify({requestId,code:app.code,status:app.status}));
    if(!res.headersSent)json(res,app.status,{ error:app.code,message:app.message,requestId }); else res.end();
  }
}
export function startServer(port=Number(process.env.PORT||3000)) {
  if(process.env.NODE_ENV==='production' && !/^https:\/\/[^/]+$/.test(origin())) throw new Error('APP_ORIGIN HTTPS obrigatório em produção, sem barra final.');
  const server=http.createServer(handler); server.requestTimeout=60000; server.headersTimeout=20000;
  return server.listen(port,'0.0.0.0',()=>console.log(`Maximum CNPJ ${VERSION} na porta ${port}`));
}
if(process.argv[1] && import.meta.url===pathToFileURL(resolve(process.argv[1])).href)startServer();
export default handler;
