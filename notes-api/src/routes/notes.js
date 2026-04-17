// CRUD routes for Note records.
//
// API field reference (for frontend consumers):
//   POST   /notes        — body: { title: string, content?: string }
//   PUT    /notes/:id    — body: { title?: string, content?: string }  (at least one required)
//   GET    /notes        — returns: { items: Note[], count: number, total: number }
//                          query params: ?q=<search>&sort=updatedAt|createdAt|title&order=asc|desc
//                                        &limit=<number>&offset=<number>
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

const SORTABLE_FIELDS = new Set(["updatedAt", "createdAt", "title"]);

export function notesRouter(store, cfg) {
  const router = Router();

  router.get("/", async (req, res, next) => {
    try {
      let items = await store.list();

      // Full-text search across title and content (case-insensitive)
      const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
      if (q) {
        const lower = q.toLowerCase();
        items = items.filter(
          (n) =>
            n.title.toLowerCase().includes(lower) ||
            n.content.toLowerCase().includes(lower),
        );
      }

      const total = items.length;

      // Sort (default: updatedAt descending — most recent first)
      const sortField = SORTABLE_FIELDS.has(req.query.sort)
        ? req.query.sort
        : "updatedAt";
      const order = req.query.order === "asc" ? 1 : -1;
      items.sort((a, b) => {
        const av = a[sortField];
        const bv = b[sortField];
        if (av < bv) return -1 * order;
        if (av > bv) return 1 * order;
        return 0;
      });

      // Pagination
      const offset = Math.max(0, parseInt(req.query.offset, 10) || 0);
      const limit = parseInt(req.query.limit, 10);
      if (limit > 0) {
        items = items.slice(offset, offset + limit);
      } else if (offset > 0) {
        items = items.slice(offset);
      }

      res.json({ items, count: items.length, total });
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
