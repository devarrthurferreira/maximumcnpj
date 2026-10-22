"""Document eligibility shared by the two managerial ICMS estimates."""
import re


def normalize_tax_document(value):
    return re.sub(r'[./\-\s]', '', str(value if value is not None else '').strip().upper())


def is_canonical_cnpj(value):
    """Match normalizeCnpj: numeric/alphanumeric CNPJ, ASCII minus 48 and mod 11."""
    if not isinstance(value, str) or not re.fullmatch(r'[A-Z0-9]{12}[0-9]{2}', value):
        return False
    if re.fullmatch(r'([0-9])\1{13}', value) or value.startswith('000000000000'):
        return False

    def digit(text, weights):
        remainder = sum((ord(char) - 48) * weight for char, weight in zip(text, weights)) % 11
        return str(0 if remainder < 2 else 11 - remainder)

    first = digit(value[:12], [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2])
    return value[12:] == first + digit(value[:12] + first, [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2])


def is_cpf_or_cnpj(value):
    document = normalize_tax_document(value)
    return re.fullmatch(r'[0-9]{11}', document) is not None or is_canonical_cnpj(document)
