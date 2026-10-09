import { mkdir, copyFile } from 'node:fs/promises';
await mkdir('public/vendor', { recursive: true });
await copyFile('dist/difal.js', 'public/difal.js');
await copyFile('dist/domain.js', 'public/domain.js');
await copyFile('node_modules/xlsx/dist/xlsx.full.min.js', 'public/vendor/xlsx.full.min.js');
await copyFile('node_modules/xlsx/LICENSE', 'public/vendor/SheetJS-LICENSE.txt');
await copyFile('dist/lookup-domain.js', 'public/lookup-domain.js');
console.log('Interface e leitor XLSX preparados, sem CDN em tempo de execução.');
