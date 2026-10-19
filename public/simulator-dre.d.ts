export const DRE_PRESENTATION_VERSION: 'DRE_PRESENTATION_V1';
export type DrePresentationRow = {
  key:string;label:string;kind:'line'|'subtotal'|'detail'|'indicator';unit:'currency'|'percent';
  values:Record<string,number|null>;monthlyValues:Record<string,(number|null)[]>;calendarAnnualValues:Record<string,number|null>;
  percentValues:Record<string,number|null>;monthlyPercentValues:Record<string,(number|null)[]>;calendarAnnualPercentValues:Record<string,number|null>;
  reasonByRegime:Record<string,string>;calendarReasonByRegime:Record<string,string>;notes:string[];informative:boolean;parentKey?:string;sourceRefs:string[];
};
export type DrePresentation = {
  version:'DRE_PRESENTATION_V1';regimes:Array<{id:string;name:string;available:boolean}>;
  sections:Array<{key:string;label:string;rows:DrePresentationRow[]}>;
  details:Array<{key:string;label:string;parentKey:string;rows:DrePresentationRow[]}>;indicators:DrePresentationRow[];
  months:Array<{number:number;label:string;period:string|null}>;calendarYear:number|null;calendarReference:any;calendarRounding:string;percentBasis:string;
};
export function buildDrePresentation(input:{result:any;monthlyGroups?:any;projection?:any;source?:any;reportMonths?:number;engineInput?:any;reprocessing?:any;calendar?:any}):DrePresentation;
