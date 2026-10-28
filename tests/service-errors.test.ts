import test from 'node:test';
import assert from 'node:assert/strict';
import {MongoServerError, MongoNetworkError, MongoNetworkTimeoutError, MongoOperationTimeoutError} from 'mongodb';
import {AppError} from '../src/security.ts';
import {serviceFailure} from '../src/service-errors.ts';

const privateText = 'mongodb+srv://private-user:synthetic-password@private-host/database?token=synthetic-token document=12345678000191';
const publicView = (failure: ReturnType<typeof serviceFailure>) => JSON.stringify({
  status:failure.app.status,code:failure.app.code,message:failure.app.message,retryable:failure.retryable,diagnostic:failure.diagnostic
});
function assertPrivate(failure: ReturnType<typeof serviceFailure>) {
  const value=publicView(failure);
  for(const secret of ['mongodb+', 'private-user', 'synthetic-password', 'private-host', 'synthetic-token', '12345678000191'])assert(!value.includes(secret));
}

test('Erros públicos e duplicidade conservam status, mensagem e contrato',()=>{
  const app=new AppError(409,'ANALYSIS_CONFLICT','Confira a análise salva.'),failure=serviceFailure(app);
  assert.equal(failure.app,app);assert.equal(failure.retryable,undefined);assert.equal(failure.diagnostic,undefined);
  const duplicate=serviceFailure(new MongoServerError({code:11000,errmsg:privateText}));
  assert.equal(duplicate.app.status,409);assert.equal(duplicate.app.code,'DUPLICATE');
  assert.equal(duplicate.app.message,'Este registro já existe. Atualize a página.');assertPrivate(duplicate);
});

test('Tempo excedido do MongoDB tem categoria própria sem mensagem privada',()=>{
  for(const [code,codeName]of [[50,'MaxTimeMSExpired'],[262,'ExceededTimeLimit']]as const){
    const failure=serviceFailure(new MongoServerError({code,codeName,errmsg:privateText}));
    assert.equal(failure.app.status,503);assert.equal(failure.app.code,'DATABASE_TIMEOUT');assert.equal(failure.retryable,true);
    assert.deepEqual(failure.diagnostic,{category:'timeout',name:'MongoServerError',code,codeName});assertPrivate(failure);
  }
  const timeout=serviceFailure(new MongoOperationTimeoutError(privateText));
  assert.equal(timeout.app.code,'DATABASE_TIMEOUT');assert.equal(timeout.retryable,true);assertPrivate(timeout);
});

test('Falha de conexão é recuperável e não revela dados do driver',()=>{
  for(const error of [new MongoNetworkError(privateText),new MongoNetworkTimeoutError(privateText),
    Object.assign(new Error(privateText),{name:'MongoServerSelectionError',reason:{uri:privateText}})]){
    const failure=serviceFailure(error);assert.equal(failure.app.code,'DATABASE_UNAVAILABLE');assert.equal(failure.retryable,true);
    assert.equal(failure.diagnostic?.category,'connection');assertPrivate(failure);
  }
});

test('Cota de armazenamento não é tratada como timeout ou reconexão',()=>{
  const failure=serviceFailure(new MongoServerError({code:8000,codeName:'AtlasError',errmsg:'you are over your space quota, using 513 MB of 512 MB '+privateText}));
  assert.equal(failure.app.status,503);assert.equal(failure.app.code,'DATABASE_STORAGE_LIMIT');assert.equal(failure.retryable,false);
  assert.equal(failure.diagnostic?.category,'storage_limit');assert.match(failure.app.message,/capacidade/);
  assert(!publicView(failure).includes('513'));assertPrivate(failure);
});

test('Falha desconhecida não acusa o MongoDB nem vaza nomes, mensagens ou stack',()=>{
  const unknown=Object.assign(new TypeError(privateText),{code:50,codeName:privateText,stack:privateText,command:{password:privateText}});
  const failure=serviceFailure(unknown);
  assert.equal(failure.app.code,'SERVICE_UNAVAILABLE');assert.equal(failure.retryable,false);
  assert.deepEqual(failure.diagnostic,{category:'unexpected',name:'TypeError'});assert.doesNotMatch(failure.app.message,/MongoDB|banco de dados/);assertPrivate(failure);
  const hostile=serviceFailure({name:privateText,codeName:privateText,message:privateText});
  assert.deepEqual(hostile.diagnostic,{category:'unexpected',name:'UnknownError'});assertPrivate(hostile);
  const notMongo=serviceFailure(Object.assign(new Error('you are over your space quota'),{code:8000}));
  assert.equal(notMongo.app.code,'SERVICE_UNAVAILABLE');
});
