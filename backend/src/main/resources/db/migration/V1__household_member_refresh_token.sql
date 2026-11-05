-- V1 (BL-101): household, member, refresh_token. Ver docs/03-domain-model.md.
-- PKs UUID generados en la app (sin DEFAULT).

CREATE TABLE household (
    id                         UUID PRIMARY KEY,
    name                       TEXT        NOT NULL,
    base_currency              CHAR(3)     NOT NULL DEFAULT 'ARS',
    timezone                   TEXT        NOT NULL DEFAULT 'America/Argentina/Buenos_Aires',
    expiry_warning_days        INT         NOT NULL DEFAULT 3,
    share_purchases_by_default BOOLEAN     NOT NULL DEFAULT TRUE,
    created_at                 TIMESTAMPTZ NOT NULL,
    updated_at                 TIMESTAMPTZ NOT NULL
);

CREATE TABLE member (
    id            UUID PRIMARY KEY,
    household_id  UUID        NOT NULL REFERENCES household (id),
    email         TEXT        NOT NULL,
    password_hash TEXT        NOT NULL,
    display_name  TEXT        NOT NULL,
    role          TEXT        NOT NULL,
    active        BOOLEAN     NOT NULL DEFAULT TRUE,
    created_at    TIMESTAMPTZ NOT NULL,
    updated_at    TIMESTAMPTZ NOT NULL,
    CONSTRAINT member_role_check CHECK (role IN ('OWNER', 'MEMBER'))
);

CREATE UNIQUE INDEX member_email_lower_uk ON member (lower(email));
CREATE INDEX member_household_id_idx ON member (household_id);

CREATE TABLE refresh_token (
    id         UUID PRIMARY KEY,
    member_id  UUID        NOT NULL REFERENCES member (id),
    token_hash TEXT        NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    revoked_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL,
    CONSTRAINT refresh_token_token_hash_uk UNIQUE (token_hash)
);

CREATE INDEX refresh_token_member_id_idx ON refresh_token (member_id);
