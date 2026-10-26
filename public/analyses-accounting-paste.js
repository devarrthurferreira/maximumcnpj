import {ACCOUNTING_FIELDS,esc,money,monthLabel} from './analyses-view.js';

/** Preview only: the controller applies an explicit choice to the local draft. */
export function renderAccountingPaste({text='',preview=null,error='',replaceConfirmed=false,open=false,sourceMonths=[],canWrite=true}={}) {
  const plan=preview?.plan,parsed=preview?.parsed;
  const unexpected=sourceMonths.length&&parsed?parsed.months.filter(row=>!sourceMonths.includes(row.sourceMonth)).map(row=>row.sourceMonth):[];
  return `<details class="analysis-paste" id="analysis-accounting-paste-panel" ${open?'open':''}>
    <summary>Colar despesas de uma planilha</summary>
    <p class="analysis-note">Copie as seis colunas na ordem abaixo e cole aqui. Você confere os meses e valores antes de aplicar ao formulário.</p>
    <p class="analysis-note"><strong>Competência · Salários e pró-labore · Aluguéis · Taxas de cartão · Benefícios · Outras despesas</strong></p>
    <label for="analysis-accounting-paste">Dados copiados da planilha</label>
    <textarea id="analysis-accounting-paste" rows="5" wrap="off" spellcheck="false" maxlength="100000" aria-describedby="analysis-paste-help" ${canWrite?'':'disabled'} placeholder="01/2026&#9;1.500,00&#9;800,00&#9;120,00&#9;300,00&#9;0,00">${esc(text)}</textarea>
    <p class="analysis-note" id="analysis-paste-help">Use TAB (ao copiar do Excel) ou ponto e vírgula. Competência: 01/2026 ou 2026-01. Valores em reais, como 1.234,56 ou 1234.56; ponto com grupos de três dígitos indica milhar. Células vazias ficam pendentes. Máximo de 12 competências.</p>
    <div class="analysis-actions analysis-paste-actions"><button type="button" id="analysis-preview-accounting-paste" ${canWrite?'':'disabled'}>Conferir colagem</button><button type="button" id="analysis-download-accounting-template" ${canWrite?'':'disabled'}>Baixar modelo CSV</button><button type="button" id="analysis-clear-accounting-paste" ${canWrite&&text?'':'disabled'}>Limpar colagem</button></div>
    <p id="analysis-accounting-paste-error" class="analysis-message is-error" role="alert" ${error?'':'hidden'}>${esc(error)}</p>
    <div id="analysis-accounting-paste-preview" class="analysis-paste-preview" ${preview?'':'hidden'}>
      ${preview?`<h3>Confira antes de aplicar</h3><div class="analysis-paste-summary"><span><strong>${parsed.monthCount}</strong> competência(s) na colagem</span><span><strong>${plan.addedMonths.length}</strong> nova(s)</span><span><strong>${plan.replacedMonths.length}</strong> já no formulário</span><span>Total preenchido: <strong>${money(parsed.totalCents/100)}</strong></span></div>
      ${parsed.blankCount?`<p class="analysis-message is-warning">${parsed.blankCount} campo(s) em branco continuarão pendentes. Informe os valores ou confirme zero antes de concluir o Contábil.</p>`:''}
      ${unexpected.length?`<p class="analysis-message is-warning">Competências fora dos relatórios fiscais atuais: ${unexpected.map(month=>esc(monthLabel(month))).join(' · ')}. A geração exige que os meses dos dois setores coincidam.</p>`:''}
      <p class="analysis-note">Deslize a tabela na horizontal para conferir todas as categorias.</p>
      <div class="analysis-paste-table-wrap" tabindex="0" role="region" aria-label="Prévia dos valores contábeis colados"><table><thead><tr><th scope="col">Competência</th>${ACCOUNTING_FIELDS.map(([,label])=>`<th scope="col">${esc(label)}</th>`).join('')}<th scope="col">No formulário</th></tr></thead><tbody>${parsed.months.map(row=>`<tr><th scope="row">${esc(monthLabel(row.sourceMonth))}</th>${ACCOUNTING_FIELDS.map(([key])=>`<td>${row[key]===null?'<span class="analysis-paste-warning">Não informado</span>':money(row[key]/100)}</td>`).join('')}<td>${plan.replacedMonths.includes(row.sourceMonth)?'Substituir mês':'Adicionar mês'}</td></tr>`).join('')}</tbody></table></div>
      ${plan.replacedMonths.length?`<label class="analysis-check analysis-paste-replace"><input type="checkbox" id="analysis-paste-replace-confirm" ${replaceConfirmed?'checked':''}>Confirmo substituir os cinco valores de ${plan.replacedMonths.map(month=>esc(monthLabel(month))).join(' · ')} pelos dados desta colagem, inclusive os campos em branco.</label>`:''}
      <p class="analysis-note">As demais competências permanecem. Depois de aplicar, use Salvar rascunho ou Salvar e concluir para gravar os dados.</p>
      <div class="analysis-actions analysis-paste-actions"><button type="button" class="primary" id="analysis-apply-accounting-paste" ${!canWrite||plan.replacedMonths.length&&!replaceConfirmed?'disabled':''}>Aplicar ao formulário</button><button type="button" id="analysis-cancel-accounting-paste">Cancelar prévia</button></div>`:''}
    </div>
  </details>`;
}
