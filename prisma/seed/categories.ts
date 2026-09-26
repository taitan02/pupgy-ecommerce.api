/**
 * Platform category tree. Merchants list into this shared taxonomy (ADR-001), so it
 * is seeded data, not merchant data. Kept deliberately shallow: two levels are
 * enough to exercise the tree and the SEO URLs without pretending to be complete.
 */
export interface CategorySeed {
  slug: string;
  name: string;
  children?: CategorySeed[];
}

export const categorySeed: CategorySeed[] = [
  {
    slug: 'dien-thoai-phu-kien',
    name: 'Điện thoại & Phụ kiện',
    children: [
      { slug: 'dien-thoai', name: 'Điện thoại' },
      { slug: 'tablet', name: 'Máy tính bảng' },
      { slug: 'sac-cap', name: 'Sạc & Cáp' },
      { slug: 'op-lung', name: 'Ốp lưng & Bao da' },
    ],
  },
  {
    slug: 'may-tinh-laptop',
    name: 'Máy tính & Laptop',
    children: [
      { slug: 'laptop', name: 'Laptop' },
      { slug: 'man-hinh', name: 'Màn hình' },
      { slug: 'ban-phim-chuot', name: 'Bàn phím & Chuột' },
    ],
  },
  {
    slug: 'thoi-trang-nam',
    name: 'Thời trang nam',
    children: [
      { slug: 'ao-nam', name: 'Áo nam' },
      { slug: 'quan-nam', name: 'Quần nam' },
      { slug: 'giay-nam', name: 'Giày nam' },
    ],
  },
  {
    slug: 'thoi-trang-nu',
    name: 'Thời trang nữ',
    children: [
      { slug: 'ao-nu', name: 'Áo nữ' },
      { slug: 'vay-dam', name: 'Váy & Đầm' },
      { slug: 'giay-nu', name: 'Giày nữ' },
    ],
  },
  {
    slug: 'nha-cua-doi-song',
    name: 'Nhà cửa & Đời sống',
    children: [
      { slug: 'do-dung-nha-bep', name: 'Đồ dùng nhà bếp' },
      { slug: 'trang-tri-nha-cua', name: 'Trang trí nhà cửa' },
    ],
  },
];
