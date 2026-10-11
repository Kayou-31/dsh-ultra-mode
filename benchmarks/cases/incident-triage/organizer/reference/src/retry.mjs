export function shouldRetry({ status, attempt, maxAttempts }) {
  return [500, 502, 503, 504].includes(status) && attempt < maxAttempts;
}

export async function runWithRetry(operation, { maxAttempts = 3 } = {}) {
  if (!Number.isSafeInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 10) throw new RangeError('Invalid maxAttempts');
  const retryStatuses = [];
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const response = await operation({ attempt });
    if (!shouldRetry({ status: response.status, attempt, maxAttempts })) return { ...response, attempts: attempt, retryStatuses };
    retryStatuses.push(response.status);
  }
  throw new Error('Retry loop did not settle');
}
