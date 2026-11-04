/** Public DRE entry point. The captured calculation/presentation remains read-only. */
export * from './simulator-dre-core.js';
import {capturedDreRows} from './simulator-dre-core.js';
import {withIrpjBreakdown} from './simulator-irpj-display.js';

/** Keep the public API while exposing normal IRPJ and its additional separately. */
export function unifiedDreRows(presentation) {
  return withIrpjBreakdown(presentation,capturedDreRows(presentation));
}
