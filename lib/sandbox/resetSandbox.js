import axios from "axios";
import chalk from "chalk";

// Resets a sandbox via the Sandbox Management API.
export async function resetSandbox(envMap, accessToken, resetSandboxName) {
  const { API_KEY: apiKey, IMS_ORG: imsOrg } = envMap;
  const sandbox = resetSandboxName;

  try {
    // create url call
    const url = `https://platform.adobe.io/data/foundation/sandbox-management/sandboxes/${sandbox}`;
    
    const headers = {
      Authorization: `Bearer ${accessToken}`,
      "x-api-key": apiKey,
      "x-gw-ims-org-id": imsOrg,
      "x-sandbox-name": sandbox,
      "Content-Type": "application/json",
    };

    const response = await axios.put(url, '{"action":"reset"}', { headers });
    if (response.status === 202) {
      return true;
    } else {
      return false;
    }
  } catch (err) {
    console.log(chalk.red("  ✗") + ` Failed to reset sandbox ${sandbox}: ${err.response?.data || err.message}`);
    return false;
  }
}
