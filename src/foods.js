// Rough calories for common groceries, matched by keyword in the list item's text.
// kcal is per `per` (a typical serving); cat drives the "basket mix" bar. Estimates only.
export const FOODS = [
  // produce
  ['spinach', 7, '1 cup', 'produce'], ['banana', 105, '1 medium', 'produce'], ['apple', 95, '1 medium', 'produce'],
  ['orange', 62, '1 medium', 'produce'], ['avocado', 240, '1 whole', 'produce'], ['tomato', 22, '1 medium', 'produce'],
  ['onion', 44, '1 medium', 'produce'], ['potato', 160, '1 medium', 'produce'], ['carrot', 25, '1 medium', 'produce'],
  ['broccoli', 31, '1 cup', 'produce'], ['cucumber', 16, '1 cup', 'produce'], ['lettuce', 5, '1 cup', 'produce'],
  ['berries', 65, '1 cup', 'produce'], ['strawberr', 50, '1 cup', 'produce'], ['blueberr', 85, '1 cup', 'produce'],
  ['grape', 104, '1 cup', 'produce'], ['mango', 200, '1 whole', 'produce'], ['lemon', 17, '1 whole', 'produce'],
  ['garlic', 4, '1 clove', 'produce'], ['ginger', 5, '1 tsp', 'produce'], ['chili', 18, '1 pepper', 'produce'],
  ['pepper', 30, '1 medium', 'produce'], ['coriander', 1, '1 tbsp', 'produce'], ['cilantro', 1, '1 tbsp', 'produce'],
  ['mushroom', 15, '1 cup', 'produce'], ['corn', 90, '1 ear', 'produce'], ['peas', 117, '1 cup', 'produce'],
  // protein
  ['chicken', 165, '100 g', 'protein'], ['egg', 72, '1 large', 'protein'], ['paneer', 265, '100 g', 'protein'],
  ['tofu', 76, '100 g', 'protein'], ['salmon', 208, '100 g', 'protein'], ['fish', 150, '100 g', 'protein'],
  ['shrimp', 99, '100 g', 'protein'], ['beef', 250, '100 g', 'protein'], ['mutton', 294, '100 g', 'protein'],
  ['lamb', 294, '100 g', 'protein'], ['turkey', 135, '100 g', 'protein'], ['dal', 230, '1 cup cooked', 'protein'],
  ['lentil', 230, '1 cup cooked', 'protein'], ['chickpea', 269, '1 cup cooked', 'protein'], ['chana', 269, '1 cup cooked', 'protein'],
  ['rajma', 225, '1 cup cooked', 'protein'], ['beans', 225, '1 cup cooked', 'protein'], ['protein', 120, '1 scoop', 'protein'],
  ['peanut butter', 190, '2 tbsp', 'protein'], ['almond', 164, '1 oz', 'protein'], ['nuts', 170, '1 oz', 'protein'],
  // dairy
  ['milk', 103, '1 cup', 'dairy'], ['curd', 150, '1 cup', 'dairy'], ['yogurt', 150, '1 cup', 'dairy'],
  ['greek yogurt', 100, '170 g', 'dairy'], ['cheese', 113, '1 slice', 'dairy'], ['butter', 102, '1 tbsp', 'dairy'],
  ['ghee', 112, '1 tbsp', 'dairy'], ['cream', 52, '1 tbsp', 'dairy'], ['ice cream', 270, '1 cup', 'treats'],
  // grains
  ['basmati', 205, '1 cup cooked', 'grains'], ['rice', 205, '1 cup cooked', 'grains'], ['atta', 100, '1 roti', 'grains'],
  ['roti', 100, '1 roti', 'grains'], ['bread', 80, '1 slice', 'grains'], ['oats', 150, '1/2 cup dry', 'grains'],
  ['pasta', 220, '1 cup cooked', 'grains'], ['noodle', 220, '1 cup cooked', 'grains'], ['tortilla', 140, '1 wrap', 'grains'],
  ['cereal', 120, '1 cup', 'grains'], ['quinoa', 222, '1 cup cooked', 'grains'], ['poha', 180, '1 cup', 'grains'],
  ['bagel', 245, '1 bagel', 'grains'],
  // treats + drinks
  ['chocolate', 155, '1 oz', 'treats'], ['chips', 152, '1 oz', 'treats'], ['cookie', 140, '2 cookies', 'treats'],
  ['biscuit', 140, '2 biscuits', 'treats'], ['cake', 350, '1 slice', 'treats'], ['soda', 150, '1 can', 'treats'],
  ['coke', 140, '1 can', 'treats'], ['juice', 110, '1 cup', 'drinks'], ['coffee', 2, '1 cup', 'drinks'],
  ['tea', 2, '1 cup', 'drinks'], ['beer', 153, '1 can', 'treats'], ['wine', 125, '1 glass', 'treats'],
  ['water', 0, '1 bottle', 'drinks'],
  // pantry
  ['oil', 120, '1 tbsp', 'pantry'], ['sugar', 16, '1 tsp', 'pantry'], ['honey', 64, '1 tbsp', 'pantry'],
  ['salt', 0, '1 tsp', 'pantry'], ['masala', 6, '1 tsp', 'pantry'], ['sauce', 30, '2 tbsp', 'pantry'],
];

// Usual amount to buy, used when an item is added without a quantity.
const BUY = {
  milk: '1 gal', egg: '1 dozen', spinach: '1 bag', banana: '1 bunch', apple: '6', onion: '3 lb', potato: '5 lb',
  tomato: '4', avocado: '3', berries: '1 box', strawberr: '1 lb', blueberr: '1 pint', grape: '2 lb', lemon: '4',
  chicken: '2 lb', paneer: '1 pack', tofu: '1 block', salmon: '1 lb', fish: '1 lb', shrimp: '1 lb', beef: '1 lb',
  dal: '2 lb', lentil: '2 lb', chickpea: '2 cans', chana: '2 lb', rajma: '2 lb', beans: '2 cans', curd: '1 tub',
  yogurt: '32 oz', 'greek yogurt': '32 oz', cheese: '1 pack', butter: '1 lb', ghee: '1 jar', basmati: '10 lb bag',
  rice: '10 lb bag', atta: '20 lb bag', bread: '1 loaf', oats: '1 canister', pasta: '1 box', tortilla: '1 pack',
  cereal: '1 box', coffee: '1 bag', tea: '1 box', water: '1 case', oil: '1 bottle', sugar: '4 lb', juice: '1 bottle',
};

// Longest keyword wins, so "greek yogurt" beats "yogurt" and "peanut butter" beats "butter".
const SORTED = [...FOODS].sort((a, b) => b[0].length - a[0].length);

export function lookupFood(text) {
  const t = text.toLowerCase();
  const hit = SORTED.find(([k]) => t.includes(k));
  return hit ? { kcal: hit[1], per: hit[2], cat: hit[3], buy: BUY[hit[0]] || '1' } : null;
}

// "2 lb chicken" -> { qty: '2 lb', text: 'chicken' }. Quantity only when it leads the text.
const QTY = /^(\d+(?:\.\d+)?\s*(?:x|lbs?|kg|g|oz|gal(?:lons?)?|l|ltr|dozen|packs?|bags?|bunch(?:es)?|bottles?|cans?|box(?:es)?|jars?|tubs?)?)\s+(.+)$/i;

export function splitQty(text) {
  const m = text.trim().match(QTY);
  return m ? { qty: m[1].trim(), text: m[2].trim() } : { qty: null, text: text.trim() };
}
