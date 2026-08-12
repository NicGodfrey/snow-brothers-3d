import { userId, type Ulid } from "@enterprise-suite/shared-kernel";
import type { TaskService } from "../../application/task-service.js";
import {
  isRecord,
  optEnum,
  optId,
  reqBody,
  reqId,
  reqInt,
  reqString,
} from "../../application/validation.js";
import { PICK_TRANSITIONS, PUTAWAY_TRANSITIONS } from "../../domain/tasks.js";
import { requireWriteRole } from "../context.js";
import { okJson, type Route } from "../router.js";

const PUTAWAY_STATUSES = Object.keys(PUTAWAY_TRANSITIONS) as (keyof typeof PUTAWAY_TRANSITIONS)[];
const PICK_STATUSES = Object.keys(PICK_TRANSITIONS) as (keyof typeof PICK_TRANSITIONS)[];

export function taskRoutes(service: TaskService): Route[] {
  return [
    // -- putaway --------------------------------------------------------------
    {
      method: "GET",
      pattern: "/tasks/putaways",
      handler: async (req) => {
        const tasks = await service.listPutaways(req.ctx, {
          warehouseId: (req.query.get("warehouseId") as Ulid | null) ?? undefined,
          status: optEnum(req.query.get("status") ?? undefined, "status", PUTAWAY_STATUSES),
          assignedTo: req.query.get("assignedTo") ?? undefined,
          openOnly: req.query.get("openOnly") === "true",
        });
        return okJson({ items: tasks.map((t) => t.toJSON()) });
      },
    },
    {
      method: "GET",
      pattern: "/tasks/putaways/:id",
      handler: async (req) => {
        const task = await service.getPutaway(req.ctx, reqId(req.params.id, "id"));
        return okJson(task.toJSON());
      },
    },
    {
      method: "POST",
      pattern: "/tasks/putaways/:id/assign",
      handler: async (req) => {
        requireWriteRole(req.ctx);
        const body = reqBody(req.body);
        const task = await service.assignPutaway(
          req.ctx,
          reqId(req.params.id, "id"),
          userId(reqString(body.userId, "userId", { maxLength: 64 })),
        );
        return okJson(task.toJSON());
      },
    },
    {
      method: "POST",
      pattern: "/tasks/putaways/:id/start",
      handler: async (req) => {
        requireWriteRole(req.ctx);
        const task = await service.startPutaway(req.ctx, reqId(req.params.id, "id"));
        return okJson(task.toJSON());
      },
    },
    {
      method: "POST",
      pattern: "/tasks/putaways/:id/complete",
      handler: async (req) => {
        requireWriteRole(req.ctx);
        const body = isRecord(req.body) ? req.body : {};
        const task = await service.completePutaway(req.ctx, reqId(req.params.id, "id"), {
          actualBinId: optId(body.actualBinId, "actualBinId"),
        });
        return okJson(task.toJSON());
      },
    },
    {
      method: "POST",
      pattern: "/tasks/putaways/:id/cancel",
      handler: async (req) => {
        requireWriteRole(req.ctx);
        const task = await service.cancelPutaway(req.ctx, reqId(req.params.id, "id"));
        return okJson(task.toJSON());
      },
    },
    // -- pick -----------------------------------------------------------------
    {
      method: "POST",
      pattern: "/reservations/:id/pick-tasks",
      handler: async (req) => {
        requireWriteRole(req.ctx);
        const tasks = await service.generatePickTasks(req.ctx, reqId(req.params.id, "id"));
        return okJson({ items: tasks.map((t) => t.toJSON()) });
      },
    },
    {
      method: "GET",
      pattern: "/tasks/picks",
      handler: async (req) => {
        const tasks = await service.listPicks(req.ctx, {
          warehouseId: (req.query.get("warehouseId") as Ulid | null) ?? undefined,
          reservationId: (req.query.get("reservationId") as Ulid | null) ?? undefined,
          status: optEnum(req.query.get("status") ?? undefined, "status", PICK_STATUSES),
          assignedTo: req.query.get("assignedTo") ?? undefined,
          openOnly: req.query.get("openOnly") === "true",
        });
        return okJson({ items: tasks.map((t) => t.toJSON()) });
      },
    },
    {
      method: "GET",
      pattern: "/tasks/picks/:id",
      handler: async (req) => {
        const task = await service.getPick(req.ctx, reqId(req.params.id, "id"));
        return okJson(task.toJSON());
      },
    },
    {
      method: "POST",
      pattern: "/tasks/picks/:id/assign",
      handler: async (req) => {
        requireWriteRole(req.ctx);
        const body = reqBody(req.body);
        const task = await service.assignPick(
          req.ctx,
          reqId(req.params.id, "id"),
          userId(reqString(body.userId, "userId", { maxLength: 64 })),
        );
        return okJson(task.toJSON());
      },
    },
    {
      method: "POST",
      pattern: "/tasks/picks/:id/start",
      handler: async (req) => {
        requireWriteRole(req.ctx);
        const task = await service.startPick(req.ctx, reqId(req.params.id, "id"));
        return okJson(task.toJSON());
      },
    },
    {
      method: "POST",
      pattern: "/tasks/picks/:id/complete",
      handler: async (req) => {
        requireWriteRole(req.ctx);
        const body = reqBody(req.body);
        const task = await service.completePick(
          req.ctx,
          reqId(req.params.id, "id"),
          reqInt(body.pickedQty, "pickedQty", { min: 0 }),
        );
        return okJson(task.toJSON());
      },
    },
    {
      method: "POST",
      pattern: "/tasks/picks/:id/cancel",
      handler: async (req) => {
        requireWriteRole(req.ctx);
        const task = await service.cancelPick(req.ctx, reqId(req.params.id, "id"));
        return okJson(task.toJSON());
      },
    },
  ];
}
