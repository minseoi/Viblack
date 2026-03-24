import type { Express } from "express";
import { DuplicateChannelNameError } from "../db";
import { ChannelEventBus } from "../events/channel-event-bus";
import { AgentRepository } from "../repositories/agent-repository";
import { ChannelMemberRepository } from "../repositories/channel-member-repository";
import { ChannelRepository } from "../repositories/channel-repository";
import { ChannelMessageService } from "../services/channel-message-service";
import { sanitizeChannelMessageKind, sanitizeText } from "../services/text-utils";

interface RegisterChannelRoutesOptions {
  agentRepository: AgentRepository;
  channelRepository: ChannelRepository;
  channelMemberRepository: ChannelMemberRepository;
  channelEventBus: ChannelEventBus;
  channelMessageService: ChannelMessageService;
}

export function registerChannelRoutes(app: Express, options: RegisterChannelRoutesOptions): void {
  const {
    agentRepository,
    channelRepository,
    channelMemberRepository,
    channelEventBus,
    channelMessageService,
  } = options;

  app.get("/api/channels", (_req, res) => {
    const channels = channelMessageService.listChannels();
    res.json({ channels });
  });

  app.get("/api/channels/events", (req, res) => {
    channelEventBus.attachClient(req, res);
  });

  app.post("/api/channels", (req, res) => {
    const name = sanitizeText(req.body?.name);
    const description = sanitizeText(req.body?.description);
    if (!name || !description) {
      res.status(400).json({ error: "name and description are required" });
      return;
    }

    try {
      const channel = channelRepository.createChannel(name, description);
      res.status(201).json({ channel });
    } catch (err) {
      if (err instanceof DuplicateChannelNameError) {
        res.status(409).json({ error: "channel name already exists" });
        return;
      }
      const message = err instanceof Error ? err.message : "unknown error";
      res.status(500).json({ error: message });
    }
  });

  app.patch("/api/channels/:channelId", (req, res) => {
    const { channelId } = req.params;
    const name = sanitizeText(req.body?.name);
    const description = sanitizeText(req.body?.description);
    if (!name || !description) {
      res.status(400).json({ error: "name and description are required" });
      return;
    }

    try {
      const channel = channelRepository.updateChannel(channelId, name, description);
      if (!channel) {
        res.status(404).json({ error: "channel not found" });
        return;
      }
      res.json({ channel });
    } catch (err) {
      if (err instanceof DuplicateChannelNameError) {
        res.status(409).json({ error: "channel name already exists" });
        return;
      }
      const message = err instanceof Error ? err.message : "unknown error";
      res.status(500).json({ error: message });
    }
  });

  app.delete("/api/channels/:channelId", (req, res) => {
    const { channelId } = req.params;
    const archived = channelRepository.archiveChannel(channelId);
    if (!archived) {
      res.status(404).json({ error: "channel not found" });
      return;
    }
    res.json({ ok: true });
  });

  app.get("/api/channels/:channelId/members", (req, res) => {
    const { channelId } = req.params;
    const channel = channelRepository.getChannel(channelId);
    if (!channel) {
      res.status(404).json({ error: "channel not found" });
      return;
    }
    const members = channelMemberRepository.listChannelMemberAgents(channelId);
    res.json({ channel, members });
  });

  app.post("/api/channels/:channelId/members", (req, res) => {
    const { channelId } = req.params;
    const agentId = sanitizeText(req.body?.agentId);
    if (!agentId) {
      res.status(400).json({ error: "agentId is required" });
      return;
    }

    const channel = channelRepository.getChannel(channelId);
    if (!channel) {
      res.status(404).json({ error: "channel not found" });
      return;
    }

    const agent = agentRepository.getAgent(agentId);
    if (!agent) {
      res.status(404).json({ error: "agent not found" });
      return;
    }

    const member = channelMemberRepository.addChannelMember(channelId, agentId);
    if (!member) {
      res.status(500).json({ error: "failed to add channel member" });
      return;
    }
    const currentMembers = channelMemberRepository.listChannelMembers(channelId);
    const isFirstMember = currentMembers.length === 1;
    channelMessageService.upsertChannelReadState({
      channelId,
      agentId,
      lastReadMessageId: 0,
      isCoordinator: isFirstMember,
    });
    const members = channelMemberRepository.listChannelMemberAgents(channelId);
    res.status(201).json({ member, members });
  });

  app.delete("/api/channels/:channelId/members/:agentId", (req, res) => {
    const { channelId, agentId } = req.params;
    const channel = channelRepository.getChannel(channelId);
    if (!channel) {
      res.status(404).json({ error: "channel not found" });
      return;
    }
    const removed = channelMemberRepository.removeChannelMember(channelId, agentId);
    if (!removed) {
      res.status(404).json({ error: "channel member not found" });
      return;
    }
    channelMessageService.deleteChannelReadState(channelId, agentId);
    res.json({ ok: true });
  });

  app.get("/api/channels/:channelId/messages", (req, res) => {
    const { channelId } = req.params;
    const afterRaw = req.query.after;
    const afterValue = Array.isArray(afterRaw) ? afterRaw[0] : afterRaw;
    const parsedAfter = typeof afterValue === "string" ? Number.parseInt(afterValue, 10) : Number.NaN;
    const afterMessageId = Number.isInteger(parsedAfter) && parsedAfter > 0 ? parsedAfter : undefined;

    const payload = channelMessageService.listChannelMessages(channelId, afterMessageId);
    if (!payload) {
      res.status(404).json({ error: "channel not found" });
      return;
    }

    res.json(payload);
  });

  app.get("/api/channels/:channelId/read-state", (req, res) => {
    const { channelId } = req.params;
    const payload = channelMessageService.listChannelReadStates(channelId);
    if (!payload) {
      res.status(404).json({ error: "channel not found" });
      return;
    }
    res.json(payload);
  });

  app.post("/api/channels/:channelId/read-state", (req, res) => {
    const { channelId } = req.params;
    const agentId = sanitizeText(req.body?.agentId);
    const lastReadMessageIdRaw = req.body?.lastReadMessageId;
    const isCoordinatorRaw = req.body?.isCoordinator;
    if (!agentId) {
      res.status(400).json({ error: "agentId is required" });
      return;
    }

    const parsedLastReadMessageId =
      typeof lastReadMessageIdRaw === "number" && Number.isInteger(lastReadMessageIdRaw)
        ? lastReadMessageIdRaw
        : undefined;
    const isCoordinator = typeof isCoordinatorRaw === "boolean" ? isCoordinatorRaw : undefined;
    const payload = channelMessageService.upsertChannelReadState({
      channelId,
      agentId,
      lastReadMessageId: parsedLastReadMessageId,
      isCoordinator,
    });
    if ("error" in payload) {
      res.status(404).json({ error: payload.error });
      return;
    }
    res.json(payload);
  });

  app.get("/api/channels/:channelId/executions", (req, res) => {
    const { channelId } = req.params;
    const afterRaw = req.query.after;
    const afterValue = Array.isArray(afterRaw) ? afterRaw[0] : afterRaw;
    const parsedAfter = typeof afterValue === "string" ? Number.parseInt(afterValue, 10) : Number.NaN;
    const afterJobId = Number.isInteger(parsedAfter) && parsedAfter > 0 ? parsedAfter : undefined;

    const payload = channelMessageService.listChannelExecutionJobs(channelId, afterJobId);
    if (!payload) {
      res.status(404).json({ error: "channel not found" });
      return;
    }
    res.json(payload);
  });

  app.post("/api/channels/:channelId/messages", async (req, res) => {
    const { channelId } = req.params;
    const content = sanitizeText(req.body?.content);
    const messageKind = sanitizeChannelMessageKind(req.body?.messageKind);
    if (!content) {
      res.status(400).json({ error: "content is required" });
      return;
    }

    const payload = await channelMessageService.postChannelMessage(channelId, content, messageKind);
    if ("error" in payload) {
      res.status(payload.error === "channel not found" ? 404 : 409).json({ error: payload.error });
      return;
    }

    res.json(payload);
  });
}
