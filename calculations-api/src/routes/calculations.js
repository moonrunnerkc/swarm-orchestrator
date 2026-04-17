// CRUD routes for Calculation records.
// POST evaluates an arithmetic expression and persists the result.
// PUT re-evaluates when the expression changes.
//
// API field reference (for frontend consumers):
//   POST   /calculations       — body: { expression: string, title?: string }
//   PUT    /calculations/:id   — body: { expression?: string, title?: string }  (at least one required)
//   GET    /calculations       — returns: { items: Calculation[], count: number, total: number }
//                                query params: ?sort=updatedAt|createdAt|result|title&order=asc|desc
//                                              &limit=<number>&offset=<number>
//   GET    /calculations/:id   — returns: Calculation
//   GET    /calculations/stats — returns: { totalCalculations, averageResult, minResult, maxResult, lastCalculatedAt }
//   DELETE /calculations/:id   — returns: 204 No Content
//
//   Calculation shape: { id, title, expression, result, createdAt, updatedAt }
//   Field names: 'expression' (not 'formula'), 'title' (nullable), 'result' (computed number)

import { Router } from "express";
import { evaluateExpression } from "../evaluate.js";
import { NotFoundError } from "../errors.js";
import {
  validateCreateBody,
  validateUpdateBody,
  validateUuid,
} from "../validation.js";

const SORTABLE_FIELDS = new Set(["updatedAt", "createdAt", "result", "title"]);

// Coerce query parameter to a single string. Express parses duplicate
// query keys (?a=1&a=2) as arrays, which can cause type confusion in
// downstream comparisons and parseInt calls.
function qstr(value) {
  if (Array.isArray(value)) return value[0] ?? "";
  return typeof value === "string" ? value : "";
}

export function calculationsRouter(store, cfg) {
  const router = Router();

  router.get("/stats", async (_req, res, next) => {
    try {
      const items = await store.list();
      if (items.length === 0) {
        return res.json({
          totalCalculations: 0,
          averageResult: null,
          minResult: null,
          maxResult: null,
          lastCalculatedAt: null,
        });
      }
      const results = items.map((c) => c.result);
      const sum = results.reduce((a, b) => a + b, 0);
      const sorted = items
        .map((c) => c.updatedAt)
        .sort()
        .reverse();
      res.json({
        totalCalculations: items.length,
        averageResult: Number.parseFloat((sum / items.length).toPrecision(12)),
        minResult: Math.min(...results),
        maxResult: Math.max(...results),
        lastCalculatedAt: sorted[0],
      });
    } catch (err) {
      next(err);
    }
  });

  router.get("/", async (req, res, next) => {
    try {
      let items = await store.list();
      const total = items.length;

      // Sort (default: updatedAt descending — most recent first)
      const sortField = SORTABLE_FIELDS.has(qstr(req.query.sort))
        ? qstr(req.query.sort)
        : "updatedAt";
      const order = qstr(req.query.order) === "asc" ? 1 : -1;
      items.sort((a, b) => {
        const av = a[sortField] ?? "";
        const bv = b[sortField] ?? "";
        if (av < bv) return -1 * order;
        if (av > bv) return 1 * order;
        return 0;
      });

      // Pagination (cap limit to prevent unbounded responses)
      const MAX_PAGE_SIZE = 100;
      const offset = Math.max(0, parseInt(qstr(req.query.offset), 10) || 0);
      const rawLimit = parseInt(qstr(req.query.limit), 10);
      const limit = rawLimit > 0 ? Math.min(rawLimit, MAX_PAGE_SIZE) : 0;
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
      const calc = await store.get(id);
      if (!calc) throw new NotFoundError("calculation", id);
      res.json(calc);
    } catch (err) {
      next(err);
    }
  });

  router.post("/", async (req, res, next) => {
    try {
      const { expression, title } = validateCreateBody(req.body, cfg);
      const { expression: normalised, result } = evaluateExpression(expression, {
        maxLength: cfg.maxExpressionLength,
      });
      const record = await store.create({
        title,
        expression: normalised,
        result,
      });
      res.status(201).json(record);
    } catch (err) {
      next(err);
    }
  });

  router.put("/:id", async (req, res, next) => {
    try {
      const id = validateUuid(req.params.id);
      const patch = validateUpdateBody(req.body, cfg);

      const updateFields = {};
      if (patch.title !== undefined) updateFields.title = patch.title;
      if (patch.expression !== undefined) {
        const { expression: normalised, result } = evaluateExpression(
          patch.expression,
          { maxLength: cfg.maxExpressionLength },
        );
        updateFields.expression = normalised;
        updateFields.result = result;
      }

      const updated = await store.update(id, updateFields);
      if (!updated) throw new NotFoundError("calculation", id);
      res.json(updated);
    } catch (err) {
      next(err);
    }
  });

  router.delete("/:id", async (req, res, next) => {
    try {
      const id = validateUuid(req.params.id);
      const removed = await store.remove(id);
      if (!removed) throw new NotFoundError("calculation", id);
      res.status(204).end();
    } catch (err) {
      next(err);
    }
  });

  return router;
}
