import { Router } from "express";
import { z } from "zod";
import type { AuthService } from "../auth/authService";
import { getConfig } from "../config";
import { requireAdmin } from "./providers";
import { McpAdminError, McpAdminService } from "../../../services/mcp-registry/adminService";

const registerSchema = z.object({
  endpoint: z.string().min(1).max(2048),
  transport: z.string().min(1).max(32),
  secret: z.string().min(8).max(4096),
});

const approveSchema = z.object({
  resultAuthorization: z.enum(["tool-gated", "resource-gated"]),
  provenancePath: z.string().min(1).max(512).optional(),
});

function statusForAdminError(code: McpAdminError["code"]): number {
  switch (code) {
    case "INVALID_ARGUMENT":
    case "INVALID_TRANSPORT":
      return 400;
    case "NOT_FOUND":
    case "TOOL_NOT_DISCOVERED":
      return 404;
    default:
      return 503;
  }
}

/**
 * Admin routes for the MCP registry — same shape as `server/src/routes/providers.ts`:
 * `requireAdmin` gates every route, CSRF is inherited from the `/api` mount in `index.ts`
 * (`app.use("/api", csrfProtection(...))` runs before this router is reached), and every
 * response body is `{ id, state }` or a discovery listing of tool ids and digests — never the
 * endpoint, never the secret_ref (M6a hold `mcp.no-secret-in-responses`).
 */
export function createMcpServersRouter(options: { auth: AuthService; admin: McpAdminService }): Router {
  const router = Router();
  const cfg = getConfig();

  router.post("/admin/mcp-servers", async (req, res) => {
    const gate = await requireAdmin(options.auth, req.cookies?.[cfg.SESSION_COOKIE_NAME]);
    if (!gate.ok) {
      res.status(gate.status).json({ error: gate.status === 401 ? "UNAUTHENTICATED" : "FORBIDDEN" });
      return;
    }
    const parsed = registerSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "INVALID_ARGUMENT" });
      return;
    }
    try {
      const result = await options.admin.registerServer(parsed.data);
      res.status(201).json(result);
    } catch (error) {
      if (error instanceof McpAdminError) {
        res.status(statusForAdminError(error.code)).json({ error: error.code });
        return;
      }
      res.status(503).json({ error: "DEPENDENCY_UNAVAILABLE" });
    }
  });

  router.post("/admin/mcp-servers/:id/discover", async (req, res) => {
    const gate = await requireAdmin(options.auth, req.cookies?.[cfg.SESSION_COOKIE_NAME]);
    if (!gate.ok) {
      res.status(gate.status).json({ error: gate.status === 401 ? "UNAUTHENTICATED" : "FORBIDDEN" });
      return;
    }
    try {
      const tools = await options.admin.discoverTools(req.params.id);
      res.json({ tools });
    } catch (error) {
      if (error instanceof McpAdminError) {
        res.status(statusForAdminError(error.code)).json({ error: error.code });
        return;
      }
      res.status(503).json({ error: "DEPENDENCY_UNAVAILABLE" });
    }
  });

  router.post("/admin/mcp-servers/:id/tools/:toolId/approve", async (req, res) => {
    const gate = await requireAdmin(options.auth, req.cookies?.[cfg.SESSION_COOKIE_NAME]);
    if (!gate.ok) {
      res.status(gate.status).json({ error: gate.status === 401 ? "UNAUTHENTICATED" : "FORBIDDEN" });
      return;
    }
    const parsed = approveSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "INVALID_ARGUMENT" });
      return;
    }
    try {
      const result = await options.admin.approveTool({
        serverId: req.params.id,
        toolId: req.params.toolId,
        resultAuthorization: parsed.data.resultAuthorization,
        provenancePath: parsed.data.provenancePath,
      });
      res.status(201).json(result);
    } catch (error) {
      if (error instanceof McpAdminError) {
        res.status(statusForAdminError(error.code)).json({ error: error.code });
        return;
      }
      res.status(503).json({ error: "DEPENDENCY_UNAVAILABLE" });
    }
  });

  router.post("/admin/mcp-servers/:id/disable", async (req, res) => {
    const gate = await requireAdmin(options.auth, req.cookies?.[cfg.SESSION_COOKIE_NAME]);
    if (!gate.ok) {
      res.status(gate.status).json({ error: gate.status === 401 ? "UNAUTHENTICATED" : "FORBIDDEN" });
      return;
    }
    try {
      res.json(await options.admin.disableServer(req.params.id));
    } catch {
      res.status(404).json({ error: "NOT_FOUND" });
    }
  });

  return router;
}
