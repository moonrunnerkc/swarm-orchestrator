// CRUD routes for Note records.
//
// API field reference (for frontend consumers):
//   POST   /notes        — body: { title: string, content?: string }
//   PUT    /notes/:id    — body: { title?: string, content?: string }  (at least one required)
//   GET    /notes        — returns: { items: Note[], count: number }
//   GET    /notes/:id    — returns: Note
//   DELETE /notes/:id    — returns: 204 No Content
//
//   Note shape: { id, title, content, createdAt, updatedAt }
//   Field names: 'title' (not 'text'), 'content' (not 'body')

import { Router } from "express";
import { NotFoundError } from "../errors.js";
import {
  validateCreateBody,
  validateUpdateBody,
  validateUuid,
} from "../validation.js";

export function notesRouter(store, cfg) {
  const router = Router();

  router.get("/", async (_req, res, next) => {
    try {
      const items = await store.list();
      res.json({ items, count: items.length });
    } catch (err) {
      next(err);
    }
  });

  router.get("/:id", async (req, res, next) => {
    try {
      const id = validateUuid(req.params.id);
      const note = await store.get(id);
      if (!note) throw new NotFoundError("note", id);
      res.json(note);
    } catch (err) {
      next(err);
    }
  });

  router.post("/", async (req, res, next) => {
    try {
      const { title, content } = validateCreateBody(req.body, cfg);
      const record = await store.create({ title, content });
      res.status(201).json(record);
    } catch (err) {
      next(err);
    }
  });

  router.put("/:id", async (req, res, next) => {
    try {
      const id = validateUuid(req.params.id);
      const patch = validateUpdateBody(req.body, cfg);
      const updated = await store.update(id, patch);
      if (!updated) throw new NotFoundError("note", id);
      res.json(updated);
    } catch (err) {
      next(err);
    }
  });

  router.delete("/:id", async (req, res, next) => {
    try {
      const id = validateUuid(req.params.id);
      const removed = await store.remove(id);
      if (!removed) throw new NotFoundError("note", id);
      res.status(204).end();
    } catch (err) {
      next(err);
    }
  });

  return router;
}
