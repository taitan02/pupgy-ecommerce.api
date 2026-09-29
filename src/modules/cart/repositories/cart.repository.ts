import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../infra/prisma/prisma.service.js';

const LINE = {
  id: true,
  skuId: true,
  shopId: true,
  quantity: true,
  createdAt: true,
  sku: {
    select: {
      price: true,
      stock: true,
      isSellable: true,
      optionValue1: { select: { value: true } },
      optionValue2: { select: { value: true } },
      product: {
        select: {
          id: true,
          name: true,
          slug: true,
          status: true,
          shop: { select: { id: true, name: true, slug: true, status: true } },
          images: { select: { storageKey: true }, orderBy: { position: 'asc' }, take: 1 },
        },
      },
    },
  },
} as const;

export type CartLineRow = {
  id: string;
  skuId: string;
  shopId: string;
  quantity: number;
  createdAt: Date;
  sku: {
    price: number;
    stock: number;
    isSellable: boolean;
    optionValue1: { value: string } | null;
    optionValue2: { value: string } | null;
    product: {
      id: string;
      name: string;
      slug: string;
      status: string;
      shop: { id: string; name: string; slug: string; status: string };
      images: { storageKey: string }[];
    };
  };
};

/** Like the address book, the user id is in every WHERE clause; there is no method
 *  that reads a cart line without knowing whose it is. */
@Injectable()
export class CartRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** One query for the whole cart: it is bounded by what a person will actually buy,
   *  so paginating it would cost more than it saves. */
  list(userId: string): Promise<CartLineRow[]> {
    return this.prisma.cartItem.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      select: LINE,
    });
  }

  /** One shop's lines, for checkout: an order is placed against a shop, not a cart. */
  listForShop(userId: string, shopId: string): Promise<CartLineRow[]> {
    return this.prisma.cartItem.findMany({
      where: { userId, shopId },
      orderBy: { createdAt: 'desc' },
      select: LINE,
    });
  }

  countLines(userId: string): Promise<number> {
    return this.prisma.cartItem.count({ where: { userId } });
  }

  findOwned(userId: string, id: string): Promise<CartLineRow | null> {
    return this.prisma.cartItem.findFirst({ where: { id, userId }, select: LINE });
  }

  findBySku(userId: string, skuId: string): Promise<{ id: string; quantity: number } | null> {
    return this.prisma.cartItem.findUnique({
      where: { userId_skuId: { userId, skuId } },
      select: { id: true, quantity: true },
    });
  }

  upsertQuantity(input: {
    id: string;
    userId: string;
    shopId: string;
    skuId: string;
    quantity: number;
  }): Promise<{ id: string }> {
    const { id, ...key } = input;
    return this.prisma.cartItem.upsert({
      where: { userId_skuId: { userId: key.userId, skuId: key.skuId } },
      create: { id, ...key },
      update: { quantity: key.quantity },
      select: { id: true },
    });
  }

  setQuantity(id: string, quantity: number): Promise<{ id: string }> {
    return this.prisma.cartItem.update({ where: { id }, data: { quantity }, select: { id: true } });
  }

  async remove(userId: string, id: string): Promise<boolean> {
    const result = await this.prisma.cartItem.deleteMany({ where: { id, userId } });
    return result.count === 1;
  }

  /** The SKU as the shop sells it now, for the checks on add. */
  findSku(skuId: string) {
    return this.prisma.sku.findUnique({
      where: { id: skuId },
      select: {
        id: true,
        shopId: true,
        stock: true,
        isSellable: true,
        product: { select: { status: true, shop: { select: { status: true } } } },
      },
    });
  }
}
