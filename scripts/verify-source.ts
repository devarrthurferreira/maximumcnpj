import { BigQuerySource, configuration } from '../src/provider.ts';
try {
  const source = await new BigQuerySource(configuration(false)).inspect();
  console.log(JSON.stringify(source, null, 2));
  console.log('Metadados verificados. Isto NÃO homologa os valores fiscais. Confira manualmente os indicadores, a competência publicada e CNPJs de controle. Só então configure BQ_SOURCE_APPROVED=true.');
} catch (e) { console.error(e instanceof Error ? e.message : 'Erro ao verificar a fonte.'); process.exitCode = 1; }
