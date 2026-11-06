-- V4 (BL-106): stock_item, stock_movement. Ver docs/03-domain-model.md.
-- PKs UUID generados en la app (sin DEFAULT).
-- purchase_item_id queda sin FK: la tabla purchase_item llega con V6 (BL-108), que agrega la constraint.

CREATE TABLE stock_item (
    id               UUID PRIMARY KEY,
    household_id     UUID          NOT NULL REFERENCES household (id),
    product_id       UUID          NOT NULL REFERENCES product (id),
    quantity         NUMERIC(12, 3) NOT NULL,
    initial_quantity NUMERIC(12, 3) NOT NULL,
    unit             TEXT          NOT NULL,
    expiry_date      DATE,
    location         TEXT,
    purchase_item_id UUID,
    status           TEXT          NOT NULL DEFAULT 'ACTIVE',
    discard_reason   TEXT,
    added_at         TIMESTAMPTZ   NOT NULL,
    updated_at       TIMESTAMPTZ   NOT NULL,
    CONSTRAINT stock_item_quantity_check CHECK (quantity >= 0),
    CONSTRAINT stock_item_initial_quantity_check CHECK (initial_quantity > 0),
    CONSTRAINT stock_item_unit_check CHECK (unit IN ('UNIT', 'KG', 'G', 'L', 'ML', 'PACK')),
    CONSTRAINT stock_item_status_check CHECK (status IN ('ACTIVE', 'CONSUMED', 'DISCARDED')),
    -- un lote ACTIVE siempre tiene remanente; uno CONSUMED está en 0
    CONSTRAINT stock_item_status_quantity_check CHECK (
        (status = 'ACTIVE' AND quantity > 0) OR (status = 'CONSUMED' AND quantity = 0) OR status = 'DISCARDED'
    )
);

CREATE INDEX stock_item_household_status_expiry_idx ON stock_item (household_id, status, expiry_date);
CREATE INDEX stock_item_product_id_idx ON stock_item (product_id);

CREATE TABLE stock_movement (
    id            UUID PRIMARY KEY,
    stock_item_id UUID           NOT NULL REFERENCES stock_item (id),
    type          TEXT           NOT NULL,
    -- cantidad movida; en ADJUST es la diferencia con signo (nuevo - anterior)
    quantity      NUMERIC(12, 3) NOT NULL,
    created_by    UUID           NOT NULL REFERENCES member (id),
    created_at    TIMESTAMPTZ    NOT NULL,
    CONSTRAINT stock_movement_type_check CHECK (type IN ('IN', 'CONSUME', 'DISCARD', 'ADJUST'))
);

CREATE INDEX stock_movement_stock_item_id_idx ON stock_movement (stock_item_id);
