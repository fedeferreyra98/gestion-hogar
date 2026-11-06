-- V5 (BL-107): expense. Ver docs/03-domain-model.md.
-- PKs UUID generados en la app (sin DEFAULT). Monto en unidades menores + moneda (ADR-004).
-- shared/split_mode se persisten pero el reparto (expense_split) es Fase 2.

CREATE TABLE expense (
    id           UUID PRIMARY KEY,
    household_id UUID        NOT NULL REFERENCES household (id),
    description  TEXT        NOT NULL,
    amount_minor BIGINT      NOT NULL,
    currency     CHAR(3)     NOT NULL,
    expense_date DATE        NOT NULL,
    category_id  UUID REFERENCES category (id),
    paid_by      UUID        NOT NULL REFERENCES member (id),
    source       TEXT        NOT NULL,
    shared       BOOLEAN     NOT NULL DEFAULT FALSE,
    split_mode   TEXT,
    created_by   UUID        NOT NULL REFERENCES member (id),
    deleted_at   TIMESTAMPTZ,
    version      BIGINT      NOT NULL DEFAULT 0,
    created_at   TIMESTAMPTZ NOT NULL,
    updated_at   TIMESTAMPTZ NOT NULL,
    CONSTRAINT expense_amount_check CHECK (amount_minor > 0),
    CONSTRAINT expense_source_check CHECK (source IN ('PURCHASE', 'MANUAL')),
    CONSTRAINT expense_split_mode_check CHECK (split_mode IS NULL OR split_mode IN ('CONTRIBUTION', 'EQUAL', 'CUSTOM')),
    CONSTRAINT expense_split_mode_shared_check CHECK (shared OR split_mode IS NULL)
);

CREATE INDEX expense_household_date_idx ON expense (household_id, expense_date DESC);
CREATE INDEX expense_category_id_idx ON expense (category_id);
