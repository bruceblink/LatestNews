-- CreateTable
CREATE TABLE "public"."user_info"
(
    "id"           BIGSERIAL      NOT NULL,
    "email"        VARCHAR(255),
    "username"     VARCHAR(100),
    "password"     TEXT,
    "display_name" VARCHAR(255),
    "avatar_url"   TEXT,
    "created_at"   TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"   TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_info_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."user_identities"
(
    "id"               BIGSERIAL      NOT NULL,
    "user_id"          BIGINT         NOT NULL,
    "provider"         VARCHAR(50)    NOT NULL,
    "provider_uid"     VARCHAR(255)   NOT NULL,
    "access_token"     TEXT,
    "token_expires_at" TIMESTAMPTZ(6),
    "created_at"       TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"       TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_identities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."cache"
(
    "id"         BIGSERIAL      NOT NULL,
    "data"       TEXT           NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cache_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "user_info_email_key" ON "public"."user_info" ("email");

-- CreateIndex
CREATE UNIQUE INDEX "user_info_username_key" ON "public"."user_info" ("username");

-- CreateIndex
CREATE UNIQUE INDEX "user_identities_provider_provider_uid_key" ON "public"."user_identities" ("provider", "provider_uid");

-- AddForeignKey
ALTER TABLE "public"."user_identities"
    ADD CONSTRAINT "user_identities_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."user_info" ("id") ON DELETE CASCADE ON UPDATE NO ACTION;
