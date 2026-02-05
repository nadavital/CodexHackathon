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
    summary: row.summary,
    tags: safeJsonParse(row.tags_json, []),
    project: row.project,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    embedding: safeJsonParse(row.embedding_json, null),
    metadata: safeJsonParse(row.metadata_json, {}),
  };
}

function mapPmSourceRow(row) {
  if (!row) return null;
  return {
    sourceId: row.source_id,
    sourceFilename: row.source_filename,
    sourcePath: row.source_path,
    sourceKind: row.source_kind,
    isDeleted: Boolean(row.is_deleted),
    deletedAt: row.deleted_at,
    firstSeenAt: row.first_seen_at,
    lastSeenAt: row.last_seen_at,
    lastChecksum: row.last_checksum,
    metadata: safeJsonParse(row.metadata_json, {}),
  };
}

function mapPmVersionRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    sourceId: row.source_id,
    version: row.version,
    checksum: row.checksum,
    fuzzyHash: row.fuzzy_hash,
    contentMarkdown: row.content_markdown,
    agentfsUri: row.agentfs_uri,
    contentBytes: row.content_bytes,
    createdAt: row.created_at,
    metadata: safeJsonParse(row.metadata_json, {}),
  };
}

function mapPmMemoryRow(row) {
  if (!row) return null;
  return {
    memoryId: row.memory_id,
    sourceId: row.source_id,
    latestVersion: row.latest_version,
    titleManual: row.title_manual,
    notesManual: row.notes_manual,
    pinnedTags: safeJsonParse(row.pinned_tags_json, []),
    categoryOverrides: safeJsonParse(row.category_overrides_json, []),
    summaryAuto: row.summary_auto,
    tagsAuto: safeJsonParse(row.tags_auto_json, []),
    linksAuto: safeJsonParse(row.links_auto_json, []),
    effectiveTitle: row.effective_title,
    effectiveSummary: row.effective_summary,
    effectiveTags: safeJsonParse(row.effective_tags_json, []),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    metadata: safeJsonParse(row.metadata_json, {}),
  };
}

class NoteRepository {
  constructor(dbPath = config.dbPath) {
    this.db = new DatabaseSync(dbPath);
    this.db.exec("PRAGMA journal_mode = WAL;");
    this.db.exec("PRAGMA synchronous = NORMAL;");
    this._initSchema();

    this.insertStmt = this.db.prepare(`
      INSERT INTO notes (
        id, content, source_type, source_url, image_path,
        summary, tags_json, project,
        created_at, updated_at, embedding_json, metadata_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
          ifnull(source_url, '') LIKE ?
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

  createNote(note) {
    this.insertStmt.run(
      note.id,
      note.content,
      note.sourceType,
      note.sourceUrl,
      note.imagePath,
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
      .all(normalized, normalized, like, like, like, like, bounded)
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

class ProjectMemoryRepository {
  constructor(db) {
    this.db = db;
    this._initSchema();
    this._prepareStatements();
    this.seedTopLevelCategories();
  }

  _initSchema() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS pm_sources (
        source_id TEXT PRIMARY KEY,
        source_filename TEXT NOT NULL,
        source_path TEXT,
        source_kind TEXT NOT NULL DEFAULT 'markdown',
        is_deleted INTEGER NOT NULL DEFAULT 0,
        deleted_at TEXT,
        first_seen_at TEXT NOT NULL,
        last_seen_at TEXT NOT NULL,
        last_checksum TEXT,
        metadata_json TEXT NOT NULL DEFAULT '{}'
      )
    `);

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS pm_source_versions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        source_id TEXT NOT NULL,
        version INTEGER NOT NULL,
        checksum TEXT NOT NULL,
        fuzzy_hash TEXT,
        content_markdown TEXT NOT NULL,
        agentfs_uri TEXT,
        content_bytes INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        metadata_json TEXT NOT NULL DEFAULT '{}',
        FOREIGN KEY(source_id) REFERENCES pm_sources(source_id),
        UNIQUE(source_id, version),
        UNIQUE(source_id, checksum)
      )
    `);

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS pm_memories (
        memory_id TEXT PRIMARY KEY,
        source_id TEXT NOT NULL,
        latest_version INTEGER NOT NULL,
        title_manual TEXT,
        notes_manual TEXT,
        pinned_tags_json TEXT NOT NULL DEFAULT '[]',
        category_overrides_json TEXT NOT NULL DEFAULT '[]',
        summary_auto TEXT,
        tags_auto_json TEXT NOT NULL DEFAULT '[]',
        links_auto_json TEXT NOT NULL DEFAULT '[]',
        effective_title TEXT,
        effective_summary TEXT,
        effective_tags_json TEXT NOT NULL DEFAULT '[]',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        metadata_json TEXT NOT NULL DEFAULT '{}',
        FOREIGN KEY(source_id) REFERENCES pm_sources(source_id)
      )
    `);

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS pm_categories (
        category_id TEXT PRIMARY KEY,
        parent_category_id TEXT,
        slug TEXT NOT NULL UNIQUE,
        display_name TEXT NOT NULL,
        description TEXT,
        is_top_level INTEGER NOT NULL DEFAULT 0,
        is_system INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY(parent_category_id) REFERENCES pm_categories(category_id)
      )
    `);

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS pm_memory_categories (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        memory_id TEXT NOT NULL,
        category_id TEXT NOT NULL,
        assignment_source TEXT NOT NULL,
        confidence REAL,
        reason TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY(memory_id) REFERENCES pm_memories(memory_id),
        FOREIGN KEY(category_id) REFERENCES pm_categories(category_id),
        UNIQUE(memory_id, category_id, assignment_source)
      )
    `);

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS pm_related_memories (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        memory_id TEXT NOT NULL,
        related_memory_id TEXT NOT NULL,
        relation_type TEXT NOT NULL DEFAULT 'related',
        confidence REAL,
        reason TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY(memory_id) REFERENCES pm_memories(memory_id),
        FOREIGN KEY(related_memory_id) REFERENCES pm_memories(memory_id),
        UNIQUE(memory_id, related_memory_id, relation_type)
      )
    `);

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS pm_source_aliases (
        alias_source_id TEXT PRIMARY KEY,
        canonical_source_id TEXT NOT NULL,
        reason TEXT,
        confidence REAL,
        is_active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY(canonical_source_id) REFERENCES pm_sources(source_id)
      )
    `);

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS pm_jobs (
        job_name TEXT PRIMARY KEY,
        last_started_at TEXT,
        last_completed_at TEXT,
        last_status TEXT,
        last_run_id INTEGER,
        lock_owner TEXT,
        lock_expires_at TEXT,
        updated_at TEXT NOT NULL
      )
    `);

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS pm_job_runs (
        run_id INTEGER PRIMARY KEY AUTOINCREMENT,
        job_name TEXT NOT NULL,
        started_at TEXT NOT NULL,
        finished_at TEXT,
        status TEXT NOT NULL,
        processed_count INTEGER NOT NULL DEFAULT 0,
        error_text TEXT,
        metadata_json TEXT NOT NULL DEFAULT '{}'
      )
    `);

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS pm_memory_evidence (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        memory_id TEXT NOT NULL,
        source_id TEXT NOT NULL,
        source_version INTEGER NOT NULL,
        start_offset INTEGER,
        end_offset INTEGER,
        evidence_text TEXT,
        created_at TEXT NOT NULL,
        metadata_json TEXT NOT NULL DEFAULT '{}',
        FOREIGN KEY(memory_id) REFERENCES pm_memories(memory_id),
        FOREIGN KEY(source_id) REFERENCES pm_sources(source_id)
      )
    `);

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS pm_extraction_runs (
        run_id INTEGER PRIMARY KEY AUTOINCREMENT,
        source_id TEXT NOT NULL,
        source_version INTEGER NOT NULL,
        model TEXT NOT NULL,
        status TEXT NOT NULL,
        started_at TEXT NOT NULL,
        finished_at TEXT,
        extracted_count INTEGER NOT NULL DEFAULT 0,
        error_text TEXT,
        metadata_json TEXT NOT NULL DEFAULT '{}'
      )
    `);

    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_pm_sources_last_seen_at ON pm_sources(last_seen_at DESC)`);
    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_pm_source_versions_source_version ON pm_source_versions(source_id, version DESC)`);
    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_pm_memories_source_id ON pm_memories(source_id)`);
    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_pm_memories_updated_at ON pm_memories(updated_at DESC)`);
    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_pm_memory_categories_memory_id ON pm_memory_categories(memory_id)`);
    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_pm_memory_categories_category_id ON pm_memory_categories(category_id)`);
    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_pm_related_memories_memory_id ON pm_related_memories(memory_id)`);
    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_pm_memory_evidence_memory_id ON pm_memory_evidence(memory_id)`);
    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_pm_memory_evidence_source_version ON pm_memory_evidence(source_id, source_version DESC)`);
    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_pm_extraction_runs_source_version ON pm_extraction_runs(source_id, source_version DESC, run_id DESC)`);
    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_pm_job_runs_job_name ON pm_job_runs(job_name, run_id DESC)`);
  }

  _prepareStatements() {
    this.getSourceByIdStmt = this.db.prepare(`SELECT * FROM pm_sources WHERE source_id = ?`);
    this.upsertSourceStmt = this.db.prepare(`
      INSERT INTO pm_sources (
        source_id, source_filename, source_path, source_kind,
        is_deleted, deleted_at, first_seen_at, last_seen_at, last_checksum, metadata_json
      ) VALUES (?, ?, ?, ?, 0, NULL, ?, ?, ?, ?)
      ON CONFLICT(source_id) DO UPDATE SET
        source_filename = excluded.source_filename,
        source_path = excluded.source_path,
        source_kind = excluded.source_kind,
        is_deleted = 0,
        deleted_at = NULL,
        last_seen_at = excluded.last_seen_at,
        last_checksum = excluded.last_checksum,
        metadata_json = excluded.metadata_json
    `);
    this.markSourceDeletedStmt = this.db.prepare(`
      UPDATE pm_sources
      SET is_deleted = 1, deleted_at = ?, last_seen_at = ?, metadata_json = ?
      WHERE source_id = ?
    `);

    this.getLatestVersionStmt = this.db.prepare(`
      SELECT * FROM pm_source_versions
      WHERE source_id = ?
      ORDER BY version DESC
      LIMIT 1
    `);
    this.getSourceVersionStmt = this.db.prepare(`
      SELECT * FROM pm_source_versions
      WHERE source_id = ? AND version = ?
      LIMIT 1
    `);
    this.insertVersionStmt = this.db.prepare(`
      INSERT INTO pm_source_versions (
        source_id, version, checksum, fuzzy_hash, content_markdown,
        agentfs_uri, content_bytes, created_at, metadata_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    this.getMemoryByIdStmt = this.db.prepare(`SELECT * FROM pm_memories WHERE memory_id = ?`);
    this.upsertMemoryStmt = this.db.prepare(`
      INSERT INTO pm_memories (
        memory_id, source_id, latest_version,
        title_manual, notes_manual, pinned_tags_json, category_overrides_json,
        summary_auto, tags_auto_json, links_auto_json,
        effective_title, effective_summary, effective_tags_json,
        created_at, updated_at, metadata_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(memory_id) DO UPDATE SET
        source_id = excluded.source_id,
        latest_version = excluded.latest_version,
        summary_auto = excluded.summary_auto,
        tags_auto_json = excluded.tags_auto_json,
        links_auto_json = excluded.links_auto_json,
        effective_title = excluded.effective_title,
        effective_summary = excluded.effective_summary,
        effective_tags_json = excluded.effective_tags_json,
        updated_at = excluded.updated_at,
        metadata_json = excluded.metadata_json
    `);

    this.listMemoryRecordsStmt = this.db.prepare(`
      SELECT * FROM pm_memories
      ORDER BY datetime(updated_at) DESC
      LIMIT ?
    `);
    this.listMemoryRecordsByUpdatedRangeStmt = this.db.prepare(`
      SELECT * FROM pm_memories
      WHERE datetime(updated_at) >= datetime(?) AND datetime(updated_at) <= datetime(?)
      ORDER BY datetime(updated_at) ASC
      LIMIT ?
    `);
    this.listMemoryRecordsBySourceStmt = this.db.prepare(`
      SELECT * FROM pm_memories
      WHERE source_id = ?
      ORDER BY datetime(updated_at) DESC
    `);
    this.deleteMemoryCategoriesByMemoryIdStmt = this.db.prepare(`
      DELETE FROM pm_memory_categories
      WHERE memory_id = ?
    `);
    this.deleteRelatedMemoriesByMemoryIdStmt = this.db.prepare(`
      DELETE FROM pm_related_memories
      WHERE memory_id = ? OR related_memory_id = ?
    `);
    this.deleteMemoryRecordStmt = this.db.prepare(`
      DELETE FROM pm_memories
      WHERE memory_id = ?
    `);
    this.deleteMemoryEvidenceByMemoryIdStmt = this.db.prepare(`
      DELETE FROM pm_memory_evidence
      WHERE memory_id = ?
    `);
    this.insertMemoryEvidenceStmt = this.db.prepare(`
      INSERT INTO pm_memory_evidence (
        memory_id, source_id, source_version, start_offset, end_offset, evidence_text, created_at, metadata_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    this.insertCategoryStmt = this.db.prepare(`
      INSERT OR IGNORE INTO pm_categories (
        category_id, parent_category_id, slug, display_name, description,
        is_top_level, is_system, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)
    `);
    this.getCategoryBySlugStmt = this.db.prepare(`
      SELECT * FROM pm_categories
      WHERE slug = ?
      LIMIT 1
    `);

    this.upsertMemoryCategoryStmt = this.db.prepare(`
      INSERT INTO pm_memory_categories (
        memory_id, category_id, assignment_source, confidence, reason, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(memory_id, category_id, assignment_source) DO UPDATE SET
        confidence = excluded.confidence,
        reason = excluded.reason,
        updated_at = excluded.updated_at
    `);
    this.deleteMemoryCategoriesBySourceStmt = this.db.prepare(`
      DELETE FROM pm_memory_categories
      WHERE memory_id = ? AND assignment_source = ?
    `);

    this.upsertRelatedMemoryStmt = this.db.prepare(`
      INSERT INTO pm_related_memories (
        memory_id, related_memory_id, relation_type, confidence, reason, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(memory_id, related_memory_id, relation_type) DO UPDATE SET
        confidence = excluded.confidence,
        reason = excluded.reason,
        updated_at = excluded.updated_at
    `);

    this.upsertSourceAliasStmt = this.db.prepare(`
      INSERT INTO pm_source_aliases (
        alias_source_id, canonical_source_id, reason, confidence, is_active, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(alias_source_id) DO UPDATE SET
        canonical_source_id = excluded.canonical_source_id,
        reason = excluded.reason,
        confidence = excluded.confidence,
        is_active = excluded.is_active,
        updated_at = excluded.updated_at
    `);

    this.startExtractionRunStmt = this.db.prepare(`
      INSERT INTO pm_extraction_runs (
        source_id, source_version, model, status, started_at, metadata_json
      ) VALUES (?, ?, ?, 'running', ?, ?)
    `);
    this.finishExtractionRunStmt = this.db.prepare(`
      UPDATE pm_extraction_runs
      SET status = ?, finished_at = ?, extracted_count = ?, error_text = ?, metadata_json = ?
      WHERE run_id = ?
    `);
  }

  seedTopLevelCategories(nowIso = new Date().toISOString()) {
    const categories = [
      {
        id: "cat_preferences",
        slug: "preferences",
        label: "Preferences",
        description: "User likes, defaults, and style preferences.",
      },
      {
        id: "cat_people",
        slug: "people",
        label: "People",
        description: "People, contacts, and relationship context.",
      },
      {
        id: "cat_commitments",
        slug: "commitments",
        label: "Commitments",
        description: "Promises, tasks, reminders, and follow-ups.",
      },
      {
        id: "cat_decisions",
        slug: "decisions",
        label: "Decisions",
        description: "Decisions taken and rationale.",
      },
      {
        id: "cat_knowledge",
        slug: "knowledge",
        label: "Knowledge",
        description: "Facts, learnings, and durable knowledge.",
      },
      {
        id: "cat_resources",
        slug: "resources",
        label: "Resources",
        description: "Links, files, references, and source materials.",
      },
      {
        id: "cat_events",
        slug: "events",
        label: "Events",
        description: "Timeline moments like meetings and appointments.",
      },
      {
        id: "cat_inbox",
        slug: "inbox",
        label: "Inbox",
        description: "Unclassified memory pending organization.",
      },
    ];

    for (const category of categories) {
      this.insertCategoryStmt.run(
        category.id,
        null,
        category.slug,
        category.label,
        category.description,
        1,
        nowIso,
        nowIso
      );
    }
  }

  upsertSource({ sourceId, sourceFilename, sourcePath = null, sourceKind = "markdown", checksum, seenAt, metadata = {} }) {
    this.upsertSourceStmt.run(
      sourceId,
      sourceFilename,
      sourcePath,
      sourceKind,
      seenAt,
      seenAt,
      checksum,
      JSON.stringify(metadata)
    );
    return this.getSourceById(sourceId);
  }

  markSourceDeleted({ sourceId, deletedAt, metadata = {} }) {
    this.markSourceDeletedStmt.run(deletedAt, deletedAt, JSON.stringify(metadata), sourceId);
    return this.getSourceById(sourceId);
  }

  getSourceById(sourceId) {
    return mapPmSourceRow(this.getSourceByIdStmt.get(sourceId));
  }

  getLatestVersion(sourceId) {
    return mapPmVersionRow(this.getLatestVersionStmt.get(sourceId));
  }

  getSourceVersion(sourceId, version) {
    return mapPmVersionRow(this.getSourceVersionStmt.get(sourceId, version));
  }

  createVersionIfChanged({
    sourceId,
    checksum,
    fuzzyHash,
    contentMarkdown,
    agentfsUri = null,
    contentBytes,
    createdAt,
    metadata = {},
  }) {
    const latest = this.getLatestVersion(sourceId);
    if (latest && latest.checksum === checksum) {
      return {
        changed: false,
        version: latest.version,
        row: latest,
      };
    }

    const nextVersion = latest ? latest.version + 1 : 1;
    this.insertVersionStmt.run(
      sourceId,
      nextVersion,
      checksum,
      fuzzyHash,
      contentMarkdown,
      agentfsUri,
      contentBytes,
      createdAt,
      JSON.stringify(metadata)
    );

    return {
      changed: true,
      version: nextVersion,
      row: this.getLatestVersion(sourceId),
    };
  }

  upsertMemoryRecord({
    memoryId,
    sourceId,
    latestVersion,
    summaryAuto = null,
    tagsAuto = [],
    linksAuto = [],
    effectiveTitle = null,
    effectiveSummary = null,
    effectiveTags = [],
    createdAt,
    updatedAt,
    metadata = {},
  }) {
    const existing = this.getMemoryById(memoryId);
    this.upsertMemoryStmt.run(
      memoryId,
      sourceId,
      latestVersion,
      existing?.titleManual || null,
      existing?.notesManual || null,
      JSON.stringify(existing?.pinnedTags || []),
      JSON.stringify(existing?.categoryOverrides || []),
      summaryAuto,
      JSON.stringify(tagsAuto),
      JSON.stringify(linksAuto),
      effectiveTitle,
      effectiveSummary,
      JSON.stringify(effectiveTags),
      existing?.createdAt || createdAt,
      updatedAt,
      JSON.stringify({ ...existing?.metadata, ...metadata })
    );

    return this.getMemoryById(memoryId);
  }

  getMemoryById(memoryId) {
    return mapPmMemoryRow(this.getMemoryByIdStmt.get(memoryId));
  }

  getCategoryBySlug(slug) {
    const row = this.getCategoryBySlugStmt.get(slug);
    if (!row) return null;
    return {
      categoryId: row.category_id,
      slug: row.slug,
      displayName: row.display_name,
      isTopLevel: Boolean(row.is_top_level),
    };
  }

  assignMemoryCategory({
    memoryId,
    categoryId,
    assignmentSource,
    confidence = null,
    reason = null,
    assignedAt,
  }) {
    this.upsertMemoryCategoryStmt.run(
      memoryId,
      categoryId,
      assignmentSource,
      confidence,
      reason,
      assignedAt,
      assignedAt
    );
  }

  replaceMemoryCategoriesBySource({ memoryId, assignmentSource, assignments = [], assignedAt }) {
    this.db.exec("BEGIN");
    try {
      this.deleteMemoryCategoriesBySourceStmt.run(memoryId, assignmentSource);
      for (const assignment of assignments) {
        this.assignMemoryCategory({
          memoryId,
          categoryId: assignment.categoryId,
          assignmentSource,
          confidence: assignment.confidence ?? null,
          reason: assignment.reason ?? null,
          assignedAt,
        });
      }
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  upsertRelatedMemory({
    memoryId,
    relatedMemoryId,
    relationType = "related",
    confidence = null,
    reason = null,
    linkedAt,
  }) {
    this.upsertRelatedMemoryStmt.run(
      memoryId,
      relatedMemoryId,
      relationType,
      confidence,
      reason,
      linkedAt,
      linkedAt
    );
  }

  upsertSourceAlias({
    aliasSourceId,
    canonicalSourceId,
    reason = null,
    confidence = null,
    isActive = true,
    updatedAt,
  }) {
    this.upsertSourceAliasStmt.run(
      aliasSourceId,
      canonicalSourceId,
      reason,
      confidence,
      isActive ? 1 : 0,
      updatedAt,
      updatedAt
    );
  }

  listMemoryRecords(limit = 50) {
    const bounded = Number.isFinite(Number(limit)) ? Math.max(1, Math.min(500, Number(limit))) : 50;
    return this.listMemoryRecordsStmt.all(bounded).map(mapPmMemoryRow);
  }

  listMemoryRecordsByUpdatedRange({ startIso, endIso, limit = 2000 }) {
    const bounded = Number.isFinite(Number(limit)) ? Math.max(1, Math.min(5000, Number(limit))) : 2000;
    return this.listMemoryRecordsByUpdatedRangeStmt.all(startIso, endIso, bounded).map(mapPmMemoryRow);
  }

  listMemoryRecordsBySource(sourceId) {
    return this.listMemoryRecordsBySourceStmt.all(sourceId).map(mapPmMemoryRow);
  }

  deleteMemoryRecord(memoryId) {
    this.db.exec("BEGIN");
    try {
      this.deleteMemoryCategoriesByMemoryIdStmt.run(memoryId);
      this.deleteRelatedMemoriesByMemoryIdStmt.run(memoryId, memoryId);
      this.deleteMemoryEvidenceByMemoryIdStmt.run(memoryId);
      this.deleteMemoryRecordStmt.run(memoryId);
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  replaceMemoryEvidence({ memoryId, sourceId, sourceVersion, evidenceItems = [], createdAt }) {
    this.db.exec("BEGIN");
    try {
      this.deleteMemoryEvidenceByMemoryIdStmt.run(memoryId);
      for (const evidence of evidenceItems) {
        this.insertMemoryEvidenceStmt.run(
          memoryId,
          sourceId,
          sourceVersion,
          evidence.startOffset ?? null,
          evidence.endOffset ?? null,
          evidence.evidenceText ?? null,
          createdAt,
          JSON.stringify(evidence.metadata || {})
        );
      }
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  startExtractionRun({ sourceId, sourceVersion, model, startedAt, metadata = {} }) {
    const result = this.startExtractionRunStmt.run(
      sourceId,
      sourceVersion,
      model,
      startedAt,
      JSON.stringify(metadata)
    );
    return Number(result.lastInsertRowid);
  }

  finishExtractionRun({
    runId,
    status,
    finishedAt,
    extractedCount = 0,
    errorText = null,
    metadata = {},
  }) {
    this.finishExtractionRunStmt.run(
      status,
      finishedAt,
      extractedCount,
      errorText,
      JSON.stringify(metadata),
      runId
    );
  }
}

export const noteRepo = new NoteRepository();
export const projectMemoryRepo = new ProjectMemoryRepository(noteRepo.db);
