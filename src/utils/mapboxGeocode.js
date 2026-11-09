// Safe Geocoding & Reverse Geocoding Service
// In-memory RAM cache for fast typing/session lookup -> Mapbox API -> Nominatim Fallback
// Updates existing Customer (/customers) and Admin (/settings/shop) documents directly in place without creating extra collections.

import { doc, setDoc } from "firebase/firestore";
import { db } from "../firebase/config";
import {
  getMapboxToken,
  MAX_ADDRESS_QUERY_LENGTH,
  AUTOCOMPLETE_SUGGESTION_LIMIT,
  MEMORY_CACHE_TTL_MS,
} from "../config/geoConfig";

// Local In-Memory Cache for fast session-level lookups
const memoryCache = new Map();

function createSafeHash(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash).toString(36);
}

function getReverseKey(lat, lng) {
  return `rev_${Number(lat).toFixed(4)}_${Number(lng).toFixed(4)}`;
}

function getForwardKey(address) {
  const normalized = address.toLowerCase().trim().slice(0, MAX_ADDRESS_QUERY_LENGTH);
  return `fwd_${createSafeHash(normalized)}`;
}

function getFromMemory(key) {
  const item = memoryCache.get(key);
  if (!item) return null;
  if (Date.now() - item.timestamp > MEMORY_CACHE_TTL_MS) {
    memoryCache.delete(key);
    return null;
  }
  return item.data;
}

function setToMemory(key, data) {
  memoryCache.set(key, { data, timestamp: Date.now() });
}

/**
 * Persist or update customer location directly on the customer's existing document (/customers/{customerId}).
 * One-time update per address change — no separate collections are created.
 */
export async function updateCustomerLocation(customerId, locationData) {
  if (!customerId || !locationData) return;
  try {
    const custDocRef = doc(db, 'customers', customerId);
    await setDoc(custDocRef, {
      lat: locationData.lat ?? null,
      lng: locationData.lng ?? null,
      address: locationData.address || '',
      updatedAt: new Date().toISOString()
    }, { merge: true });
  } catch (err) {
    console.warn('Unable to update customer location document:', err.message);
  }
}

/**
 * Persist or update admin shop location directly on the existing /settings/shop document.
 * Updates in-place without creating extra collections.
 */
export async function updateAdminShopLocation(settingsData) {
  if (!settingsData) return;
  try {
    const shopDocRef = doc(db, 'settings', 'shop');
    await setDoc(shopDocRef, {
      ...settingsData,
      updatedAt: new Date().toISOString()
    }, { merge: true });
  } catch (err) {
    console.warn('Unable to update admin shop document:', err.message);
  }
}

/**
 * Fallback reverse geocoding via OpenStreetMap Nominatim.
 */
async function fallbackReverseGeocode(lat, lng) {
  try {
    const url = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=18&addressdetails=1`;
    const resp = await fetch(url, {
      headers: {
        Accept: "application/json",
      },
    });
    if (resp.ok) {
      const data = await resp.json();
      if (data && data.display_name) {
        return data.display_name;
      }
    }
  } catch {
    // Ignore fallback failure
  }
  return `${Number(lat).toFixed(5)}, ${Number(lng).toFixed(5)}`;
}

/**
 * Fallback forward geocoding via OpenStreetMap Nominatim.
 */
async function fallbackForwardGeocode(address) {
  const clean = encodeURIComponent(address.slice(0, MAX_ADDRESS_QUERY_LENGTH));
  const url = `https://nominatim.openstreetmap.org/search?format=json&q=${clean}&limit=1`;
  const resp = await fetch(url, {
    headers: {
      Accept: "application/json",
    },
  });
  if (!resp.ok) {
    throw new Error("Unable to locate address via fallback service.");
  }
  const data = await resp.json();
  if (!Array.isArray(data) || data.length === 0) {
    throw new Error("No coordinates found for the given address.");
  }
  return {
    lat: parseFloat(data[0].lat),
    lng: parseFloat(data[0].lon),
    formatted: data[0].display_name,
  };
}

/**
 * Forward geocoding: address string -> { lat, lng, formatted }
 * Uses RAM cache during the session before querying Mapbox or Nominatim.
 */
export async function geocodeAddress(address) {
  if (!address || typeof address !== "string" || !address.trim()) {
    throw new Error("Please provide a valid address string.");
  }

  const cleanAddress = address.trim().slice(0, MAX_ADDRESS_QUERY_LENGTH);
  const cacheKey = getForwardKey(cleanAddress);

  // Check RAM Cache
  const memoryHit = getFromMemory(cacheKey);
  if (memoryHit) {
    return memoryHit;
  }

  // Query External Provider (Mapbox or Nominatim)
  const token = getMapboxToken();
  let resolved = null;

  if (token) {
    try {
      const endpoint = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(
        cleanAddress
      )}.json?access_token=${token}&limit=1`;
      const resp = await fetch(endpoint);
      if (resp.ok) {
        const data = await resp.json();
        if (data.features && data.features.length > 0) {
          const [lng, lat] = data.features[0].center;
          resolved = {
            lat,
            lng,
            formatted: data.features[0].place_name,
          };
        }
      }
    } catch (mapboxErr) {
      console.warn("Mapbox geocoding error, falling back:", mapboxErr.message);
    }
  }

  if (!resolved) {
    resolved = await fallbackForwardGeocode(cleanAddress);
  }

  // Cache to RAM only (no auxiliary collection writes)
  setToMemory(cacheKey, resolved);

  return resolved;
}

/**
 * Autocomplete suggestions: query string -> Array<{ id, place_name, lat, lng }>
 */
export async function searchAddressSuggestions(query, options = {}) {
  if (!query || typeof query !== "string" || query.trim().length < 3) {
    return [];
  }

  const cleanQuery = query.trim().slice(0, MAX_ADDRESS_QUERY_LENGTH);
  const cacheKey = `sug_${createSafeHash(cleanQuery)}`;

  const memoryHit = getFromMemory(cacheKey);
  if (memoryHit) {
    return memoryHit;
  }

  const token = getMapboxToken();
  if (!token) {
    try {
      const resp = await fetch(
        `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(
          cleanQuery
        )}&limit=${AUTOCOMPLETE_SUGGESTION_LIMIT}`,
        {
          headers: { Accept: "application/json" },
          signal: options.signal,
        }
      );
      if (resp.ok) {
        const data = await resp.json();
        const results = (data || []).map((item) => ({
          id: String(item.place_id),
          place_name: item.display_name,
          lat: parseFloat(item.lat),
          lng: parseFloat(item.lon),
        }));
        setToMemory(cacheKey, results);
        return results;
      }
    } catch {
      return [];
    }
    return [];
  }

  try {
    const endpoint = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(
      cleanQuery
    )}.json?access_token=${token}&autocomplete=true&limit=${AUTOCOMPLETE_SUGGESTION_LIMIT}`;
    const resp = await fetch(endpoint, { signal: options.signal });
    if (resp.ok) {
      const data = await resp.json();
      const results = (data.features || []).map((feat) => ({
        id: feat.id,
        place_name: feat.place_name,
        lat: feat.center[1],
        lng: feat.center[0],
      }));
      setToMemory(cacheKey, results);
      return results;
    }
  } catch {
    return [];
  }
  return [];
}

/**
 * Reverse geocoding: { lat, lng } -> formatted address string
 * Checks RAM -> Mapbox -> Nominatim fallback.
 */
export async function reverseGeocodeCoords(lat, lng) {
  if (typeof lat !== "number" || typeof lng !== "number" || isNaN(lat) || isNaN(lng)) {
    return "";
  }

  const cacheKey = getReverseKey(lat, lng);

  // Check RAM Cache
  const memoryHit = getFromMemory(cacheKey);
  if (memoryHit) {
    return memoryHit;
  }

  const token = getMapboxToken();
  let resolvedAddress = null;

  if (token) {
    try {
      const endpoint = `https://api.mapbox.com/geocoding/v5/mapbox.places/${lng},${lat}.json?access_token=${token}&limit=1`;
      const resp = await fetch(endpoint);
      if (resp.ok) {
        const data = await resp.json();
        if (data.features && data.features.length > 0) {
          resolvedAddress = data.features[0].place_name;
        }
      }
    } catch (mapboxErr) {
      console.warn("Mapbox reverse geocode error, using fallback:", mapboxErr.message);
    }
  }

  if (!resolvedAddress) {
    resolvedAddress = await fallbackReverseGeocode(lat, lng);
  }

  if (resolvedAddress) {
    setToMemory(cacheKey, resolvedAddress);
  }

  return resolvedAddress || `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
}
