-- Restores the unique SKU-combination index that the previous migration dropped.
--
-- Why it was dropped: the index existed only in hand-written migration SQL, so the
-- schema diff did not know about it and removed it as drift. It is now declared in
-- schema.prisma (@@unique … map: "skus_product_option_combination_key"), which makes
-- Prisma treat it as its own and stop dropping it.
--
-- Why the DROP/CREATE below: Prisma 7 cannot express NULLS NOT DISTINCT, so the
-- index it generates is re-created here with that clause under the same name. Without
-- it Postgres treats every NULL as distinct, and a product with no options could
-- accumulate unlimited duplicate SKUs.

-- CreateIndex
CREATE UNIQUE INDEX "skus_product_option_combination_key" ON "skus"("product_id", "option_value_1_id", "option_value_2_id");

DROP INDEX "skus_product_option_combination_key";
CREATE UNIQUE INDEX "skus_product_option_combination_key"
  ON "skus" ("product_id", "option_value_1_id", "option_value_2_id") NULLS NOT DISTINCT;
