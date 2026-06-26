// uploadToDLZ.js
import fs from "fs";
import path from "path";
import axios from "axios";
import chalk from "chalk";
import { ContainerClient } from "@azure/storage-blob";


// Get DLZ credentials from Adobe
async function getDLZCredentials(accessToken, apiKey, imsOrg, sandbox) {
  const url = `https://platform.adobe.io/data/foundation/connectors/landingzone/credentials?type=user_drop_zone`;
  const headers = {
    Authorization: `Bearer ${accessToken}`,
    "x-api-key": apiKey,
    "x-gw-ims-org-id": imsOrg,
    "x-sandbox-name": sandbox,
    Accept: "application/json",
  };

  try {
    const response = await axios.get(url, { headers });
    return response.data;
  } catch (err) {
    if (err.response?.status === 404) {
      throw new Error(`Data Landing Zone not found for sandbox "${sandbox}" (404) — check your SANDBOX_NAME`);
    }
    if (err.response?.status === 403) {
      throw new Error(`Access denied to Data Landing Zone (403) — check your credentials`);
    }
    if (err.response?.status) {
      throw new Error(`Failed to fetch DLZ credentials (${err.response.status})`);
    }
    throw err;
  }
}

// Upload a single file to Azure Blob Storage with retry
async function uploadFileToAzure(sasUri, srcFile, targetPath, maxRetries = 3) {
  const containerClient = new ContainerClient(sasUri);
  const blockBlobClient = containerClient.getBlockBlobClient(targetPath);
  const fileBuffer = fs.readFileSync(srcFile);

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      await blockBlobClient.uploadData(fileBuffer, {
        blobHTTPHeaders: { blobContentType: "application/octet-stream" },
      });
      return true;
    } catch (err) {
      if (attempt === maxRetries) {
        console.log(chalk.red("  ✗") + ` Upload failed after ${maxRetries} attempts: ${targetPath}`);
        return false;
      }
      console.log(chalk.yellow("  !") + ` Retry ${attempt} for: ${targetPath}`);
    }
  }
}

export async function uploadToDLZ(accessToken, envMap, datasetsMap) {
  const apiKey = envMap.API_KEY;
  const imsOrg = envMap.IMS_ORG;
  const sandbox = envMap.SANDBOX_NAME;

  const dlzCreds = await getDLZCredentials(accessToken, apiKey, imsOrg, sandbox);
  const sasUri = dlzCreds.SASUri;

  const files = [...datasetsMap.values()].filter((d) => d.localPath && d.targetPath);

  if (files.length === 0) {
    console.log(chalk.yellow("  !") + " No files found in file list — nothing to upload");
    return;
  }

  let successCount = 0;

  for (const file of files) {
    const srcFile = path.join(process.cwd(), file.localPath);
    const targetPath = file.targetPath;
    const uploaded = await uploadFileToAzure(sasUri, srcFile, targetPath);
    if (uploaded) successCount++;
  }

  if (successCount !== files.length) {
    console.log(chalk.red("  ✗") + ` Upload incomplete: ${successCount}/${files.length} files succeeded`);
    return false;
  }

  console.log(chalk.green("  ✓") + ` Files uploaded (${successCount}/${files.length})`);
  return true;
}
