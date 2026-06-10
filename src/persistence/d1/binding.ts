// D1 rejects statements with more than 100 bound parameters
// ("variable number must be between ?1 and ?100"). Any query that
// binds one parameter per id in an IN (...) clause must batch ids
// through this helper. 90 leaves headroom for fixed parameters.
export const D1_BIND_BATCH_SIZE = 90;

export function chunkForBinding<T>(values: T[], batchSize = D1_BIND_BATCH_SIZE): T[][] {
  if (batchSize < 1 || batchSize > 100) {
    throw new Error(`batchSize must be between 1 and 100, got ${batchSize}`);
  }
  const batches: T[][] = [];
  for (let index = 0; index < values.length; index += batchSize) {
    batches.push(values.slice(index, index + batchSize));
  }
  return batches;
}
