/**
 * Maximum simulator: faithful JavaScript port of the existing calculadora model.
 * Source: devarrthurferreira/calculadora@d60e8bc3b2edcc2ebd4ff11cf584689f01d0d381
 * Files: src/lib/tax/{constants,engine,schema}.ts and src/lib/simulation.ts.
 * Formulas and numerical defaults are unchanged; schema validation has no dependencies.
 * Forecast assumptions only; this port does not establish fiscal eligibility.
 */
export const CALCULATOR_SOURCE_COMMIT = 'd60e8bc3b2edcc2ebd4ff11cf584689f01d0d381';

export const DEFAULT_RATES = {
    cbs: 0.0911,
    ibs: 0.001,
    icms: 0.18,
    iss: 0.05,
    payroll: 0.278,
    irSales: 0.08,
    csSales: 0.12,
    irServices: 0.32,
    csServices: 0.32
};
export const MODEL_VERSION = '1.0.0-2027-2028';
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
            cbsRate: .0911,
            ibsRate: .001
        },
        regular: {
            base: 10_400,
            cbsRate: .0911,
            ibsRate: .001
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
function checkChoices(input) {
  for (const [key, values] of [['year', [2027, 2028]], ['salesAnnex', [1, 2]], ['serviceAnnex', [3, 4, 5]]]) {
    if (!values.includes(input[key])) failInput([key], 'Opção inválida.');
  }
}
function parseTaxInput(input) {
  strictObject(input, [...TAX_AMOUNT_FIELDS, 'year', 'salesAnnex', 'serviceAnnex', 'icmsOutside', 'rates', 'credits']);
  checkChoices(input);
  if (typeof input.icmsOutside !== 'boolean') failInput(['icmsOutside'], 'Informe uma opção válida.');
  for (const key of TAX_AMOUNT_FIELDS) checkNumber(input[key], VALUE_LIMIT, [key]);
  strictObject(input.rates, RATE_FIELDS, ['rates']);
  for (const key of RATE_FIELDS) checkNumber(input.rates[key], 1, ['rates', key]);
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
  return { ...input, rates: { ...input.rates }, credits: Object.fromEntries(CREDIT_GROUPS.map(key => [key, { ...input.credits[key] }])) };
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
    const used = Math.min(debit, potential);
    return {
        debit,
        potential,
        used,
        due: positive(debit - used),
        balance: positive(potential - used)
    };
}
const DRE_LABELS = {
    services: 'Receita de serviços',
    sales: 'Receita de vendas',
    revenue: 'Receita bruta total',
    das: 'DAS',
    cbsDebit: 'Débito de CBS',
    ibsDebit: 'Débito de IBS',
    icmsNet: 'ICMS líquido fora do DAS',
    iss: 'ISS fora do DAS',
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
    const memory = [];
    const warnings = [];
    const add = (id, section, label, formula, value, unit = 'currency')=>{
        memory.push({
            id,
            section,
            label,
            formula,
            value: typeof value === 'number' ? cleanZero(value) : value,
            unit
        });
    };
    const warn = (code, severity, title, detail)=>warnings.push({
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
    const cmv = annual.cmvSimple + annual.cmvRegular;
    const operational = revenue - cmv - annual.salaries - annual.benefits - annual.administrative - annual.rent - annual.cards;
    add('year', 'Premissas', 'Ano do cenário', 'Partilhas do Simples válidas para 2027 e 2028.', input.year, 'number');
    add('months', 'Premissas', 'Horizonte da projeção', 'Um mês informado repetido em 12 meses; valores anuais não são uma apuração trimestral.', MONTHS, 'number');
    add('rbt12', 'Premissas', 'RBT12', 'Receita total efetiva dos últimos 12 meses informada pelo usuário; separada da projeção.', input.rbt12);
    add('sublimit', 'Premissas', 'Sublimite de referência', 'Referência preventiva para ICMS/ISS fora do DAS.', SUBLIMIT);
    add('simplesLimit', 'Premissas', 'Limite do Simples', 'Limite de referência do modelo.', SIMPLES_LIMIT);
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
    add('annual.cmv', 'Valores anuais', 'CMV total anual', 'CMV de optantes + CMV de não optantes; a parcela SN regular não é somada outra vez.', cmv);
    add('annual.operational', 'Valores anuais', 'Resultado antes de tributos e encargos', 'Receita − CMV − salários − benefícios − administração − aluguel − cartões', operational);
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
        cbs: apportion(revenue * input.rates.cbs, cbsPotential),
        ibs: apportion(revenue * input.rates.ibs, ibsPotential),
        icms: apportion(annual.sales * input.rates.icms, annual.cmvRegular * input.rates.icms)
    };
    for (const key of [
        'cbs',
        'ibs',
        'icms'
    ]){
        const credit = credits[key];
        const name = key.toUpperCase();
        add(`${key}.debit`, `Apuração de ${name}`, `Débito de ${name}`, key === 'icms' ? `${currency(annual.sales)} de vendas anuais × ${percent(input.rates.icms)}` : `${currency(revenue)} de receita anual × ${percent(input.rates[key])}`, credit.debit);
        add(`${key}.potential`, `Apuração de ${name}`, `Crédito potencial de ${name}`, key === 'icms' ? `${currency(annual.cmvRegular)} de compras/CMV de não optantes × ${percent(input.rates.icms)}` : `Soma dos créditos de ${name} dos três grupos; sem compensar outro tributo.`, credit.potential);
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
    const salesDas = annual.sales * salesEffective;
    const serviceDas = annual.services * serviceEffective;
    const icmsRemoved = input.icmsOutside ? annual.sales * salesIcmsEffective : 0;
    const issRemoved = input.icmsOutside ? annual.services * serviceIssEffective : 0;
    const pureDas = salesDas - icmsRemoved + serviceDas - issRemoved;
    const cbsRemoved = annual.sales * salesCbsEffective + annual.services * serviceCbsEffective;
    const ibsRemoved = annual.sales * salesIbsEffective + annual.services * serviceIbsEffective;
    const hybridDas = positive(pureDas - cbsRemoved - ibsRemoved);
    const ipiIncluded = annual.sales * salesEffective * (salesBand?.ipiShare ?? 0);
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
            'Receita de vendas anual × alíquota efetiva de vendas',
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
            'Se recolhimento fora do DAS: vendas anuais × ICMS efetivo no DAS; caso contrário, zero.',
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
            'Vendas anuais × CBS efetiva de vendas + serviços anuais × CBS efetiva de serviços',
            cbsRemoved
        ],
        [
            'ibsRemoved',
            'IBS retirado no Híbrido',
            'Vendas anuais × IBS efetivo de vendas + serviços anuais × IBS efetivo de serviços',
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
            'Vendas anuais × efetiva × participação IPI; já no DAS, sem nova soma.',
            ipiIncluded
        ]
    ])add(`simples.${id}`, 'Simples Nacional', label, formula, value);
    const excessRevenue = positive(revenue - PRESUMPTION_LIMIT);
    const irBase = annual.sales * input.rates.irSales + annual.services * input.rates.irServices;
    const csBase = annual.sales * input.rates.csSales + annual.services * input.rates.csServices;
    const irCoefficient = revenue > 0 ? irBase / revenue : 0;
    const csCoefficient = revenue > 0 ? csBase / revenue : 0;
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
            'Máximo(0; receita anual − R$ 5.000.000)',
            excessRevenue
        ],
        [
            'irBase',
            'Base IRPJ sem acréscimo',
            `Vendas anuais × ${percent(input.rates.irSales)} + serviços anuais × ${percent(input.rates.irServices)}`,
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
            `Vendas anuais × ${percent(input.rates.csSales)} + serviços anuais × ${percent(input.rates.csServices)}`,
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
    add('presumed.irCoefficient', 'Lucro Presumido', 'Coeficiente médio IRPJ', 'Base IRPJ sem acréscimo ÷ receita total; zero se receita zero.', irCoefficient, 'percent');
    add('presumed.csCoefficient', 'Lucro Presumido', 'Coeficiente médio CSLL', 'Base CSLL sem acréscimo ÷ receita total; zero se receita zero.', csCoefficient, 'percent');
    for (const [id, label, formula, value] of [
        [
            'preTax',
            'Resultado antes de IRPJ/CSLL',
            'Resultado operacional − CBS líquido − IBS líquido − ICMS líquido − ISS − encargos LP/LR',
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
    let simpleStatus = input.icmsOutside ? 'Disponível · ICMS/ISS fora do DAS' : 'Disponível';
    let simpleAvailable = true;
    if (revenue > SIMPLES_LIMIT || input.rbt12 > SIMPLES_LIMIT) {
        simpleStatus = 'Fora do limite de referência do Simples';
        simpleAvailable = false;
    } else if (revenue > 0 && input.rbt12 === 0) {
        simpleStatus = 'Informe a RBT12 para calcular o Simples';
        simpleAvailable = false;
    } else if (input.rbt12 > SUBLIMIT && !input.icmsOutside) {
        simpleStatus = 'Revise o sublimite e o ICMS/ISS fora do DAS';
        simpleAvailable = false;
    } else if (revenue === 0) {
        simpleStatus = 'Calculado com receita zero';
    }
    function regime(id, name) {
        const isSimple = id === 'pure' || id === 'hybrid';
        const isPure = id === 'pure';
        const outside = !isSimple || input.icmsOutside;
        const available = !isSimple || simpleAvailable;
        const dre = {
            services: annual.services,
            sales: annual.sales,
            revenue,
            das: -(id === 'pure' ? pureDas : id === 'hybrid' ? hybridDas : 0),
            cbsDebit: isPure ? 0 : -credits.cbs.debit,
            ibsDebit: isPure ? 0 : -credits.ibs.debit,
            icmsNet: outside ? -credits.icms.due : 0,
            iss: outside ? -iss : 0,
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
        dre.netRevenue = dre.revenue + dre.das + dre.cbsDebit + dre.ibsDebit + dre.icmsNet + dre.iss;
        dre.grossProfit = dre.netRevenue + dre.cmv + dre.cbsUsed + dre.ibsUsed;
        dre.personnel = dre.salaries + dre.benefits + dre.payroll;
        dre.preTax = dre.grossProfit + dre.personnel + dre.administrative + dre.rent + dre.cards;
        dre.netProfit = dre.preTax + dre.irpj + dre.csll;
        const taxes = -dre.das - dre.cbsDebit - dre.ibsDebit - dre.icmsNet - dre.iss - dre.payroll - dre.irpj - dre.csll - dre.cbsUsed - dre.ibsUsed;
        const formulas = {
            services: 'Serviços mensais × 12',
            sales: 'Vendas mensais × 12',
            revenue: 'Serviços anuais + vendas anuais',
            das: isPure ? '−DAS Puro' : id === 'hybrid' ? '−DAS residual Híbrido' : 'Zero: regime fora do Simples',
            cbsDebit: isPure ? 'Zero: CBS incluída no DAS' : '−Débito anual de CBS',
            ibsDebit: isPure ? 'Zero: IBS incluído no DAS' : '−Débito anual de IBS',
            icmsNet: outside ? '−(débito ICMS − crédito ICMS utilizado)' : 'Zero: ICMS incluído no DAS; sem crédito externo',
            iss: outside ? '−Serviços anuais × alíquota de ISS' : 'Zero: ISS incluído no DAS',
            netRevenue: 'Receita bruta + linhas negativas de DAS, CBS, IBS, ICMS e ISS',
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
            add(`dre.${id}.${key}`, `DRE · ${name}`, DRE_LABELS[key], available ? formulas[key] : `Indisponível: ${simpleStatus}.`, dre[key]);
        }
        const margin = available && revenue > 0 ? dre.netProfit / revenue : null;
        const totalTaxes = available ? cleanZero(taxes) : 0;
        const taxBurden = available && revenue > 0 ? totalTaxes / revenue : null;
        add(`summary.${id}.taxes`, `DRE · ${name}`, 'Tributos e encargos totais', 'DAS + débitos CBS/IBS + ICMS líquido + ISS + encargos + IRPJ + CSLL − créditos CBS/IBS utilizados; sem segunda dedução do crédito ICMS.', totalTaxes);
        add(`summary.${id}.monthly`, `DRE · ${name}`, 'Resultado médio mensal', 'Resultado líquido anual ÷ 12', dre.netProfit / MONTHS);
        add(`summary.${id}.margin`, `DRE · ${name}`, 'Margem líquida', 'Resultado líquido ÷ receita; não aplicável sem receita ou em regime indisponível.', margin ?? 'Não aplicável', margin === null ? 'text' : 'percent');
        add(`summary.${id}.burden`, `DRE · ${name}`, 'Carga sobre receita', 'Tributos e encargos totais ÷ receita; não aplicável sem receita ou em regime indisponível.', taxBurden ?? 'Não aplicável', taxBurden === null ? 'text' : 'percent');
        return {
            id,
            name,
            available,
            status: isSimple ? simpleStatus : revenue === 0 ? 'Calculado com receita zero' : id === 'presumed' ? 'Simulação sujeita ao enquadramento' : 'Disponível',
            annualProfit: dre.netProfit,
            monthlyProfit: dre.netProfit / MONTHS,
            margin,
            totalTaxes,
            taxBurden,
            dre
        };
    }
    const regimes = [
        regime('pure', 'Simples Puro'),
        regime('hybrid', 'Simples Híbrido'),
        regime('presumed', 'Lucro Presumido'),
        regime('actual', 'Lucro Real')
    ];
    const ranked = revenue > 0 ? regimes.filter((item)=>item.available).sort((a, b)=>b.annualProfit - a.annualProfit) : [];
    const bestRegimeId = ranked[0]?.id ?? null;
    const difference = ranked.length > 1 ? ranked[0].annualProfit - ranked[ranked.length - 1].annualProfit : 0;
    warn('model-period', 'info', 'Cenário de 2027/2028', `O ano selecionado é ${input.year}. As partilhas pertencem a 2027/2028. CBS de 9,11% e IBS de 0,10% são hipóteses iniciais editáveis, não promessa de alíquota oficial definitiva.`);
    warn('icms-assumption', 'info', 'Utilização da alíquota padrão de ICMS', `O padrão da simulação é 18% nas vendas e nas compras/CMV de não optantes; o cenário usa ${percent(input.rates.icms)}. A mesma taxa gera débito e crédito potencial somente com ICMS fora do DAS. Não representa alíquota única nacional. Créditos dependem das operações e documentos fiscais.`);
    warn('projection', 'info', 'Projeção gerencial de 12 meses', 'Um mês é repetido 12 vezes. Compras/CMV são uma simplificação de custo; não há controle de estoque, ajustes fiscais do Lucro Real, compensação de prejuízos nem apuração trimestral. O maior resultado é apenas o maior deste cenário, sujeito a enquadramento e premissas.');
    warn('credits-eligibility', 'info', 'Bases e percentuais creditáveis', 'Bases de CBS/IBS são informadas separadamente do CMV. Fornecedor Simples com tributos no DAS não transfere automaticamente a taxa regular integral. Créditos excedentes ficam separados e não aumentam o lucro.');
    warn('presumed-eligibility', 'info', 'Lucro Presumido sujeito ao enquadramento', 'A opção exige verificar a receita bruta total do ano-calendário anterior, limitada a R$ 78 milhões ou ao limite proporcional quando aplicável, além das situações que obrigam o Lucro Real (Lei 9.718/1998, arts. 13 e 14). A receita do ano anterior não é coletada; RBT12 e projeção não a substituem. A apresentação dos cálculos não confirma elegibilidade.');
    if (input.rbt12 > PRESUMED_ELIGIBILITY_REFERENCE || revenue > PRESUMED_ELIGIBILITY_REFERENCE) {
        const causes = [
            input.rbt12 > PRESUMED_ELIGIBILITY_REFERENCE ? `RBT12 de ${currency(input.rbt12)}` : '',
            revenue > PRESUMED_ELIGIBILITY_REFERENCE ? `projeção anual de ${currency(revenue)}` : ''
        ].filter(Boolean).join(' e ');
        warn('presumed-limit-reference', 'warning', 'Revise a elegibilidade ao Lucro Presumido', `${causes} supera(m) a referência de R$ 78 milhões. Confira a receita bruta total do ano-calendário anterior, o limite proporcional e as demais hipóteses de obrigatoriedade do Lucro Real. O cálculo permanece disponível porque o modelo não coleta os dados necessários para decidir o enquadramento; esse resultado não comprova o direito à opção.`);
    }
    if (input.rbt12 > SUBLIMIT || revenue > SUBLIMIT) {
        const causes = [
            input.rbt12 > SUBLIMIT ? `RBT12 de ${currency(input.rbt12)}` : '',
            revenue > SUBLIMIT ? `projeção anual de ${currency(revenue)}` : ''
        ].filter(Boolean).join(' e ');
        warn('sublimit', 'warning', 'Sublimite de R$ 3,6 milhões ultrapassado', `${causes} supera(m) o sublimite de referência. Revise ICMS/ISS fora do DAS. A data de efeito exige examinar receita acumulada no ano, ano anterior e excesso; o aviso não altera a opção automaticamente.`);
    }
    if (!simpleAvailable) warn('simples-unavailable', 'warning', 'Simples indisponível neste cenário', simpleStatus + '. Os resultados de Presumido e Real continuam disponíveis.');
    if (input.salesAnnex === 2 && input.salesRevenue > 0) warn('industry-ipi', 'warning', 'Indústria: revise o IPI antes de comparar', 'O IPI do Anexo II permanece no DAS do Puro e do Híbrido. Este modelo não inclui IPI fora do DAS nos regimes de Lucro Presumido e Real. A comparação industrial está incompleta sem essa avaliação.');
    if (input.serviceRevenue > 0) warn('service-annex', 'info', 'Anexo de serviços informado', 'A classificação III/IV/V depende da atividade e, quando aplicável, do fator R. O sistema usa a seleção informada e não determina CNAE ou enquadramento automaticamente.');
    if (input.serviceAnnex === 4 && input.serviceRevenue > 0 && input.extraPayroll === 0) warn('annex-iv-payroll', 'warning', 'Anexo IV com encargos fora do DAS zerados', 'O Anexo IV exige revisar a CPP fora do DAS. Informe os encargos efetivos, considerando eventual atividade mista; o modelo mantém o zero que foi explicitamente informado.');
    if (excessRevenue > 0) warn('presumption-increase', 'warning', 'Acréscimo dos coeficientes de presunção', 'A parcela projetada acima de R$ 5 milhões recebe acréscimo relativo de 10% nos coeficientes, ponderado pela receita das atividades. A projeção pressupõe composição uniforme e não substitui a verificação por período.');
    if (revenue === 0) warn('zero-revenue', 'info', 'Receita zero aceita', 'A DRE continua calculando custos e despesas. Margem, carga sobre receita e ranking não são apresentados, pois não há receita para comparação.');
    return {
        version: MODEL_VERSION,
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

/** Same assumptions and default credit bases as calculadora/src/lib/simulation.ts. */
export function draftToInput(draft) {
  try {
    strictObject(draft, ['year', 'salesAnnex', 'serviceAnnex', 'values']);
    checkChoices(draft);
    strictObject(draft.values, SIMULATION_VALUE_FIELDS, ['values']);
    for (const key of SIMULATION_VALUE_FIELDS) checkNumber(draft.values[key], VALUE_LIMIT, ['values', key]);
    const values = draft.values;
    return taxInputSchema.parse({
      ...values, year: draft.year, salesAnnex: draft.salesAnnex, serviceAnnex: draft.serviceAnnex,
      simpleRegularPurchases: 0, extraPayroll: 0, icmsOutside: false,
      rbt12: (values.serviceRevenue + values.salesRevenue) * 12,
      rates: { ...DEFAULT_RATES },
      credits: {
        simple: { base: values.simplePurchases, cbsRate: .015, ibsRate: .0002 },
        simpleRegular: { base: 0, cbsRate: DEFAULT_RATES.cbs, ibsRate: DEFAULT_RATES.ibs },
        regular: { base: values.regularPurchases, cbsRate: DEFAULT_RATES.cbs, ibsRate: DEFAULT_RATES.ibs },
      },
    });
  } catch { return null; }
}

/** Display-ready projection. The RBT12 proxy is explicitly identified in its memory. */
export function calculateSimulation(draft) {
  const input = draftToInput(draft);
  if (!input) throw new TypeError('Preencha todos os campos com valores válidos. Informe 0 quando não houver valor.');
  const result = calculateTax(input);
  const rbt12 = result.memory.find(row => row.id === 'rbt12');
  rbt12.label = 'Receita estimada em 12 meses';
  rbt12.formula = 'Receita mensal de serviços + receita mensal de vendas, multiplicadas por 12. Estimativa usada como referência da simulação; não é a receita real dos últimos 12 meses.';
  result.warnings.push({ code: 'estimated-rbt12', severity: 'info', title: 'Receita de 12 meses estimada', detail: 'A referência para as faixas do Simples é a receita mensal × 12. A simulação não consultou o faturamento real dos últimos 12 meses. As alíquotas e bases de crédito seguem as premissas da calculadora Maximum.' });
  return result;
}
