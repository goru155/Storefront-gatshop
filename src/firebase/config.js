import { initializeApp } from "firebase/app";
import { 
  getFirestore, 
  collection, 
  getDocs, 
  doc, 
  getDoc, 
  setDoc, 
  onSnapshot,
  addDoc,
  serverTimestamp,
  updateDoc
} from "firebase/firestore";
import { getAuth } from "firebase/auth";

const firebaseConfig = {
  apiKey: "AIzaSyAawUopX1lromd5nFeMPoogEXFzLZ7ZnXM",
  authDomain: "shopportal-f6630.firebaseapp.com",
  projectId: "shopportal-f6630",
  storageBucket: "shopportal-f6630.firebasestorage.app",
  messagingSenderId: "843668522089",
  appId: "1:843668522089:web:cfdd7548303ced6df04ef8",
  measurementId: "G-3P0EWBDSLW"
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
export const auth = getAuth(app);

// Category icon mapper for dynamic database categories
export const CATEGORY_ICONS = {
  vegetables: "🥦",
  vegetable: "🥦",
  fruits: "🍋",
  fruit: "🍋",
  beverages: "🍵",
  beverage: "🍵",
  drinks: "🥤",
  drink: "🥤",
  eggs: "🥚",
  egg: "🥚",
  dairy: "🥛",
  milk: "🥛",
  baking: "🥖",
  bakery: "🥖",
  bread: "🍞",
  seafood: "🐟",
  fish: "🐟",
  cheese: "🧀",
  meat: "🥩",
  beef: "🥩",
  poultry: "🍗",
  snacks: "🍿",
  pantry: "🥫",
  spices: "🧂",
  organic: "🌱",
  general: "📦"
};

export const getCategoryIcon = (catName = '') => {
  const normalized = catName.toLowerCase().trim();
  return CATEGORY_ICONS[normalized] || "🏷️";
};

// Category fallback image mapper for products added in Admin without image
export const CATEGORY_IMAGES = {
  vegetables: "https://images.unsplash.com/photo-1540420773420-3366772f4999?w=500&auto=format&fit=crop&q=80",
  vegetable: "https://images.unsplash.com/photo-1540420773420-3366772f4999?w=500&auto=format&fit=crop&q=80",
  fruits: "https://images.unsplash.com/photo-1619566636858-adf3ef46400b?w=500&auto=format&fit=crop&q=80",
  fruit: "https://images.unsplash.com/photo-1619566636858-adf3ef46400b?w=500&auto=format&fit=crop&q=80",
  beverages: "https://images.unsplash.com/photo-1576092768241-dec231879fc3?w=500&auto=format&fit=crop&q=80",
  beverage: "https://images.unsplash.com/photo-1576092768241-dec231879fc3?w=500&auto=format&fit=crop&q=80",
  drinks: "https://images.unsplash.com/photo-1576092768241-dec231879fc3?w=500&auto=format&fit=crop&q=80",
  drink: "https://images.unsplash.com/photo-1576092768241-dec231879fc3?w=500&auto=format&fit=crop&q=80",
  dairy: "https://images.unsplash.com/photo-1550583724-b2692b85b150?w=500&auto=format&fit=crop&q=80",
  milk: "https://images.unsplash.com/photo-1550583724-b2692b85b150?w=500&auto=format&fit=crop&q=80",
  cheese: "https://images.unsplash.com/photo-1486297678162-eb2a19b0a32d?w=500&auto=format&fit=crop&q=80",
  eggs: "https://images.unsplash.com/photo-1582722872446-44dc5f7e3c8f?w=500&auto=format&fit=crop&q=80",
  egg: "https://images.unsplash.com/photo-1582722872446-44dc5f7e3c8f?w=500&auto=format&fit=crop&q=80",
  baking: "https://images.unsplash.com/photo-1509440159596-0249088772ff?w=500&auto=format&fit=crop&q=80",
  bakery: "https://images.unsplash.com/photo-1509440159596-0249088772ff?w=500&auto=format&fit=crop&q=80",
  bread: "https://images.unsplash.com/photo-1509440159596-0249088772ff?w=500&auto=format&fit=crop&q=80",
  seafood: "https://images.unsplash.com/photo-1519708227418-c8fd9a32b7a2?w=500&auto=format&fit=crop&q=80",
  fish: "https://images.unsplash.com/photo-1519708227418-c8fd9a32b7a2?w=500&auto=format&fit=crop&q=80",
  meat: "https://images.unsplash.com/photo-1603048588665-791ca8aea617?w=500&auto=format&fit=crop&q=80",
  beef: "https://images.unsplash.com/photo-1603048588665-791ca8aea617?w=500&auto=format&fit=crop&q=80",
  general: "https://images.unsplash.com/photo-1542838132-92c53300491e?w=500&auto=format&fit=crop&q=80"
};

export const getCategoryFallbackImage = (catName = '') => {
  const normalized = catName.toLowerCase().trim();
  return CATEGORY_IMAGES[normalized] || CATEGORY_IMAGES.general;
};

// Initial database fallback inventory
export const INITIAL_PRODUCTS = [
  {
    id: "prod-1",
    name: "Organic Red Bell Pepper (Capsicum)",
    category: "vegetables",
    weight: "1000gm",
    price: 24.00,
    rating: 4.8,
    reviewsCount: 142,
    stock: 18,
    isVisible: true,
    image: "https://images.unsplash.com/photo-1563565375-f3fdfdbefa83?w=500&auto=format&fit=crop&q=80",
    description: "Farm fresh, crisp organic red bell peppers rich in vitamins A & C."
  },
  {
    id: "prod-2",
    name: "Pure Green Tea with Citrus Lemon",
    category: "beverages",
    weight: "250gm (50 bags)",
    price: 18.50,
    rating: 4.9,
    reviewsCount: 230,
    stock: 25,
    isVisible: true,
    image: "https://images.unsplash.com/photo-1576092768241-dec231879fc3?w=500&auto=format&fit=crop&q=80",
    description: "Antioxidant-rich artisanal green tea infused with natural lemon zest."
  },
  {
    id: "prod-3",
    name: "South African Meyer Yellow Lemons",
    category: "fruits",
    weight: "1000gm (6-8 pcs)",
    price: 12.00,
    rating: 4.7,
    reviewsCount: 89,
    stock: 14,
    isVisible: true,
    image: "https://images.unsplash.com/photo-1533089860892-a7c6f0a88666?w=500&auto=format&fit=crop&q=80",
    description: "Naturally sweet and aromatic Meyer lemons freshly imported."
  },
  {
    id: "prod-4",
    name: "Hass Fresh Creamy Avocados",
    category: "fruits",
    weight: "500gm (2 pcs)",
    price: 16.00,
    rating: 4.8,
    reviewsCount: 310,
    stock: 9,
    isVisible: true,
    image: "https://images.unsplash.com/photo-1523049673857-eb18f1d7b578?w=500&auto=format&fit=crop&q=80",
    description: "Nutrient-dense, perfectly ripened Hass avocados ideal for toast and salads."
  },
  {
    id: "prod-5",
    name: "Farm Fresh Free-Range Brown Eggs",
    category: "eggs",
    weight: "12 Eggs / Pack",
    price: 9.50,
    rating: 4.9,
    reviewsCount: 420,
    stock: 30,
    isVisible: true,
    image: "https://images.unsplash.com/photo-1582722872446-44dc5f7e3c8f?w=500&auto=format&fit=crop&q=80",
    description: "Grade-A pasture-raised eggs rich in protein and Omega-3."
  },
  {
    id: "prod-6",
    name: "Artisanal Sourdough Country Loaf",
    category: "baking",
    weight: "750gm",
    price: 8.50,
    rating: 4.9,
    reviewsCount: 164,
    stock: 6,
    isVisible: true,
    image: "https://images.unsplash.com/photo-1509440159596-0249088772ff?w=500&auto=format&fit=crop&q=80",
    description: "Slow-fermented crusty sourdough loaf made with organic stoneground wheat."
  },
  {
    id: "prod-7",
    name: "Wild Alaskan Salmon Fillet",
    category: "seafood",
    weight: "600gm",
    price: 34.00,
    rating: 4.9,
    reviewsCount: 95,
    stock: 8,
    isVisible: true,
    image: "https://images.unsplash.com/photo-1519708227418-c8fd9a32b7a2?w=500&auto=format&fit=crop&q=80",
    description: "Sustainably wild-caught Alaskan salmon, skin-on and vacuum sealed."
  },
  {
    id: "prod-8",
    name: "Organic Whole Alpine Milk",
    category: "dairy",
    weight: "1000ml",
    price: 6.20,
    rating: 4.7,
    reviewsCount: 180,
    stock: 22,
    isVisible: true,
    image: "https://images.unsplash.com/photo-1550583724-b2692b85b150?w=500&auto=format&fit=crop&q=80",
    description: "Creamy whole milk from grass-fed alpine dairy cows."
  },
  {
    id: "prod-9",
    name: "Dutch Aged Gouda Cheese Wedge",
    category: "cheese",
    weight: "350gm",
    price: 19.80,
    rating: 4.8,
    reviewsCount: 112,
    stock: 12,
    isVisible: true,
    image: "https://images.unsplash.com/photo-1486297678162-eb2a19b0a32d?w=500&auto=format&fit=crop&q=80",
    description: "Smooth, nutty 18-month aged Gouda with crystalline crunch."
  },
  {
    id: "prod-10",
    name: "Grass-Fed Angus Beef Ribeye",
    category: "meat",
    weight: "500gm",
    price: 42.00,
    rating: 4.9,
    reviewsCount: 78,
    stock: 5,
    isVisible: true,
    image: "https://images.unsplash.com/photo-1603048588665-791ca8aea617?w=500&auto=format&fit=crop&q=80",
    description: "Prime marble grade beef ribeye steak, tender and deeply flavorful."
  }
];
