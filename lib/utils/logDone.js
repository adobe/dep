export function logDone(startTime) {
  const elapsedSec = Math.round((Date.now() - startTime) / 1000);
  const minutes = Math.floor(elapsedSec / 60);
  const seconds = elapsedSec % 60;
  const elapsed = minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
  console.log(`Completed in ${elapsed} — ${new Date().toISOString()}\n`);
}