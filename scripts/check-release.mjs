import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
const pkg=JSON.parse(readFileSync('package.json','utf8'));
const domain=readFileSync('src/domain.ts','utf8'),core=readFileSync('reporting/core.py','utf8'),pyproject=readFileSync('pyproject.toml','utf8'),readme=readFileSync('README.md','utf8'),log=readFileSync('CHANGELOG.md','utf8');
for(const [name,ok] of [['domínio',domain.includes(`VERSION = '${pkg.version}'`)],['Python',core.includes(`VERSION = '${pkg.version}'`)],['pyproject',pyproject.includes(`version = "${pkg.version}"`)],['README',readme.includes(`v${pkg.version}`)],['CHANGELOG',log.includes(`[${pkg.version}]`)]])if(!ok)throw new Error(`Versão divergente em ${name}.`);
if(process.env.GITHUB_ACTIONS==='true'){
 const changed=execFileSync('git',['diff','--name-only','HEAD^','HEAD'],{encoding:'utf8'}).trim().split('\n');
 if(changed.some(f=>/^(src\/|public\/|api\/|package\.json|vercel\.json)/.test(f))&&!changed.includes('README.md'))throw new Error('Mudança funcional sem README no mesmo commit.');
}
console.log(`Versão ${pkg.version} e documentação conferidas.`);
