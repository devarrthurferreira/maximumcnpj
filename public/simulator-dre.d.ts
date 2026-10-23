export const DRE_PRESENTATION_VERSION: 'DRE_PRESENTATION_V1';
export type DrePresentationRow = {
  key:string;label:string;kind:'line'|'subtotal'|'detail'|'indicator';unit:'currency'|'percent';
  values:Record<string,number|null>;monthlyValues:Record<string,(number|null)[]>;calendarAnnualValues:Record<string,number|null>;
  percentValues:Record<string,number|null>;monthlyPercentValues:Record<string,(number|null)[]>;calendarAnnualPercentValues:Record<string,number|null>;
  reasonByRegime:Record<string,string>;calendarReasonByRegime:Record<string,string>;monthlyReasonByRegime?:Record<string,string[]>;notes:string[];informative:boolean;parentKey?:string;sourceRefs:string[];
};
export type DrePresentation = {
  version:'DRE_PRESENTATION_V1';method?:string|null;regimes:Array<{id:string;name:string;available:boolean;status?:string;monthlyAvailability?:boolean[];monthlyStatuses?:string[];difalApplication?:import('./simulator-engine.js').SimulationRegime['difalApplication']}>;
  report?:{modelVersion:string|null;sourceMonths:string[];warnings:Array<{code:string;severity:string;title:string;detail:string}>;memory:Array<{id:string;section:string;label:string;formula:string;value:number|string;unit:string}>;sources:Array<{label:string;url:string}>;reportPeriod:any};
  difalPolicy?:import('./simulator-engine.js').DifalPolicy;
  simplesDiagnostic?:any;
  sections:Array<{key:string;label:string;rows:DrePresentationRow[]}>;
  details:Array<{key:string;label:string;parentKey:string;rows:DrePresentationRow[]}>;indicators:DrePresentationRow[];
  revenueReconciliation?:{key:'revenueReconciliation';label:string;note:string;rows:DrePresentationRow[]};
  months:Array<{number:number;label:string;period:string|null;sourceMonth?:string|null;rbt12Cents?:number|null}>;
  rbt12Schedule?:import('./simulator-rbt12.js').Rbt12Schedule;
  calendarYear:number|null;calendarReference:any;calendarRounding:string;percentBasis:string;
};
export function buildDrePresentation(input:{result:any;monthlyGroups?:any;projection?:any;source?:any;reportMonths?:number;engineInput?:any;reprocessing?:any;calendar?:any;taxSources?:any}):DrePresentation;
export function unifiedDreRows(presentation:DrePresentation):DrePresentationRow[];
export function dreDifalNotes(presentation:DrePresentation,options?:{sourceMonth?:string|null}):string[];
export function dreReportCoverage(presentation:DrePresentation):{actual:boolean;sourceMonths:string[];count:number|null;completeYear:boolean;label:string;detail:string};
export function dreRegimeStatuses(presentation:DrePresentation,options?:{sourceMonth?:string|null}):Array<{id:string;name:string;available:boolean;status:string;months:Array<{available:boolean;status:string;months:string[]}>}>;
export function dreReportMemory(presentation:DrePresentation,options?:{includeDre?:boolean}):NonNullable<DrePresentation['report']>['memory'];
