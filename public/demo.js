import { digits, statistics } from './domain.js';
/** Isolado do backend: somente demonstração, sem resultados fiscais reais. */
const clients = [{_id:'demo-comercio',name:'Carteira · Comércio',cnpj:null,active:true,notes:'Exemplo fictício de carteira comercial.'},{_id:'demo-servicos',name:'Carteira · Serviços',cnpj:null,active:true,notes:'Exemplo fictício de carteira de serviços.'},{_id:'demo-industria',name:'Carteira · Indústria',cnpj:null,active:true,notes:'Exemplo fictício de carteira industrial.'}];
const names=['Horizonte Comércio','Aurora Serviços','Norte Sul Distribuidora','Alameda Soluções','Raiz Consultoria','Lume Tecnologia','Ponto Azul','Ateliê Central','Nova Estação','Caminho Indústria','Casa Jardim','Estúdio Maré'];
const entries=Array.from({length:36},(_,i)=>{const base=String(88000000+i).padStart(8,'0')+'0001';return {cnpj:base+digits(base),name:names[i%12]+' · fictícia',status:i%9===0?'NAO_CONFIRMADO':i%3===0?'NAO_OPTANTE':'OPTANTE',mei:i%5===0 && i%3!==0,reason:i%9===0?'NAO_ENCONTRADO':null,clientId:clients[Math.floor(i/12)]._id,observedAt:'2026-09-24T10:00:00.000Z',source:{table:'DEMONSTRAÇÃO — não consultado',referenceDate:'2026-08-01'}};});
const batches=clients.flatMap((client,i)=>[0,1].map((n)=>{const records=entries.filter(e=>e.clientId===client._id),date=`2026-09-${24-i-n*7}T10:00:00.000Z`;return {_id:`demo-lote-${i}-${n}`,clientId:client._id,clientName:client.name,fileName:`base_${['comercio','servicos','industria'][i]}_${n?'anterior':'setembro'}.xlsx`,createdAt:date,completedAt:date,startedAt:date,status:'COMPLETED',expectedRows:15,uploaded:15,received:12,summary:{lines:15,unique:12,invalid:1,duplicates:2},resultSummary:statistics(records),estimate:{source:{table:'DEMONSTRAÇÃO — não consultado',referenceDate:'2026-08-01'}},version:'0.2.0'};})).sort((a,b)=>b.createdAt.localeCompare(a.createdAt));
export function demoRequest(path) {
 const url=new URL(path,location.origin),client=url.searchParams.get('clientId');
 const selected=client?entries.filter(e=>e.clientId===client):entries;
 const filtered=client?batches.filter(b=>b.clientId===client):batches;
 if(url.pathname==='/api/auth/me')return {user:{_id:'demo',name:'Equipe Maximum',email:'Demonstração visual',role:'admin'},version:'0.2.0'};
 if(url.pathname==='/api/clients')return {items:clients};
 if(url.pathname==='/api/dashboard')return {metrics:statistics(selected),recent:filtered,clientCount:clients.length,batchCount:filtered.length};
 if(url.pathname==='/api/batches')return {items:filtered,total:filtered.length,page:1};
 if(url.pathname==='/api/settings')return {version:'0.2.0',workspace:'Demonstração',source:{approved:false,table:'OpenCNPJ / BigQuery (não conectado)',referenceDate:null,location:null,maximumBytesBilled:null},maxRows:50000,history:'Demonstração: nenhuma consulta fiscal executada.'};
 if(url.pathname==='/api/users')return {items:[]};
 if(url.pathname==='/api/audit')return {items:[]};
 const match=url.pathname.match(/^\/api\/batches\/([^/]+)(?:\/(results|export))?$/);
 if(match){const b=batches.find(b=>b._id===match[1]);if(!b)throw new Error('Lote de demonstração não encontrado.');if(!match[2])return b;
 let results=entries.filter(e=>e.clientId===b.clientId);const status=url.searchParams.get('status'),search=(url.searchParams.get('search')||'').toLowerCase();if(status)results=results.filter(e=>e.status===status);if(search)results=results.filter(e=>(e.cnpj+e.name).toLowerCase().includes(search));
 if(match[2]==='results')return {items:results,total:results.length,page:1};
 return {headers:['CNPJ','RAZAO_SOCIAL','SITUACAO','AMBIENTE'],rows:results.map(r=>[r.cnpj,r.name,r.status,'FICTÍCIO — NÃO É CONSULTA FISCAL']),next:null};}
 throw new Error('Esta ação não está disponível na demonstração.');
}
