// lib/getAccessTokenFromEnvFile.js
import fs from "fs";
import axios from "axios";
import chalk from "chalk";

export async function getAccessToken(envMap) {

  const clientId = envMap.API_KEY;
  const clientSecret = envMap.CLIENT_SECRET;
  const scopes = envMap.SCOPES;

  if (!clientId || !clientSecret || !scopes) {
    throw new Error("❌ Missing required values: API_KEY, CLIENT_SECRET, or SCOPES");
  }

  const url = `https://ims-na1.adobelogin.com/ims/token/v2`;
  const params = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: clientId,
    client_secret: clientSecret,
    scope: scopes,
  });

  try {
    const response = await axios.post(url, params.toString(), {
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
    });

    return response.data.access_token;
  } catch (err) {
    console.log(chalk.red("  ✗") + ` Failed to get access token: ${err.response?.data || err.message}`);
    throw err;
  }
}