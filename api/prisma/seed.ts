import 'dotenv/config';
import { faker } from '@faker-js/faker/locale/en_NG';
import { PrismaPg } from '@prisma/adapter-pg';
import { v5 as uuidv5 } from 'uuid';
import { PrismaClient } from '../src/generated/prisma/client.js';

/**
 * Idempotent seed. Every row id is a UUID v5 derived from a stable key and
 * faker is seeded, so repeated runs generate identical rows and
 * `skipDuplicates` turns later runs into no-ops.
 */
const NAMESPACE = '6f1d7a52-3c4b-4e0a-9d52-0b1f6a7c9e10';
const COUNTS = {
  customers: Number(process.env.SEED_CUSTOMERS ?? 400),
  restaurants: Number(process.env.SEED_RESTAURANTS ?? 300),
  itemsPerRestaurant: [8, 14] as const,
  orders: Number(process.env.SEED_ORDERS ?? 1000),
};
const CHUNK = 1000;

const CITIES = ['Lagos', 'Abuja', 'Port Harcourt', 'Ibadan', 'Kano', 'Enugu', 'Benin City', 'Kaduna'];
const CUISINES = ['pizza', 'burgers', 'jollof', 'suya', 'sushi', 'chinese', 'bakery', 'vegetarian'] as const;
const CATEGORIES = ['starter', 'main', 'side', 'drink', 'dessert'] as const;
type Cuisine = (typeof CUISINES)[number];
type Category = (typeof CATEGORIES)[number];

const SUFFIX: Record<Cuisine, string[]> = {
  pizza: ['Pizza Hub', 'Slice House', 'Pizzeria'],
  burgers: ['Burger Joint', 'Grill & Bun', 'Burger Bar'],
  jollof: ['Jollof Kitchen', 'Mama Put', 'Buka'],
  suya: ['Suya Spot', 'Suya Corner', 'Yaji House'],
  sushi: ['Sushi Bar', 'Maki Lounge', 'Sushi Express'],
  chinese: ['Wok House', 'Dragon Palace', 'Noodle Bar'],
  bakery: ['Bakery', 'Pastry Place', 'Bread & Co'],
  vegetarian: ['Green Plate', 'Veggie Kitchen', 'Leaf Cafe'],
};

const DISHES: Record<Cuisine, Record<Category, string[]>> = {
  pizza: {
    starter: ['Garlic Bread', 'Chicken Wings'],
    main: ['Margherita', 'Pepperoni', 'Suya Pizza', 'BBQ Chicken Pizza'],
    side: ['Coleslaw', 'Fries'],
    drink: ['Chapman', 'Zobo', 'Cola'],
    dessert: ['Tiramisu', 'Ice Cream'],
  },
  burgers: {
    starter: ['Onion Rings', 'Chicken Tenders'],
    main: ['Classic Beef Burger', 'Double Cheeseburger', 'Crispy Chicken Burger'],
    side: ['Fries', 'Plantain Chips'],
    drink: ['Milkshake', 'Chapman', 'Cola'],
    dessert: ['Brownie', 'Ice Cream'],
  },
  jollof: {
    starter: ['Pepper Soup', 'Moi Moi'],
    main: ['Jollof Rice & Chicken', 'Fried Rice & Turkey', 'Ofada Rice & Sauce', 'Egusi & Pounded Yam'],
    side: ['Fried Plantain', 'Coleslaw'],
    drink: ['Zobo', 'Chapman', 'Kunu'],
    dessert: ['Puff Puff', 'Chin Chin'],
  },
  suya: {
    starter: ['Asun', 'Kilishi'],
    main: ['Beef Suya', 'Chicken Suya', 'Ram Suya'],
    side: ['Sliced Onions & Tomato', 'Yaji'],
    drink: ['Zobo', 'Kunu'],
    dessert: ['Fruit Salad'],
  },
  sushi: {
    starter: ['Miso Soup', 'Edamame'],
    main: ['Salmon Roll', 'Dragon Roll', 'Chicken Katsu'],
    side: ['Seaweed Salad', 'Steamed Rice'],
    drink: ['Green Tea', 'Soda'],
    dessert: ['Mochi'],
  },
  chinese: {
    starter: ['Spring Rolls', 'Egg Drop Soup'],
    main: ['Sweet & Sour Chicken', 'Fried Noodles', 'Beef in Black Bean Sauce'],
    side: ['Egg Fried Rice', 'Steamed Dumplings'],
    drink: ['Jasmine Tea', 'Cola'],
    dessert: ['Fried Banana'],
  },
  bakery: {
    starter: ['Meat Pie', 'Sausage Roll'],
    main: ['Chicken Pie', 'Fish Roll', 'Club Sandwich'],
    side: ['Scotch Egg', 'Doughnut'],
    drink: ['Coffee', 'Smoothie'],
    dessert: ['Cake Slice', 'Cupcake'],
  },
  vegetarian: {
    starter: ['Garden Salad', 'Vegetable Soup'],
    main: ['Veggie Bowl', 'Mushroom Stir Fry', 'Bean Porridge'],
    side: ['Roasted Yam', 'Steamed Vegetables'],
    drink: ['Fresh Juice', 'Zobo'],
    dessert: ['Fruit Salad'],
  },
};

type Status = 'pending' | 'preparing' | 'out_for_delivery' | 'delivered' | 'cancelled';
const STATUS_WEIGHTS: Array<{ value: Status; weight: number }> = [
  { value: 'pending', weight: 10 },
  { value: 'preparing', weight: 10 },
  { value: 'out_for_delivery', weight: 5 },
  { value: 'delivered', weight: 65 },
  { value: 'cancelled', weight: 10 },
];

const FROM = new Date('2026-01-01T00:00:00Z');
const TO = new Date('2026-10-01T00:00:00Z');

const id = (kind: string, n: number) => uuidv5(`${kind}:${n}`, NAMESPACE);
const chunks = <T>(rows: T[]): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < rows.length; i += CHUNK) out.push(rows.slice(i, i + CHUNK));
  return out;
};

export function buildDataset() {
  faker.seed(42);

  const customers = Array.from({ length: COUNTS.customers }, (_, i) => {
    const name = faker.person.fullName();
    const slug = name.toLowerCase().replace(/[^a-z]+/g, '.').replace(/^\.+|\.+$/g, '');
    return {
      id: id('customer', i),
      name,
      email: `${slug}.${i}@example.com`,
      phone: faker.phone.number({ style: 'international' }),
      city: faker.helpers.arrayElement(CITIES),
      createdAt: faker.date.between({ from: FROM, to: TO }),
    };
  });

  const restaurants = Array.from({ length: COUNTS.restaurants }, (_, i) => {
    const cuisine = faker.helpers.arrayElement(CUISINES);
    return {
      id: id('restaurant', i),
      name: `${faker.person.lastName()}'s ${faker.helpers.arrayElement(SUFFIX[cuisine])}`,
      cuisine,
      city: faker.helpers.arrayElement(CITIES),
      address: faker.location.streetAddress(),
      phone: faker.phone.number({ style: 'international' }),
      rating: faker.number.float({ min: 2.5, max: 5, fractionDigits: 1 }),
      isOpen: faker.number.int({ min: 1, max: 10 }) > 2,
      createdAt: faker.date.between({ from: FROM, to: TO }),
    };
  });

  const menuItems = restaurants.flatMap((r, ri) => {
    const count = faker.number.int({ min: COUNTS.itemsPerRestaurant[0], max: COUNTS.itemsPerRestaurant[1] });
    return Array.from({ length: count }, (_, k) => {
      const category = faker.helpers.arrayElement(CATEGORIES);
      return {
        id: id('menu-item', ri * 100 + k),
        restaurantId: r.id,
        name: faker.helpers.arrayElement(DISHES[r.cuisine][category]),
        description: faker.lorem.sentence({ min: 5, max: 10 }),
        category,
        // N500..N15,000 in N50 steps, stored as integer kobo
        priceKobo: faker.number.int({ min: 10, max: 300 }) * 50 * 100,
        available: faker.number.int({ min: 1, max: 10 }) > 1,
        createdAt: r.createdAt,
      };
    });
  });

  const itemsByRestaurant = new Map<string, typeof menuItems>();
  for (const m of menuItems) {
    const list = itemsByRestaurant.get(m.restaurantId) ?? [];
    list.push(m);
    itemsByRestaurant.set(m.restaurantId, list);
  }

  const orders: Array<{
    id: string;
    customerId: string;
    restaurantId: string;
    status: Status;
    deliveryAddress: string;
    totalKobo: number;
    createdAt: Date;
    updatedAt: Date;
  }> = [];
  const orderItems: Array<{ id: string; orderId: string; menuItemId: string; quantity: number; unitPriceKobo: number }> = [];

  for (let i = 0; i < COUNTS.orders; i++) {
    const customer = faker.helpers.arrayElement(customers);
    const restaurant = faker.helpers.arrayElement(restaurants);
    const pool = itemsByRestaurant.get(restaurant.id)!;
    const picked = faker.helpers.arrayElements(pool, { min: 1, max: Math.min(5, pool.length) });
    const orderId = id('order', i);
    let total = 0;
    picked.forEach((m, k) => {
      const quantity = faker.number.int({ min: 1, max: 4 });
      total += quantity * m.priceKobo;
      orderItems.push({ id: id('order-item', i * 10 + k), orderId, menuItemId: m.id, quantity, unitPriceKobo: m.priceKobo });
    });
    const createdAt = faker.date.between({ from: FROM, to: TO });
    orders.push({
      id: orderId,
      customerId: customer.id,
      restaurantId: restaurant.id,
      status: faker.helpers.weightedArrayElement(STATUS_WEIGHTS),
      deliveryAddress: faker.location.streetAddress(),
      totalKobo: total,
      createdAt,
      updatedAt: createdAt,
    });
  }

  return { customers, restaurants, menuItems, orders, orderItems };
}

async function main() {
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
  try {
    const data = buildDataset();
    const insert = async <T>(label: string, rows: T[], fn: (batch: T[]) => Promise<{ count: number }>) => {
      let inserted = 0;
      for (const batch of chunks(rows)) inserted += (await fn(batch)).count;
      console.log(`${label}: ${inserted} inserted, ${rows.length - inserted} already present`);
    };

    await insert('customers', data.customers, (d) => prisma.customer.createMany({ data: d, skipDuplicates: true }));
    await insert('restaurants', data.restaurants, (d) => prisma.restaurant.createMany({ data: d, skipDuplicates: true }));
    await insert('menu_items', data.menuItems, (d) => prisma.menuItem.createMany({ data: d, skipDuplicates: true }));
    await insert('orders', data.orders, (d) => prisma.order.createMany({ data: d, skipDuplicates: true }));
    await insert('order_items', data.orderItems, (d) => prisma.orderItem.createMany({ data: d, skipDuplicates: true }));

    console.log('totals:', {
      customers: await prisma.customer.count(),
      restaurants: await prisma.restaurant.count(),
      menuItems: await prisma.menuItem.count(),
      orders: await prisma.order.count(),
      orderItems: await prisma.orderItem.count(),
    });
  } finally {
    await prisma.$disconnect();
  }
}

// Only run when executed directly (so tests can import buildDataset).
if (process.argv[1] && /seed\.ts$/.test(process.argv[1].replace(/\\/g, '/'))) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
