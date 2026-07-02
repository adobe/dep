const MIN_AGE_MS = 60 * 60 * 1000; // 60 minutes

export function checkDatasetsReady(datasets) {
  const now = Date.now();
  const notEnabled = [];
  const tooRecent = [];
  let maxRemainingMinutes = 0;

  for (const [name, { profileEnabledAt }] of datasets) {
    if (profileEnabledAt == null) {
      notEnabled.push(name);
      continue;
    }
    const ageMs = now - profileEnabledAt;
    if (ageMs < MIN_AGE_MS) {
      const remainingMinutes = Math.ceil((MIN_AGE_MS - ageMs) / 60_000);
      tooRecent.push({ name, remainingMinutes });
      if (remainingMinutes > maxRemainingMinutes) maxRemainingMinutes = remainingMinutes;
    }
  }

  const ready = notEnabled.length === 0 && tooRecent.length === 0;
  return { ready, notEnabled, tooRecent, maxRemainingMinutes };
}
