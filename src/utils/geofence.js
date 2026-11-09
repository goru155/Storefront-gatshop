import { DEFAULT_SHOP_LOCATION, DEFAULT_DELIVERY_RADIUS_KM } from '../config/geoConfig.js';

// Haversine formula — calculates great-circle distance between two lat/lng coordinates in km
export function getDistanceKm(lat1, lon1, lat2, lon2) {
  const R = 6371; // Earth's mean radius in km
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

// Default shop coordinates from centralized config
export const SHOP_LOCATION = DEFAULT_SHOP_LOCATION;

// Default maximum delivery radius from centralized config
export const DELIVERY_RADIUS_KM = DEFAULT_DELIVERY_RADIUS_KM;

/**
 * Validates whether the given customer coordinates fall within the shop delivery radius.
 * @param {number} customerLat
 * @param {number} customerLng
 * @param {{ lat: number, lng: number }} [customShopLocation] - Optional dynamic shop coordinates
 * @param {number} [customRadiusKm] - Optional dynamic delivery radius in km
 * @returns {{ allowed: boolean, distanceKm: number }}
 */
export function isWithinDeliveryArea(customerLat, customerLng, customShopLocation, customRadiusKm) {
  const shopLat = typeof customShopLocation?.lat === 'number' ? customShopLocation.lat : SHOP_LOCATION.lat;
  const shopLng = typeof customShopLocation?.lng === 'number' ? customShopLocation.lng : SHOP_LOCATION.lng;
  const radius = typeof customRadiusKm === 'number' && customRadiusKm > 0 ? customRadiusKm : DELIVERY_RADIUS_KM;

  const distanceKm = getDistanceKm(
    shopLat,
    shopLng,
    customerLat,
    customerLng
  );
  return {
    allowed: distanceKm <= radius,
    distanceKm: Math.round(distanceKm * 100) / 100,
  };
}

/**
 * Prompts user for GPS location via the Browser Geolocation API.
 * @returns {Promise<{ lat: number, lng: number }>}
 */
export function getCurrentPosition(options = {}) {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error('Geolocation is not supported by your browser.'));
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (position) => {
        resolve({
          lat: position.coords.latitude,
          lng: position.coords.longitude,
        });
      },
      (error) => {
        switch (error.code) {
          case error.PERMISSION_DENIED:
            reject(new Error('Location access was denied. Please allow location permissions in your browser to verify delivery.'));
            break;
          case error.POSITION_UNAVAILABLE:
            reject(new Error('Location information is unavailable. Please check your device location settings.'));
            break;
          case error.TIMEOUT:
            reject(new Error('Location request timed out. Please try again.'));
            break;
          default:
            reject(new Error('An unexpected error occurred while obtaining your location.'));
        }
      },
      {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 300000, // Cache position for up to 5 minutes
        ...options,
      }
    );
  });
}

