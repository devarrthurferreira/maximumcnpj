import {parseIcmsOperations,projectIcmsOperations} from './simulator-icms.js';
import {REGIME_IDS,REGIME_LABELS,parseRegimeSelection,resolveRegimeSelection,requiresSimplesReference,regimeMemoryApplies,regimeWarningApplies} from './regime-selection.js';

/**
 * Maximum simulator: faithful JavaScript port of the existing calculadora model.
 * Source: devarrthurferreira/calculadora@d60e8bc3b2edcc2ebd4ff11cf584689f01d0d381
 * Files: src/lib/tax/{constants,engine,schema}.ts and src/lib/simulation.ts.
 * Monthly revenue context, explicit local-tax treatment and versioned scenario
 * defaults extend the original projection. Schema validation has no dependencies.
 * Forecast assumptions only; this port does not establish fiscal eligibility.
 */
export const CALCULATOR_SOURCE_COMMIT = 'd60e8bc3b2edcc2ebd4ff11cf584689f01d0d381';

export const DEFAULT_RATES = {
    cbs: 0.113,
    ibs: 0.001,
    icms: 0.18,
    iss: 0.05,
    payroll: 0.278,
    irSales: 0.08,
    csSales: 0.12,
    irServices: 0.32,
    csServices: 0.32
};
export const MODEL_VERSION = '1.17.0-dre-sales-difal-sync';
export const SIMPLES_DIAGNOSTIC_VERSION = 'SIMPLES_DIAGNOSTIC_V1';
export const REVENUE_CONTEXT_VERSION = 'SIMPLES_REVENUE_CONTEXT_V1';
export const ICMS_ANTICIPATION_VERSION = 'ICMS_ANTICIPATION_DRE_V1';
export const DIFAL_POLICY_VERSION = 'DIFAL_SCENARIOS_V2';
const LEGACY_DIFAL_POLICY_VERSION = 'DIFAL_SCENARIOS_V1';
const DIFAL_REGIME_IDS = Object.freeze(['pure','hybrid']);
const DIFAL_OPERATIONS = Object.freeze(['entry','exit']);
export const MONTHS = 12;
export const SUBLIMIT = 3_600_000;
export const SIMPLES_LIMIT = 4_800_000;
export const PRESUMPTION_LIMIT = 5_000_000;
export const PRESUMED_ELIGIBILITY_REFERENCE = 78_000_000;
export const PRESUMPTION_INCREASE = 0.1;
export const IRPJ_RATE = 0.15;
export const IRPJ_ADDITIONAL_RATE = 0.1;
export const IRPJ_ADDITIONAL_BASE = 240_000;
export const CSLL_RATE = 0.09;
export const DAS_ISS_CAP = 0.05;
const ceilings = [
    180_000,
    360_000,
    720_000,
    1_800_000,
    3_600_000,
    4_800_000
];
function table(nominal, deduction, cbs, ibs, local, ipi = [
    0,
    0,
    0,
    0,
    0,
    0
]) {
    return ceilings.map((ceiling, i)=>({
            ceiling,
            nominal: nominal[i],
            deduction: deduction[i],
            cbsShare: cbs[i],
            ibsShare: ibs[i],
            localShare: local[i],
            ipiShare: ipi[i]
        }));
}
export const TAX_BANDS = {
    1: table([
        .04,
        .073,
        .095,
        .107,
        .143,
        .189
    ], [
        0,
        5940,
        13860,
        22500,
        87300,
        378000
    ], [
        .1533,
        .1533,
        .1533,
        .1533,
        .1533,
        .3402
    ], [
        .0017,
        .0017,
        .0017,
        .0017,
        .0017,
        0
    ], [
        .34,
        .34,
        .335,
        .335,
        .335,
        0
    ]),
    2: table([
        .045,
        .078,
        .10,
        .112,
        .147,
        .299
    ], [
        0,
        5940,
        13860,
        22500,
        85500,
        720000
    ], [
        .1385,
        .1385,
        .1385,
        .1385,
        .1385,
        .2522
    ], [
        .0015,
        .0015,
        .0015,
        .0015,
        .0015,
        0
    ], [
        .32,
        .32,
        .32,
        .32,
        .32,
        0
    ], [
        .075,
        .075,
        .075,
        .075,
        .075,
        .3513
    ]),
    3: table([
        .06,
        .112,
        .135,
        .16,
        .21,
        .329
    ], [
        0,
        9360,
        17640,
        35640,
        125640,
        648000
    ], [
        .1543,
        .1691,
        .1641,
        .1641,
        .1543,
        .1929
    ], [
        .0017,
        .0019,
        .0019,
        .0019,
        .0017,
        0
    ], [
        .335,
        .32,
        .325,
        .325,
        .335,
        0
    ]),
    4: table([
        .045,
        .09,
        .102,
        .14,
        .22,
        .329
    ], [
        0,
        8100,
        12420,
        39780,
        183780,
        828000
    ], [
        .2126,
        .2473,
        .2374,
        .2275,
        .2176,
        .247
    ], [
        .0024,
        .0027,
        .0026,
        .0025,
        .0024,
        0
    ], [
        .445,
        .4,
        .4,
        .4,
        .4,
        0
    ]),
    5: table([
        .155,
        .18,
        .195,
        .205,
        .23,
        .304
    ], [
        0,
        4500,
        9900,
        17100,
        62100,
        540000
    ], [
        .1696,
        .1696,
        .1795,
        .1894,
        .1696,
        .1978
    ], [
        .0019,
        .0019,
        .002,
        .0021,
        .0019,
        0
    ], [
        .14,
        .17,
        .19,
        .21,
        .235,
        0
    ])
};
export const TAX_SOURCES = [
    {
        label: 'CBS para 2027 — referência de 11,3% proposta pelo TCU em 28/10/2026',
        url: 'https://sites.tcu.gov.br/reforma-tributaria/visao-cbs-2027.html'
    },
    {
        label: 'Fixação da alíquota da CBS pelo Senado Federal',
        url: 'https://www12.senado.leg.br/noticias/audios/2026/10/reforma-tributaria-aliquota-da-cbs-sera-definida-pelo-senado'
    },
    {
        label: 'Partilhas do Simples para 2027/2028 — LC 214/2025 consolidada',
        url: 'https://www2.camara.leg.br/legin/fed/leicom/2025/leicomplementar-214-16-janeiro-2025-796905-normaatualizada-pl.html'
    },
    {
        label: 'Simples Nacional e sublimite — LC 123/2006',
        url: 'https://www.planalto.gov.br/ccivil_03/leis/lcp/lcp123.htm'
    },
    {
        label: 'Créditos de ICMS — LC 87/1996',
        url: 'https://www.planalto.gov.br/ccivil_03/leis/lcp/lcp87.htm'
    },
    {
        label: 'Alíquotas interestaduais de ICMS — Resolução do Senado 22/1989',
        url: 'https://legis.senado.leg.br/norma/586152/publicacao/15646891'
    },
    {
        label: 'Base e alíquota da devolução interestadual — Convênio ICMS 54/2000',
        url: 'https://www.sefanet.pr.gov.br/dados/SEFADOCUMENTOS/8200000054.pdf'
    },
    {
        label: 'Coeficientes de presunção — Lei 9.249/1995',
        url: 'https://www.planalto.gov.br/ccivil_03/leis/l9249.htm'
    },
    {
        label: 'Acréscimo de presunção — LC 224/2025',
        url: 'https://www.planalto.gov.br/ccivil_03/leis/lcp/lcp224.htm'
    },
    {
        label: 'Enquadramento no Lucro Presumido e obrigatoriedade do Lucro Real — Lei 9.718/1998, arts. 13 e 14',
        url: 'https://www.planalto.gov.br/ccivil_03/leis/l9718.htm'
    }
];
export const EXAMPLE_INPUT = {
    year: 2027,
    serviceRevenue: 33_333.33,
    salesRevenue: 8_333.33,
    simplePurchases: 10_433.33,
    regularPurchases: 10_400,
    simpleRegularPurchases: 0,
    salaries: 4_166.67,
    benefits: 0,
    adminExpenses: 833.33,
    rent: 0,
    cardExpenses: 0,
    extraPayroll: 0,
    rbt12: (33_333.33 + 8_333.33) * 12,
    salesAnnex: 1,
    serviceAnnex: 3,
    icmsOutside: false,
    rates: {
        ...DEFAULT_RATES
    },
    credits: {
        simple: {
            base: 10_433.33,
            cbsRate: .015,
            ibsRate: .0002
        },
        simpleRegular: {
            base: 0,
            cbsRate: DEFAULT_RATES.cbs,
            ibsRate: DEFAULT_RATES.ibs
        },
        regular: {
            base: 10_400,
            cbsRate: DEFAULT_RATES.cbs,
            ibsRate: DEFAULT_RATES.ibs
        }
    }
};

// Dependency-free equivalent of the strict source schema. Numbers never coerce.
const VALUE_LIMIT = 1_000_000_000_000;
const TAX_AMOUNT_FIELDS = ['serviceRevenue', 'salesRevenue', 'simplePurchases', 'regularPurchases', 'simpleRegularPurchases', 'salaries', 'benefits', 'adminExpenses', 'rent', 'cardExpenses', 'extraPayroll', 'rbt12'];
const RATE_FIELDS = ['cbs', 'ibs', 'icms', 'iss', 'payroll', 'irSales', 'csSales', 'irServices', 'csServices'];
const CREDIT_GROUPS = ['simple', 'simpleRegular', 'regular'];
function failInput(path, message) {
  const error = new TypeError(`${path.join('.')}: ${message}`);
  error.issues = [{ path, message }];
  throw error;
}
function strictObject(value, keys, path = []) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) failInput(path, 'Informe um objeto válido.');
  for (const key of Object.keys(value)) if (!keys.includes(key)) failInput([...path, key], 'Campo não reconhecido.');
  for (const key of keys) if (!Object.hasOwn(value, key)) failInput([...path, key], 'Campo obrigatório.');
}
function checkNumber(value, max, path) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > max) failInput(path, `Informe um número entre 0 e ${max}.`);
}
function checkSalesNumber(value, path) {
  if (typeof value !== 'number' || !Number.isFinite(value) || Math.abs(value) > VALUE_LIMIT) {
    failInput(path, `Informe um número entre -${VALUE_LIMIT} e ${VALUE_LIMIT}.`);
  }
}
function checkChoices(input) {
  for (const [key, values] of [['year', [2027, 2028]], ['salesAnnex', [1, 2]], ['serviceAnnex', [3, 4, 5]]]) {
    if (!values.includes(input[key])) failInput([key], 'Opção inválida.');
  }
}
/** Derived by the monthly adapter, never copied from an editable draft or client result. */
function parseRevenueContext(value) {
  const hasPositiveRevenue=value!=null&&Object.hasOwn(value,'positiveRevenueCents');
  strictObject(value,['version','method','revenueCents','sourceMonths',...(hasPositiveRevenue?['positiveRevenueCents']:[])],['revenueContext']);
  if(value.version!==REVENUE_CONTEXT_VERSION||value.method!=='ACTUAL_REPORT_MONTHS')failInput(['revenueContext'],'Contexto da receita inválido.');
  if(!Number.isSafeInteger(value.revenueCents))failInput(['revenueContext','revenueCents'],'Receita do período inválida.');
  if(hasPositiveRevenue&&(!Number.isSafeInteger(value.positiveRevenueCents)||value.positiveRevenueCents<Math.max(0,value.revenueCents)))failInput(['revenueContext','positiveRevenueCents'],'A soma das receitas positivas do período é inválida.');
  if(!Array.isArray(value.sourceMonths)||value.sourceMonths.length<1||value.sourceMonths.length>12||
      value.sourceMonths.some(month=>typeof month!=='string'||!/^\d{4}-(0[1-9]|1[0-2])$/.test(month))||
      new Set(value.sourceMonths).size!==value.sourceMonths.length)failInput(['revenueContext','sourceMonths'],'Competências da receita inválidas.');
  return {...value,sourceMonths:[...value.sourceMonths]};
}
/** New choices never mutate an older draft or normalize its request hash. */
export function defaultDifalPolicy() {
  return {version:DIFAL_POLICY_VERSION,enabled:{pure:true,hybrid:true,presumed:false,actual:false},
    operations:{pure:{entry:true,exit:true},hybrid:{entry:true,exit:true}}};
}
export function parseDifalPolicy(value) {
  const current=value?.version===DIFAL_POLICY_VERSION;
  strictObject(value,['version','enabled',...(current?['operations']:[])],['difalPolicy']);
  if(!current&&value.version!==LEGACY_DIFAL_POLICY_VERSION)failInput(['difalPolicy','version'],'Versão das opções de DIFAL inválida.');
  strictObject(value.enabled,REGIME_IDS,['difalPolicy','enabled']);
  for(const id of REGIME_IDS)if(typeof value.enabled[id]!=='boolean')failInput(['difalPolicy','enabled',id],'Escolha incluir ou excluir o DIFAL.');
  const policy={version:value.version,enabled:Object.fromEntries(REGIME_IDS.map(id=>[id,value.enabled[id]]))};
  if(current){
    for(const id of ['presumed','actual'])if(value.enabled[id])failInput(['difalPolicy','enabled',id],'O DIFAL é permitido somente no Simples Puro e Híbrido.');
    strictObject(value.operations,DIFAL_REGIME_IDS,['difalPolicy','operations']);
    for(const id of DIFAL_REGIME_IDS){
      strictObject(value.operations[id],DIFAL_OPERATIONS,['difalPolicy','operations',id]);
      for(const operation of DIFAL_OPERATIONS)if(typeof value.operations[id][operation]!=='boolean')failInput(['difalPolicy','operations',id,operation],'Escolha incluir ou excluir o DIFAL de entrada e de saída.');
    }
    policy.operations=Object.fromEntries(DIFAL_REGIME_IDS.map(id=>[id,Object.fromEntries(DIFAL_OPERATIONS.map(operation=>[operation,value.operations[id][operation]]))]));
  }
  return policy;
}
/** Upgrade only for a new calculation or editable copy; immutable snapshots keep their original policy. */
export function upgradeDifalPolicy(value) {
  const current=defaultDifalPolicy();
  if(value===undefined)return current;
  const policy=parseDifalPolicy(value);
  if(policy.version===DIFAL_POLICY_VERSION)return policy;
  for(const id of DIFAL_REGIME_IDS)current.enabled[id]=policy.enabled[id];
  return current;
}
/** Potential application, independent of the source amount (pending lines can have zero). */
export function resolveDifalApplication({policy,regimeId,rbt12,icmsOutside=false}) {
  if(!REGIME_IDS.includes(regimeId))failInput(['regimeId'],'Regime inválido para as opções de DIFAL.');
  const simple=DIFAL_REGIME_IDS.includes(regimeId);
  if(rbt12!==null&&(simple||rbt12!=null))checkNumber(rbt12,VALUE_LIMIT,['rbt12']);
  if(typeof icmsOutside!=='boolean')failInput(['icmsOutside'],'Informe uma opção válida.');
  const selected=upgradeDifalPolicy(policy),enabled=simple&&selected.enabled[regimeId];
  const operations=simple?{...selected.operations[regimeId]}:{entry:false,exit:false};
  const reason=!simple?'NOT_APPLICABLE':rbt12===null?'MISSING_RBT12':rbt12>=SUBLIMIT?'SUBLIMIT':icmsOutside?'ICMS_OUTSIDE_DAS':!enabled?'USER_EXCLUDED':!operations.entry&&!operations.exit?'NO_OPERATIONS':'ENABLED';
  const blocked=reason==='MISSING_RBT12'||reason==='SUBLIMIT'||reason==='ICMS_OUTSIDE_DAS';
  const included=operations.entry&&operations.exit?'DIFAL de entrada (antecipação das compras) e de saída (vendas) elegíveis.':operations.entry?'DIFAL de entrada (antecipação das compras elegíveis). Saída não selecionada.':'DIFAL de saída (vendas elegíveis). Entrada não selecionada.';
  const message={NOT_APPLICABLE:'Não se aplica: DIFAL de entrada e de saída somente no Simples Puro e Híbrido.',MISSING_RBT12:'Aplicação pendente no Simples: RBT12 não informada. A referência dos documentos permanece preservada.',SUBLIMIT:'Zerado automaticamente: RBT12 da competência igual ou superior a R$ 3.600.000.',ICMS_OUTSIDE_DAS:'Zerado automaticamente: ICMS fora do DAS.',USER_EXCLUDED:'Excluído deste cenário por escolha do usuário.',NO_OPERATIONS:'Sem DIFAL: entrada e saída não selecionadas.',ENABLED:`Incluído: ${included}`}[reason];
  return {version:DIFAL_POLICY_VERSION,enabled,operations,blocked,reason,message,rbt12:rbt12??null,icmsOutside,salesDifal:enabled&&!blocked&&operations.exit,purchaseAnticipation:enabled&&!blocked&&operations.entry};
}
function parseTaxInput(input) {
  const hasDifal = input != null && Object.hasOwn(input, 'difalMonthly');
  const hasAnticipation = input != null && Object.hasOwn(input, 'icmsAnticipation');
  const hasDifalPolicy=input!=null&&Object.hasOwn(input,'difalPolicy');
  const hasRevenueContext=input!=null&&Object.hasOwn(input,'revenueContext');
  const hasIcmsOperations=input!=null&&Object.hasOwn(input,'icmsOperations');
  const hasRegimeSelection=input!=null&&Object.hasOwn(input,'regimeSelection');
  const regimeSelection=hasRegimeSelection?parseRegimeSelection(input.regimeSelection):undefined;
  const needsRbt12=requiresSimplesReference(regimeSelection);
  strictObject(input, [...TAX_AMOUNT_FIELDS.filter(key=>key!=='rbt12'||needsRbt12||Object.hasOwn(input,'rbt12')), 'year', 'salesAnnex', 'serviceAnnex', 'icmsOutside', 'rates', 'credits', ...(hasDifal ? ['difalMonthly'] : []), ...(hasAnticipation ? ['icmsAnticipation'] : []),...(hasDifalPolicy?['difalPolicy']:[]),...(hasRevenueContext?['revenueContext']:[]),...(hasIcmsOperations?['icmsOperations']:[]),...(hasRegimeSelection?['regimeSelection']:[])]);
  const icmsOperations=hasIcmsOperations?parseIcmsOperations(input.icmsOperations):null;
  const revenueContext=hasRevenueContext?parseRevenueContext(input.revenueContext):null;
  const difalPolicy=hasDifalPolicy?parseDifalPolicy(input.difalPolicy):null;
  if (hasDifal) checkNumber(input.difalMonthly, VALUE_LIMIT, ['difalMonthly']);
  if (hasAnticipation) {
    strictObject(input.icmsAnticipation, ['version', 'monthlyCents'], ['icmsAnticipation']);
    if (input.icmsAnticipation.version !== ICMS_ANTICIPATION_VERSION) failInput(['icmsAnticipation','version'], 'Versão da antecipação de ICMS inválida.');
    checkNumber(input.icmsAnticipation.monthlyCents, VALUE_LIMIT * 100, ['icmsAnticipation','monthlyCents']);
    if (!Number.isSafeInteger(input.icmsAnticipation.monthlyCents) || !Number.isSafeInteger(input.icmsAnticipation.monthlyCents * MONTHS)) failInput(['icmsAnticipation','monthlyCents'], 'A antecipação exige centavos inteiros dentro do limite seguro.');
  }
  checkChoices(input);
  if (typeof input.icmsOutside !== 'boolean') failInput(['icmsOutside'], 'Informe uma opção válida.');
  for (const key of TAX_AMOUNT_FIELDS) if(key!=='rbt12'||needsRbt12||input[key]!=null){
    if(key==='rbt12'&&input[key]===null)continue;
    if(key==='salesRevenue')checkSalesNumber(input[key],[key]);else checkNumber(input[key], VALUE_LIMIT, [key]);
  }
  strictObject(input.rates, RATE_FIELDS, ['rates']);
  for (const key of RATE_FIELDS) checkNumber(input.rates[key], 1, ['rates', key]);
  if(icmsOperations&&input.rates.icms!==icmsOperations.internalRatePercent/100)failInput(['rates','icms'],'A taxa interna diverge da premissa de ICMS capturada nas operações.');
  strictObject(input.credits, CREDIT_GROUPS, ['credits']);
  if (input.simpleRegularPurchases > input.simplePurchases) failInput(['simpleRegularPurchases'], 'Esta parcela já está nas compras do Simples e não pode exceder seu total.');
  const purchases = { simple: Math.max(0, input.simplePurchases - input.simpleRegularPurchases), simpleRegular: input.simpleRegularPurchases, regular: input.regularPurchases };
  for (const key of CREDIT_GROUPS) {
    const group = input.credits[key];
    strictObject(group, ['base', 'cbsRate', 'ibsRate'], ['credits', key]);
    checkNumber(group.base, VALUE_LIMIT, ['credits', key, 'base']);
    checkNumber(group.cbsRate, 1, ['credits', key, 'cbsRate']);
    checkNumber(group.ibsRate, 1, ['credits', key, 'ibsRate']);
    if (group.base > purchases[key]) failInput(['credits', key, 'base'], 'A base elegível não pode superar as compras deste grupo. Informe 0 se não houver crédito.');
    if (group.base * (group.cbsRate + group.ibsRate) > purchases[key] + 1e-8) failInput(['credits', key, 'cbsRate'], 'O crédito combinado de CBS e IBS não pode exceder as compras do grupo.');
  }
  return { ...input,rbt12:needsRbt12?input.rbt12:null,...(hasRegimeSelection?{regimeSelection}:{}),...(hasIcmsOperations?{icmsOperations}:{}),...(hasRevenueContext?{revenueContext}:{}),...(hasDifalPolicy?{difalPolicy}:{}), ...(hasAnticipation ? {icmsAnticipation: {...input.icmsAnticipation}} : {}), rates: { ...input.rates }, credits: Object.fromEntries(CREDIT_GROUPS.map(key => [key, { ...input.credits[key] }])) };
}
export const taxInputSchema = Object.freeze({
  parse: parseTaxInput,
  safeParse(input) { try { return { success: true, data: parseTaxInput(input) }; } catch (error) { return { success: false, error }; } },
});


const currency = (value)=>value.toLocaleString('pt-BR', {
        style: 'currency',
        currency: 'BRL',
        maximumFractionDigits: 2
    });
const percent = (value)=>`${(value * 100).toLocaleString('pt-BR', {
        maximumFractionDigits: 6
    })}%`;
const positive = (value)=>Math.max(0, value);
const cleanZero = (value)=>Object.is(value, -0) ? 0 : value;
function apportion(debit, potential) {
    debit = positive(debit);
    const used = Math.min(debit, potential);
    return {
        debit,
        potential,
        used,
        due: positive(debit - used),
        balance: positive(potential - used)
    };
}
function diagnoseSimples(input, revenue) {
    const context=input.revenueContext;
    const sourceMonths=context?[...context.sourceMonths]:[];
    const revenueReference=context?context.revenueCents/100:revenue;
    const revenueBasis=context?'ACTUAL_REPORT_MONTHS':'AVERAGE_X12';
    const completeYear=sourceMonths.length===12&&new Set(sourceMonths.map(month=>month.slice(0,4))).size===1;
    const referenceLabel=context?'A receita considerada no período':'A projeção de receita em 12 meses';
    let statusCode='READY',available=true;
    let message=input.icmsOutside?'Cálculo disponível com ICMS/ISS fora do DAS, conforme a premissa informada.':'Cálculo disponível com ICMS/ISS no DAS, conforme as premissas informadas.';
    let action='Confira enquadramento, atividade, receita do ano-calendário e demais condições antes de usar o resultado fiscalmente.';
    if(input.rbt12===null){
      statusCode='MISSING_RBT12';available=false;
      message='RBT12 não informada. O cálculo deste cenário do Simples está pendente.';
      action='Se desejar calcular o Simples, informe a RBT12 manualmente ou importe o PDF do PGDAS-D. A análise e os demais regimes podem continuar sem esse documento.';
    }else if((positive(input.salesRevenue)+input.serviceRevenue)>0&&input.rbt12===0){
      statusCode='MISSING_RBT12';available=false;
      message='Informe uma RBT12 válida para calcular o Simples com receita positiva.';
      action='Confirme a RBT12 do extrato ou informe a referência manual. Início de atividade exige a regra de proporcionalização aplicável.';
    }else if(input.rbt12>SIMPLES_LIMIT){
      statusCode='RATE_TABLE_EXCEEDED';available=false;
      message=`A RBT12 de ${currency(input.rbt12)} supera a faixa de R$ 4.800.000 suportada neste modelo. Isso não confirma exclusão do Simples Nacional.`;
      action='Confira RBA, RBAA, mercados interno/externo e a regra de cálculo além da última faixa. O modelo não aplica automaticamente essa apuração especial.';
    }else if(revenueReference>SIMPLES_LIMIT){
      statusCode='REVENUE_REVIEW_REQUIRED';available=false;
      message=`${referenceLabel} de ${currency(revenueReference)} supera a referência de R$ 4.800.000. A data e os efeitos de eventual exclusão precisam de análise específica.`;
      action='Confira a receita por ano-calendário e mercado, início de atividade e percentual de excesso. O total considerado não substitui essa análise.';
    }else if(input.rbt12>SUBLIMIT&&!input.icmsOutside){
      statusCode='LOCAL_TAX_REVIEW_REQUIRED';available=false;
      message='A RBT12 está na sexta faixa e ICMS/ISS permanecem indicados no DAS. Essa apuração local exige revisão específica; o sublimite não exclui a empresa do Simples Nacional.';
      action='Se ICMS/ISS já forem recolhidos fora do DAS, selecione essa situação. Se ainda estiverem no DAS, confira RBA, RBAA, parcela de excesso e a apuração local da sexta faixa; não altere a opção apenas para liberar o cálculo.';
    }else if(revenue===0){
      statusCode='ZERO_REVENUE';message='Cálculo disponível com receita zero; custos e despesas permanecem considerados.';
    }else if(revenue<0){
      statusCode='NEGATIVE_REVENUE';message='Cálculo disponível com receita negativa após devoluções; valores, custos e despesas permanecem considerados.';
    }
    return {version:SIMPLES_DIAGNOSTIC_VERSION,available,statusCode,message,action,rbt12:input.rbt12,
      federalLimit:SIMPLES_LIMIT,sublimit:SUBLIMIT,revenueReference,revenueBasis,sourceMonths,
      coveredMonths:context?sourceMonths.length:MONTHS,completeYear,icmsOutside:input.icmsOutside,eligibilityVerified:false,
      assumptions:[
        'RBT12 define a faixa de cálculo. Receita do período, RBT12 e receita acumulada no ano-calendário (RBA/RBAA) são bases diferentes.',
        'O modelo não confirma enquadramento nem datas de exclusão. Receita de cada mercado, início de atividade, vedações e efeitos do excesso exigem conferência.',
        ...(context&&!completeYear?['O período não cobre um ano-calendário completo. Meses ausentes não são presumidos como zero nem projetados.']:[])
      ]};
}
const DRE_LABELS = {
    services: 'Receita de serviços',
    sales: 'Receita de vendas',
    revenue: 'Receita total utilizada',
    das: 'DAS',
    cbsDebit: 'Débito de CBS',
    ibsDebit: 'Débito de IBS',
    icmsNet: 'ICMS líquido fora do DAS',
    iss: 'ISS fora do DAS',
    difal: 'DIFAL estimado (10%)',
    icmsAnticipation: 'Antecipação de ICMS',
    netRevenue: 'Receita líquida',
    cmvSimple: 'Compras/CMV de optantes',
    cmvRegular: 'Compras/CMV de não optantes',
    cmv: 'CMV total',
    cbsUsed: 'Crédito CBS utilizado',
    ibsUsed: 'Crédito IBS utilizado',
    grossProfit: 'Lucro bruto',
    salaries: 'Salários',
    benefits: 'FGTS e benefícios',
    payroll: 'Encargos adicionais',
    personnel: 'Pessoal e encargos',
    administrative: 'Despesas administrativas',
    rent: 'Aluguel',
    cards: 'Cartões e vendas',
    preTax: 'Resultado antes de IRPJ/CSLL',
    irpj: 'IRPJ',
    csll: 'CSLL',
    netProfit: 'Resultado líquido',
    icmsUsed: 'Crédito ICMS já abatido (informativo)',
    icmsBalance: 'Saldo credor ICMS (informativo)'
};
export function calculateTax(rawInput) {
    const input = taxInputSchema.parse(rawInput);
    const regimeSelection=resolveRegimeSelection(input.regimeSelection),hasSimples=requiresSimplesReference(regimeSelection);
    const icmsProjection=input.icmsOperations?projectIcmsOperations(input.icmsOperations,{salesRevenueCents:Math.round(input.salesRevenue*100),regularPurchasesCents:Math.round(input.regularPurchases*100)}):null;
    if(icmsProjection)for(const key of ['debitCents','potentialCents','purchaseCreditCents','salesReturnCreditCents']){
      if(!Number.isSafeInteger(icmsProjection[key]*MONTHS))failInput(['icmsOperations'],'O ICMS da projeção excede o limite seguro.');
    }
    const hasDifal = Object.hasOwn(input, 'difalMonthly');
    const annualDifal = (input.difalMonthly ?? 0) * MONTHS;
    const hasAnticipation = Object.hasOwn(input, 'icmsAnticipation');
    const missingRbt12=hasSimples&&input.rbt12===null;
    const anticipationBlocked = missingRbt12 || input.rbt12 >= SUBLIMIT || input.icmsOutside;
    const annualAnticipation = hasAnticipation && !anticipationBlocked ? input.icmsAnticipation.monthlyCents * MONTHS / 100 : 0;
    const difalPolicy=upgradeDifalPolicy(input.difalPolicy);
    const difalApplications=Object.fromEntries(regimeSelection.selected.map(regimeId=>[regimeId,resolveDifalApplication({policy:difalPolicy,regimeId,rbt12:input.rbt12,icmsOutside:input.icmsOutside})]));
    const memory = [];
    const warnings = [];
    const add = (id, section, label, formula, value, unit = 'currency')=>{
        if(!regimeMemoryApplies(id,regimeSelection))return;
        memory.push({
            id,
            section,
            label,
            formula,
            value: typeof value === 'number' ? cleanZero(value) : value,
            unit
        });
    };
    const warn = (code, severity, title, detail)=>regimeWarningApplies(code,regimeSelection)&&warnings.push({
            code,
            severity,
            title,
            detail
        });
    const annual = {
        services: input.serviceRevenue * MONTHS,
        sales: input.salesRevenue * MONTHS,
        cmvSimple: input.simplePurchases * MONTHS,
        cmvRegular: input.regularPurchases * MONTHS,
        salaries: input.salaries * MONTHS,
        benefits: input.benefits * MONTHS,
        administrative: input.adminExpenses * MONTHS,
        rent: input.rent * MONTHS,
        cards: input.cardExpenses * MONTHS
    };
    const revenue = annual.services + annual.sales;
    // The financial result keeps returns and losses. A negative assessment base
    // does not create a negative tax, an automatic refund or cross-month credit.
    const taxableSales = positive(annual.sales), taxableRevenue = positive(revenue);
    const simplesDiagnostic=hasSimples?diagnoseSimples(input,revenue):null;
    if(simplesDiagnostic&&input.icmsOutside&&icmsProjection&&!icmsProjection.available){
      const previous=simplesDiagnostic.available?'':simplesDiagnostic.message+' ';
      if(simplesDiagnostic.available)simplesDiagnostic.statusCode='ICMS_OPERATIONS_PENDING';
      simplesDiagnostic.available=false;
      simplesDiagnostic.message=previous+icmsProjection.status;
      simplesDiagnostic.action='Confira natureza, UF da empresa e UF da contraparte nos relatórios para completar o ICMS fora do DAS. '+simplesDiagnostic.action;
    }
    const revenueReference=input.revenueContext?input.revenueContext.revenueCents/100:revenue;
    const cmv = annual.cmvSimple + annual.cmvRegular;
    const operational = revenue - cmv - annual.salaries - annual.benefits - annual.administrative - annual.rent - annual.cards;
    add('year', 'Premissas', 'Ano do cenário', hasSimples?'Partilhas do Simples válidas para 2027 e 2028.':'Ano das premissas do cenário gerencial.', input.year, 'number');
    add('months', 'Premissas', 'Horizonte da projeção', 'Um mês informado repetido em 12 meses; valores anuais não são uma apuração trimestral.', MONTHS, 'number');
    add('rbt12', 'Premissas', 'RBT12', missingRbt12?'Referência opcional não informada; não equivale a zero nem à receita mensal multiplicada por doze.':'Receita total efetiva dos últimos 12 meses informada pelo usuário; separada da projeção.', missingRbt12?'Não informada':input.rbt12,missingRbt12?'text':'currency');
    add('sublimit', 'Premissas', 'Sublimite de referência', 'Referência preventiva para ICMS/ISS fora do DAS.', SUBLIMIT);
    add('simplesLimit', 'Premissas', 'Limite do Simples', 'Limite de referência do modelo.', SIMPLES_LIMIT);
    add('simples.revenueReference','Simples Nacional',input.revenueContext?'Receita considerada no período':'Receita anual projetada de referência',input.revenueContext?'Soma das receitas de cada competência informada, após devoluções e ajustes do cenário. Não é cada mês multiplicado por 12 nem confirmação de RBA fiscal.':'Receita mensal × 12, identificada como projeção; não substitui RBA/RBAA para enquadramento.',revenueReference);
    if(simplesDiagnostic){
      add('simples.diagnostic','Simples Nacional','Condição do cálculo do Simples','A disponibilidade informa se o modelo suporta o cálculo; não confirma elegibilidade fiscal.',simplesDiagnostic.message,'text');
      add('simples.action','Simples Nacional','Conferência necessária',simplesDiagnostic.statusCode,simplesDiagnostic.action,'text');
    }else add('revenue.reference','Premissas',input.revenueContext?'Receita considerada no período':'Receita anual projetada de referência',input.revenueContext?'Soma das receitas das competências informadas, após devoluções e ajustes do cenário.':'Receita mensal × 12; projeção gerencial.',revenueReference);
    add('outside', 'Premissas', 'ICMS e ISS fora do DAS', 'Situação informada pelo usuário; alerta de sublimite não altera a opção automaticamente.', input.icmsOutside ? 'Sim' : 'Não', 'text');
    const rateLabels = {
        cbs: 'CBS de saída (hipótese)',
        ibs: 'IBS de saída (hipótese)',
        icms: 'ICMS padrão da simulação',
        iss: 'ISS fora do DAS',
        payroll: 'Encargos LP/LR',
        irSales: 'Presunção IRPJ vendas',
        csSales: 'Presunção CSLL vendas',
        irServices: 'Presunção IRPJ serviços',
        csServices: 'Presunção CSLL serviços'
    };
    for (const key of Object.keys(rateLabels))add(`rate.${key}`, 'Premissas', rateLabels[key], 'Percentual informado, armazenado como fração decimal.', input.rates[key], 'percent');
    for (const key of Object.keys(annual))add(`annual.${key}`, 'Valores anuais', DRE_LABELS[key], `${currency(annual[key] / MONTHS)} por mês × ${MONTHS}`, annual[key]);
    add('annual.revenue', 'Valores anuais', 'Receita total anual', 'Receita anual de serviços + receita anual de vendas', revenue);
    add('taxable.sales', 'Bases de cálculo', 'Base não negativa de vendas', 'Máximo(0; receita de vendas após devoluções). O saldo negativo permanece na DRE; não cria restituição automática.', taxableSales);
    add('taxable.revenue', 'Bases de cálculo', 'Base não negativa de CBS/IBS', 'Máximo(0; receita total após devoluções). A receita financeira permanece integral na DRE.', taxableRevenue);
    add('annual.cmv', 'Valores anuais', 'CMV total anual', 'CMV de optantes + CMV de não optantes; a parcela SN regular não é somada outra vez.', cmv);
    add('annual.operational', 'Valores anuais', 'Resultado antes de tributos e encargos', 'Receita − CMV − salários − benefícios − administração − aluguel − cartões', operational);
    if (hasDifal) add('difal.annual', 'Tributos e encargos', 'DIFAL anual importado, antes das opções por regime', 'Estimativa mensal vinculada às operações importadas × 12. A dedução efetiva depende da opção e do bloqueio de cada regime; confira suas linhas na DRE.', annualDifal);
    if (hasAnticipation) {
      add('icmsAnticipation.rate', 'Antecipação de ICMS', 'Percentual sobre compras interestaduais', 'Premissa gerencial aplicada às compras elegíveis do relatório de origem.', .0732, 'percent');
      add('icmsAnticipation.annual', 'Antecipação de ICMS', 'Referência anual da antecipação antes da opção por regime', missingRbt12?'A aplicação no Simples depende da RBT12; o valor importado permanece identificado na origem.':anticipationBlocked ? 'Zero: RBT12 atingiu R$ 3.600.000 ou ICMS está fora do DAS.' : 'Antecipação mensal importada × 12; a dedução depende da opção de cada cenário Simples, sem crédito adicional.', missingRbt12?'Não calculada':annualAnticipation,missingRbt12?'text':'currency');
      add('icmsAnticipation.status', 'Antecipação de ICMS', 'Condição da antecipação de ICMS', 'O bloqueio por sublimite usa a RBT12 desta competência; não usa a receita mensal multiplicada por 12.', missingRbt12?'Pendente: RBT12 não informada.':anticipationBlocked ? 'Bloqueada: sublimite alcançado ou ICMS fora do DAS.' : 'Disponível abaixo do sublimite; a opção de cada cenário determina a inclusão.', 'text');
    }
    const groupNames = {
        simple: 'Simples com CBS/IBS no DAS',
        simpleRegular: 'Simples com CBS/IBS no regime regular',
        regular: 'Não optantes pelo Simples'
    };
    const groupPurchases = {
        simple: input.simplePurchases - input.simpleRegularPurchases,
        simpleRegular: input.simpleRegularPurchases,
        regular: input.regularPurchases
    };
    let cbsPotential = 0;
    let ibsPotential = 0;
    for (const key of [
        'simple',
        'simpleRegular',
        'regular'
    ]){
        const group = input.credits[key];
        const cbs = group.base * group.cbsRate * MONTHS;
        const ibs = group.base * group.ibsRate * MONTHS;
        cbsPotential += cbs;
        ibsPotential += ibs;
        add(`group.${key}.purchases`, 'Compras e créditos', `${groupNames[key]} — compras mensais`, key === 'simple' ? 'Compras de optantes − parcela de optantes no regime regular' : 'Valor mensal informado; parcela SN regular já incluída nas compras de optantes.', groupPurchases[key]);
        add(`group.${key}.base`, 'Compras e créditos', `${groupNames[key]} — base elegível mensal`, 'Base mensal informada, limitada às compras do grupo. Não implica que todo CMV gere crédito.', group.base);
        add(`group.${key}.cbsRate`, 'Compras e créditos', `${groupNames[key]} — taxa creditável CBS`, 'Percentual creditável informado para este grupo.', group.cbsRate, 'percent');
        add(`group.${key}.ibsRate`, 'Compras e créditos', `${groupNames[key]} — taxa creditável IBS`, 'Percentual creditável informado para este grupo.', group.ibsRate, 'percent');
        add(`group.${key}.cbs`, 'Compras e créditos', `${groupNames[key]} — crédito CBS anual`, `${currency(group.base)} × ${percent(group.cbsRate)} × ${MONTHS}`, cbs);
        add(`group.${key}.ibs`, 'Compras e créditos', `${groupNames[key]} — crédito IBS anual`, `${currency(group.base)} × ${percent(group.ibsRate)} × ${MONTHS}`, ibs);
    }
    const credits = {
        cbs: apportion(taxableRevenue * input.rates.cbs, cbsPotential),
        ibs: apportion(taxableRevenue * input.rates.ibs, ibsPotential),
        icms: icmsProjection?apportion(icmsProjection.debitCents*MONTHS/100,icmsProjection.potentialCents*MONTHS/100):apportion(taxableSales * input.rates.icms, annual.cmvRegular * input.rates.icms)
    };
    if(icmsProjection){
      const p=icmsProjection,s=p.source,annualAmount=value=>value*MONTHS/100;
      add('icms.interstateRate','Apuração de ICMS','Alíquota interestadual do cenário','Premissa gerencial solicitada para operações com UFs confirmadas e diferentes; não substitui a alíquota da nota.',s.interstateRatePercent/100,'percent');
      add('icms.grossSales','Apuração de ICMS','Vendas brutas de mercadorias consideradas','Vendas líquidas do cenário + devoluções de venda importadas. A receita da DRE continua após devoluções.',annualAmount(p.grossSalesCents));
      add('icms.salesAdjustment','Apuração de ICMS','Ajuste de vendas na base de ICMS','Diferença manual aplicada à composição de UFs das vendas brutas de origem; não altera as devoluções.',annualAmount(p.salesAdjustmentCents));
      add('icms.purchaseCredit','Apuração de ICMS','Crédito de ICMS das compras elegíveis','Somente COMPRAS do grupo gerencial não optante, por UF: internas 18% e interestaduais 12%. Serviços 8000 excluídos.',annualAmount(p.purchaseCreditCents));
      add('icms.returnCredit','Apuração de ICMS','Crédito de ICMS das devoluções de venda','DEVOLUCAO_VENDA nas entradas, independentemente do grupo do comprador; mesma premissa 18% interna / 12% interestadual das vendas. O débito parte das vendas brutas para evitar duplicação.',annualAmount(p.salesReturnCreditCents));
      add('icms.excludedServices','Apuração de ICMS','Compras 8000 excluídas do crédito de ICMS','Serviços com prefixo 8000 permanecem no custo, sem crédito e sem antecipação de ICMS.',annualAmount(s.excludedServicePurchasesCents));
      for(const [group,label] of [['purchases','Compras elegíveis'],['salesReturns','Devoluções de venda'],['sales','Vendas brutas de origem']]){
        add(`icms.${group}.internalBase`,'Apuração de ICMS',`${label} — base interna`,'UF confirmada igual à UF da empresa; premissa de 18%.',annualAmount(s[group].internalBaseCents));
        add(`icms.${group}.interstateBase`,'Apuração de ICMS',`${label} — base interestadual`,'UFs confirmadas e diferentes; premissa de 12%.',annualAmount(s[group].interstateBaseCents));
      }
      add('icms.operationStatus','Apuração de ICMS','Condição da apuração por operações','Natureza, UF e valores vêm dos relatórios conciliados.',p.status,'text');
    }
    for (const key of [
        'cbs',
        'ibs',
        'icms'
    ]){
        const credit = credits[key];
        const name = key.toUpperCase();
        add(`${key}.debit`, `Apuração de ${name}`, `Débito de ${name}`, key === 'icms' ? icmsProjection?'Vendas brutas elegíveis: internas × 18% + interestaduais × 12%, por linha. Ajuste de receita ponderado pela composição da origem; base mínima zero.':`Máximo(0; ${currency(annual.sales)} de vendas anuais) × ${percent(input.rates.icms)}` : `Máximo(0; ${currency(revenue)} de receita anual) × ${percent(input.rates[key])}`, credit.debit);
        add(`${key}.potential`, `Apuração de ${name}`, `Crédito potencial de ${name}`, key === 'icms' ? icmsProjection?'Crédito das compras elegíveis + crédito das devoluções de venda. Naturezas 8000 não geram crédito.':`${currency(annual.cmvRegular)} de compras/CMV de não optantes × ${percent(input.rates.icms)}` : `Soma dos créditos de ${name} dos três grupos; sem compensar outro tributo.`, credit.potential);
        add(`${key}.used`, `Apuração de ${name}`, `Crédito utilizado de ${name}`, 'Mínimo entre débito e crédito potencial', credit.used);
        add(`${key}.due`, `Apuração de ${name}`, `${name} líquido a recolher`, 'Débito − crédito utilizado; nunca imposto negativo', credit.due);
        add(`${key}.balance`, `Apuração de ${name}`, `Saldo credor potencial de ${name}`, 'Máximo(0; crédito potencial − crédito utilizado). Não integra lucro ou restituição automática.', credit.balance);
    }
    const iss = annual.services * input.rates.iss;
    const regularPayroll = annual.salaries * input.rates.payroll;
    const simplePayroll = input.extraPayroll * MONTHS;
    add('iss.annual', 'Tributos e encargos', 'ISS anual fora do DAS', `${currency(annual.services)} de serviços anuais × ${percent(input.rates.iss)}`, iss);
    add('payroll.regular', 'Tributos e encargos', 'Encargos anuais LP/LR', `${currency(annual.salaries)} de salários × ${percent(input.rates.payroll)}`, regularPayroll);
    add('payroll.simple', 'Tributos e encargos', 'Encargos anuais fora do DAS no Simples', `${currency(input.extraPayroll)} informados por mês × ${MONTHS}`, simplePayroll);
    const bandIndex = input.rbt12 > 0 ? TAX_BANDS[input.salesAnnex].findIndex((band)=>input.rbt12 <= band.ceiling) : -1;
    const salesBand = bandIndex >= 0 ? TAX_BANDS[input.salesAnnex][bandIndex] : null;
    const serviceBand = bandIndex >= 0 ? TAX_BANDS[input.serviceAnnex][bandIndex] : null;
    const salesEffective = salesBand ? positive((input.rbt12 * salesBand.nominal - salesBand.deduction) / input.rbt12) : 0;
    const serviceEffective = serviceBand ? positive((input.rbt12 * serviceBand.nominal - serviceBand.deduction) / input.rbt12) : 0;
    const salesCbsEffective = salesEffective * (salesBand?.cbsShare ?? 0);
    const salesIbsEffective = salesEffective * (salesBand?.ibsShare ?? 0);
    const salesIcmsEffective = salesEffective * (salesBand?.localShare ?? 0);
    const serviceIssEffective = Math.min(DAS_ISS_CAP, serviceEffective * (serviceBand?.localShare ?? 0));
    const cappedIII = input.serviceAnnex === 3 && bandIndex === 4 && serviceEffective * (serviceBand?.localShare ?? 0) > DAS_ISS_CAP;
    const cappedIV = input.serviceAnnex === 4 && bandIndex === 4 && serviceEffective * (serviceBand?.localShare ?? 0) > DAS_ISS_CAP;
    const serviceCbsEffective = cappedIII ? (serviceEffective - DAS_ISS_CAP) * .232 : cappedIV ? (serviceEffective - DAS_ISS_CAP) * .3627 : serviceEffective * (serviceBand?.cbsShare ?? 0);
    const serviceIbsEffective = cappedIII ? (serviceEffective - DAS_ISS_CAP) * .0026 : cappedIV ? (serviceEffective - DAS_ISS_CAP) * .004 : serviceEffective * (serviceBand?.ibsShare ?? 0);
    const salesDas = taxableSales * salesEffective;
    const serviceDas = annual.services * serviceEffective;
    const icmsRemoved = input.icmsOutside ? taxableSales * salesIcmsEffective : 0;
    const issRemoved = input.icmsOutside ? annual.services * serviceIssEffective : 0;
    const pureDas = salesDas - icmsRemoved + serviceDas - issRemoved;
    const cbsRemoved = taxableSales * salesCbsEffective + annual.services * serviceCbsEffective;
    const ibsRemoved = taxableSales * salesIbsEffective + annual.services * serviceIbsEffective;
    const hybridDas = positive(pureDas - cbsRemoved - ibsRemoved);
    const ipiIncluded = taxableSales * salesEffective * (salesBand?.ipiShare ?? 0);
    add('simples.band', 'Simples Nacional', 'Faixa pela RBT12 total', 'Primeiro teto que comporta a RBT12; 0 significa sem faixa válida.', bandIndex + 1, 'number');
    for (const [prefix, annex, band, effective] of [
        [
            'sales',
            input.salesAnnex,
            salesBand,
            salesEffective
        ],
        [
            'services',
            input.serviceAnnex,
            serviceBand,
            serviceEffective
        ]
    ]){
        const label = prefix === 'sales' ? 'Vendas' : 'Serviços';
        add(`simples.${prefix}.annex`, 'Simples Nacional', `${label} — anexo`, 'Anexo informado, aplicado apenas à receita desta atividade.', annex, 'number');
        add(`simples.${prefix}.nominal`, 'Simples Nacional', `${label} — alíquota nominal`, 'Tabela do anexo para a faixa da RBT12 total, período 2027/2028.', band?.nominal ?? 0, 'percent');
        add(`simples.${prefix}.deduction`, 'Simples Nacional', `${label} — parcela a deduzir`, 'Dedução correspondente ao anexo e à faixa.', band?.deduction ?? 0);
        add(`simples.${prefix}.effective`, 'Simples Nacional', `${label} — alíquota efetiva`, 'Máximo(0; (RBT12 × nominal − dedução) ÷ RBT12); zero quando sem faixa válida.', effective, 'percent');
    }
    for (const [id, label, formula, value] of [
        [
            'sales.cbs',
            'CBS efetiva de vendas',
            'Efetiva do anexo de vendas × participação CBS',
            salesCbsEffective
        ],
        [
            'sales.ibs',
            'IBS efetivo de vendas',
            'Efetiva do anexo de vendas × participação IBS',
            salesIbsEffective
        ],
        [
            'sales.icms',
            'ICMS efetivo no DAS de vendas',
            'Efetiva do anexo de vendas × participação ICMS',
            salesIcmsEffective
        ],
        [
            'services.cbs',
            'CBS efetiva de serviços',
            cappedIII ? '(Efetiva − 5%) × 23,20% (teto de ISS, Anexo III/faixa 5)' : cappedIV ? '(Efetiva − 5%) × 36,27% (teto de ISS, Anexo IV/faixa 5)' : 'Efetiva de serviços × participação CBS',
            serviceCbsEffective
        ],
        [
            'services.ibs',
            'IBS efetivo de serviços',
            cappedIII ? '(Efetiva − 5%) × 0,26% (teto de ISS, Anexo III/faixa 5)' : cappedIV ? '(Efetiva − 5%) × 0,40% (teto de ISS, Anexo IV/faixa 5)' : 'Efetiva de serviços × participação IBS',
            serviceIbsEffective
        ],
        [
            'services.iss',
            'ISS efetivo no DAS de serviços',
            'Mínimo(5%; efetiva de serviços × participação ISS)',
            serviceIssEffective
        ]
    ])add(`simples.${id}`, 'Simples Nacional', label, formula, value, 'percent');
    for (const [id, label, formula, value] of [
        [
            'salesDas',
            'DAS cheio de vendas',
            'Máximo(0; receita de vendas anual após devoluções) × alíquota efetiva de vendas',
            salesDas
        ],
        [
            'serviceDas',
            'DAS cheio de serviços',
            'Receita de serviços anual × alíquota efetiva de serviços',
            serviceDas
        ],
        [
            'icmsRemoved',
            'ICMS retirado do DAS',
            'Se recolhimento fora do DAS: máximo(0; vendas anuais) × ICMS efetivo no DAS; caso contrário, zero.',
            icmsRemoved
        ],
        [
            'issRemoved',
            'ISS retirado do DAS',
            'Se recolhimento fora do DAS: serviços anuais × ISS efetivo no DAS; caso contrário, zero.',
            issRemoved
        ],
        [
            'pureDas',
            'DAS do Simples Puro',
            'DAS cheio de vendas + DAS cheio de serviços − ICMS retirado − ISS retirado',
            pureDas
        ],
        [
            'cbsRemoved',
            'CBS retirada no Híbrido',
            'Máximo(0; vendas anuais) × CBS efetiva de vendas + serviços anuais × CBS efetiva de serviços',
            cbsRemoved
        ],
        [
            'ibsRemoved',
            'IBS retirado no Híbrido',
            'Máximo(0; vendas anuais) × IBS efetivo de vendas + serviços anuais × IBS efetivo de serviços',
            ibsRemoved
        ],
        [
            'hybridDas',
            'DAS residual do Simples Híbrido',
            'Máximo(0; DAS Puro − CBS retirada − IBS retirado)',
            hybridDas
        ],
        [
            'ipiIncluded',
            'IPI incluído no DAS do Anexo II',
            'Máximo(0; vendas anuais) × efetiva × participação IPI; já no DAS, sem nova soma.',
            ipiIncluded
        ]
    ])add(`simples.${id}`, 'Simples Nacional', label, formula, value);
    // In the monthly adapter, distribute the model's excess exactly once across
    // positive months. The signed period total determines the excess; negative
    // months neither generate refunds nor inflate the shares of positive months.
    const positiveRevenueReference=input.revenueContext?
      (input.revenueContext.positiveRevenueCents??positive(input.revenueContext.revenueCents))/100:taxableRevenue;
    const excessRevenue = input.revenueContext
      ? (positiveRevenueReference>0?positive(revenueReference-PRESUMPTION_LIMIT)*taxableRevenue/positiveRevenueReference:0)
      : positive(revenue - PRESUMPTION_LIMIT);
    const irBase = taxableSales * input.rates.irSales + annual.services * input.rates.irServices;
    const csBase = taxableSales * input.rates.csSales + annual.services * input.rates.csServices;
    const taxableActivities = taxableSales + annual.services;
    const irCoefficient = taxableActivities > 0 ? irBase / taxableActivities : 0;
    const csCoefficient = taxableActivities > 0 ? csBase / taxableActivities : 0;
    const irIncrease = excessRevenue * irCoefficient * PRESUMPTION_INCREASE;
    const csIncrease = excessRevenue * csCoefficient * PRESUMPTION_INCREASE;
    const irTotalBase = irBase + irIncrease;
    const csTotalBase = csBase + csIncrease;
    const presumedBasicIr = irTotalBase * IRPJ_RATE;
    const presumedAdditionalIr = positive(irTotalBase - IRPJ_ADDITIONAL_BASE) * IRPJ_ADDITIONAL_RATE;
    const presumedIr = presumedBasicIr + presumedAdditionalIr;
    const presumedCs = csTotalBase * CSLL_RATE;
    const actualPreTax = operational - credits.cbs.due - credits.ibs.due - credits.icms.due - iss - regularPayroll;
    const actualBase = positive(actualPreTax);
    const actualBasicIr = actualBase * IRPJ_RATE;
    const actualAdditionalIr = positive(actualBase - IRPJ_ADDITIONAL_BASE) * IRPJ_ADDITIONAL_RATE;
    const actualIr = actualBasicIr + actualAdditionalIr;
    const actualCs = actualBase * CSLL_RATE;
    for (const [id, label, formula, value] of [
        [
            'excessRevenue',
            'Receita excedente a R$ 5 milhões',
            input.revenueContext?'Excedente da receita líquida do período a R$ 5.000.000, rateado pela proporção da receita positiva da competência na soma das receitas positivas. Contribuição anualizada para conversão mensal; não representa apuração trimestral.':'Máximo(0; receita anual − R$ 5.000.000)',
            excessRevenue
        ],
        [
            'irBase',
            'Base IRPJ sem acréscimo',
            `Máximo(0; vendas anuais) × ${percent(input.rates.irSales)} + serviços anuais × ${percent(input.rates.irServices)}`,
            irBase
        ],
        [
            'irIncrease',
            'Acréscimo da base IRPJ',
            'Excedente a R$ 5 milhões × coeficiente médio ponderado IRPJ × 10%',
            irIncrease
        ],
        [
            'irTotalBase',
            'Base presumida total IRPJ',
            'Base IRPJ sem acréscimo + acréscimo da base',
            irTotalBase
        ],
        [
            'irBasic',
            'IRPJ básico presumido',
            'Base presumida total × 15%',
            presumedBasicIr
        ],
        [
            'irAdditional',
            'Adicional IRPJ presumido',
            'Máximo(0; base presumida total − R$ 240.000) × 10%',
            presumedAdditionalIr
        ],
        [
            'irTotal',
            'IRPJ total presumido',
            'IRPJ básico + adicional',
            presumedIr
        ],
        [
            'csBase',
            'Base CSLL sem acréscimo',
            `Máximo(0; vendas anuais) × ${percent(input.rates.csSales)} + serviços anuais × ${percent(input.rates.csServices)}`,
            csBase
        ],
        [
            'csIncrease',
            'Acréscimo da base CSLL',
            'Excedente a R$ 5 milhões × coeficiente médio ponderado CSLL × 10%',
            csIncrease
        ],
        [
            'csTotalBase',
            'Base presumida total CSLL',
            'Base CSLL sem acréscimo + acréscimo da base',
            csTotalBase
        ],
        [
            'csTotal',
            'CSLL presumida',
            'Base presumida total CSLL × 9%',
            presumedCs
        ]
    ])add(`presumed.${id}`, 'Lucro Presumido', label, formula, value);
    add('presumed.irCoefficient', 'Lucro Presumido', 'Coeficiente médio IRPJ', 'Base IRPJ sem acréscimo ÷ soma das bases não negativas de vendas e serviços; zero se não houver base.', irCoefficient, 'percent');
    add('presumed.csCoefficient', 'Lucro Presumido', 'Coeficiente médio CSLL', 'Base CSLL sem acréscimo ÷ soma das bases não negativas de vendas e serviços; zero se não houver base.', csCoefficient, 'percent');
    for (const [id, label, formula, value] of [
        [
            'preTax',
            'Resultado antes de IRPJ/CSLL',
            'Resultado operacional − CBS líquido − IBS líquido − ICMS líquido − ISS − encargos LP/LR. DIFAL não se aplica ao Lucro Real.',
            actualPreTax
        ],
        [
            'base',
            'Base positiva estimada',
            'Máximo(0; resultado antes de IRPJ/CSLL); sem ajustes fiscais ou compensações.',
            actualBase
        ],
        [
            'irBasic',
            'IRPJ básico do Real',
            'Base positiva × 15%',
            actualBasicIr
        ],
        [
            'irAdditional',
            'Adicional IRPJ do Real',
            'Máximo(0; base positiva − R$ 240.000) × 10%',
            actualAdditionalIr
        ],
        [
            'irTotal',
            'IRPJ total do Real',
            'IRPJ básico + adicional',
            actualIr
        ],
        [
            'csTotal',
            'CSLL do Real',
            'Base positiva × 9%',
            actualCs
        ]
    ])add(`actual.${id}`, 'Lucro Real', label, formula, value);
    const simpleStatus=simplesDiagnostic?.message;
    const simpleAvailable=simplesDiagnostic?.available??false;
    function regime(id, name) {
        const isSimple = id === 'pure' || id === 'hybrid';
        const isPure = id === 'pure';
        const outside = !isSimple || input.icmsOutside;
        const icmsPending=outside&&icmsProjection&&!icmsProjection.available;
        const available = (!isSimple || simpleAvailable)&&!icmsPending;
        const status=isSimple?simpleStatus:icmsPending?icmsProjection.status:revenue===0?'Calculado com receita zero':revenue<0?'Calculado com receita negativa; confira os alertas':id==='presumed'?'Simulação sujeita ao enquadramento':'Disponível';
        const application=difalApplications[id];
        const dre = {
            services: annual.services,
            sales: annual.sales,
            revenue,
            das: -(id === 'pure' ? pureDas : id === 'hybrid' ? hybridDas : 0),
            cbsDebit: isPure ? 0 : -credits.cbs.debit,
            ibsDebit: isPure ? 0 : -credits.ibs.debit,
            icmsNet: outside ? -credits.icms.due : 0,
            iss: outside ? -iss : 0,
            ...(hasDifal ? {difal: application.salesDifal ? -annualDifal : 0} : {}),
            ...(hasAnticipation ? {icmsAnticipation: application.purchaseAnticipation ? -annualAnticipation : 0} : {}),
            netRevenue: 0,
            cmvSimple: -annual.cmvSimple,
            cmvRegular: -annual.cmvRegular,
            cmv: -cmv,
            cbsUsed: isPure ? 0 : credits.cbs.used,
            ibsUsed: isPure ? 0 : credits.ibs.used,
            grossProfit: 0,
            salaries: -annual.salaries,
            benefits: -annual.benefits,
            payroll: -(isSimple ? simplePayroll : regularPayroll),
            personnel: 0,
            administrative: -annual.administrative,
            rent: -annual.rent,
            cards: -annual.cards,
            preTax: 0,
            irpj: -(id === 'presumed' ? presumedIr : id === 'actual' ? actualIr : 0),
            csll: -(id === 'presumed' ? presumedCs : id === 'actual' ? actualCs : 0),
            netProfit: 0,
            icmsUsed: outside ? credits.icms.used : 0,
            icmsBalance: outside ? credits.icms.balance : 0
        };
        dre.netRevenue = dre.revenue + dre.das + dre.cbsDebit + dre.ibsDebit + dre.icmsNet + dre.iss + (dre.difal ?? 0) + (dre.icmsAnticipation ?? 0);
        dre.grossProfit = dre.netRevenue + dre.cmv + dre.cbsUsed + dre.ibsUsed;
        dre.personnel = dre.salaries + dre.benefits + dre.payroll;
        dre.preTax = dre.grossProfit + dre.personnel + dre.administrative + dre.rent + dre.cards;
        dre.netProfit = dre.preTax + dre.irpj + dre.csll;
        const taxes = -dre.das - dre.cbsDebit - dre.ibsDebit - dre.icmsNet - dre.iss - (dre.difal ?? 0) - (dre.icmsAnticipation ?? 0) - dre.payroll - dre.irpj - dre.csll - dre.cbsUsed - dre.ibsUsed;
        const formulas = {
            services: 'Serviços mensais × 12',
            sales: 'Vendas mensais × 12',
            revenue: 'Serviços anuais + vendas anuais',
            das: isPure ? '−DAS Puro' : id === 'hybrid' ? '−DAS residual Híbrido' : 'Zero: regime fora do Simples',
            cbsDebit: isPure ? 'Zero: CBS incluída no DAS' : '−Débito anual de CBS',
            ibsDebit: isPure ? 'Zero: IBS incluído no DAS' : '−Débito anual de IBS',
            icmsNet: outside ? '−(débito ICMS − crédito ICMS utilizado)' : 'Zero: ICMS incluído no DAS; sem crédito externo',
            iss: outside ? '−Serviços anuais × alíquota de ISS' : 'Zero: ISS incluído no DAS',
            difal: application.salesDifal?'−DIFAL mensal estimado das operações importadas × 12; hipótese gerencial de 10%, incluída uma única vez.':application.message,
            icmsAnticipation: !isSimple ? 'Zero: antecipação de ICMS aplicada somente ao Simples Puro e Híbrido.' : !application.purchaseAnticipation ? application.message : '−Antecipação mensal das compras interestaduais elegíveis × 12; premissa de 7,32%, deduzida uma única vez e sem crédito adicional.',
            netRevenue: 'Receita utilizada + linhas negativas de DAS, CBS, IBS, ICMS, ISS e DIFAL estimado' + (hasAnticipation ? ' + antecipação de ICMS quando aplicável' : ''),
            cmvSimple: '−Compras/CMV de optantes × 12',
            cmvRegular: '−Compras/CMV de não optantes × 12',
            cmv: 'CMV optantes + CMV não optantes (subtotal negativo)',
            cbsUsed: isPure ? 'Zero: sem crédito próprio de CBS no Simples Puro' : '+Crédito utilizado CBS limitado ao débito',
            ibsUsed: isPure ? 'Zero: sem crédito próprio de IBS no Simples Puro' : '+Crédito utilizado IBS limitado ao débito',
            grossProfit: 'Receita líquida + CMV total negativo + créditos CBS/IBS utilizados',
            salaries: '−Salários mensais × 12',
            benefits: '−Benefícios mensais × 12',
            payroll: isSimple ? '−Encargos efetivos fora do DAS informados × 12' : '−Salários anuais × percentual de encargos LP/LR',
            personnel: 'Salários + benefícios + encargos (subtotal negativo)',
            administrative: '−Despesas administrativas × 12',
            rent: '−Aluguel mensal × 12',
            cards: '−Despesas com cartões × 12',
            preTax: 'Lucro bruto + pessoal total + administração + aluguel + cartões',
            irpj: isSimple ? 'Zero: IRPJ já no DAS' : id === 'presumed' ? '−IRPJ total presumido' : '−IRPJ total sobre base positiva do Real',
            csll: isSimple ? 'Zero: CSLL já no DAS' : id === 'presumed' ? '−CSLL presumida' : '−CSLL sobre base positiva do Real',
            netProfit: 'Resultado antes de IRPJ/CSLL + IRPJ negativo + CSLL negativa',
            icmsUsed: outside ? 'Informativo: crédito já abatido no ICMS líquido; não somar ao resultado.' : 'Zero: ICMS no DAS, sem utilização externa',
            icmsBalance: outside ? 'Informativo: crédito ICMS excedente; não somar ao resultado.' : 'Zero: ICMS no DAS, sem crédito externo'
        };
        for (const key of Object.keys(dre)){
            dre[key] = available ? cleanZero(dre[key]) : 0;
            add(`dre.${id}.${key}`, `DRE · ${name}`, DRE_LABELS[key], available ? formulas[key] : `Indisponível: ${status}.`, dre[key]);
        }
        add(`difal.option.${id}`,`DIFAL · ${name}`,'Opção de DIFAL do cenário','Escolha somente no Simples Puro e Híbrido; o bloqueio automático prevalece sobre a inclusão.',!isSimple?'Não aplicável':application.enabled?'Incluir':'Excluir','text');
        add(`difal.operations.${id}`,`DIFAL · ${name}`,'Operações de DIFAL selecionadas','Entrada e saída são opções independentes por cenário; a seleção não altera os relatórios de origem.',!isSimple?'Não aplicável':DIFAL_OPERATIONS.filter(operation=>application.operations[operation]).map(operation=>operation==='entry'?'Entrada':'Saída').join(' e ')||'Nenhuma','text');
        add(`difal.status.${id}`,`DIFAL · ${name}`,'Aplicação do DIFAL e da antecipação',isSimple?(missingRbt12?'RBT12 desta competência não informada.':`RBT12 desta competência: ${currency(input.rbt12)}.`):'DIFAL não aplicável ao regime selecionado.',application.message,'text');
        const margin = available && revenue > 0 ? dre.netProfit / revenue : null;
        const totalTaxes = available ? cleanZero(taxes) : 0;
        const taxBurden = available && revenue > 0 ? totalTaxes / revenue : null;
        add(`summary.${id}.taxes`, `DRE · ${name}`, 'Tributos e encargos totais', 'DAS + débitos CBS/IBS + ICMS líquido + ISS + DIFAL estimado' + (hasAnticipation ? ' + antecipação de ICMS aplicável' : '') + ' + encargos + IRPJ + CSLL − créditos CBS/IBS utilizados; sem segunda dedução do crédito ICMS.', totalTaxes);
        add(`summary.${id}.monthly`, `DRE · ${name}`, 'Resultado médio mensal', 'Resultado líquido anual ÷ 12', dre.netProfit / MONTHS);
        add(`summary.${id}.margin`, `DRE · ${name}`, 'Margem líquida', 'Resultado líquido ÷ receita; não aplicável sem receita ou em regime indisponível.', margin ?? 'Não aplicável', margin === null ? 'text' : 'percent');
        add(`summary.${id}.burden`, `DRE · ${name}`, 'Carga sobre receita', 'Tributos e encargos totais ÷ receita; não aplicável sem receita ou em regime indisponível.', taxBurden ?? 'Não aplicável', taxBurden === null ? 'text' : 'percent');
        return {
            id,
            name,
            available,
            status,
            annualProfit: dre.netProfit,
            monthlyProfit: dre.netProfit / MONTHS,
            margin,
            totalTaxes,
            taxBurden,
            difalApplication:application,
            dre
        };
    }
    const regimes = regimeSelection.selected.map(id=>regime(id,REGIME_LABELS[id]));
    const ranked = revenue > 0 ? regimes.filter((item)=>item.available).sort((a, b)=>b.annualProfit - a.annualProfit) : [];
    const bestRegimeId = ranked[0]?.id ?? null;
    const difference = ranked.length > 1 ? ranked[0].annualProfit - ranked[ranked.length - 1].annualProfit : 0;
    warn('model-period', 'info', 'Cenário de 2027/2028', `O ano selecionado é ${input.year}. As partilhas pertencem a 2027/2028. CBS de ${percent(input.rates.cbs)} e IBS de ${percent(input.rates.ibs)} são premissas deste cenário.${input.rates.cbs===DEFAULT_RATES.cbs?' A CBS padrão de 11,3% acompanha a referência proposta pelo TCU em 28/10/2026, ainda sujeita à fixação pelo Senado Federal.':' Os percentuais informados foram preservados no cálculo.'} As premissas do cenário não confirmam alíquotas oficiais definitivas ou enquadramento fiscal.`);
    warn('icms-assumption', 'info',icmsProjection?'ICMS por natureza e UF':'Utilização da alíquota padrão de ICMS',icmsProjection?'Premissa gerencial: 18% nas operações internas e 12% nas interestaduais com UFs confirmadas. O crédito potencial soma compras elegíveis e devoluções de venda; serviços 8000 não geram crédito. A devolução usa a mesma premissa das vendas e não é abatida duas vezes. A alíquota e a base efetivas da nota, inclusive nas devoluções, precisam de conferência; 12% não é alíquota universal.':`O padrão da simulação é 18% nas vendas e nas compras/CMV de não optantes; o cenário usa ${percent(input.rates.icms)}. A mesma taxa gera débito e crédito potencial somente com ICMS fora do DAS. Não representa alíquota única nacional. Créditos dependem das operações e documentos fiscais.`);
    if(icmsProjection?.salesAdjustmentCents)warn('icms-sales-adjustment','info','Ajuste de receita com a composição de UFs da origem','O ajuste manual altera a base bruta de vendas pela proporção das bases internas e interestaduais importadas, com arredondamento no total da competência. Sem ajuste, conserva o arredondamento por linha. Devoluções e créditos dos documentos permanecem preservados.');
    if(icmsProjection?.grossSalesFloorApplied)warn('icms-sales-base-floor','warning','Base de ICMS limitada a zero','O ajuste manual deixou a base bruta reconstruída de ICMS abaixo de zero. O débito usa base zero, com receita e ajuste integralmente preservados na DRE. Créditos dos documentos permanecem separados, sem restituição automática. A análise continua disponível para conferência.');
    if(icmsProjection?.purchaseAdjustmentCents)warn('icms-purchase-adjustment','info','Crédito de ICMS vinculado aos documentos','O ajuste manual de compras modifica o custo, mas não cria ou exclui crédito fiscal das operações importadas. Para alterar naturezas, UFs ou crédito de origem, revise e reimporte os documentos.');
    if(icmsProjection&&!icmsProjection.available)warn('icms-operations-pending','warning','Apuração de ICMS exige conferência',icmsProjection.status+' Regimes com ICMS fora do DAS ficam pendentes; o Simples com ICMS no DAS mantém seu cálculo.');
    if(!input.revenueContext)warn('projection', 'info', 'Projeção gerencial de 12 meses', 'Um mês é repetido 12 vezes. Compras/CMV são uma simplificação de custo; não há controle de estoque, ajustes fiscais do Lucro Real, compensação de prejuízos nem apuração trimestral. O maior resultado é apenas o maior deste cenário, sujeito a enquadramento e premissas.');
    warn('credits-eligibility', 'info', 'Bases e percentuais creditáveis', 'Bases de CBS/IBS são informadas separadamente do CMV. Fornecedor Simples com tributos no DAS não transfere automaticamente a taxa regular integral. Créditos excedentes ficam separados e não aumentam o lucro.');
    warn('presumed-eligibility', 'info', 'Lucro Presumido sujeito ao enquadramento', 'A opção exige verificar a receita bruta total do ano-calendário anterior, limitada a R$ 78 milhões ou ao limite proporcional quando aplicável, além das situações que obrigam o Lucro Real (Lei 9.718/1998, arts. 13 e 14). A receita do ano anterior não é coletada; RBT12 e projeção não a substituem. A apresentação dos cálculos não confirma elegibilidade.');
    if (input.rbt12 > PRESUMED_ELIGIBILITY_REFERENCE || revenueReference > PRESUMED_ELIGIBILITY_REFERENCE) {
        const causes = [
            input.rbt12 > PRESUMED_ELIGIBILITY_REFERENCE ? `RBT12 de ${currency(input.rbt12)}` : '',
            revenueReference > PRESUMED_ELIGIBILITY_REFERENCE ? `${input.revenueContext?'receita do período':'projeção anual'} de ${currency(revenueReference)}` : ''
        ].filter(Boolean).join(' e ');
        warn('presumed-limit-reference', 'warning', 'Revise a elegibilidade ao Lucro Presumido', `${causes} supera(m) a referência de R$ 78 milhões. Confira a receita bruta total do ano-calendário anterior, o limite proporcional e as demais hipóteses de obrigatoriedade do Lucro Real. O cálculo permanece disponível porque o modelo não coleta os dados necessários para decidir o enquadramento; esse resultado não comprova o direito à opção.`);
    }
    if (input.rbt12 > SUBLIMIT || revenueReference > SUBLIMIT) {
        const causes = [
            input.rbt12 > SUBLIMIT ? `RBT12 de ${currency(input.rbt12)}` : '',
            revenueReference > SUBLIMIT ? `${input.revenueContext?'receita do período':'projeção anual'} de ${currency(revenueReference)}` : ''
        ].filter(Boolean).join(' e ');
        warn('sublimit', 'warning', 'Conferência do sublimite de ICMS/ISS', `${causes} supera(m) a referência de R$ 3,6 milhões. Isso não significa exclusão do Simples Nacional. A data de efeito sobre ICMS/ISS depende da receita acumulada no ano, ano anterior e excesso; RBT12 e projeções não substituem essa verificação. A opção não é alterada automaticamente.`);
    }
    if (hasSimples&&!simpleAvailable) warn('simples-unavailable', 'warning', 'Simples: revisão necessária para calcular', `${simpleStatus} ${simplesDiagnostic.action}`);
    if (input.salesAnnex === 2 && input.salesRevenue > 0) warn('industry-ipi', 'warning', 'Indústria: revise o IPI antes de comparar', 'O IPI do Anexo II permanece no DAS do Puro e do Híbrido. Este modelo não inclui IPI fora do DAS nos regimes de Lucro Presumido e Real. A comparação industrial está incompleta sem essa avaliação.');
    if (input.serviceRevenue > 0) warn('service-annex', 'info', 'Anexo de serviços informado', 'A classificação III/IV/V depende da atividade e, quando aplicável, do fator R. O sistema usa a seleção informada e não determina CNAE ou enquadramento automaticamente.');
    if (input.serviceAnnex === 4 && input.serviceRevenue > 0 && input.extraPayroll === 0) warn('annex-iv-payroll', 'warning', 'Anexo IV com encargos fora do DAS zerados', 'O Anexo IV exige revisar a CPP fora do DAS. Informe os encargos efetivos, considerando eventual atividade mista; o modelo mantém o zero que foi explicitamente informado.');
    if (excessRevenue > 0) warn('presumption-increase', 'warning', 'Acréscimo dos coeficientes de presunção', input.revenueContext?'O excedente do período a R$ 5 milhões é rateado proporcionalmente entre as competências, com acréscimo relativo de 10% nos coeficientes. Essa alocação gerencial anual não substitui a apuração e os limites proporcionais de cada trimestre.':'A parcela projetada acima de R$ 5 milhões recebe acréscimo relativo de 10% nos coeficientes, ponderado pela receita das atividades. A projeção pressupõe composição uniforme e não substitui a verificação por período.');
    if (revenue === 0) warn('zero-revenue', 'info', 'Receita zero aceita', 'A DRE continua calculando custos e despesas. Margem, carga sobre receita e ranking não são apresentados, pois não há receita para comparação.');
    if (annual.sales < 0) warn('negative-sales', 'warning', 'Devoluções ou ajustes superiores às vendas', 'O saldo de vendas de mercadorias após devoluções e ajustes está negativo. O valor foi preservado na DRE e a análise pode continuar. Bases de tributos sobre vendas usam mínimo zero; o excesso não cria imposto negativo, restituição ou compensação automática entre competências.');
    if (revenue < 0) warn('negative-revenue', 'warning', 'Receita negativa aceita', 'A receita após devoluções e ajustes ficou negativa e foi preservada integralmente. A DRE continua calculando compras, custos e despesas. Margem, carga sobre receita e ranking ficam sem percentual ou classificação quando a receita não é positiva.');
    if (cmv > 0 && cmv > revenue) warn('purchases-above-revenue', 'warning', 'Compras superiores à receita', 'As compras/CMV superam a receita após devoluções e ajustes. Os valores permanecem na DRE e não impedem concluir a análise. Confira formação de estoque, período dos documentos e a classificação das operações.');
    const operatingCosts = cmv + annual.salaries + annual.benefits + annual.administrative + annual.rent + annual.cards;
    if (operatingCosts > 0 && operatingCosts > revenue) warn('costs-above-revenue', 'warning', 'Custos e despesas superiores à receita', 'A soma de compras/CMV e despesas operacionais supera a receita. O resultado negativo é mantido e a análise continua disponível, com os valores informados e as premissas do cenário.');
    if (hasDifal) warn('difal-estimate', 'info', 'DIFAL de saída nos cenários Simples', 'A referência importada de 10% permanece disponível. Sua dedução ocorre somente no Simples Puro e Híbrido, com o cenário e a saída selecionados. RBT12 igual ou superior a R$ 3,6 milhões ou ICMS fora do DAS zera sua aplicação. Esta é uma premissa gerencial, não uma determinação de incidência legal.');
    if (hasAnticipation) warn('icms-anticipation', 'info', 'DIFAL de entrada — antecipação de ICMS', missingRbt12?'Aplicação pendente no Simples porque a RBT12 não foi informada. A base e o valor dos documentos permanecem preservados para conferência.':anticipationBlocked ? 'Antecipação zerada nesta competência: a RBT12 alcançou o sublimite de R$ 3,6 milhões ou o ICMS está fora do DAS. A base importada permanece na memória para conferência.' : 'Premissa gerencial de 7,32% sobre compras interestaduais elegíveis, somente no Simples Puro e Híbrido, com o cenário e a entrada selecionados. A dedução entra uma única vez na DRE e não gera crédito adicional.');
    if(!simpleAvailable){
      // Memory is also an export surface. Intermediate tax arithmetic from an
      // unsupported scenario must not look like a confirmed amount (or zero).
      for(const item of memory){
        const regimeAmount=/^(dre|summary)\.(pure|hybrid)\./.test(item.id);
        const simplesCalculation=item.id.startsWith('simples.')&&
          (missingRbt12?!['simples.revenueReference','simples.diagnostic','simples.action'].includes(item.id):
          !['simples.band','simples.revenueReference','simples.diagnostic','simples.action'].includes(item.id)&&!/^simples\.(sales|services)\.annex$/.test(item.id));
        if(regimeAmount||simplesCalculation)Object.assign(item,{unit:'text',value:'Conferência necessária',availability:'UNAVAILABLE',
          formula:`Sem valor confirmado para este cenário: ${simpleStatus}`});
      }
    }
    if(icmsProjection&&!icmsProjection.available){
      const pending=new Set(regimes.filter(regime=>!regime.available).map(regime=>regime.id));
      for(const item of memory){
        const id=/^(?:dre|summary)\.([^.]+)\./.exec(item.id)?.[1];
        if(item.unit==='currency'&&(item.id.startsWith('icms.')||item.id.startsWith('actual.')||pending.has(id)))Object.assign(item,{unit:'text',value:'Conferência necessária',availability:'UNAVAILABLE',formula:icmsProjection.status});
      }
    }
    return {
        version: MODEL_VERSION,
        regimeSelection,
        ...(missingRbt12?{rbt12Source:'NOT_PROVIDED'}:{}),
        ...(simplesDiagnostic?{simplesDiagnostic}:{}),
        difalPolicy:parseDifalPolicy(difalPolicy),
        annualRevenue: revenue,
        regimes,
        credits,
        warnings,
        memory,
        bestRegimeId,
        difference: cleanZero(difference)
    };
}

export const SIMULATION_VALUE_FIELDS = Object.freeze(['serviceRevenue', 'salesRevenue', 'simplePurchases', 'regularPurchases', 'salaries', 'benefits', 'adminExpenses', 'rent', 'cardExpenses']);

/** Preserve blanks: an unavailable report value is not an explicitly entered zero. */
export function createEmptyDraft() {
  return { year: 2027, salesAnnex: 1, serviceAnnex: 3, values: Object.fromEntries(SIMULATION_VALUE_FIELDS.map(key => [key, null])) };
}

/** Original credit-base rules with the current versioned scenario rates. */
export function draftToInput(draft, difalProjection = null, anticipationProjection = null, revenueContext = null, icmsOperations = null) {
  try {
    const explicitRbt12 = Object.hasOwn(draft, 'rbt12');
    const hasDifalPolicy=Object.hasOwn(draft,'difalPolicy');
    const hasIcmsOutside=Object.hasOwn(draft,'icmsOutside');
    const hasRegimeSelection=Object.hasOwn(draft,'regimeSelection');
    strictObject(draft, ['year','salesAnnex','serviceAnnex','values',...(explicitRbt12?['rbt12']:[]),...(hasDifalPolicy?['difalPolicy']:[]),...(hasIcmsOutside?['icmsOutside']:[]),...(hasRegimeSelection?['regimeSelection']:[])]);
    const regimeSelection=hasRegimeSelection?parseRegimeSelection(draft.regimeSelection):undefined,needsRbt12=requiresSimplesReference(regimeSelection);
    if(hasIcmsOutside&&typeof draft.icmsOutside!=='boolean')failInput(['icmsOutside'],'Informe uma opção válida.');
    const difalPolicy=hasDifalPolicy?parseDifalPolicy(draft.difalPolicy):null;
    checkChoices(draft);
    strictObject(draft.values, SIMULATION_VALUE_FIELDS, ['values']);
    for (const key of SIMULATION_VALUE_FIELDS) {
      if(key==='salesRevenue')checkSalesNumber(draft.values[key],['values',key]);else checkNumber(draft.values[key], VALUE_LIMIT, ['values', key]);
    }
    const values = draft.values;
    if(explicitRbt12&&draft.rbt12!==null&&(needsRbt12||draft.rbt12!=null))checkNumber(draft.rbt12, VALUE_LIMIT, ['rbt12']);
    // Only the historical draft without a regime selection keeps its old estimate.
    // Current analyses preserve an omitted reference as null, never as zero.
    const rbt12 = needsRbt12 ? explicitRbt12 ? draft.rbt12 : hasRegimeSelection?null:positive(values.serviceRevenue + values.salesRevenue) * 12 : null;
    if(needsRbt12&&rbt12!==null)checkNumber(rbt12, VALUE_LIMIT, ['rbt12']);
    if (difalProjection !== null && (difalProjection.version !== 'DIFAL_DRE_V1' ||
        !Number.isSafeInteger(difalProjection.monthlyCents) || difalProjection.monthlyCents < 0 ||
        !Number.isSafeInteger(difalProjection.annualCents) || difalProjection.annualCents !== difalProjection.monthlyCents * MONTHS)) {
      throw new TypeError('Projeção do DIFAL inválida.');
    }
    if (anticipationProjection !== null) {
      if (typeof anticipationProjection !== 'object' || Array.isArray(anticipationProjection) || anticipationProjection.version !== ICMS_ANTICIPATION_VERSION ||
          !Number.isSafeInteger(anticipationProjection.monthlyCents) || anticipationProjection.monthlyCents < 0 ||
          !Number.isSafeInteger(anticipationProjection.annualCents) || anticipationProjection.annualCents !== anticipationProjection.monthlyCents * MONTHS) throw new TypeError('Projeção da antecipação de ICMS inválida.');
      for (const key of ['sourceBaseCents','sourceAmountCents','pendingLines','eligibleLines']) if (Object.hasOwn(anticipationProjection,key) && (!Number.isSafeInteger(anticipationProjection[key]) || anticipationProjection[key] < 0)) throw new TypeError('Referência da antecipação de ICMS inválida.');
      if (Object.hasOwn(anticipationProjection,'reportMonths') && (!Number.isInteger(anticipationProjection.reportMonths) || anticipationProjection.reportMonths < 1 || anticipationProjection.reportMonths > 12)) throw new TypeError('Competências da antecipação de ICMS inválidas.');
      if (Object.hasOwn(anticipationProjection,'ratePercent') && anticipationProjection.ratePercent !== 7.32) throw new TypeError('Percentual da antecipação de ICMS inválido.');
    }
    return taxInputSchema.parse({
      ...values, year: draft.year, salesAnnex: draft.salesAnnex, serviceAnnex: draft.serviceAnnex,
      ...(hasDifalPolicy?{difalPolicy}:{}),
      ...(hasRegimeSelection?{regimeSelection}:{}),
      ...(revenueContext===null?{}:{revenueContext:parseRevenueContext(revenueContext)}),
      ...(icmsOperations===null?{}:{icmsOperations:parseIcmsOperations(icmsOperations)}),
      ...(difalProjection === null ? {} : {difalMonthly: difalProjection.monthlyCents / 100}),
      ...(anticipationProjection === null ? {} : {icmsAnticipation: {version: ICMS_ANTICIPATION_VERSION, monthlyCents: anticipationProjection.monthlyCents}}),
      simpleRegularPurchases: 0, extraPayroll: 0, icmsOutside: hasIcmsOutside?draft.icmsOutside:false,
      rbt12,
      rates: { ...DEFAULT_RATES },
      credits: {
        simple: { base: values.simplePurchases, cbsRate: .015, ibsRate: .0002 },
        simpleRegular: { base: 0, cbsRate: DEFAULT_RATES.cbs, ibsRate: DEFAULT_RATES.ibs },
        regular: { base: values.regularPurchases, cbsRate: DEFAULT_RATES.cbs, ibsRate: DEFAULT_RATES.ibs },
      },
    });
  } catch { return null; }
}

/** Display-ready projection. Novas simulações usam a RBT12 informada/extraída; snapshots antigos mantêm a estimativa histórica. */
export function calculateSimulation(draft, difalProjection = null, anticipationProjection = null, revenueContext = null, icmsOperations = null) {
  const explicitRbt12 = Object.hasOwn(draft, 'rbt12');
  const input = draftToInput(draft, difalProjection, anticipationProjection, revenueContext,icmsOperations);
  if (!input) throw new TypeError('Preencha todos os campos com valores válidos. Informe 0 quando não houver valor.');
  const result = calculateTax(input);
  const hasSimples=requiresSimplesReference(result.regimeSelection);
  if (hasSimples&&difalProjection !== null) {
    result.memory.push(
      {id: 'difal.source', section: 'DIFAL estimado', label: 'DIFAL do período importado', formula: 'Soma das estimativas por operação no relatório de origem; ajustes manuais de receita não alteram esta referência.', value: difalProjection.sourceAmountCents / 100, unit: 'currency'},
      {id: 'difal.monthly', section: 'DIFAL estimado', label: 'DIFAL médio mensal', formula: `Total importado ÷ ${difalProjection.reportMonths} competências, arredondado em centavos.`, value: difalProjection.monthlyCents / 100, unit: 'currency'}
    );
    if (difalProjection.pendingLines > 0) result.warnings.push({code: 'difal-partial', severity: 'warning', title: 'Base de DIFAL com pendências', detail: `${difalProjection.pendingLines} linhas aguardam UF do emitente ou destinatário. A referência inclui apenas a estimativa confirmada; sua dedução respeita as opções e os bloqueios de cada cenário. Corrija a origem e reimporte para completar a base.`});
  }
  if (hasSimples&&anticipationProjection !== null) {
    if (Object.hasOwn(anticipationProjection,'sourceBaseCents')) result.memory.push({id:'icmsAnticipation.base',section:'Antecipação de ICMS',label:'Base de compras interestaduais importada',formula:'Compras elegíveis com UF do emitente e do fornecedor confirmadas e diferentes; ajustes manuais não alteram a origem.',value:anticipationProjection.sourceBaseCents/100,unit:'currency'});
    if (Object.hasOwn(anticipationProjection,'sourceAmountCents')) result.memory.push({id:'icmsAnticipation.source',section:'Antecipação de ICMS',label:'Antecipação de ICMS do período importado',formula:'Estimativa de 7,32% das compras interestaduais elegíveis, antes do bloqueio por sublimite da competência.',value:anticipationProjection.sourceAmountCents/100,unit:'currency'});
    result.memory.push({id:'icmsAnticipation.monthly',section:'Antecipação de ICMS',label:'Antecipação de ICMS mensal importada',formula:'Valor mensal confirmado da origem, antes da aplicação por regime e do bloqueio por sublimite.',value:anticipationProjection.monthlyCents/100,unit:'currency'});
    if (anticipationProjection.pendingLines > 0) result.warnings.push({code:'icms-anticipation-partial',severity:'warning',title:'Antecipação de ICMS parcial',detail:`${anticipationProjection.pendingLines} linhas aguardam confirmação da UF do emitente ou fornecedor. UFs ausentes não foram tratadas como compras interestaduais.`});
  }
  const rbt12 = result.memory.find(row => row.id === 'rbt12');
  if(rbt12&&input.rbt12===null){
    rbt12.label='RBT12 não informada';
    rbt12.formula='Referência opcional não informada. O Simples permanece sem cálculo confirmado; os demais regimes seguem suas próprias premissas.';
    result.warnings.push({code:'rbt12-not-provided',severity:'info',title:'RBT12 e extrato opcionais',detail:'Esta análise foi salva sem RBT12 ou PDF do PGDAS-D. Os cenários do Simples ficam pendentes de cálculo, sem usar zero ou estimar a receita histórica. Informe a referência se desejar calcular esses cenários.'});
  } else if (rbt12&&explicitRbt12) {
    rbt12.label = 'RBT12 do Simples Nacional';
    rbt12.formula = 'Receita bruta acumulada nos 12 meses anteriores ao período de apuração, informada manualmente ou extraída do Extrato do Simples Nacional.';
    result.warnings.push({ code: 'rbt12-source', severity: 'info', title: 'RBT12 informada', detail: 'A faixa do Simples usa a RBT12 fornecida para este cenário. Quando o valor veio do PDF, confira a conciliação exibida no leitor do extrato.' });
  } else if(rbt12) {
    rbt12.label = 'Receita estimada em 12 meses';
    rbt12.formula = 'Máximo(0; receita mensal de serviços + receita mensal de vendas) × 12. Compatibilidade com versões anteriores; não é a RBT12 efetiva.';
    result.warnings.push({ code: 'estimated-rbt12', severity: 'info', title: 'RBT12 estimada em versão anterior', detail: 'Este cenário não recebeu RBT12 explícita e usa a estimativa de receita mensal × 12, com mínimo zero para saldos negativos. Confira a RBT12 efetiva antes de usar o resultado fiscalmente.' });
  }
  return result;
}
