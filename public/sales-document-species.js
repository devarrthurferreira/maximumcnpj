/** Only the species explicitly recorded in column D identifies an NFC-e. */
export function isNfce(value) {
  return typeof value === 'string' && value.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toUpperCase().replace(/[^A-Z0-9]/g, '') === 'NFCE';
}
