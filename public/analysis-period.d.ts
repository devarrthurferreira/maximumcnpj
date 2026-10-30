export const JAN_SEP_POLICY:'JAN_SEP_V1';
export const JAN_SEP_MODEL_VERSION:'1.16.0-cpf-sales-difal-available-months';
export type AnalysisPeriod={version:typeof JAN_SEP_POLICY;sourceYear:number;startMonth:string;endMonth:string;months:number;
  availableMonths?:string[];expectedMonths:string[];includedMonths:string[];excludedMonths:string[];missingMonths:string[];complete:boolean};
export type SourcePeriod={startMonth:string;endMonth:string;months:number};
export function analysisMonthsForYear(sourceYear:number):string[];
export function isAnalysisMonth(sourceMonth:unknown,sourceYear?:number):boolean;
export function reportMonthsInPeriod(period:SourcePeriod|null|undefined):string[];
export function buildAnalysisPeriod(purchasesPeriod:SourcePeriod|null|undefined,salesPeriod:SourcePeriod|null|undefined):AnalysisPeriod;
export function assertCompleteAnalysisPeriod(period:AnalysisPeriod|null|undefined,reports?:readonly {sourceMonth:string}[]):AnalysisPeriod;

export function selectAnalysisPeriod(period:AnalysisPeriod,sourceMonths:string[]):AnalysisPeriod;
