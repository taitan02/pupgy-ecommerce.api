-- Escrow (ADR-015, supersedes ADR-001).
--
-- Two hand-written steps, because a generated diff cannot know what the old rows mean:
--
-- 1. `payments` and `payment_events` are reshaped, not extended. Under ADR-014 a
--    payment belonged to exactly one order and was received by the shop; under escrow
--    one payment covers several orders and is received by the platform. The existing
--    rows describe a model that no longer exists and cannot be reinterpreted, so they
--    are removed rather than migrated into a shape that would be a lie. This is only
--    safe because no production system has ever run this schema.
--
-- 2. `orders.commission_rate` is backfilled with the current default and the default is
--    then dropped, so new orders must state their rate explicitly. The rate is
--    snapshotted per order: changing the platform's rate must not rewrite what a shop
--    was owed on an order placed last month.

DELETE FROM "payment_events";
DELETE FROM "payments";

-- CreateEnum
CREATE TYPE "ledger_account" AS ENUM ('SHOP_PENDING', 'SHOP_AVAILABLE', 'PLATFORM_REVENUE');

-- CreateEnum
CREATE TYPE "ledger_reason" AS ENUM ('ORDER_PAID', 'ORDER_RELEASED', 'COMMISSION', 'ORDER_REFUNDED', 'COD_COMMISSION_DUE', 'PAYOUT_RESERVED', 'PAYOUT_RETURNED');

-- CreateEnum
CREATE TYPE "payout_status" AS ENUM ('REQUESTED', 'PROCESSING', 'PAID', 'REJECTED');

-- AlterEnum
ALTER TYPE "order_status" ADD VALUE 'COMPLETED';

-- DropForeignKey
ALTER TABLE "payment_events" DROP CONSTRAINT "payment_events_shop_id_fkey";

-- DropForeignKey
ALTER TABLE "payments" DROP CONSTRAINT "payments_order_id_fkey";

-- DropForeignKey
ALTER TABLE "shop_payment_accounts" DROP CONSTRAINT "shop_payment_accounts_shop_id_fkey";

-- DropIndex
DROP INDEX "payment_events_shop_id_provider_transaction_id_key";

-- DropIndex
DROP INDEX "payment_events_shop_id_received_at_idx";

-- DropIndex
DROP INDEX "payments_order_id_key";

-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "commission_rate" INTEGER NOT NULL DEFAULT 500,
ADD COLUMN     "completed_at" TIMESTAMPTZ(3),
ADD COLUMN     "payment_id" UUID,
ADD COLUMN     "released_at" TIMESTAMPTZ(3);

-- AlterTable
ALTER TABLE "payment_events" DROP COLUMN "shop_id";

-- AlterTable
ALTER TABLE "payments" DROP COLUMN "order_id",
DROP COLUMN "reference",
DROP COLUMN "shop_id",
ADD COLUMN     "buyer_id" UUID NOT NULL,
ADD COLUMN     "code" VARCHAR(20) NOT NULL;

-- DropTable
DROP TABLE "shop_payment_accounts";

-- CreateTable
CREATE TABLE "shop_payout_accounts" (
    "id" UUID NOT NULL,
    "shop_id" UUID NOT NULL,
    "bank_code" VARCHAR(40) NOT NULL,
    "account_number" VARCHAR(40) NOT NULL,
    "account_name" VARCHAR(120) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "shop_payout_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ledger_entries" (
    "id" UUID NOT NULL,
    "shop_id" UUID NOT NULL,
    "account" "ledger_account" NOT NULL,
    "amount" INTEGER NOT NULL,
    "reason" "ledger_reason" NOT NULL,
    "order_id" UUID,
    "payout_id" UUID,
    "note" VARCHAR(200),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ledger_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payouts" (
    "id" UUID NOT NULL,
    "shop_id" UUID NOT NULL,
    "amount" INTEGER NOT NULL,
    "status" "payout_status" NOT NULL DEFAULT 'REQUESTED',
    "bank_code" VARCHAR(40) NOT NULL,
    "account_number" VARCHAR(40) NOT NULL,
    "account_name" VARCHAR(120) NOT NULL,
    "note" VARCHAR(200),
    "requested_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "settled_at" TIMESTAMPTZ(3),

    CONSTRAINT "payouts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "shop_payout_accounts_shop_id_key" ON "shop_payout_accounts"("shop_id");

-- CreateIndex
CREATE INDEX "ledger_entries_shop_id_account_idx" ON "ledger_entries"("shop_id", "account");

-- CreateIndex
CREATE INDEX "ledger_entries_order_id_idx" ON "ledger_entries"("order_id");

-- CreateIndex
CREATE INDEX "payouts_shop_id_requested_at_idx" ON "payouts"("shop_id", "requested_at");

-- CreateIndex
CREATE INDEX "payouts_status_idx" ON "payouts"("status");

-- CreateIndex
CREATE INDEX "orders_payment_id_idx" ON "orders"("payment_id");

-- CreateIndex
CREATE INDEX "orders_status_released_at_idx" ON "orders"("status", "released_at");

-- CreateIndex
CREATE UNIQUE INDEX "payment_events_provider_transaction_id_key" ON "payment_events"("provider_transaction_id");

-- CreateIndex
CREATE INDEX "payment_events_received_at_idx" ON "payment_events"("received_at");

-- CreateIndex
CREATE UNIQUE INDEX "payments_code_key" ON "payments"("code");

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shop_payout_accounts" ADD CONSTRAINT "shop_payout_accounts_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_buyer_id_fkey" FOREIGN KEY ("buyer_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_payout_id_fkey" FOREIGN KEY ("payout_id") REFERENCES "payouts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payouts" ADD CONSTRAINT "payouts_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Backfill done; from here the application must supply it.
ALTER TABLE "orders" ALTER COLUMN "commission_rate" DROP DEFAULT;
