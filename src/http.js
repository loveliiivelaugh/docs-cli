import fs from "node:fs/promises";

function ensureLeadingSlash(pathname) {
  return pathname.startsWith("/") ? pathname : `/${pathname}`;
}

function appendQuery(url, queryEntries) {
  for (const entry of queryEntries) {
    const [rawKey, ...rawValue] = entry.split("=");
    const key = rawKey?.trim();
    if (!key) {
      continue;
    }

    url.searchParams.append(key, rawValue.join("=").trim());
  }
}

function normalizeApiError(parsedBody) {
  if (!parsedBody) {
    return "";
  }

  if (typeof parsedBody === "string") {
    return parsedBody;
  }

  if (typeof parsedBody.detail === "string") {
    return parsedBody.detail;
  }

  return JSON.stringify(parsedBody, null, 2);
}

export async function loadJsonInput({ data, input }) {
  if (data && input) {
    throw new Error("Use either --data or --input, not both");
  }

  if (data) {
    try {
      return JSON.parse(data);
    } catch (error) {
      throw new Error(`Invalid JSON passed to --data: ${error.message}`);
    }
  }

  if (input) {
    const contents = await fs.readFile(input, "utf8");
    try {
      return JSON.parse(contents);
    } catch (error) {
      throw new Error(`Invalid JSON in ${input}: ${error.message}`);
    }
  }

  return null;
}

export async function docsRequest({
  apiKey,
  baseUrl,
  method,
  pathname,
  body,
  query = [],
  headers = {},
  allowStatuses = [],
}) {
  if (!apiKey) {
    throw new Error("No API key configured. Run `docs auth login --api-key <key>` first.");
  }

  const url = new URL(ensureLeadingSlash(pathname), baseUrl);
  appendQuery(url, query);

  const requestHeaders = {
    Accept: "application/json",
    "X-Api-Key": apiKey,
    ...headers,
  };

  let payload;
  if (body !== undefined && body !== null) {
    requestHeaders["Content-Type"] = "application/json";
    payload = JSON.stringify(body);
  }

  const response = await fetch(url, {
    method: method.toUpperCase(),
    headers: requestHeaders,
    body: payload,
  });

  const contentType = response.headers.get("content-type") || "";
  const responseText = await response.text();
  const parsedBody =
    contentType.includes("application/json") && responseText
      ? JSON.parse(responseText)
      : responseText;

  if (!response.ok && !allowStatuses.includes(response.status)) {
    throw new Error(
      `Docs API request failed (${response.status} ${response.statusText}): ${normalizeApiError(parsedBody)}`,
    );
  }

  return {
    status: response.status,
    headers: response.headers,
    body: parsedBody,
  };
}
