-- CreateEnum
CREATE TYPE "VerificationType" AS ENUM ('EMAIL_VERIFY', 'EMAIL_CHANGE', 'PASSWORD_RESET', 'PHONE_VERIFY', 'PHONE_PASSWORD_RESET');

-- CreateEnum
CREATE TYPE "LedgerKind" AS ENUM ('ADD', 'REMOVE', 'REPRICE');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "email" VARCHAR(254) NOT NULL,
    "email_verified_at" TIMESTAMP(3),
    "pending_email" VARCHAR(254),
    "phone" VARCHAR(20),
    "phone_verified_at" TIMESTAMP(3),
    "pending_phone" VARCHAR(20),
    "password_hash" TEXT NOT NULL,
    "password_changed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "failed_login_count" INTEGER NOT NULL DEFAULT 0,
    "locked_until" TIMESTAMP(3),
    "default_currency" VARCHAR(3) NOT NULL DEFAULT 'INR',
    "theme" VARCHAR(8) NOT NULL DEFAULT 'system',
    "locale" VARCHAR(8) NOT NULL DEFAULT 'en-IN',
    "show_quantity" BOOLEAN NOT NULL DEFAULT true,
    "terms_accepted_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "token_hash" CHAR(64) NOT NULL,
    "previous_token_hash" CHAR(64),
    "rotated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "persistent" BOOLEAN NOT NULL DEFAULT false,
    "user_agent" VARCHAR(512),
    "ip_address" VARCHAR(64),
    "authenticated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_active_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "verification_tokens" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "type" "VerificationType" NOT NULL,
    "token_hash" CHAR(64) NOT NULL,
    "target" VARCHAR(254) NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "consumed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "verification_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "categories" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "name" VARCHAR(50) NOT NULL,
    "name_key" VARCHAR(50) NOT NULL,
    "color" VARCHAR(16) NOT NULL DEFAULT 'blue',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "items" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "category_id" UUID,
    "name" VARCHAR(120) NOT NULL,
    "price_minor" BIGINT NOT NULL,
    "currency" VARCHAR(3) NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "sku" VARCHAR(64),
    "description" VARCHAR(2000),
    "supplier" VARCHAR(120),
    "purchase_date" DATE,
    "tags" VARCHAR(32)[] DEFAULT ARRAY[]::VARCHAR(32)[],
    "version" INTEGER NOT NULL DEFAULT 1,
    "client_request_id" VARCHAR(64),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "price_history" (
    "id" UUID NOT NULL,
    "item_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "price_minor" BIGINT NOT NULL,
    "currency" VARCHAR(3) NOT NULL,
    "quantity" INTEGER NOT NULL,
    "recorded_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "price_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "value_ledger" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "item_id" UUID,
    "currency" VARCHAR(3) NOT NULL,
    "delta_minor" DECIMAL(30,0) NOT NULL,
    "kind" "LedgerKind" NOT NULL,
    "occurred_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "value_ledger_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "activity_log" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "type" VARCHAR(48) NOT NULL,
    "summary" VARCHAR(300) NOT NULL,
    "entity_id" UUID,
    "metadata" JSONB,
    "ip_address" VARCHAR(64),
    "user_agent" VARCHAR(512),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "activity_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "kind" VARCHAR(16) NOT NULL,
    "title" VARCHAR(120) NOT NULL,
    "body" VARCHAR(500) NOT NULL,
    "link" VARCHAR(200),
    "read_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "users_phone_key" ON "users"("phone");

-- CreateIndex
CREATE UNIQUE INDEX "sessions_token_hash_key" ON "sessions"("token_hash");

-- CreateIndex
CREATE UNIQUE INDEX "sessions_previous_token_hash_key" ON "sessions"("previous_token_hash");

-- CreateIndex
CREATE INDEX "sessions_user_id_idx" ON "sessions"("user_id");

-- CreateIndex
CREATE INDEX "sessions_expires_at_idx" ON "sessions"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "verification_tokens_token_hash_key" ON "verification_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "verification_tokens_user_id_type_created_at_idx" ON "verification_tokens"("user_id", "type", "created_at");

-- CreateIndex
CREATE INDEX "verification_tokens_expires_at_idx" ON "verification_tokens"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "categories_user_id_name_key_key" ON "categories"("user_id", "name_key");

-- CreateIndex
CREATE INDEX "items_user_id_deleted_at_created_at_idx" ON "items"("user_id", "deleted_at", "created_at");

-- CreateIndex
CREATE INDEX "items_user_id_deleted_at_updated_at_idx" ON "items"("user_id", "deleted_at", "updated_at");

-- CreateIndex
CREATE INDEX "items_user_id_deleted_at_price_minor_idx" ON "items"("user_id", "deleted_at", "price_minor");

-- CreateIndex
CREATE INDEX "items_user_id_deleted_at_name_idx" ON "items"("user_id", "deleted_at", "name");

-- CreateIndex
CREATE INDEX "items_category_id_idx" ON "items"("category_id");

-- CreateIndex
CREATE INDEX "items_tags_idx" ON "items" USING GIN ("tags");

-- CreateIndex
CREATE UNIQUE INDEX "items_user_id_client_request_id_key" ON "items"("user_id", "client_request_id");

-- CreateIndex
CREATE INDEX "price_history_item_id_recorded_at_idx" ON "price_history"("item_id", "recorded_at");

-- CreateIndex
CREATE INDEX "price_history_user_id_recorded_at_idx" ON "price_history"("user_id", "recorded_at");

-- CreateIndex
CREATE INDEX "value_ledger_user_id_currency_occurred_at_idx" ON "value_ledger"("user_id", "currency", "occurred_at");

-- CreateIndex
CREATE INDEX "activity_log_user_id_created_at_idx" ON "activity_log"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "notifications_user_id_read_at_created_at_idx" ON "notifications"("user_id", "read_at", "created_at");

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "verification_tokens" ADD CONSTRAINT "verification_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "categories" ADD CONSTRAINT "categories_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "items" ADD CONSTRAINT "items_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "items" ADD CONSTRAINT "items_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "price_history" ADD CONSTRAINT "price_history_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "price_history" ADD CONSTRAINT "price_history_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "value_ledger" ADD CONSTRAINT "value_ledger_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "value_ledger" ADD CONSTRAINT "value_ledger_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activity_log" ADD CONSTRAINT "activity_log_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Data-integrity constraints that Prisma's schema language cannot express.
ALTER TABLE "items"
  ADD CONSTRAINT "items_price_minor_non_negative" CHECK ("price_minor" >= 0),
  ADD CONSTRAINT "items_quantity_positive" CHECK ("quantity" >= 1 AND "quantity" <= 1000000),
  ADD CONSTRAINT "items_currency_format" CHECK ("currency" ~ '^[A-Z]{3}$'),
  ADD CONSTRAINT "items_name_not_blank" CHECK (length(btrim("name")) > 0),
  ADD CONSTRAINT "items_version_positive" CHECK ("version" >= 1);

ALTER TABLE "price_history"
  ADD CONSTRAINT "price_history_price_non_negative" CHECK ("price_minor" >= 0),
  ADD CONSTRAINT "price_history_quantity_positive" CHECK ("quantity" >= 1);

ALTER TABLE "value_ledger"
  ADD CONSTRAINT "value_ledger_currency_format" CHECK ("currency" ~ '^[A-Z]{3}$');

ALTER TABLE "users"
  ADD CONSTRAINT "users_email_lowercase" CHECK ("email" = lower("email")),
  ADD CONSTRAINT "users_default_currency_format" CHECK ("default_currency" ~ '^[A-Z]{3}$');

ALTER TABLE "categories"
  ADD CONSTRAINT "categories_name_key_lowercase" CHECK ("name_key" = lower("name_key"));

ALTER TABLE "verification_tokens"
  ADD CONSTRAINT "verification_tokens_attempts_non_negative" CHECK ("attempts" >= 0);
