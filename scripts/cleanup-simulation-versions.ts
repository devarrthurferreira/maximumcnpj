import {collection,scope,closeDatabase} from '../src/store.ts';
import {cleanupSavedVersions} from '../src/simulation-retention-admin.ts';

try{
  if(!process.argv.includes('--apply')){
    const simulations=await collection('simulations');
    const rows=await simulations.aggregate([{$match:scope({deletedAt:{$exists:false},analysisPublication:{$ne:'PENDING'}})},
      {$group:{_id:'$clientId',count:{$sum:1}}},{$group:{_id:null,companies:{$sum:1},obsolete:{$sum:{$max:[0,{$subtract:['$count',1]}]}}}}]).toArray();
    console.log(JSON.stringify({mode:'PREVIEW',...rows[0],revisionCopies:await(await collection('analysisRevisions')).countDocuments(scope()),
      apply:'npm run cleanup:versions -- --apply'}));
  }else{
    const administrator=await(await collection('users')).findOne(scope({role:'admin',active:true}),{projection:{_id:1,role:1,name:1,email:1}});
    if(!administrator)throw new Error('Nenhum administrador ativo neste workspace.');
    const result=await cleanupSavedVersions(administrator as any,{confirmed:true});
    console.log(JSON.stringify(result));if(result.failed.length)process.exitCode=1;
  }
}catch(error:any){console.error(error?.code||'RETENTION_FAILED');process.exitCode=1;}
finally{await closeDatabase();}
