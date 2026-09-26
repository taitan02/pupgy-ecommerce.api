import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { hash } from '@node-rs/argon2';
import { v7 as uuidv7 } from 'uuid';
import { PrismaClient } from '../../src/generated/prisma/client.js';
import { categorySeed, type CategorySeed } from './categories.js';
import { demoUsers, DEMO_PASSWORD } from './demo-users.js';

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

/**
 * Idempotent: seeding twice must not duplicate rows or churn ids, because ids end up
 * in URLs and in other tables. `slug` is the natural key, so upsert on it.
 */
async function upsertTree(nodes: CategorySeed[], parentId: string | null): Promise<void> {
  for (const [index, node] of nodes.entries()) {
    const category = await prisma.category.upsert({
      where: { slug: node.slug },
      update: { name: node.name, parentId, position: index, isActive: true },
      create: { id: uuidv7(), slug: node.slug, name: node.name, parentId, position: index },
      select: { id: true },
    });

    if (node.children?.length) {
      await upsertTree(node.children, category.id);
    }
  }
}

async function seedDemoUsers(): Promise<void> {
  const passwordHash = await hash(DEMO_PASSWORD);

  for (const demo of demoUsers) {
    const user = await prisma.user.upsert({
      where: { email: demo.email },
      update: {},
      create: { id: uuidv7(), email: demo.email, fullName: demo.fullName, passwordHash },
      select: { id: true },
    });

    if (demo.shop) {
      const shop = await prisma.shop.upsert({
        where: { slug: demo.shop.slug },
        update: {},
        create: { id: uuidv7(), name: demo.shop.name, slug: demo.shop.slug },
        select: { id: true },
      });

      await prisma.shopMember.upsert({
        where: { shopId_userId: { shopId: shop.id, userId: user.id } },
        update: { role: 'OWNER' },
        create: { id: uuidv7(), shopId: shop.id, userId: user.id, role: 'OWNER' },
      });
    }

    if (demo.staffOf) {
      const shop = await prisma.shop.findUnique({ where: { slug: demo.staffOf }, select: { id: true } });
      if (shop) {
        await prisma.shopMember.upsert({
          where: { shopId_userId: { shopId: shop.id, userId: user.id } },
          update: { role: 'STAFF' },
          create: { id: uuidv7(), shopId: shop.id, userId: user.id, role: 'STAFF' },
        });
      }
    }
  }
}

await upsertTree(categorySeed, null);
const categories = await prisma.category.count();

// Demo accounts exist so you can log in locally; they must never reach production.
if (process.env.NODE_ENV !== 'production') {
  await seedDemoUsers();
  console.log(`Demo users seeded (password in prisma/seed/demo-users.ts)`);
}

console.log(`Seed complete: ${categories} categories`);
await prisma.$disconnect();
