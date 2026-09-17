/** Demo data for the client walkthrough. Edit the figures here, not in index.ts.
 *
 *  Everything is denominated per Section 6.4: supplier costs in USD, every price
 *  in GHS. Landed costs and suggested prices are computed from these, never
 *  typed in, so the seed and the API cannot disagree about the arithmetic.
 */

/** The FX rate the existing stock was bought at. */
export const HISTORIC_FX_RATE = '12.500000';

/** Shop-wide settings. Both are read by the API; neither has a UI beyond Settings. */
export const SETTINGS = {
  default_margin_pct: '35',
  default_payment_terms_days: '30',
} as const;

/** Single location for the demo — no selector, no transfers. Section 4. */
export const LOCATION_NAME = 'Main Shop';

/** One password for all four, so the walkthrough does not stall on typing. */
export const DEMO_PASSWORD = 'demo1234';

export const USERS = [
  { email: 'sales@demo', fullName: 'Ama Mensah', role: 'sales' },
  { email: 'purchasing@demo', fullName: 'Kofi Asante', role: 'purchasing' },
  { email: 'accounts@demo', fullName: 'Adjoa Boateng', role: 'accountant' },
  { email: 'admin@demo', fullName: 'Yaw Owusu', role: 'admin' },
] as const;

export const SUPPLIERS = [
  {
    name: 'Guangzhou Auto Parts Co',
    contactPerson: 'Li Wei',
    phone: '+86 20 8888 1234',
    email: 'sales@gzautoparts.cn',
    paymentTerms: 'Net 30',
  },
  {
    name: 'Dubai Motor Spares FZE',
    contactPerson: 'Rashid Al Hamadi',
    phone: '+971 4 555 0180',
    email: 'orders@dubaimotorspares.ae',
    paymentTerms: 'Net 45',
  },
] as const;

/** `finalPrice` is the number a human settled on — deliberately not equal to the
 *  computed suggestion, because that override is the thing the demo shows off.
 *  Three parts sit below their reorder point so Low Stock is not an empty table. */
export const PARTS = [
  {
    sku: 'BRK-TOY-001',
    name: 'Brake Pad Set — Front',
    partNumber: '04465-02220',
    oemNumber: '0446502220',
    brand: 'Bosch',
    category: 'Braking',
    fitment: ['2014-2019 Toyota Corolla 1.8L', '2013-2018 Toyota Auris 1.6L'],
    unitCostUsd: '18.4000',
    finalPrice: '310.00',
    reorderPoint: 10,
    openingStock: '24',
  },
  {
    sku: 'OIL-FLT-045',
    name: 'Oil Filter',
    partNumber: '90915-YZZD2',
    oemNumber: '90915YZZD2',
    brand: 'Mann',
    category: 'Filters',
    fitment: ['2010-2020 Toyota Corolla', '2012-2019 Nissan Sentra'],
    unitCostUsd: '4.2000',
    finalPrice: '70.00',
    reorderPoint: 20,
    openingStock: '60',
  },
  {
    sku: 'SPK-NGK-4T',
    name: 'Spark Plug — Iridium',
    partNumber: 'IFR6T11',
    oemNumber: 'NGK4589',
    brand: 'NGK',
    category: 'Ignition',
    fitment: ['2009-2018 Toyota Camry 2.5L', '2011-2017 Honda Accord 2.4L'],
    unitCostUsd: '3.6000',
    finalPrice: '60.00',
    reorderPoint: 24,
    openingStock: '8',
  },
  {
    sku: 'ALT-NIS-220',
    name: 'Alternator 12V 110A',
    partNumber: '23100-JA00A',
    oemNumber: '23100JA00A',
    brand: 'Denso',
    category: 'Electrical',
    fitment: ['2007-2013 Nissan Altima 2.5L'],
    unitCostUsd: '86.0000',
    finalPrice: '1450.00',
    reorderPoint: 2,
    openingStock: '3',
  },
  {
    sku: 'SHK-HON-118',
    name: 'Shock Absorber — Rear',
    partNumber: '52611-TA0-A03',
    oemNumber: '52611TA0A03',
    brand: 'KYB',
    category: 'Suspension',
    fitment: ['2008-2012 Honda Accord 2.4L'],
    unitCostUsd: '32.5000',
    finalPrice: '550.00',
    reorderPoint: 6,
    openingStock: '12',
  },
  {
    sku: 'BAT-12V-70',
    name: 'Battery 12V 70Ah',
    partNumber: 'DIN70-L3',
    oemNumber: null,
    brand: 'Exide',
    category: 'Electrical',
    fitment: ['Universal — DIN L3 terminal'],
    unitCostUsd: '54.0000',
    finalPrice: '910.00',
    reorderPoint: 8,
    openingStock: '5',
  },
  {
    sku: 'WPR-BLD-22',
    name: 'Wiper Blade 22"',
    partNumber: 'WB-22',
    oemNumber: null,
    brand: 'Bosch',
    category: 'Accessories',
    fitment: ['Universal — hook fitting'],
    unitCostUsd: '6.8000',
    finalPrice: '115.00',
    reorderPoint: 15,
    openingStock: '40',
  },
  {
    sku: 'CLT-KIT-TC',
    name: 'Clutch Kit — 3 Piece',
    partNumber: '31250-02100',
    oemNumber: '3125002100',
    brand: 'Exedy',
    category: 'Transmission',
    fitment: ['2011-2016 Toyota Corolla 1.6L Manual'],
    unitCostUsd: '74.0000',
    finalPrice: '1250.00',
    reorderPoint: 3,
    openingStock: '2',
  },
] as const;

export const CUSTOMERS = [
  { name: 'Kwame Motors', phone: '+233 24 411 8820', email: 'kwame@kwamemotors.gh' },
  { name: 'Adom Transport Ltd', phone: '+233 20 776 1043', email: 'accounts@adomtransport.gh' },
  { name: 'Bright Auto Works', phone: '+233 55 902 3317', email: null },
] as const;

/** Left in `sent`, unreceived, on purpose.
 *
 *  It is the starting point of the demo's central story: receive this order and
 *  watch a landed cost, a suggested price and then a till price appear. The rate
 *  is 13.20 against the 12.50 the current stock was bought at, so receiving it
 *  visibly moves the numbers rather than reproducing them. */
export const OPEN_PURCHASE_ORDER = {
  reference: 'PO-2026-0007',
  supplierName: 'Guangzhou Auto Parts Co',
  orderDate: '2026-09-10',
  fxRate: '13.200000',
  lines: [
    { sku: 'BRK-TOY-001', quantityOrdered: '20', unitCostUsd: '18.9000' },
    { sku: 'SPK-NGK-4T', quantityOrdered: '50', unitCostUsd: '3.7500' },
  ],
} as const;
