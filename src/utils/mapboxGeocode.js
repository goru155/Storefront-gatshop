// Mapbox Geocoding & Reverse Geocoding helper
// Reads VITE_MAPBOX_TOKEN from environment

const getMapboxToken = () => {
  const token = import.meta.env.VITE_MAPBOX_TOKEN;
  if (!token) {
    throw new Error('Mapbox token (VITE_MAPBOX_TOKEN) not configured in .env');
  }
  return token;
};

/**
 * Forward geocoding: address string -> { lat, lng, formatted }
 */
export async function geocodeAddress(address) {
  const token = getMapboxToken();
  const endpoint = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(
    address
  )}.json?access_token=${token}&limit=1`;
  const resp = await fetch(endpoint);
  if (!resp.ok) {
    throw new Error('Geocoding request failed');
  }
  const data = await resp.json();
  if (!data.features || data.features.length === 0) {
    throw new Error('No results for the address');
  }
  const [lng, lat] = data.features[0].center;
  const formatted = data.features[0].place_name;
  return { lat, lng, formatted };
}

/**
 * Autocomplete suggestions: query string -> Array<{ id, place_name, lat, lng }>
 */
export async function searchAddressSuggestions(query) {
  if (!query || query.trim().length < 3) return [];
  const token = getMapboxToken();
  const endpoint = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(
    query.trim()
  )}.json?access_token=${token}&autocomplete=true&limit=5`;
  
  const resp = await fetch(endpoint);
  if (!resp.ok) return [];
  const data = await resp.json();
  if (!data.features) return [];

  return data.features.map(f => ({
    id: f.id,
    place_name: f.place_name,
    lng: f.center[0],
    lat: f.center[1]
  }));
}

/**
 * Reverse geocoding: { lat, lng } -> formatted address string
 */
export async function reverseGeocodeCoords(lat, lng) {
  const token = getMapboxToken();
  const endpoint = `https://api.mapbox.com/geocoding/v5/mapbox.places/${lng},${lat}.json?access_token=${token}&limit=1`;
  const resp = await fetch(endpoint);
  if (!resp.ok) return `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
  const data = await resp.json();
  if (data.features && data.features.length > 0) {
    return data.features[0].place_name;
  }
  return `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
}
