-- CreateEnum
CREATE TYPE "payment_record_status" AS ENUM ('PENDING', 'PAID', 'EXPIRED', 'CANCELLED');

-- AlterEnum
ALTER TYPE "order_status" ADD VALUE 'AWAITING_PAYMENT';

-- CreateTable
CREATE TABLE "shop_payment_accounts" (
    "id" UUID NOT NULL,
    "shop_id" UUID NOT NULL,
    "bank_code" VARCHAR(40) NOT NULL,
    "account_number" VARCHAR(40) NOT NULL,
    "account_name" VARCHAR(120) NOT NULL,
    "webhook_id" VARCHAR(64) NOT NULL,
    "webhook_secret_cipher" VARCHAR(500) NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "shop_payment_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payments" (
    "id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "shop_id" UUID NOT NULL,
    "amount" INTEGER NOT NULL,
    "status" "payment_record_status" NOT NULL DEFAULT 'PENDING',
    "reference" VARCHAR(32) NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "paid_at" TIMESTAMPTZ(3),
    "provider_transaction_id" VARCHAR(64),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_events" (
    "id" UUID NOT NULL,
    "shop_id" UUID NOT NULL,
    "provider_transaction_id" VARCHAR(64) NOT NULL,
    "payload" JSONB NOT NULL,
    "payment_id" UUID,
    "received_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "shop_payment_accounts_shop_id_key" ON "shop_payment_accounts"("shop_id");

-- CreateIndex
CREATE UNIQUE INDEX "shop_payment_accounts_webhook_id_key" ON "shop_payment_accounts"("webhook_id");

-- CreateIndex
CREATE UNIQUE INDEX "payments_order_id_key" ON "payments"("order_id");

-- CreateIndex
CREATE INDEX "payments_status_expires_at_idx" ON "payments"("status", "expires_at");

-- CreateIndex
CREATE INDEX "payment_events_shop_id_received_at_idx" ON "payment_events"("shop_id", "received_at");

-- CreateIndex
CREATE UNIQUE INDEX "payment_events_shop_id_provider_transaction_id_key" ON "payment_events"("shop_id", "provider_transaction_id");

-- AddForeignKey
ALTER TABLE "shop_payment_accounts" ADD CONSTRAINT "shop_payment_accounts_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_events" ADD CONSTRAINT "payment_events_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE CASCADE ON UPDATE CASCADE;
