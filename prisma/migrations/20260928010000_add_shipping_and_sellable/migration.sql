-- AlterTable
ALTER TABLE "products" ADD COLUMN     "height_cm" INTEGER,
ADD COLUMN     "length_cm" INTEGER,
ADD COLUMN     "weight_grams" INTEGER,
ADD COLUMN     "width_cm" INTEGER;

-- AlterTable
ALTER TABLE "skus" ADD COLUMN     "is_sellable" BOOLEAN NOT NULL DEFAULT true;


-- Shipping figures are physical quantities: zero or negative is always a bug.
ALTER TABLE "products" ADD CONSTRAINT "products_shipping_positive" CHECK (
  ("weight_grams" IS NULL OR "weight_grams" > 0) AND
  ("length_cm" IS NULL OR "length_cm" > 0) AND
  ("width_cm" IS NULL OR "width_cm" > 0) AND
  ("height_cm" IS NULL OR "height_cm" > 0)
);
