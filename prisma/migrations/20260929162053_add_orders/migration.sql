-- CreateEnum
CREATE TYPE "order_status" AS ENUM ('PENDING', 'CONFIRMED', 'SHIPPING', 'DELIVERED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "payment_method" AS ENUM ('COD', 'SEPAY_QR');

-- CreateEnum
CREATE TYPE "payment_status" AS ENUM ('UNPAID', 'PAID');

-- CreateEnum
CREATE TYPE "cancelled_by" AS ENUM ('BUYER', 'SELLER');

-- CreateEnum
CREATE TYPE "inventory_reason" AS ENUM ('ORDER_PLACED', 'ORDER_CANCELLED');

-- CreateTable
CREATE TABLE "orders" (
    "id" UUID NOT NULL,
    "code" VARCHAR(20) NOT NULL,
    "shop_id" UUID NOT NULL,
    "buyer_id" UUID NOT NULL,
    "status" "order_status" NOT NULL DEFAULT 'PENDING',
    "payment_method" "payment_method" NOT NULL,
    "payment_status" "payment_status" NOT NULL DEFAULT 'UNPAID',
    "recipient_name" VARCHAR(120) NOT NULL,
    "phone" VARCHAR(20) NOT NULL,
    "province_name" VARCHAR(120) NOT NULL,
    "ward_name" VARCHAR(120) NOT NULL,
    "street_line" VARCHAR(200) NOT NULL,
    "note" VARCHAR(500),
    "items_subtotal" INTEGER NOT NULL,
    "shipping_fee" INTEGER NOT NULL,
    "total" INTEGER NOT NULL,
    "placed_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "confirmed_at" TIMESTAMPTZ(3),
    "shipped_at" TIMESTAMPTZ(3),
    "delivered_at" TIMESTAMPTZ(3),
    "cancelled_at" TIMESTAMPTZ(3),
    "cancelled_by" "cancelled_by",
    "cancel_reason" VARCHAR(200),
    "idempotency_key" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_items" (
    "id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "shop_id" UUID NOT NULL,
    "sku_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "product_name" VARCHAR(200) NOT NULL,
    "option_values" TEXT[],
    "image_key" VARCHAR(400),
    "unit_price" INTEGER NOT NULL,
    "quantity" INTEGER NOT NULL,
    "line_total" INTEGER NOT NULL,

    CONSTRAINT "order_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_movements" (
    "id" UUID NOT NULL,
    "shop_id" UUID NOT NULL,
    "sku_id" UUID NOT NULL,
    "order_id" UUID,
    "delta" INTEGER NOT NULL,
    "reason" "inventory_reason" NOT NULL,
    "stock_after" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inventory_movements_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "orders_code_key" ON "orders"("code");

-- CreateIndex
CREATE INDEX "orders_shop_id_status_id_idx" ON "orders"("shop_id", "status", "id");

-- CreateIndex
CREATE INDEX "orders_buyer_id_id_idx" ON "orders"("buyer_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "orders_buyer_id_idempotency_key_key" ON "orders"("buyer_id", "idempotency_key");

-- CreateIndex
CREATE UNIQUE INDEX "orders_id_shop_id_key" ON "orders"("id", "shop_id");

-- CreateIndex
CREATE INDEX "order_items_order_id_idx" ON "order_items"("order_id");

-- CreateIndex
CREATE INDEX "order_items_sku_id_idx" ON "order_items"("sku_id");

-- CreateIndex
CREATE INDEX "inventory_movements_sku_id_id_idx" ON "inventory_movements"("sku_id", "id");

-- CreateIndex
CREATE INDEX "inventory_movements_shop_id_id_idx" ON "inventory_movements"("shop_id", "id");

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_buyer_id_fkey" FOREIGN KEY ("buyer_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_order_id_shop_id_fkey" FOREIGN KEY ("order_id", "shop_id") REFERENCES "orders"("id", "shop_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_sku_id_shop_id_fkey" FOREIGN KEY ("sku_id", "shop_id") REFERENCES "skus"("id", "shop_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_sku_id_shop_id_fkey" FOREIGN KEY ("sku_id", "shop_id") REFERENCES "skus"("id", "shop_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;
