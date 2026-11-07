-- V6 (BL-108): purchase, purchase_item + FK de stock_item.purchase_item_id. Ver docs/03-domain-model.md.
-- PKs UUID generados en la app (sin DEFAULT). Montos en unidades menores + moneda (ADR-004).

CREATE TABLE purchase (
    id               UUID PRIMARY KEY,
    household_id     UUID        NOT NULL REFERENCES household (id),
    -- una lista se completa una sola vez: el UNIQUE es la red de seguridad de la concurrencia
    shopping_list_id UUID UNIQUE REFERENCES shopping_list (id),
    store            TEXT,
    purchase_date    DATE        NOT NULL,
    total_minor      BIGINT      NOT NULL,
    currency         CHAR(3)     NOT NULL,
    paid_by          UUID        NOT NULL REFERENCES member (id),
    expense_id       UUID        NOT NULL UNIQUE REFERENCES expense (id),
    created_by       UUID        NOT NULL REFERENCES member (id),
    created_at       TIMESTAMPTZ NOT NULL,
    updated_at       TIMESTAMPTZ NOT NULL,
    CONSTRAINT purchase_total_check CHECK (total_minor > 0)
);

CREATE INDEX purchase_household_date_idx ON purchase (household_id, purchase_date DESC);

CREATE TABLE purchase_item (
    id               UUID PRIMARY KEY,
    purchase_id      UUID           NOT NULL REFERENCES purchase (id) ON DELETE CASCADE,
    -- orden de las líneas tal como se cargaron
    position         INT            NOT NULL,
    product_id       UUID           NOT NULL REFERENCES product (id),
    quantity         NUMERIC(12, 3) NOT NULL,
    unit             TEXT           NOT NULL,
    unit_price_minor BIGINT         NOT NULL,
    total_minor      BIGINT         NOT NULL,
    expiry_date      DATE,
    CONSTRAINT purchase_item_quantity_check CHECK (quantity > 0),
    CONSTRAINT purchase_item_unit_check CHECK (unit IN ('UNIT', 'KG', 'G', 'L', 'ML', 'PACK')),
    CONSTRAINT purchase_item_price_check CHECK (unit_price_minor >= 0 AND total_minor >= 0)
);

CREATE INDEX purchase_item_purchase_id_idx ON purchase_item (purchase_id);
CREATE INDEX purchase_item_product_id_idx ON purchase_item (product_id);

-- Editar una compra reemplaza sus ítems; los lotes de stock ya creados se conservan (desvinculados).
ALTER TABLE stock_item
    ADD CONSTRAINT stock_item_purchase_item_fk
        FOREIGN KEY (purchase_item_id) REFERENCES purchase_item (id) ON DELETE SET NULL;
CREATE INDEX stock_item_purchase_item_id_idx ON stock_item (purchase_item_id);
