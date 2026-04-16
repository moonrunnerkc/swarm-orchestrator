// CRUD routes for Calculation records.
// POST evaluates an arithmetic expression and persists the result.
// PUT re-evaluates when the expression changes.

import { Router } from "express";
import { evaluateExpression } from "../evaluate.js";
import { NotFoundError } from "../errors.js";
import {
  validateCreateBody,
  validateUpdateBody,
  validateUuid,
} from "../validation.js";

export function calculationsRouter(store, cfg) {
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
