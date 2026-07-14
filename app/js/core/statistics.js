export function numbers(values) {
  return values.filter(value => value !== null && value !== undefined && Number.isFinite(Number(value))).map(Number).sort((a, b) => a - b);
}

export function mean(values) {
  const list = numbers(values);
  return list.length ? list.reduce((sum, value) => sum + value, 0) / list.length : null;
}

export function quantile(values, probability) {
  const list = numbers(values);
  if (!list.length) return null;
  if (probability < 0 || probability > 1) throw new RangeError('probability must be between zero and one');
  const position = (list.length - 1) * probability;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return list[lower];
  const weight = position - lower;
  return list[lower] * (1 - weight) + list[upper] * weight;
}

export const median = values => quantile(values, 0.5);

export function percentileRank(values, value) {
  const list = numbers(values);
  if (!list.length || value === null || value === undefined) return null;
  const below = list.filter(item => item < value).length;
  const equal = list.filter(item => item === value).length;
  return (below + 0.5 * equal) / list.length;
}

export function safeRatio(numerator, denominator) {
  return denominator ? numerator / denominator : null;
}

export function summarize(values) {
  const list = numbers(values);
  return {
    samples: list.length,
    mean: mean(list),
    median: median(list),
    p25: quantile(list, 0.25),
    p75: quantile(list, 0.75),
    p90: quantile(list, 0.9),
  };
}

