-- CreateTable
CREATE TABLE "public"."user_info"
(
    "id"           BIGSERIAL      NOT NULL,
    "email"        VARCHAR(255),
    "username"     VARCHAR(100),
    "password"     TEXT,
    "display_name" VARCHAR(255),
    "avatar_url"   TEXT,
    "type"         VARCHAR(100),
    "data"         JSONB,
    "created_at"   TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"   TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_info_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."cache"
(
    "id"         TEXT           NOT NULL,
    "data"       JSONB          NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cache_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "user_info_email_key" ON "public"."user_info" ("email");

-- CreateIndex
CREATE UNIQUE INDEX "user_info_username_key" ON "public"."user_info" ("username");

-- CreateIndex
CREATE UNIQUE INDEX "user_info_type_key" ON "public"."user_info" ("type");
