import { AppError, need } from './security.ts';
import { classify, MAX_ROWS, normalizeCnpj, ADAPTER_VERSION } from './domain.ts';
import type { Result } from './domain.ts';
export type Config = { project: string; table: string; location: string; maxBytes: string; referenceDate: string | null; yes: string[]; no: string[] };
export type Transport = (method: 'GET' | 'POST', path: string, data?: unknown) => Promise<any>;
export function configuration(approved = true): Config {
  const project = process.env.GOOGLE_CLOUD_PROJECT || '', table = process.env.BQ_SOURCE_TABLE || 'opencnpj-bigquery.public.receita';
  const location = process.env.BQ_LOCATION || '', maxBytes = process.env.BQ_MAXIMUM_BYTES_BILLED || (approved ? '' : '0');
  need(/^[a-z][a-z0-9-]{4,61}[a-z0-9]$/.test(project), 'Configure GOOGLE_CLOUD_PROJECT.', 503, 'SOURCE_CONFIG');
  need(/^[a-z][a-z0-9-]+\.[A-Za-z_][\w]*\.[A-Za-z_][\w]*$/.test(table), 'Referência da tabela inválida.', 503, 'SOURCE_CONFIG');
  need((!approved && !location) || /^[a-zA-Z0-9-]+$/.test(location), 'Verifique e configure BQ_LOCATION.', 503, 'SOURCE_CONFIG');
  need(/^\d{1,18}$/.test(maxBytes) && (!approved || BigInt(maxBytes) > 0n), 'Defina o teto BQ_MAXIMUM_BYTES_BILLED.', 503, 'SOURCE_CONFIG');
  if (approved) need(process.env.BQ_SOURCE_APPROVED === 'true', 'Fonte ainda não homologada. Execute verify:source e confira os valores antes de liberar consultas.', 503, 'SOURCE_NOT_APPROVED');
  let yes: unknown, no: unknown;
  try { yes = JSON.parse(process.env.BQ_FLAG_TRUE || '["S","SIM","TRUE","1"]'); no = JSON.parse(process.env.BQ_FLAG_FALSE || '["N","NAO","NÃO","FALSE","0"]'); } catch { throw new AppError(503, 'SOURCE_CONFIG', 'Mapeamento dos indicadores inválido.'); }
  const flags = (v: unknown): v is string[] => Array.isArray(v) && v.length > 0 && v.every(x => typeof x === 'string' && x.trim() && x.length < 30);
  need(flags(yes) && flags(no), 'Mapeamento dos indicadores inválido.', 503);
  yes = yes.map(v => v.trim().toUpperCase()); no = no.map(v => v.trim().toUpperCase());
  need(!(yes as string[]).some(v => (no as string[]).includes(v)), 'Os indicadores positivo e negativo se sobrepõem.', 503);
  const referenceDate = process.env.BQ_SOURCE_REFERENCE_DATE || null;
  need(!referenceDate || (/^\d{4}-\d{2}-\d{2}$/.test(referenceDate) && !Number.isNaN(Date.parse(referenceDate)) && new Date(referenceDate).toISOString().slice(0,10) === referenceDate && Date.parse(referenceDate) <= Date.now()), 'Data de referência inválida ou futura.', 503);
  return { project, table, location, maxBytes, referenceDate, yes: yes as string[], no: no as string[] };
}
let transportClient: any;
export const googleTransport: Transport = async (method, path, data) => {
  if (!transportClient) {
    const { GoogleAuth } = await import('google-auth-library');
    let credentials;
    try { credentials = process.env.GOOGLE_CREDENTIALS_JSON ? JSON.parse(process.env.GOOGLE_CREDENTIALS_JSON) : undefined; }
    catch { throw new AppError(503, 'GOOGLE_CREDENTIALS', 'JSON da credencial inválido no servidor.'); }
    transportClient = await new GoogleAuth({ credentials, scopes: ['https://www.googleapis.com/auth/bigquery'] }).getClient();
  }
  try {
    const response = await transportClient.request({ url: 'https://bigquery.googleapis.com/bigquery/v2/' + path, method, data, timeout: 18000, retry: false });
    return response.data;
  } catch (e: any) {
    const status = e.response?.status || 503;
    throw new AppError(status === 409 ? 409 : status === 429 ? 429 : 502, `BIGQUERY_${status}`, status === 403 ? 'Acesso negado no BigQuery. Confira IAM, faturamento e limites.' : status === 404 ? 'Tabela ou job não encontrado no BigQuery.' : 'O BigQuery não concluiu a requisição. É seguro tentar retomar o mesmo lote.');
  }
};
export function buildQuery(c: Config, values: string[]) {
  const cnpjs = [...new Set(values)];
  need(cnpjs.length > 0 && cnpjs.length <= MAX_ROWS && cnpjs.every(v => normalizeCnpj(v).valid && normalizeCnpj(v).cnpj === v), 'Lote de CNPJs inválido.');
  const query = `WITH requested AS (SELECT cnpj FROM UNNEST(@cnpjs) AS cnpj),\nsource AS (SELECT cnpj, COUNT(*) AS sourceCount, ANY_VALUE(razao_social) AS name,\n ANY_VALUE(CAST(opcao_simples AS STRING)) AS simples, ANY_VALUE(CAST(opcao_mei AS STRING)) AS mei,\n ANY_VALUE(CAST(data_opcao_simples AS STRING)) AS optionDate, ANY_VALUE(CAST(data_opcao_mei AS STRING)) AS meiDate\n FROM \`${c.table}\` WHERE cnpj IN UNNEST(@cnpjs) GROUP BY cnpj)\nSELECT r.cnpj, s.name, s.simples, s.mei, s.optionDate, s.meiDate, IFNULL(s.sourceCount, 0) AS sourceCount\nFROM requested r LEFT JOIN source s USING(cnpj) ORDER BY r.cnpj`;
  return { query, useLegacySql: false, parameterMode: 'NAMED', queryParameters: [{ name: 'cnpjs', parameterType: { type: 'ARRAY', arrayType: { type: 'STRING' } }, parameterValue: { arrayValues: cnpjs.map(value => ({ value })) } }], maximumBytesBilled: c.maxBytes, useQueryCache: true };
}
export class BigQuerySource {
  config: Config; transport: Transport;
  constructor(config = configuration(), transport = googleTransport) { this.config = config; this.transport = transport; }
  async inspect() {
    const [project, dataset, table] = this.config.table.split('.');
    const data = await this.transport('GET', `projects/${project}/datasets/${dataset}/tables/${table}`);
    const fields = data.schema?.fields || [];
    const required = ['cnpj','razao_social','opcao_simples','opcao_mei','data_opcao_simples','data_opcao_mei'];
    need(required.every(n => fields.some((f: any) => f.name === n && f.mode !== 'REPEATED' && f.type !== 'RECORD')), 'Schema da fonte incompatível. Consultas bloqueadas até revisar o adaptador.', 503, 'SOURCE_SCHEMA');
    need(fields.find((f: any) => f.name === 'cnpj')?.type === 'STRING', 'CNPJ na fonte precisa ser STRING, preservando zeros e letras.', 503, 'SOURCE_SCHEMA');
    need(!this.config.location || data.location?.toLowerCase() === this.config.location.toLowerCase(), `Localização divergente. A tabela informa ${String(data.location || 'desconhecida')}.`, 503, 'SOURCE_LOCATION');
    need(typeof data.etag === 'string' && data.etag.length > 0, 'Metadados sem versão da tabela.', 502, 'SOURCE_ETAG');
    const ageDays = this.config.referenceDate ? Math.floor((Date.now()-Date.parse(this.config.referenceDate))/86400000) : null;
    return { ageDays, stale: ageDays === null ? null : ageDays > (Number(process.env.SOURCE_MAX_AGE_DAYS) || 60), table: this.config.table, location: data.location, etag: data.etag, modifiedAt: data.lastModifiedTime, fields, referenceDate: this.config.referenceDate, adapter: ADAPTER_VERSION };
  }
  async estimate(values: string[]) {
    const source = await this.inspect();
    const data = await this.transport('POST', `projects/${this.config.project}/jobs`, { jobReference: { projectId: this.config.project, location: this.config.location }, configuration: { dryRun: true, query: buildQuery(this.config, values) } });
    const bytes = String(data.statistics?.query?.totalBytesProcessed ?? data.statistics?.totalBytesProcessed ?? '');
    need(/^\d+$/.test(bytes), 'O provedor não informou a estimativa de consumo.', 502, 'ESTIMATE_MISSING');
    return { bytes, withinLimit: BigInt(bytes) <= BigInt(this.config.maxBytes), maximumBytesBilled: this.config.maxBytes, source };
  }
  async start(jobId: string, values: string[]) {
    need(/^maximum_[a-f0-9]{32}$/.test(jobId), 'ID do job inválido.');
    try { return await this.transport('POST', `projects/${this.config.project}/jobs`, { jobReference: { projectId: this.config.project, jobId, location: this.config.location }, configuration: { query: buildQuery(this.config, values) } }); }
    catch (e) { if (e instanceof AppError && e.status === 409) return this.job(jobId); throw e; }
  }
  async job(jobId: string) { return this.transport('GET', `projects/${this.config.project}/jobs/${encodeURIComponent(jobId)}?location=${encodeURIComponent(this.config.location)}`); }
  async page(jobId: string, pageToken?: string): Promise<{ running: boolean; results: Result[]; next: string | null; total: number; billed: string | null }> {
    const q = new URLSearchParams({ location: this.config.location, maxResults: '1000', timeoutMs: '0' });
    if (pageToken) q.set('pageToken', pageToken);
    const data = await this.transport('GET', `projects/${this.config.project}/queries/${encodeURIComponent(jobId)}?${q}`);
    if (!data.jobComplete) return { running: true, results: [], next: null, total: 0, billed: null };
    need(!data.errors?.length, 'A consulta retornou erros. Nenhum resultado será publicado.', 502, 'QUERY_FAILED');
    const fields = data.schema?.fields?.map((f: any) => f.name);
    need(Array.isArray(fields), 'Resposta do BigQuery sem schema.', 502, 'QUERY_SCHEMA');
    const results = (data.rows || []).map((row: any) => classify(Object.fromEntries(fields.map((f: string, i: number) => [f, row.f[i]?.v ?? null])), this.config.yes, this.config.no));
    return { running: false, results, next: data.pageToken || null, total: Number(data.totalRows || 0), billed: data.totalBytesProcessed || null };
  }
  async cancel(jobId: string) { return this.transport('POST', `projects/${this.config.project}/jobs/${encodeURIComponent(jobId)}/cancel?location=${encodeURIComponent(this.config.location)}`, {}); }
}
