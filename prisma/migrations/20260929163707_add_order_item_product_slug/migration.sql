/*
  Warnings:

  - Added the required column `product_slug` to the `order_items` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "order_items" ADD COLUMN     "product_slug" VARCHAR(220) NOT NULL;
