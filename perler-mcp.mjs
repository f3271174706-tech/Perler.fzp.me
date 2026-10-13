// Read-only MCP Streamable HTTP endpoint for the public perler.cloud example gallery.
// No dependencies, administrator sessions, secrets, or mutating tools.
const serverName = "perler-cloud-gallery";
const serverVersion = "1.0.0";
const mcpProtocolVersion = "2025-11-25";
const publicBaseUrl = "https://perler.cloud";
const maxRequestBytes = 16 * 1024;
const allowedOrigins = new Set([publicBaseUrl, "https://chatgpt.com", "https://chat.openai.com"]);

const tools = [
  {
    name: "list_example_patterns",
    title: "列出拼豆示例图纸",
    description: "List public uploaded example patterns from perler.cloud with name, grid size, image URL, total count, and display-order metadata. No user accounts or private data.",
    inputSchema: {
      type: "object",
      properties: {
        limit: { type: "integer", minimum: 1, maximum: 100, description: "Maximum number of patterns (default 50)" },
        offset: { type: "integer", minimum: 0, description: "Zero-based starting position (default 0)" }
      },
      additionalProperties: false
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
  },
  {
    name: "get_example_pattern",
    title: "查看示例图纸详情",
    description: "Look up one public uploaded example pattern by its exact uploaded: ID. Returns a public PNG image URL and metadata, not image bytes.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", minLength: 1, maxLength: 240, description: "The uploaded: ID returned by list_example_patterns" }
      },
      required: ["id"],
      additionalProperties: false
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
  }
];

function sendJson(response, status, body) {
  const payload = JSON.stringify(body);
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(payload),
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff"
  });
  response.end(payload);
}

function jsonRpcError(id, code, message) {
  return { jsonrpc: "2.0", id: id ?? null, error: { code, message } };
}

function toolResult(data, isError = false) {
  return {
    content: [{ type: "text", text: JSON.stringify(data) }],
    ...(isError ? { isError: true } : { structuredContent: data })
  };
}

async function readJson(request) {
  if (!String(request.headers["content-type"] || "").toLowerCase().match(/^application\/json(?:\s*;|\s*$)/)) {
    const error = new Error("Content-Type must be application/json");
    error.httpStatus = 415;
    throw error;
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > maxRequestBytes) {
      const error = new Error("MCP request too large");
      error.httpStatus = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    const error = new Error("Parse error");
    error.rpcCode = -32700;
    throw error;
  }
}

function toPublicUrl(example) {
  return { ...example, url: new URL(example.url, publicBaseUrl).href };
}

/**
 * Wire this handler into the existing Node HTTP server on POST /mcp.
 * getGallery MUST return only the gallery the public GET /api/examples already exposes.
 * publicExample MUST return exactly the sanitized shape from that public endpoint.
 */
export function createPerlerMcpHandler({ getGallery, publicExample }) {
  if (typeof getGallery !== "function" || typeof publicExample !== "function") {
    throw new TypeError("getGallery and publicExample must be functions");
  }

  return async function handlePerlerMcp(request, response) {
    const origin = request.headers.origin;
    if (origin && !allowedOrigins.has(origin)) {
      return sendJson(response, 403, { error: "Untrusted Origin" });
    }
    if (request.method !== "POST") {
      response.setHeader("Allow", "POST");
      return sendJson(response, 405, { error: "Method not allowed" });
    }

    let message;
    try {
      message = await readJson(request);
    } catch (error) {
      return sendJson(response, error.httpStatus || 400, jsonRpcError(null, error.rpcCode || -32600, error.message));
    }
    if (!message || typeof message !== "object" || Array.isArray(message) || message.jsonrpc !== "2.0" || typeof message.method !== "string") {
      return sendJson(response, 400, jsonRpcError(null, -32600, "Invalid JSON-RPC request"));
    }
    if (!("id" in message)) {
      // MCP client notifications do not get a JSON-RPC response.
      response.writeHead(202, { "Cache-Control": "no-store" });
      return response.end();
    }
    if (typeof message.id !== "string" && typeof message.id !== "number") {
      return sendJson(response, 400, jsonRpcError(null, -32600, "Invalid JSON-RPC id"));
    }

    let result;
    switch (message.method) {
      case "initialize":
        result = {
          protocolVersion: mcpProtocolVersion,
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: serverName, version: serverVersion },
          instructions: "Only publicly available perler.cloud example-gallery metadata is exposed. This integration cannot log in, view user data, upload, reorder, or delete images."
        };
        break;
      case "ping":
        result = {};
        break;
      case "tools/list":
        result = { tools };
        break;
      case "tools/call": {
        const params = message.params;
        if (!params || typeof params !== "object" || Array.isArray(params) || typeof params.name !== "string") {
          return sendJson(response, 200, jsonRpcError(message.id, -32602, "Tool name is required"));
        }
        const args = params.arguments ?? {};
        if (!args || typeof args !== "object" || Array.isArray(args)) {
          return sendJson(response, 200, jsonRpcError(message.id, -32602, "Tool arguments must be an object"));
        }
        if (params.name === "list_example_patterns") {
          if (Object.keys(args).some(k => !["limit", "offset"].includes(k)) ||
              (args.limit !== undefined && (!Number.isInteger(args.limit) || args.limit < 1 || args.limit > 100)) ||
              (args.offset !== undefined && (!Number.isSafeInteger(args.offset) || args.offset < 0))) {
            return sendJson(response, 200, jsonRpcError(message.id, -32602, "Invalid pagination arguments"));
          }
          const { examples, order, hiddenBuiltins } = getGallery();
          const offset = args.offset ?? 0;
          const limit = args.limit ?? 50;
          const data = {
            total: examples.length,
            offset,
            limit,
            hasMore: offset + limit < examples.length,
            examples: examples.slice(offset, offset + limit).map(publicExample).map(toPublicUrl),
            order,
            hiddenBuiltins
          };
          result = toolResult(data);
        } else if (params.name === "get_example_pattern") {
          if (Object.keys(args).some(k => k !== "id") || typeof args.id !== "string" || args.id.length < 1 || args.id.length > 240) {
            return sendJson(response, 200, jsonRpcError(message.id, -32602, "A valid example id is required"));
          }
          const example = getGallery().examples.find(item => item.id === args.id);
          result = example ? toolResult({ example: toPublicUrl(publicExample(example)) }) : toolResult({ error: "Example not found" }, true);
        } else {
          return sendJson(response, 200, jsonRpcError(message.id, -32602, "Unknown or disallowed tool"));
        }
        break;
      }
      default:
        // Modern 2026-07-28 clients can fall back to initialize-capable MCP.
        return sendJson(response, 200, jsonRpcError(message.id, -32601, "Method not found"));
    }
    return sendJson(response, 200, { jsonrpc: "2.0", id: message.id, result });
  };
}
