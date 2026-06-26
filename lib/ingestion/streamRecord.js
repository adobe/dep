import axios from "axios";
import chalk from "chalk";

export async function streamRecord(inletUrl, data, flowId) {
  try {
    const isBatch = Array.isArray(data);
    const url = isBatch ? inletUrl.replace("/collection/", "/collection/batch/") : inletUrl;
    const payload = isBatch ? { messages: data } : data;

    const response = await axios.post(url, payload, {
      headers: {
        "Content-Type": "application/json",
        "x-adobe-flow-id": flowId,
      },
      validateStatus: () => true,
    });

    if (response.status >= 200 && response.status < 300) return true;
    const detail = response.data?.title || response.data?.detail || response.data?.message || `HTTP ${response.status}`;
    console.log(chalk.red("    ✗") + ` Stream error: ${detail}`);
    return false;
  } catch (err) {
    console.log(chalk.red("    ✗") + ` Stream error: ${err.message}`);
    return false;
  }
}
