-- V3 (BL-105): shopping_list, shopping_list_item. Ver docs/03-domain-model.md.
-- PKs UUID generados en la app (sin DEFAULT).

CREATE TABLE shopping_list (
    id           UUID PRIMARY KEY,
    household_id UUID        NOT NULL REFERENCES household (id),
    name         TEXT        NOT NULL,
    status       TEXT        NOT NULL DEFAULT 'OPEN',
    created_by   UUID        NOT NULL REFERENCES member (id),
    completed_at TIMESTAMPTZ,
    created_at   TIMESTAMPTZ NOT NULL,
    updated_at   TIMESTAMPTZ NOT NULL,
    CONSTRAINT shopping_list_status_check CHECK (status IN ('OPEN', 'COMPLETED', 'ARCHIVED'))
);

CREATE INDEX shopping_list_household_status_idx ON shopping_list (household_id, status, created_at DESC);

CREATE TABLE shopping_list_item (
    id                      UUID PRIMARY KEY,
    list_id                 UUID           NOT NULL REFERENCES shopping_list (id) ON DELETE CASCADE,
    product_id              UUID           NOT NULL REFERENCES product (id),
    quantity                NUMERIC(12, 3) NOT NULL,
    unit                    TEXT           NOT NULL,
    estimated_price_minor   BIGINT,
    estimated_price_currency CHAR(3),
    note                    TEXT,
    checked                 BOOLEAN        NOT NULL DEFAULT FALSE,
    checked_at              TIMESTAMPTZ,
    created_at              TIMESTAMPTZ    NOT NULL,
    updated_at              TIMESTAMPTZ    NOT NULL,
    CONSTRAINT shopping_list_item_quantity_check CHECK (quantity > 0),
    CONSTRAINT shopping_list_item_unit_check CHECK (unit IN ('UNIT', 'KG', 'G', 'L', 'ML', 'PACK')),
    CONSTRAINT shopping_list_item_price_check CHECK (
        (estimated_price_minor IS NULL AND estimated_price_currency IS NULL)
        OR (estimated_price_minor IS NOT NULL AND estimated_price_minor >= 0 AND estimated_price_currency IS NOT NULL)
    ),
    CONSTRAINT shopping_list_item_list_product_unit_uk UNIQUE (list_id, product_id, unit)
);

CREATE INDEX shopping_list_item_product_id_idx ON shopping_list_item (product_id);
