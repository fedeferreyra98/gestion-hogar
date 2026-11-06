-- V2 (BL-104): category, product. Ver docs/03-domain-model.md.
-- PKs UUID generados en la app (sin DEFAULT).

CREATE TABLE category (
    id           UUID PRIMARY KEY,
    household_id UUID        NOT NULL REFERENCES household (id),
    name         TEXT        NOT NULL,
    created_at   TIMESTAMPTZ NOT NULL,
    updated_at   TIMESTAMPTZ NOT NULL
);

CREATE UNIQUE INDEX category_household_name_lower_uk ON category (household_id, lower(name));

CREATE TABLE product (
    id                      UUID PRIMARY KEY,
    household_id            UUID        NOT NULL REFERENCES household (id),
    name                    TEXT        NOT NULL,
    category_id             UUID REFERENCES category (id),
    default_unit            TEXT        NOT NULL,
    default_shelf_life_days INT,
    archived                BOOLEAN     NOT NULL DEFAULT FALSE,
    created_at              TIMESTAMPTZ NOT NULL,
    updated_at              TIMESTAMPTZ NOT NULL,
    CONSTRAINT product_default_unit_check CHECK (default_unit IN ('UNIT', 'KG', 'G', 'L', 'ML', 'PACK')),
    CONSTRAINT product_shelf_life_check CHECK (default_shelf_life_days IS NULL OR default_shelf_life_days >= 0)
);

CREATE UNIQUE INDEX product_household_name_lower_uk ON product (household_id, lower(name));
CREATE INDEX product_category_id_idx ON product (category_id);
