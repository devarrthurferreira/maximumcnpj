import { AppError } from './security.ts';

// Do not copy driver messages, command payloads, connection strings or stacks to
// logs. Mongo messages can contain the document or credentials that caused them.
const classes = new Set([
  'Error', 'TypeError', 'RangeError', 'SyntaxError', 'ReferenceError',
  'MongoError', 'MongoServerError', 'MongoBulkWriteError', 'MongoClientBulkWriteError',
  'MongoNetworkError', 'MongoNetworkTimeoutError', 'MongoServerSelectionError',
  'MongoOperationTimeoutError', 'MongoNotConnectedError', 'MongoServerClosedError',
  'MongoTopologyClosedError', 'MongoClientClosedError', 'MongoWriteConcernError',
  'MongoParseError', 'MongoInvalidArgumentError', 'MongoMissingCredentialsError'
]);
const codeNames = new Set([
  'MaxTimeMSExpired', 'ExceededTimeLimit', 'NetworkTimeout', 'HostUnreachable',
  'HostNotFound', 'ShutdownInProgress', 'InterruptedAtShutdown',
  'InterruptedDueToReplStateChange', 'DuplicateKey', 'AtlasError'
]);
const connectionClasses = new Set([
  'MongoNetworkError', 'MongoNetworkTimeoutError', 'MongoServerSelectionError',
  'MongoNotConnectedError', 'MongoServerClosedError', 'MongoTopologyClosedError', 'MongoClientClosedError'
]);

type FailureCategory = 'timeout' | 'connection' | 'storage_limit' | 'unexpected';
type Diagnostic = {category: FailureCategory; name: string; code?: number; codeName?: string};
export type ServiceFailure = {app: AppError; retryable?: boolean; diagnostic?: Diagnostic};

/** Preserve public application errors; expose only a fixed taxonomy for unexpected failures. */
export function serviceFailure(error: unknown): ServiceFailure {
  if (error instanceof AppError) return {app: error};
  const value = error && typeof error === 'object' ? error as Record<string, unknown> : {};
  // Keep the established duplicate-write contract, without revealing index keys.
  if (value.code === 11000) return {app: new AppError(409, 'DUPLICATE', 'Este registro já existe. Atualize a página.')};

  const name = typeof value.name === 'string' && classes.has(value.name) ? value.name : 'UnknownError';
  const mongo = name.startsWith('Mongo');
  const diagnostic: Diagnostic = {category: 'unexpected', name,
    ...(mongo && typeof value.code === 'number' && Number.isSafeInteger(value.code) && value.code >= 0 && value.code <= 1000000 ? {code: value.code} : {}),
    ...(mongo && typeof value.codeName === 'string' && codeNames.has(value.codeName) ? {codeName: value.codeName} : {})};
  // Atlas documents this exact server-side quota failure. Inspect it only to
  // classify the error; never return or log the original text or storage values.
  if (mongo && typeof value.message === 'string' && /you are over your space quota/i.test(value.message)) {
    diagnostic.category = 'storage_limit';
    return {app: new AppError(503, 'DATABASE_STORAGE_LIMIT',
      'O banco de dados atingiu o limite de armazenamento. O envio não pode continuar até a capacidade ser ajustada. Os dados já salvos foram preservados.'),
      retryable: false, diagnostic};
  }
  if (mongo && (name === 'MongoOperationTimeoutError' || value.code === 50 || value.code === 262 ||
      value.codeName === 'MaxTimeMSExpired' || value.codeName === 'ExceededTimeLimit')) {
    diagnostic.category = 'timeout';
    return {app: new AppError(503, 'DATABASE_TIMEOUT',
      'O banco de dados excedeu o tempo desta etapa. Tente novamente para continuar do progresso já salvo.'), retryable: true, diagnostic};
  }
  if (connectionClasses.has(name)) {
    diagnostic.category = 'connection';
    return {app: new AppError(503, 'DATABASE_UNAVAILABLE',
      'A conexão com o banco de dados está temporariamente indisponível. Tente novamente em instantes; o progresso já salvo será preservado.'),
      retryable: true, diagnostic};
  }
  return {app: new AppError(503, 'SERVICE_UNAVAILABLE',
    'Não foi possível concluir esta operação. Tente novamente; se persistir, informe o código da requisição para conferência.'),
    retryable: false, diagnostic};
}
