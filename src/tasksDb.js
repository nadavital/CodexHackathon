import crypto from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import { config } from "./config.js";

const TASK_STATUS_OPEN = "open";

function nowIso() {
  return new Date().toISOString();
}

function mapTaskRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    title: row.title,
    status: row.status,
    createdAt: row.created_at,
  };
}

class TaskRepository {
  constructor(dbPath = path.join(config.dataDir, "tasks.db")) {
    this.db = new DatabaseSync(dbPath);
    this.db.exec("PRAGMA journal_mode = WAL;");
    this.db.exec("PRAGMA synchronous = NORMAL;");

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS tasks (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL
      )
    `);

    this.insertStmt = this.db.prepare(`
      INSERT INTO tasks (id, title, status, created_at)
      VALUES (?, ?, ?, ?)
    `);

    this.countStmt = this.db.prepare(`
      SELECT COUNT(*) AS count FROM tasks
    `);

    this.listOpenStmt = this.db.prepare(`
      SELECT * FROM tasks
      WHERE status = ?
      ORDER BY created_at DESC, id DESC
    `);

    this.listByStatusStmt = this.db.prepare(`
      SELECT * FROM tasks
      WHERE (? IS NULL OR status = ?)
      ORDER BY created_at DESC, id DESC
    `);

    this.getByIdStmt = this.db.prepare(`
      SELECT * FROM tasks WHERE id = ?
    `);

    this.seedSampleIfEmpty();
  }

  seedSampleIfEmpty() {
    const count = Number(this.countStmt.get()?.count || 0);
    if (count > 0) return;

    const seeded = [
      {
        id: "task-001",
        title: "Ingest PDFs from Downloads",
        status: TASK_STATUS_OPEN,
        createdAt: nowIso(),
      },
      {
        id: "task-002",
        title: "Validate markdown extraction quality",
        status: TASK_STATUS_OPEN,
        createdAt: nowIso(),
      },
      {
        id: "task-003",
        title: "Close old migration checklist",
        status: "closed",
        createdAt: nowIso(),
      },
    ];

    for (const row of seeded) {
      this.insertStmt.run(row.id, row.title, row.status, row.createdAt);
    }
  }

  listOpenTasks() {
    return this.listOpenStmt.all(TASK_STATUS_OPEN).map(mapTaskRow);
  }

  listTasks(status = TASK_STATUS_OPEN) {
    const normalized = status && String(status).trim() ? String(status).trim().toLowerCase() : null;
    return this.listByStatusStmt.all(normalized, normalized).map(mapTaskRow);
  }

  createTask({ title, status = TASK_STATUS_OPEN }) {
    const normalizedTitle = String(title || "").trim();
    if (!normalizedTitle) {
      throw new Error("Missing task title");
    }
    const normalizedStatus = String(status || TASK_STATUS_OPEN).trim().toLowerCase() || TASK_STATUS_OPEN;
    const id = `task-${crypto.randomUUID()}`;
    const createdAt = nowIso();
    this.insertStmt.run(id, normalizedTitle, normalizedStatus, createdAt);
    return mapTaskRow(this.getByIdStmt.get(id));
  }
}

export const taskRepo = new TaskRepository();
