// Add report navigation without changing the established login/import lifecycle.
function update(){
 const nav=document.querySelector('.sidebar .nav');
 if(nav&&!nav.querySelector('[data-purchase-link]')){const a=document.createElement('a');a.href='/purchases.html';a.textContent='▦ Compras e vendas';a.dataset.purchaseLink='true';a.className='report-links';nav.append(a);}
 if(nav&&!nav.querySelector('[data-report-link]')){const a=document.createElement('a');a.href='/reports.html';a.textContent='▤ Relatórios por empresa';a.dataset.reportLink='true';a.className='report-links';nav.append(a);}
 const exportButton=document.querySelector('#export-results'),match=location.hash.match(/^#job\/([a-f0-9-]{36})$/);
 if(exportButton&&match&&!document.querySelector('#open-python-report')){const a=document.createElement('a');a.id='open-python-report';a.href='/reports.html?job='+encodeURIComponent(match[1]);a.textContent='Ver separado / Relatório Python';a.className='report-links';exportButton.parentElement.append(a);}
}
let scheduled=false;const observer=new MutationObserver(()=>{if(scheduled)return;scheduled=true;queueMicrotask(()=>{scheduled=false;update();});});
observer.observe(document.getElementById('app'),{childList:true,subtree:true});update();
