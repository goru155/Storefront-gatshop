/**
 * Centralized Geocoding and Location Configuration
 *
 * Single source of truth for shop coordinates, delivery radius,
 * and geocoding settings across the storefront and admin.
 * Reads environment variables with safe fallbacks (no hardcoded magic numbers).
 */

const getEnvValue = (key) => {
  // Vite environment variables
  if (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env[key]) {
    return import.meta.env[key];
  }
  // Static runtime environment variables (injected into window.__ENV__)
  if (typeof window !== 'undefined' && window.__ENV__ && window.__ENV__[key]) {
    return window.__ENV__[key];
  }
  return undefined;
};

// Default store coordinates (used only when neither .env nor Firestore settings are available)
export const DEFAULT_SHOP_LOCATION = {
  lat: parseFloat(getEnvValue('VITE_SHOP_LAT')) || 28.6139,
  lng: parseFloat(getEnvValue('VITE_SHOP_LNG')) || 77.2090,
  address: 'Shop Physical Store',
};

// Default maximum delivery boundary radius in kilometers
export const DEFAULT_DELIVERY_RADIUS_KM =
  parseFloat(getEnvValue('VITE_DELIVERY_RADIUS_KM')) || 5;

// Coordinates and addresses are persisted directly on existing documents
// (/customers/{uid} for customers, /settings/shop for admin) without separate collections.

// Maximum address input length to sanitize searches
export const MAX_ADDRESS_QUERY_LENGTH = 120;

// Maximum autocomplete suggestions to request
export const AUTOCOMPLETE_SUGGESTION_LIMIT = 5;

// In-memory cache time-to-live in milliseconds (15 minutes)
export const MEMORY_CACHE_TTL_MS = 15 * 60 * 1000;

/**
 * Safely retrieves the Mapbox access token without throwing synchronous errors.
 * Returns null if unconfigured so the app can fall back gracefully.
 * @returns {string|null}
 */
export const getMapboxToken = () => {
  const token = getEnvValue('VITE_MAPBOX_TOKEN');
  if (!token || typeof token !== 'string' || !token.trim()) {
    return null;
  }
  return token.trim();
};

