-- CreateTable
CREATE TABLE "addresses" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "recipient_name" VARCHAR(120) NOT NULL,
    "phone" VARCHAR(20) NOT NULL,
    "province_code" VARCHAR(16),
    "province_name" VARCHAR(120) NOT NULL,
    "ward_code" VARCHAR(16),
    "ward_name" VARCHAR(120) NOT NULL,
    "street_line" VARCHAR(200) NOT NULL,
    "label" VARCHAR(40),
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "addresses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cart_items" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "shop_id" UUID NOT NULL,
    "sku_id" UUID NOT NULL,
    "quantity" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "cart_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "addresses_user_id_created_at_idx" ON "addresses"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "cart_items_user_id_shop_id_idx" ON "cart_items"("user_id", "shop_id");

-- CreateIndex
CREATE UNIQUE INDEX "cart_items_user_id_sku_id_key" ON "cart_items"("user_id", "sku_id");

-- CreateIndex
CREATE UNIQUE INDEX "skus_id_shop_id_key" ON "skus"("id", "shop_id");

-- AddForeignKey
ALTER TABLE "addresses" ADD CONSTRAINT "addresses_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cart_items" ADD CONSTRAINT "cart_items_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cart_items" ADD CONSTRAINT "cart_items_sku_id_shop_id_fkey" FOREIGN KEY ("sku_id", "shop_id") REFERENCES "skus"("id", "shop_id") ON DELETE CASCADE ON UPDATE CASCADE;
