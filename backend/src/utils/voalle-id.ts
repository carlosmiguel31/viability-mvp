/**
 * IDs do Voalle vêm da coluna bigint e são tratados SEMPRE como string na
 * aplicação para não perder precisão acima de Number.MAX_SAFE_INTEGER.
 * A ordenação usa BigInt quando ambos os valores são inteiros válidos, com
 * fallback determinístico por comparação de string caso apareça algo
 * inesperado.
 */
const INTEGER_REGEX = /^[+-]?[0-9]+$/;

export function compareVoalleIds(a: string, b: string): number {
  if (INTEGER_REGEX.test(a) && INTEGER_REGEX.test(b)) {
    const bigA = BigInt(a);
    const bigB = BigInt(b);
    if (bigA < bigB) return -1;
    if (bigA > bigB) return 1;
    return 0;
  }
  return a < b ? -1 : a > b ? 1 : 0;
}
