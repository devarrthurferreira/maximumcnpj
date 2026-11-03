import {test as base} from '@playwright/test';
import {MongoClient} from 'mongodb';
import {digest} from '../../src/security.ts';

const loopback=(hostname:string)=>['localhost','127.0.0.1','[::1]'].includes(hostname);
const syntheticScope=(value:string)=>value==='ci'||/(?:^|_)(?:e2e|test|tests|synthetic|validation)(?:_|$)/i.test(value);

// These persistence scenarios must authenticate again in a fresh browser context.
// Isolate their login counters from unrelated scenarios sharing the CI loopback IP.
// Application limits remain unchanged and active throughout each individual test.
export const test=base.extend<{loginLimitsIsolation:void}>({
  loginLimitsIsolation:[async({baseURL},use)=>{
    const uri=process.env.MONGODB_URI,database=process.env.MONGODB_DB,workspace=process.env.WORKSPACE_ID;
    const account=process.env.ADMIN_EMAIL?.trim().toLowerCase();
    if(!uri||!database||!workspace||!account||!baseURL)
      throw new Error('Login isolation requires the disposable MongoDB and synthetic CI account environment.');
    const mongoUrl=new URL(uri),applicationUrl=new URL(baseURL);
    if(mongoUrl.protocol!=='mongodb:'||!loopback(mongoUrl.hostname)||
      applicationUrl.protocol!=='http:'||!loopback(applicationUrl.hostname)||
      !syntheticScope(database)||!syntheticScope(workspace)||!account.endsWith('@example.test'))
      throw new Error('Login isolation is restricted to loopback services, test database/workspace and an @example.test account.');
    const bucket=Math.floor(Date.now()/(15*60_000));
    const keys=[
      ...['127.0.0.1','::1','::ffff:127.0.0.1'].map(ip=>'login-ip:'+digest(workspace+':'+ip)),
      'login-account:'+digest(workspace+':'+account)
    ].map(key=>`${key}:${bucket}`);
    const mongo=new MongoClient(uri,{serverSelectionTimeoutMS:5000});
    try{
      await mongo.connect();
      await mongo.db(database).collection<{_id:string;count:number}>('limits').deleteMany({_id:{$in:keys}});
    }finally{await mongo.close();}
    await use();
  },{auto:true}]
});
