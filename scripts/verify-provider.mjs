// One public business CNPJ from the provider's documentation; no user's list is sent.
import {lookupCnpj} from '../src/lookup-provider.ts';
try{const r=await lookupCnpj('33683111000280');console.log(JSON.stringify({source:r.source,cnpj:r.cnpj,status:r.status,checkedAt:new Date().toISOString(),note:'Teste de conectividade; não valida atualidade fiscal.'}));}
catch(e){console.error('Fonte indisponível nesta verificação: '+(e.code||e.message));process.exitCode=1;}
