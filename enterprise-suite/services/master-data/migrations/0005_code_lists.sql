-- Versioned code lists.
--
-- A document raised last quarter must still resolve the label its code had
-- then, so lists are versioned rather than mutable: editing happens on a draft
-- and publishing fixes the version to an effective date while closing the
-- previous one. Published entries are never deleted, only deprecated with an
-- optional successor, which is what lets a historical code be translated
-- forward instead of failing.

CREATE TABLE mdm_code_lists (
    id                  TEXT        PRIMARY KEY,
    tenant_id           TEXT        NOT NULL,
    list_code           TEXT        NOT NULL CHECK (list_code ~ '^[a-z][a-z0-9_.-]{1,47}$'),
    name                TEXT        NOT NULL CHECK (length(btrim(name)) > 0),
    description         TEXT,
    steward             TEXT,
    -- When false, only the listed codes are accepted wherever the list is used.
    allows_custom_codes BOOLEAN     NOT NULL DEFAULT FALSE,
    hierarchical        BOOLEAN     NOT NULL DEFAULT FALSE,
    version             INTEGER     NOT NULL DEFAULT 1,
    created_at          TIMESTAMPTZ NOT NULL,
    updated_at          TIMESTAMPTZ NOT NULL,
    UNIQUE (tenant_id, list_code)
);

CREATE TABLE mdm_code_list_versions (
    id              TEXT        PRIMARY KEY,
    tenant_id       TEXT        NOT NULL,
    code_list_id    TEXT        NOT NULL REFERENCES mdm_code_lists (id) ON DELETE CASCADE,
    version         INTEGER     NOT NULL CHECK (version > 0),
    status          TEXT        NOT NULL DEFAULT 'draft'
        CHECK (status IN ('draft', 'published', 'retired')),
    effective_from  DATE,
    effective_to    DATE,
    published_at    TIMESTAMPTZ,
    published_by    TEXT,
    notes           TEXT,

    UNIQUE (code_list_id, version),
    CHECK (effective_to IS NULL OR effective_from IS NULL OR effective_to > effective_from),
    -- A draft has no dates; anything published or retired has a start and a
    -- publisher.
    CHECK ((status = 'draft') = (effective_from IS NULL)),
    CHECK (status = 'draft' OR (published_at IS NOT NULL AND published_by IS NOT NULL))
);
-- One open draft at a time, and one version effective on any given date.
CREATE UNIQUE INDEX mdm_code_list_versions_single_draft_uq
    ON mdm_code_list_versions (code_list_id)
    WHERE status = 'draft';
ALTER TABLE mdm_code_list_versions
    ADD CONSTRAINT mdm_code_list_versions_no_overlap
    EXCLUDE USING GIST (
        code_list_id WITH =,
        daterange(effective_from, effective_to, '[)') WITH &&
    ) WHERE (status <> 'draft');

CREATE TABLE mdm_code_list_entries (
    tenant_id         TEXT        NOT NULL,
    version_id        TEXT        NOT NULL REFERENCES mdm_code_list_versions (id) ON DELETE CASCADE,
    code              TEXT        NOT NULL CHECK (code ~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,63}$'),
    label             TEXT        NOT NULL CHECK (length(btrim(label)) > 0),
    description       TEXT,
    parent_code       TEXT,
    sort_order        INTEGER     NOT NULL DEFAULT 0,
    attributes        JSONB       NOT NULL DEFAULT '{}',
    deprecated        BOOLEAN     NOT NULL DEFAULT FALSE,
    deprecated_reason TEXT,
    -- Successor followed when migrating a document from an older version.
    replaced_by       TEXT,

    PRIMARY KEY (version_id, code),
    CHECK (parent_code IS NULL OR parent_code <> code),
    CHECK (replaced_by IS NULL OR replaced_by <> code),
    -- A successor only makes sense on a withdrawn code.
    CHECK (deprecated OR replaced_by IS NULL),
    FOREIGN KEY (version_id, parent_code)
        REFERENCES mdm_code_list_entries (version_id, code) ON DELETE RESTRICT,
    FOREIGN KEY (version_id, replaced_by)
        REFERENCES mdm_code_list_entries (version_id, code) ON DELETE RESTRICT
);
CREATE INDEX mdm_code_list_entries_parent_idx ON mdm_code_list_entries (version_id, parent_code)
    WHERE parent_code IS NOT NULL;
CREATE INDEX mdm_code_list_entries_active_idx ON mdm_code_list_entries (version_id, sort_order)
    WHERE NOT deprecated;
