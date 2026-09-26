/**
 * Development fixtures. Never seeded in production — see the guard in index.ts.
 *
 * These are throwaway local accounts on a local database. Real credentials never
 * belong in a repository.
 */
export const DEMO_PASSWORD = 'demo-password-123';

export const demoUsers = [
  {
    email: 'seller@demo.local',
    fullName: 'Demo Seller',
    // Signs in at the Seller Center (http://localhost:3002) and owns a demo shop.
    shop: { name: 'Tai Store', slug: 'tai-store' },
  },
  {
    email: 'staff@demo.local',
    fullName: 'Demo Staff',
    // Added to the demo shop as STAFF, to exercise the role checks in the UI.
    staffOf: 'tai-store',
  },
  {
    email: 'customer@demo.local',
    fullName: 'Demo Customer',
    // Storefront side; no shop membership.
  },
];
