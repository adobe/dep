import chalk from "chalk";

/**
 * Retries an async function up to maxAttempts times with a delay between attempts.
 * Used internally by all API call functions — callers do not invoke this directly.
 *
 * @param {Function} fn - Async function to retry. Should throw on failure.
 * @param {number} maxAttempts - Maximum number of attempts (default: 3).
 * @param {number} delayMs - Milliseconds to wait between attempts (default: 2000).
 * @param {string} [label] - Optional label shown in retry log lines (e.g. "flow creation").
 *   When provided: logs `! Retry X/N (label): message` after each failed attempt except the last.
 *   When omitted: retries silently.
 * @returns {Promise<*>} - Resolves with the return value of fn on success.
 * @throws {Error} - Throws after all attempts are exhausted.
 */
export async function withRetry(fn, maxAttempts = 3, delayMs = 2000, label) {
  let lastError;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;

      if (attempt < maxAttempts) {
        if (label) {
          console.log(chalk.yellow("  !") + ` Retry ${attempt}/${maxAttempts} (${label}): ${err.message}`);
        }
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }
  }

  throw new Error(
    `Failed after ${maxAttempts} attempt(s): ${lastError?.message || "unknown error"}`
  );
}
