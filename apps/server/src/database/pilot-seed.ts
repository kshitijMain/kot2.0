import type { PrismaClient } from '../generated/prisma/client.js';
import { newTableToken } from '../floor/table-qr.service.js';
import { type ItemSpec, type SeedProfile, seedDevelopmentData } from './dev-seed.js';

/**
 * The QR pilot's restaurant, Mannat (P9-06, ADR-0024): 5 tables with QR codes, a North Indian
 * menu, a manager whose phone rings for every QR order, two waiters and a kitchen screen, and the
 * QR settings the pilot runs with (the diner's mobile number required; UPI when given). Set-up
 * only: it refuses a database that already has a restaurant, like the development seed. Every PIN
 * here is for the first sign-in; the Owner changes them in Manage → Staff before service.
 */

const R = 100; // paise per rupee, for readable prices below

export const MANNAT_PINS = {
  'Owner (Mannat)': '1111',
  'Manager (Mannat)': '2222',
  'Waiter 1': '4444',
  'Waiter 2': '5555',
  Kitchen: '6666',
} as const;

const ITEMS: readonly ItemSpec[] = [
  // Starters
  {
    name: 'Paneer Tikka',
    description: 'Cottage cheese cubes in spiced yoghurt, charred in the tandoor.',
    category: 'Starters',
    price: 280 * R,
    food: 'VEG',
    station: 'kitchen',
    spice: 2,
    modifiers: ['spice'],
    tags: ['bestseller'],
  },
  {
    name: 'Hara Bhara Kabab',
    description: 'Spinach, peas and potato patties, crisp outside and soft inside.',
    category: 'Starters',
    price: 230 * R,
    food: 'VEG',
    station: 'kitchen',
    spice: 1,
  },
  {
    name: 'Crispy Corn',
    description: 'Golden fried sweet corn tossed with pepper, onion and chaat masala.',
    category: 'Starters',
    price: 210 * R,
    food: 'VEG',
    station: 'kitchen',
    spice: 1,
  },
  {
    name: 'Chicken Tikka',
    description: 'Boneless chicken marinated overnight and roasted in the tandoor.',
    category: 'Starters',
    price: 340 * R,
    food: 'NON_VEG',
    station: 'kitchen',
    spice: 2,
    modifiers: ['spice'],
    variants: [
      ['Half', 220 * R],
      ['Full', 340 * R],
    ],
  },
  {
    name: 'Tandoori Chicken',
    description: 'Bone-in chicken in a smoky red marinade, served with mint chutney.',
    category: 'Starters',
    price: 420 * R,
    food: 'NON_VEG',
    station: 'kitchen',
    spice: 2,
    variants: [
      ['Half', 260 * R],
      ['Full', 420 * R],
    ],
    tags: ['bestseller'],
  },
  // Main course
  {
    name: 'Paneer Butter Masala',
    description: 'Paneer in a mild, creamy tomato and butter gravy.',
    category: 'Main Course',
    price: 320 * R,
    food: 'VEG',
    station: 'kitchen',
    spice: 1,
    modifiers: ['spice', 'addons'],
    synonyms: ['PBM'],
    tags: ['bestseller'],
  },
  {
    name: 'Dal Makhani',
    description: 'Black lentils slow-cooked overnight with butter and cream.',
    category: 'Main Course',
    price: 260 * R,
    food: 'VEG',
    station: 'kitchen',
    variants: [
      ['Half', 160 * R],
      ['Full', 260 * R],
    ],
    synonyms: ['DM'],
  },
  {
    name: 'Dal Tadka',
    description: 'Yellow lentils tempered with cumin, garlic and red chilli.',
    category: 'Main Course',
    price: 210 * R,
    food: 'VEG',
    station: 'kitchen',
    spice: 1,
  },
  {
    name: 'Kadai Paneer',
    description: 'Paneer, capsicum and onion in a spicy kadai masala.',
    category: 'Main Course',
    price: 310 * R,
    food: 'VEG',
    station: 'kitchen',
    spice: 2,
    modifiers: ['spice'],
  },
  {
    name: 'Chole Masala',
    description: 'Chickpeas in a tangy onion-tomato gravy.',
    category: 'Main Course',
    price: 220 * R,
    food: 'VEG',
    station: 'kitchen',
    spice: 2,
  },
  {
    name: 'Mix Veg',
    description: 'Seasonal vegetables in a home-style gravy.',
    category: 'Main Course',
    price: 240 * R,
    food: 'VEG',
    station: 'kitchen',
  },
  {
    name: 'Butter Chicken',
    description: 'Tandoori chicken in a rich, mildly sweet tomato butter gravy.',
    category: 'Main Course',
    price: 380 * R,
    food: 'NON_VEG',
    station: 'kitchen',
    spice: 1,
    variants: [
      ['Half', 240 * R],
      ['Full', 380 * R],
    ],
    synonyms: ['BC'],
    tags: ['bestseller'],
  },
  {
    name: 'Kadai Chicken',
    description: 'Chicken with capsicum and freshly ground kadai spices.',
    category: 'Main Course',
    price: 360 * R,
    food: 'NON_VEG',
    station: 'kitchen',
    spice: 2,
    modifiers: ['spice'],
  },
  {
    name: 'Mutton Rogan Josh',
    description: 'Slow-cooked mutton in a Kashmiri red chilli gravy.',
    category: 'Main Course',
    price: 460 * R,
    food: 'NON_VEG',
    station: 'kitchen',
    spice: 2,
  },
  // Breads
  {
    name: 'Chapati',
    description: 'Soft whole-wheat flatbread from the tawa.',
    category: 'Breads',
    price: 25 * R,
    food: 'VEG',
    station: 'kitchen',
    synonyms: ['Phulka', 'Roti'],
    modifiers: ['addons'],
  },
  {
    name: 'Tandoori Roti',
    description: 'Whole-wheat bread baked in the tandoor.',
    category: 'Breads',
    price: 30 * R,
    food: 'VEG',
    station: 'kitchen',
    modifiers: ['addons'],
  },
  {
    name: 'Butter Naan',
    description: 'Leavened bread from the tandoor, brushed with butter.',
    category: 'Breads',
    price: 60 * R,
    food: 'VEG',
    station: 'kitchen',
  },
  {
    name: 'Garlic Naan',
    description: 'Naan topped with garlic and coriander.',
    category: 'Breads',
    price: 80 * R,
    food: 'VEG',
    station: 'kitchen',
  },
  {
    name: 'Lachha Paratha',
    description: 'Layered, flaky whole-wheat paratha.',
    category: 'Breads',
    price: 70 * R,
    food: 'VEG',
    station: 'kitchen',
  },
  {
    name: 'Missi Roti',
    description: 'Gram flour and wheat roti with spices.',
    category: 'Breads',
    price: 50 * R,
    food: 'VEG',
    station: 'kitchen',
  },
  // Rice
  {
    name: 'Jeera Rice',
    description: 'Basmati rice tempered with cumin.',
    category: 'Rice',
    price: 180 * R,
    food: 'VEG',
    station: 'kitchen',
  },
  {
    name: 'Veg Biryani',
    description: 'Fragrant basmati layered with vegetables and whole spices.',
    category: 'Rice',
    price: 260 * R,
    food: 'VEG',
    station: 'kitchen',
    spice: 2,
  },
  {
    name: 'Chicken Biryani',
    description: 'Dum-cooked basmati with spiced chicken, served with raita.',
    category: 'Rice',
    price: 340 * R,
    food: 'NON_VEG',
    station: 'kitchen',
    spice: 2,
    variants: [
      ['Half', 220 * R],
      ['Full', 340 * R],
    ],
  },
  {
    name: 'Steamed Rice',
    description: 'Plain steamed basmati rice.',
    category: 'Rice',
    price: 140 * R,
    food: 'VEG',
    station: 'kitchen',
  },
  // Beverages
  {
    name: 'Masala Chaas',
    description: 'Spiced buttermilk with roasted cumin and mint.',
    category: 'Beverages',
    price: 70 * R,
    food: 'VEG',
    station: 'kitchen',
  },
  {
    name: 'Sweet Lassi',
    description: 'Thick, chilled sweet yoghurt drink.',
    category: 'Beverages',
    price: 90 * R,
    food: 'VEG',
    station: 'kitchen',
  },
  {
    name: 'Fresh Lime Soda',
    description: 'Lime with soda, sweet or salted.',
    category: 'Beverages',
    price: 90 * R,
    food: 'VEG',
    station: 'kitchen',
    variants: [
      ['Sweet', 90 * R],
      ['Salted', 90 * R],
    ],
  },
  {
    name: 'Masala Chai',
    description: 'Tea brewed with milk, ginger and cardamom.',
    category: 'Beverages',
    price: 40 * R,
    food: 'VEG',
    station: 'kitchen',
  },
  {
    name: 'Packaged Water',
    description: 'Sealed 1-litre bottle.',
    category: 'Beverages',
    price: 20 * R,
    food: 'VEG',
    station: 'kitchen',
    tax: 'gst18',
  },
  // Desserts and the thali
  {
    name: 'Gulab Jamun',
    description: 'Two warm milk dumplings in rose-cardamom syrup.',
    category: 'Desserts',
    price: 90 * R,
    food: 'VEG',
    station: 'kitchen',
  },
  {
    name: 'Rasmalai',
    description: 'Soft cheese patties in saffron milk.',
    category: 'Desserts',
    price: 120 * R,
    food: 'VEG',
    station: 'kitchen',
  },
  {
    name: 'Mannat Veg Thali',
    description: 'Dal makhani, paneer butter masala, 3 chapatis, jeera rice and a dessert.',
    category: 'Thalis',
    price: 349 * R,
    food: 'VEG',
    station: 'kitchen',
    tags: ['bestseller'],
  },
];

export const MANNAT_PROFILE: SeedProfile = {
  legalName: 'Mannat',
  displayName: 'Mannat',
  accentColor: '#8A1C2B',
  stateCode: '27',
  address: { line1: 'Mannat restaurant', city: 'Pune', pincode: '411001' },
  sections: [
    {
      name: 'Dining Hall',
      tables: [1, 2, 3, 4, 5].map((number) => ({
        label: String(number),
        capacity: number === 5 ? 6 : 4,
      })),
    },
  ],
  people: [
    ['OWNER', 'Owner (Mannat)', MANNAT_PINS['Owner (Mannat)']],
    ['MANAGER', 'Manager (Mannat)', MANNAT_PINS['Manager (Mannat)']],
    ['WAITER', 'Waiter 1', MANNAT_PINS['Waiter 1']],
    ['WAITER', 'Waiter 2', MANNAT_PINS['Waiter 2']],
    ['KITCHEN', 'Kitchen', MANNAT_PINS.Kitchen],
  ],
  categories: ['Starters', 'Main Course', 'Breads', 'Rice', 'Thalis', 'Beverages', 'Desserts'],
  items: ITEMS,
  thali: {
    item: 'Mannat Veg Thali',
    fixed: [
      ['Dal Makhani', 1],
      ['Paneer Butter Masala', 1],
      ['Chapati', 3],
      ['Jeera Rice', 1],
    ],
    desserts: ['Gulab Jamun', 'Rasmalai'],
  },
  // No kitchen printer to start with: the kitchen works on its screen (KDS); add a printer in
  // Manage → Printers when there is one.
};

export interface PilotOptions {
  readonly hashPin?: (pin: string) => Promise<string>;
  /** The restaurant's business UPI ID, e.g. from its bank's merchant app; none: no Pay button. */
  readonly upiId?: string;
}

export interface PilotSummary {
  readonly restaurantId: string;
  /** Each table's label and QR code (open `<site>/t/<code>`). */
  readonly tables: readonly { readonly label: string; readonly code: string }[];
}

/** Sets up Mannat on an empty database: the restaurant, its QR codes and the pilot's settings. */
export async function seedMannat(
  prisma: PrismaClient,
  options: PilotOptions = {},
): Promise<PilotSummary> {
  const { restaurantId } = await seedDevelopmentData(prisma, {
    profile: MANNAT_PROFILE,
    ...(options.hashPin !== undefined && { hashPin: options.hashPin }),
  });
  const rows = await prisma.diningTable.findMany({
    where: { restaurantId },
    orderBy: { displayOrder: 'asc' },
    select: { id: true, label: true },
  });
  const tables: { label: string; code: string }[] = [];
  for (const row of rows) {
    const code = newTableToken();
    await prisma.diningTable.update({
      where: { id: row.id },
      data: { qrToken: code, qrTokenIssuedAt: new Date() },
    });
    tables.push({ label: row.label, code });
  }
  const settings: [string, unknown][] = [
    // The diner's mobile number before the first order, printed on the bill (P9-02).
    ['qr.askPhone', 'REQUIRED'],
    ['payments.upiPayeeName', 'Mannat'],
    ...(options.upiId === undefined
      ? []
      : [['payments.upiId', options.upiId] as [string, unknown]]),
  ];
  for (const [key, value] of settings) {
    await prisma.setting.create({ data: { restaurantId, key, value: value as never } });
  }
  return { restaurantId, tables };
}
