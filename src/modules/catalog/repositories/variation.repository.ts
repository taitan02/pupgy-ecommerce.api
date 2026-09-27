import { Injectable } from '@nestjs/common';
import { v7 as uuidv7 } from 'uuid';
import { PrismaService } from '../../../infra/prisma/prisma.service.js';
import { RequestContext } from '../../../common/context/request-context.js';
import { combinationKey, type VariationPlan } from '../services/variation-plan.js';

/**
 * Replacing a product's variation structure.
 *
 * The rule that shapes this code: **a SKU keeps its id as long as its combination of
 * values still exists**. Ids end up in carts and in order items, so regenerating them
 * on every edit would quietly detach a customer's cart from the thing they chose.
 * Combinations are matched by their labels, which is why "Đen · M" survives a rename
 * of the group from "Màu sắc" to "Màu".
 */
@Injectable()
export class VariationRepository {
  constructor(private readonly prisma: PrismaService) {}

  async replace(productId: string, plan: VariationPlan) {
    const shopId = RequestContext.requireShopId();

    await this.prisma.$transaction(async (tx) => {
      const existing = await tx.product.findFirstOrThrow({
        where: { id: productId, shopId },
        select: {
          options: {
            orderBy: { position: 'asc' },
            select: { id: true, position: true, values: { select: { id: true, value: true } } },
          },
          skus: { select: { id: true, optionValue1Id: true, optionValue2Id: true } },
        },
      });

      const labelByValueId = new Map(
        existing.options.flatMap((option) => option.values.map((value) => [value.id, value.value])),
      );

      const existingSkuIdByCombination = new Map(
        existing.skus.map((sku) => {
          const labels = [sku.optionValue1Id, sku.optionValue2Id]
            .filter((id): id is string => id !== null)
            .map((id) => labelByValueId.get(id)!);
          return [combinationKey(labels), sku.id];
        }),
      );

      // 1. Drop SKUs whose combination is gone. This must happen before the values
      // they reference are deleted — the foreign key is Restrict, deliberately, so a
      // wrong order fails loudly instead of cascading away sold variants.
      const wanted = new Set(plan.skus.map((sku) => combinationKey(sku.labels)));
      const removed = [...existingSkuIdByCombination]
        .filter(([key]) => !wanted.has(key))
        .map(([, id]) => id);

      if (removed.length > 0) {
        await tx.sku.deleteMany({ where: { id: { in: removed }, shopId } });
      }

      // 2. Options and their values, matched by position and by label so unchanged
      // ones keep their ids.
      const valueIdByLabelPerAxis: Map<string, string>[] = [];

      for (const [index, option] of plan.options.entries()) {
        const position = index + 1;
        const current = existing.options.find((existingOption) => existingOption.position === position);
        const optionId = current?.id ?? uuidv7();

        if (current) {
          await tx.productOption.update({ where: { id: optionId }, data: { name: option.name } });
        } else {
          await tx.productOption.create({
            data: { id: optionId, productId, shopId, name: option.name, position },
          });
        }

        const valueIdByLabel = new Map<string, string>();
        for (const [valueIndex, label] of option.values.entries()) {
          const currentValue = current?.values.find((value) => value.value === label);
          const valueId = currentValue?.id ?? uuidv7();

          if (currentValue) {
            await tx.productOptionValue.update({
              where: { id: valueId },
              data: { position: valueIndex + 1 },
            });
          } else {
            await tx.productOptionValue.create({
              data: { id: valueId, optionId, shopId, value: label, position: valueIndex + 1 },
            });
          }

          valueIdByLabel.set(label, valueId);
        }

        await tx.productOptionValue.deleteMany({
          where: { optionId, id: { notIn: [...valueIdByLabel.values()] } },
        });

        valueIdByLabelPerAxis.push(valueIdByLabel);
      }

      // Axes removed entirely. Prisma turns an empty `notIn` into "match nothing",
      // so the no-options case is handled separately rather than silently keeping rows.
      if (plan.options.length === 0) {
        await tx.productOption.deleteMany({ where: { productId, shopId } });
      } else {
        await tx.productOption.deleteMany({
          where: { productId, shopId, position: { notIn: plan.options.map((_, i) => i + 1) } },
        });
      }

      // 3. Update the SKUs that survived, create the new ones.
      for (const sku of plan.skus) {
        const valueIds = sku.labels.map((label, index) => valueIdByLabelPerAxis[index]!.get(label)!);
        const data = {
          price: sku.price,
          stock: sku.stock,
          code: sku.code ?? null,
          isSellable: sku.sellable,
          optionValue1Id: valueIds[0] ?? null,
          optionValue2Id: valueIds[1] ?? null,
        };

        const existingId = existingSkuIdByCombination.get(combinationKey(sku.labels));
        if (existingId) {
          await tx.sku.update({ where: { id: existingId }, data });
        } else {
          await tx.sku.create({ data: { id: uuidv7(), productId, shopId, ...data } });
        }
      }
    });
  }
}
