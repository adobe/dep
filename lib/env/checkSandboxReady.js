import axios from "axios";
import chalk from "chalk";

/**
 * Checks whether enough time has passed since the sandbox was created or reset.
 * Queries the Sandbox Management API for the sandbox's createdDate and lastModifiedDate,
 * then uses the most recent of the two as the reference time.
 *
 * If the sandbox is not yet ready, prints a message with the remaining wait time
 * and returns false. If the check cannot be completed (API error, missing fields),
 * it fails open and returns true so execution is not unnecessarily blocked.
 *
 * @param {Object} envMap - Environment variables (API_KEY, IMS_ORG, SANDBOX_NAME).
 * @param {string} accessToken - Bearer token for Adobe IMS.
 * @param {number} [minMinutes=60] - Minimum minutes required since creation/reset.
 * @returns {Promise<boolean>} true if ready to proceed, false if still within wait window.
 */
export async function checkSandboxReady(envMap, accessToken, minMinutes = 60) {
  const { API_KEY: apiKey, IMS_ORG: imsOrg, SANDBOX_NAME: sandbox } = envMap;

  try {
    const url = `https://platform.adobe.io/data/foundation/sandbox-management/sandboxes/${encodeURIComponent(sandbox)}`;
    const response = await axios.get(url, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "x-api-key": apiKey,
        "x-gw-ims-org-id": imsOrg,
        Accept: "application/json",
      },
    });

    const { createdDate, lastModifiedDate } = response.data;

    const candidates = [createdDate, lastModifiedDate]
      .filter(Boolean)
      .map((d) => {
        // API timestamps are UTC but may omit the timezone indicator — force UTC parsing
        const s = String(d);
        return new Date(/Z|[+-]\d{2}:?\d{2}$/.test(s) ? s : s + "Z");
      })
      .filter((d) => !isNaN(d.getTime()));

    if (candidates.length === 0) return true;

  const referenceDate = candidates.sort((a, b) => b - a)[0];
  const elapsedMinutes = (Date.now() - referenceDate.getTime()) / (1000 * 60);

    if (elapsedMinutes < minMinutes) {
      const remaining = Math.ceil(minMinutes - elapsedMinutes);
      console.log(
        chalk.yellow("\n  ⚠ ") +
          `You need to wait ${minMinutes} minutes after creating/resetting a sandbox to run this.` +
          `\n  Please wait an additional ${chalk.yellow(String(remaining))} minute(s) to execute.\n`
      );
      return false;
    }

    return true;
  } catch {
    // Cannot determine sandbox age — allow execution to proceed
    return true;
  }
}
