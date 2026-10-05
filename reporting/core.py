"""Contrato, segurança e formatação compartilhada dos relatórios Python."""
from __future__ import annotations
import csv
import hashlib
import io
import os
import re
from datetime import datetime, timezone
from http.cookies import SimpleCookie, CookieError
from urllib.parse import urlsplit
from zoneinfo import ZoneInfo

VERSION = '0.15.0'
STATUSES = {'ALL': 'Todos os CNPJs', 'OPTANTE': 'Optantes pelo Simples',
            'NAO_OPTANTE': 'Não optantes', 'NAO_CONFIRMADO': 'Não confirmados'}
REPORTING_STATUSES = {'ALL': 'Todos os CNPJs', 'OPTANTE': 'Simples', 'NAO_OPTANTE': 'Não optante'}
KINDS = {'ALL': 'Clientes e fornecedores', 'CLIENTE': 'Clientes',
         'FORNECEDOR': 'Fornecedores', 'AMBOS': 'Clientes e fornecedores (ambos)',
         'OUTROS': 'Tipo não identificado'}
PAGE_SIZE = 100
PDF_PART_SIZE = 500
CSV_PART_SIZE = 2000
MAX_RESPONSE_BYTES = 4_000_000
TZ = ZoneInfo('America/Sao_Paulo')
NOTICE = ('Resultado histórico da API Minha Receita, não uma consulta fiscal em tempo real. '
          'A emissão deste relatório não consulta novamente a API. '
          'A data da requisição não comprova a atualização fiscal da base. '
          'Referência fiscal da base: não informada.')

class ReportError(Exception):
    def __init__(self, status: int, code: str, message: str):
        super().__init__(message)
        self.status, self.code = status, code


def require(condition, status=400, code='VALIDATION', message='Parâmetros inválidos.'):
    if not condition:
        raise ReportError(status, code, message)


def utcnow():
    return datetime.now(timezone.utc)


def iso(value):
    if isinstance(value, datetime):
        return value.replace(tzinfo=value.tzinfo or timezone.utc).isoformat()
    return str(value) if value is not None else None


def display_date(value):
    if not value:
        return 'Não informada'
    try:
        if isinstance(value, str):
            if re.fullmatch(r'\d{4}-\d{2}-\d{2}', value):
                return datetime.strptime(value, '%Y-%m-%d').strftime('%d/%m/%Y')
            value = datetime.fromisoformat(value.replace('Z', '+00:00'))
        return value.replace(tzinfo=value.tzinfo or timezone.utc).astimezone(TZ).strftime('%d/%m/%Y %H:%M')
    except (ValueError, TypeError, AttributeError):
        return 'Não informada'


def percentage(count, total):
    return ((count * 20_000 + total) // (total * 2)) / 100 if total else 0


def reporting_status(status):
    return 'OPTANTE' if status == 'OPTANTE' else 'NAO_OPTANTE'


def number(value):
    return f'{int(value or 0):,}'.replace(',', '.')


def percent(value):
    return f'{value:.2f}%'.replace('.', ',')


def cnpj_mask(value):
    s = str(value or '')
    return f'{s[:2]}.{s[2:5]}.{s[5:8]}/{s[8:12]}-{s[12:]}' if len(s) == 14 else s


def exact_origin(value):
    if not isinstance(value, str) or not value or ',' in value:
        return None
    try:
        u = urlsplit(value)
        if u.scheme not in ('http', 'https') or not u.netloc or u.username or u.password or u.query or u.fragment or u.path not in ('', '/'):
            return None
        _ = u.port
        return f'{u.scheme}://{u.netloc}'.lower()
    except ValueError:
        return None


def allowed_origin(headers, env=None):
    env = os.environ if env is None else env
    supplied = exact_origin(headers.get('Origin', headers.get('origin', '')))
    allowed = {exact_origin(env.get('APP_ORIGIN', 'http://localhost:3000'))}
    if env.get('VERCEL') == '1':
        for key in ('VERCEL_URL', 'VERCEL_BRANCH_URL', 'VERCEL_PROJECT_PRODUCTION_URL'):
            if env.get(key):
                allowed.add(exact_origin('https://' + env[key]))
    return supplied is not None and supplied in allowed


def session_hash(headers, env=None):
    env = os.environ if env is None else env
    # Same name and digest used by the Node.js API; never accepts both cookies.
    key = '__Host-maximum_session' if env.get('NODE_ENV', 'production' if env.get('VERCEL') == '1' else '') == 'production' else 'maximum_session'
    try:
        cookie = SimpleCookie()
        cookie.load(headers.get('Cookie', headers.get('cookie', '')))
        raw = cookie[key].value if key in cookie else ''
    except CookieError:
        raw = ''
    require(re.fullmatch(r'[\w-]{43}', raw, re.ASCII), 401, 'UNAUTHORIZED', 'Entre para gerar relatórios.')
    return hashlib.sha256(raw.encode()).hexdigest()


def validate(payload):
    require(isinstance(payload, dict))
    action = payload.get('action', 'summary')
    require(action in ('jobs', 'summary', 'rows', 'pdf', 'csv', 'generation-pdf'))
    if action == 'generation-pdf':
        generation = payload.get('generationId')
        part = payload.get('part', 1)
        require(isinstance(generation, str) and re.fullmatch(r'[a-f0-9-]{36}', generation))
        require(type(part) is int and 1 <= part <= 5)
        require(not payload.get('jobId') and not payload.get('clientId') and not payload.get('search') and
                payload.get('status', 'ALL') == 'ALL' and payload.get('kind', 'ALL') == 'ALL',
                message='O PDF da geração inclui integralmente as empresas da parte selecionada.')
        return dict(action=action, generationId=generation, part=part)
    client = payload.get('clientId', '')
    require(isinstance(client, str) and (not client or re.fullmatch(r'[a-f0-9-]{36}', client)))
    job = payload.get('jobId', '')
    require(action == 'jobs' or isinstance(job, str) and re.fullmatch(r'[a-f0-9-]{36}', job))
    status, kind = payload.get('status', 'ALL'), payload.get('kind', 'ALL')
    require(isinstance(status, str) and status in STATUSES)
    require(isinstance(kind, str) and kind in KINDS)
    search = payload.get('search', '')
    require(isinstance(search, str) and len(search) <= 100)
    # Downloads always use the explicit group, not a hidden text-search restriction.
    require(action in ('rows', 'jobs', 'summary') or not search,
            message='Limpe a pesquisa para exportar o grupo completo.')
    page, part = payload.get('page', 1), payload.get('part', 1)
    require(type(page) is int and 1 <= page <= 100000)
    require(type(part) is int and 1 <= part <= 100000)
    layout = payload.get('layout', 'detailed')
    require(layout in ('summary', 'detailed'))
    return dict(action=action, clientId=client, jobId=job, status=status, kind=kind,
                search=search.strip(), page=page, part=part, layout=layout)


def csv_bytes(job, rows):
    out = io.StringIO(newline='')
    writer = csv.writer(out, delimiter=';', quoting=csv.QUOTE_ALL)
    writer.writerow(['CODIGO EMPRESA', 'EMPRESA', 'ID CONSULTA', 'CNPJ', 'NOME INFORMADO',
                     'RAZAO SOCIAL API', 'GRUPO GERENCIAL', 'SITUACAO ORIGINAL DA FONTE', 'MEI', 'TIPO', 'UF', 'OCORRENCIAS',
                     'CONFERENCIA NOME', 'MOTIVO', 'CONSULTADO EM', 'OPCAO SIMPLES',
                     'EXCLUSAO SIMPLES', 'FONTE', 'REFERENCIA FISCAL'])
    def safe(value):
        text = str(value if value is not None else '')
        return "'" + text if re.match(r'^\s*[=+@\-\t\r]', text) else text
    for row in rows:
        d = row.get('details') or {}
        values = [job.get('clientCode'), job.get('clientName'), job['_id'], row['cnpj'],
                  row.get('submittedName'), d.get('name'), REPORTING_STATUSES[reporting_status(row['status'])], STATUSES[row['status']],
                  'Sim' if d.get('mei') is True else 'Não' if d.get('mei') is False else 'Não confirmado',
                  row.get('kind'), d.get('uf') or row.get('uf'), row.get('occurrences'),
                  row.get('nameMatch'), row.get('reason'), iso(row.get('checkedAt')),
                  d.get('optionDate'), d.get('exclusionDate'), row.get('source') or 'Minha Receita',
                  'Não informada']
        writer.writerow([safe(v) for v in values])
    return ('\ufeff' + out.getvalue()).encode('utf-8')
