import { mkdir, copyFile } from 'node:fs/promises';
await mkdir('public/vendor', { recursive: true });
await copyFile('dist/domain.js', 'public/domain.js');
await copyFile('node_modules/xlsx/dist/xlsx.full.min.js', 'public/vendor/xlsx.full.min.js');
await copyFile('node_modules/xlsx/LICENSE', 'public/vendor/SheetJS-LICENSE.txt');
console.log('Interface e leitor XLSX preparados, sem CDN em tempo de execução.');
