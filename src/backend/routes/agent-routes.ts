import type { Express } from "express";
import { DuplicateAgentNameError } from "../db";
import { AgentRepository } from "../repositories/agent-repository";
import { AgentExecutionService } from "../services/agent-execution-service";
import { sanitizeText } from "../services/text-utils";

interface RegisterAgentRoutesOptions {
  agentRepository: AgentRepository;
  agentExecutionService: AgentExecutionService;
}

export function registerAgentRoutes(app: Express, options: RegisterAgentRoutesOptions): void {
  const { agentRepository, agentExecutionService } = options;

  app.get("/api/agents", (_req, res) => {
    const agents = agentRepository.listAgents();
    res.json({ agents });
  });

  app.post("/api/agents", (req, res) => {
    const name = sanitizeText(req.body?.name);
    const role = sanitizeText(req.body?.role);
    const systemPrompt = sanitizeText(req.body?.systemPrompt);

    if (!name || !role || !systemPrompt) {
      res.status(400).json({ error: "name, role, systemPrompt are required" });
      return;
    }

    try {
      const agent = agentRepository.createAgent(name, role, systemPrompt);
      res.status(201).json({ agent });
    } catch (err) {
      if (err instanceof DuplicateAgentNameError) {
        res.status(409).json({ error: "agent display name already exists" });
        return;
      }
      const message = err instanceof Error ? err.message : "unknown error";
      res.status(500).json({ error: message });
    }
  });

  app.patch("/api/agents/:agentId", (req, res) => {
    const { agentId } = req.params;
    const name = sanitizeText(req.body?.name);
    const role = sanitizeText(req.body?.role);
    const systemPrompt = sanitizeText(req.body?.systemPrompt);

    if (!name || !role || !systemPrompt) {
      res.status(400).json({ error: "name, role, systemPrompt are required" });
      return;
    }

    try {
      const agent = agentRepository.updateAgent(agentId, name, role, systemPrompt);
      if (!agent) {
        res.status(404).json({ error: "agent not found" });
        return;
      }
      res.json({ agent });
    } catch (err) {
      if (err instanceof DuplicateAgentNameError) {
        res.status(409).json({ error: "agent display name already exists" });
        return;
      }
      const message = err instanceof Error ? err.message : "unknown error";
      res.status(500).json({ error: message });
    }
  });

  app.delete("/api/agents/:agentId", (req, res) => {
    const { agentId } = req.params;
    try {
      const deleted = agentRepository.deleteAgent(agentId);
      if (!deleted) {
        res.status(404).json({ error: "agent not found" });
        return;
      }
      res.json({ ok: true });
    } catch (err) {
      const message = err instanceof Error ? err.message : "unknown error";
      res.status(500).json({ error: message });
    }
  });

  app.delete("/api/agents/:agentId/messages", async (req, res) => {
    const { agentId } = req.params;
    try {
      const cleared = await agentExecutionService.clearMessages(agentId);
      if (!cleared) {
        res.status(404).json({ error: "agent not found" });
        return;
      }
      res.json({ ok: true });
    } catch (err) {
      const message = err instanceof Error ? err.message : "unknown error";
      res.status(500).json({ error: message });
    }
  });

  app.get("/api/agents/:agentId/messages", (req, res) => {
    const { agentId } = req.params;
    const agent = agentRepository.getAgent(agentId);
    if (!agent) {
      res.status(404).json({ error: "agent not found" });
      return;
    }
    const messages = agentRepository.listMessages(agentId);
    res.json({ agent, messages });
  });

  app.post("/api/agents/:agentId/messages", async (req, res) => {
    const { agentId } = req.params;
    const content = sanitizeText(req.body?.content);

    if (!content) {
      res.status(400).json({ error: "content is required" });
      return;
    }

    const agent = agentRepository.getAgent(agentId);
    if (!agent) {
      res.status(404).json({ error: "agent not found" });
      return;
    }

    try {
      const payload = await agentExecutionService.sendDirectMessage(agentId, content);
      res.json(payload);
    } catch (err) {
      const message = err instanceof Error ? err.message : "unknown error";
      agentRepository.appendMessage(agentId, "system", `서버 오류: ${message}`);
      res.status(500).json({ error: message });
    }
  });
}
