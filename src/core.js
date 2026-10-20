export const VALUES = [5, 10, 20, 50];
export const DEFAULT_WEIGHTS = [7000, 2000, 800, 200];

export function validateWeights(value) {
  if (!Array.isArray(value) || value.length !== 4) throw Error('Defina as quatro probabilidades.');
  const weights = value.map(v => {
    if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > 100) throw Error('Cada percentagem tem de estar entre 0 e 100.');
    const precise = v * 100;
    if (Math.abs(precise - Math.round(precise)) > 1e-6) throw Error('Use, no máximo, duas casas decimais.');
    return Math.round(precise);
  });
  if (weights.reduce((sum, n) => sum + n, 0) !== 10000) throw Error('As probabilidades têm de somar exatamente 100%.');
  return weights;
}

export function randomInt(maxExclusive) {
  const range = 0x100000000;
  const top = range - (range % maxExclusive);
  const bytes = new Uint32Array(1);
  let value;
  do { crypto.getRandomValues(bytes); value = bytes[0]; } while (value >= top);
  return value % maxExclusive;
}
export function drawPrize(weights, random = randomInt) {
  const n = random(10000);
  if (!Number.isInteger(n) || n < 0 || n >= 10000) throw Error('Sorteio inválido.');
  let cumulative = 0;
  for (let i = 0; i < weights.length; i++) {
    cumulative += weights[i];
    if (n < cumulative) return VALUES[i];
  }
  throw Error('Probabilidades inválidas.');
}
export function expectedCost(weights) {
  return Number(weights.reduce((sum, w, i) => sum + w * VALUES[i], 0) / 10000);
}
