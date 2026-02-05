import { DatabaseSync } from "node:sqlite";
import { config } from "./config.js";

function safeJsonParse(value, fallback) {
  if (!value) return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function mapRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    content: row.content,
    sourceType: row.source_type,
    sourceUrl: row.source_url,
    imagePath: row.image_path,
    fileName: row.file_name,
    fileMime: row.file_mime,
    fileSize: row.file_size,
    rawContent: row.raw_content,
    markdownContent: row.markdown_content,
    summary: row.summary,
    tags: safeJsonParse(row.tags_json, []),
    project: row.project,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    embedding: safeJsonParse(row.embedding_json, null),
    metadata: safeJsonParse(row.metadata_json, {}),
  };
}

class NoteRepository {
  constructor(dbPath = config.dbPath) {
    this.db = new DatabaseSync(dbPath);
    this.db.exec("PRAGMA journal_mode = WAL;");
    this.db.exec("PRAGMA synchronous = NORMAL;");
    this._initSchema();
    this._migrateSchema();

    this.insertStmt = this.db.prepare(`
      INSERT INTO notes (
        id, content, source_type, source_url, image_path,
        file_name, file_mime, file_size, raw_content, markdown_content,
        summary, tags_json, project,
        created_at, updated_at, embedding_json, metadata_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    this.updateEnrichmentStmt = this.db.prepare(`
      UPDATE notes
      SET summary = ?, tags_json = ?, project = ?, embedding_json = ?, metadata_json = ?, updated_at = ?
      WHERE id = ?
    `);

    this.getByIdStmt = this.db.prepare(`
      SELECT * FROM notes WHERE id = ?
    `);

    this.recentStmt = this.db.prepare(`
      SELECT * FROM notes
      ORDER BY datetime(created_at) DESC
      LIMIT ?
    `);

    this.listByProjectStmt = this.db.prepare(`
      SELECT * FROM notes
      WHERE (? IS NULL OR project = ?)
      ORDER BY datetime(created_at) DESC
      LIMIT ?
    `);

    this.searchStmt = this.db.prepare(`
      SELECT * FROM notes
      WHERE
        (? IS NULL OR project = ?)
        AND (
          content LIKE ? OR
          summary LIKE ? OR
          tags_json LIKE ? OR
          ifnull(source_url, '') LIKE ? OR
          ifnull(raw_content, '') LIKE ? OR
          ifnull(markdown_content, '') LIKE ? OR
          ifnull(file_name, '') LIKE ?
        )
      ORDER BY datetime(created_at) DESC
      LIMIT ?
    `);

    this.projectListStmt = this.db.prepare(`
      SELECT DISTINCT project
      FROM notes
      WHERE project IS NOT NULL AND project <> ''
      ORDER BY project ASC
    `);

    this.deleteStmt = this.db.prepare(`DELETE FROM notes WHERE id = ?`);
  }

  _initSchema() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS notes (
        id TEXT PRIMARY KEY,
        content TEXT NOT NULL,
        source_type TEXT NOT NULL,
        source_url TEXT,
        image_path TEXT,
        file_name TEXT,
        file_mime TEXT,
        file_size INTEGER,
        raw_content TEXT,
        markdown_content TEXT,
        summary TEXT,
        tags_json TEXT NOT NULL DEFAULT '[]',
        project TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        embedding_json TEXT,
        metadata_json TEXT NOT NULL DEFAULT '{}'
      )
    `);

    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_notes_created_at ON notes(created_at DESC);
    `);

    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_notes_project ON notes(project);
    `);
  }

  _migrateSchema() {
    const columns = this.db.prepare("PRAGMA table_info(notes)").all();
    const names = new Set(columns.map((col) => col.name));

    const migrations = [
      { name: "file_name", sql: "ALTER TABLE notes ADD COLUMN file_name TEXT" },
      { name: "file_mime", sql: "ALTER TABLE notes ADD COLUMN file_mime TEXT" },
      { name: "file_size", sql: "ALTER TABLE notes ADD COLUMN file_size INTEGER" },
      { name: "raw_content", sql: "ALTER TABLE notes ADD COLUMN raw_content TEXT" },
      { name: "markdown_content", sql: "ALTER TABLE notes ADD COLUMN markdown_content TEXT" },
    ];

    for (const migration of migrations) {
      if (!names.has(migration.name)) {
        this.db.exec(migration.sql);
      }
    }
  }

  createNote(note) {
    this.insertStmt.run(
      note.id,
      note.content,
      note.sourceType,
      note.sourceUrl,
      note.imagePath,
      note.fileName,
      note.fileMime,
      note.fileSize,
      note.rawContent,
      note.markdownContent,
      note.summary,
      JSON.stringify(note.tags || []),
      note.project,
      note.createdAt,
      note.updatedAt,
      note.embedding ? JSON.stringify(note.embedding) : null,
      JSON.stringify(note.metadata || {})
    );
    return this.getNoteById(note.id);
  }

  updateEnrichment({ id, summary, tags, project, embedding, metadata, updatedAt }) {
    this.updateEnrichmentStmt.run(
      summary,
      JSON.stringify(tags || []),
      project,
      embedding ? JSON.stringify(embedding) : null,
      JSON.stringify(metadata || {}),
      updatedAt,
      id
    );
    return this.getNoteById(id);
  }

  getNoteById(id) {
    return mapRow(this.getByIdStmt.get(id));
  }

  listRecent(limit = 20) {
    const bounded = Number.isFinite(Number(limit)) ? Math.max(1, Math.min(200, Number(limit))) : 20;
    return this.recentStmt.all(bounded).map(mapRow);
  }

  listByProject(project = null, limit = 200) {
    const bounded = Number.isFinite(Number(limit)) ? Math.max(1, Math.min(500, Number(limit))) : 200;
    const normalized = project && project.trim() ? project.trim() : null;
    return this.listByProjectStmt.all(normalized, normalized, bounded).map(mapRow);
  }

  searchNotes(query, { project = null, limit = 50 } = {}) {
    const bounded = Number.isFinite(Number(limit)) ? Math.max(1, Math.min(200, Number(limit))) : 50;
    const normalized = project && project.trim() ? project.trim() : null;
    const like = `%${query}%`;
    return this.searchStmt
      .all(normalized, normalized, like, like, like, like, like, like, like, bounded)
      .map(mapRow);
  }

  listProjects() {
    return this.projectListStmt
      .all()
      .map((row) => row.project)
      .filter(Boolean);
  }

  deleteNote(id) {
    this.deleteStmt.run(id);
  }
}

export const noteRepo = new NoteRepository();
