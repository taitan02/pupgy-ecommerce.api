-- DropIndex
DROP INDEX "skus_product_option_combination_key";

-- CreateTable
CREATE TABLE "product_images" (
    "id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "shop_id" UUID NOT NULL,
    "storage_key" VARCHAR(400) NOT NULL,
    "content_type" VARCHAR(80) NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "alt" VARCHAR(200),
    "position" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "product_images_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "product_images_storage_key_key" ON "product_images"("storage_key");

-- CreateIndex
CREATE INDEX "product_images_product_id_position_idx" ON "product_images"("product_id", "position");

-- AddForeignKey
ALTER TABLE "product_images" ADD CONSTRAINT "product_images_product_id_shop_id_fkey" FOREIGN KEY ("product_id", "shop_id") REFERENCES "products"("id", "shop_id") ON DELETE CASCADE ON UPDATE CASCADE;
