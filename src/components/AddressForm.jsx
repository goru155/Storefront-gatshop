import React, { useState, useEffect, useRef } from 'react';
import {
  searchAddressSuggestions,
  reverseGeocodeCoords,
  geocodeAddress,
} from '../utils/mapboxGeocode';
import { isWithinDeliveryArea, getCurrentPosition } from '../utils/geofence';
import { DEFAULT_SHOP_LOCATION } from '../config/geoConfig';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { useCart } from '../context/CartContext';

// Fix leaflet default marker icon issues in bundled React
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon-2x.png',
  iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png',
});

/**
 * Checkout Delivery Address Form with 20-minute post-checkout lock,
 * Mapbox autocomplete, Leaflet interactive map, and geofence checking.
 */
export default function AddressForm({
  address = '',
  coords = null,
  onChange,
  isLocked = false,
  lockTimeRemaining = null,
}) {
  const { showToast, shopSettings } = useCart();

  const [inputVal, setInputVal] = useState(address);
  const [currentCoords, setCurrentCoords] = useState(coords);
  const [suggestions, setSuggestions] = useState([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [isLocating, setIsLocating] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  const [deliveryStatus, setDeliveryStatus] = useState(null);

  const mapContainerRef = useRef(null);
  const leafletMapRef = useRef(null);
  const markerRef = useRef(null);
  const searchTimeoutRef = useRef(null);
  const abortControllerRef = useRef(null);

  // Sync incoming props
  useEffect(() => {
    setInputVal(address);
  }, [address]);

  useEffect(() => {
    if (coords && typeof coords.lat === 'number' && typeof coords.lng === 'number') {
      setCurrentCoords(coords);
    }
  }, [coords]);

  // Radius validation check helper
  const checkRadius = (lat, lng, notify = false) => {
    if (shopSettings?.lat && shopSettings?.lng) {
      const maxRadius = shopSettings?.radiusKm || 5;
      const { allowed, distanceKm } = isWithinDeliveryArea(
        lat,
        lng,
        { lat: shopSettings.lat, lng: shopSettings.lng },
        maxRadius
      );
      setDeliveryStatus({ allowed, distanceKm, maxRadius });
      if (notify) {
        if (!allowed) {
          showToast(
            `⚠️ Location is ${distanceKm.toFixed(1)} km away (outside the ${maxRadius} km delivery zone).`,
            'warning'
          );
        } else {
          showToast(`✅ Within delivery area (${distanceKm.toFixed(1)} km from shop).`, 'success');
        }
      }
      return { allowed, distanceKm, maxRadius };
    }
    return { allowed: true, distanceKm: 0, maxRadius: 5 };
  };

  // Initial radius check if coords exist
  useEffect(() => {
    if (currentCoords?.lat && currentCoords?.lng) {
      checkRadius(currentCoords.lat, currentCoords.lng, false);
    }
  }, [currentCoords, shopSettings]);

  // Leaflet map setup and updates
  useEffect(() => {
    if (!mapContainerRef.current) return;

    const initialLat =
      currentCoords?.lat || shopSettings?.lat || DEFAULT_SHOP_LOCATION.lat;
    const initialLng =
      currentCoords?.lng || shopSettings?.lng || DEFAULT_SHOP_LOCATION.lng;

    if (!leafletMapRef.current) {
      const map = L.map(mapContainerRef.current).setView(
        [initialLat, initialLng],
        currentCoords ? 15 : 13
      );
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; OpenStreetMap contributors',
      }).addTo(map);

      setTimeout(() => {
        map.invalidateSize();
      }, 200);

      map.on('click', async (e) => {
        if (isLocked) return;
        const { lat, lng } = e.latlng;
        const newCoords = { lat, lng };
        setCurrentCoords(newCoords);

        if (!markerRef.current) {
          const marker = L.marker([lat, lng], { draggable: !isLocked }).addTo(map);
          marker.on('dragend', async (dragEvt) => {
            if (isLocked) return;
            const pos = dragEvt.target.getLatLng();
            const draggedCoords = { lat: pos.lat, lng: pos.lng };
            setCurrentCoords(draggedCoords);
            const radiusInfo = checkRadius(pos.lat, pos.lng, true);
            try {
              const resAddr = await reverseGeocodeCoords(pos.lat, pos.lng);
              if (resAddr) {
                setInputVal(resAddr);
                if (onChange) {
                  onChange({
                    address: resAddr,
                    coords: draggedCoords,
                    isWithinZone: radiusInfo.allowed,
                    distanceKm: radiusInfo.distanceKm,
                  });
                }
              }
            } catch {}
          });
          markerRef.current = marker;
        } else {
          markerRef.current.setLatLng([lat, lng]);
        }

        map.panTo([lat, lng]);
        const radiusInfo = checkRadius(lat, lng, true);

        try {
          const resAddr = await reverseGeocodeCoords(lat, lng);
          if (resAddr) {
            setInputVal(resAddr);
            if (onChange) {
              onChange({
                address: resAddr,
                coords: newCoords,
                isWithinZone: radiusInfo.allowed,
                distanceKm: radiusInfo.distanceKm,
              });
            }
          }
        } catch {}
      });

      leafletMapRef.current = map;
    }

    if (currentCoords && leafletMapRef.current) {
      leafletMapRef.current.setView([currentCoords.lat, currentCoords.lng], 15);

      if (!markerRef.current) {
        const marker = L.marker([currentCoords.lat, currentCoords.lng], {
          draggable: !isLocked,
        }).addTo(leafletMapRef.current);

        marker.on('dragend', async (e) => {
          if (isLocked) return;
          const { lat, lng } = e.target.getLatLng();
          const draggedCoords = { lat, lng };
          setCurrentCoords(draggedCoords);
          const radiusInfo = checkRadius(lat, lng, true);

          try {
            const resAddr = await reverseGeocodeCoords(lat, lng);
            if (resAddr) {
              setInputVal(resAddr);
              if (onChange) {
                onChange({
                  address: resAddr,
                  coords: draggedCoords,
                  isWithinZone: radiusInfo.allowed,
                  distanceKm: radiusInfo.distanceKm,
                });
              }
            }
          } catch {}
        });

        markerRef.current = marker;
      } else {
        markerRef.current.setLatLng([currentCoords.lat, currentCoords.lng]);
        if (markerRef.current.dragging) {
          if (isLocked) {
            markerRef.current.dragging.disable();
          } else {
            markerRef.current.dragging.enable();
          }
        }
      }
    }
  }, [currentCoords, isLocked, shopSettings]);

  // Clean up Leaflet on unmount
  useEffect(() => {
    return () => {
      if (leafletMapRef.current) {
        leafletMapRef.current.remove();
        leafletMapRef.current = null;
        markerRef.current = null;
      }
    };
  }, []);

  // GPS auto-detect
  const handleUseCurrentLocation = async () => {
    if (isLocked) return;
    setIsLocating(true);
    showToast('📍 Getting current location...', 'info');
    try {
      const pos = await getCurrentPosition();
      const detectedCoords = { lat: pos.lat, lng: pos.lng };
      setCurrentCoords(detectedCoords);
      const radiusInfo = checkRadius(pos.lat, pos.lng, true);

      const resolvedAddress = await reverseGeocodeCoords(pos.lat, pos.lng);
      if (resolvedAddress) {
        setInputVal(resolvedAddress);
        if (onChange) {
          onChange({
            address: resolvedAddress,
            coords: detectedCoords,
            isWithinZone: radiusInfo.allowed,
            distanceKm: radiusInfo.distanceKm,
          });
        }
      }
    } catch (err) {
      showToast(err.message || 'Could not fetch current location.', 'error');
    } finally {
      setIsLocating(false);
    }
  };

  // Address text change with autocomplete
  const handleAddressChange = (e) => {
    if (isLocked) return;
    const val = e.target.value;
    setInputVal(val);

    if (onChange) {
      onChange({
        address: val,
        coords: currentCoords,
        isWithinZone: deliveryStatus?.allowed ?? true,
        distanceKm: deliveryStatus?.distanceKm ?? null,
      });
    }

    if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
    if (abortControllerRef.current) abortControllerRef.current.abort();

    if (val.trim().length >= 3) {
      setIsSearching(true);
      searchTimeoutRef.current = setTimeout(async () => {
        try {
          const controller = new AbortController();
          abortControllerRef.current = controller;
          const results = await searchAddressSuggestions(val, {
            signal: controller.signal,
          });
          setSuggestions(results);
          setShowSuggestions(results.length > 0);
        } catch {
          setSuggestions([]);
        } finally {
          setIsSearching(false);
        }
      }, 350);
    } else {
      setSuggestions([]);
      setShowSuggestions(false);
      setIsSearching(false);
    }
  };

  const handleSelectSuggestion = (item) => {
    if (isLocked) return;
    setInputVal(item.place_name);
    const selectedCoords = { lat: item.lat, lng: item.lng };
    setCurrentCoords(selectedCoords);
    setSuggestions([]);
    setShowSuggestions(false);
    const radiusInfo = checkRadius(item.lat, item.lng, true);

    if (onChange) {
      onChange({
        address: item.place_name,
        coords: selectedCoords,
        isWithinZone: radiusInfo.allowed,
        distanceKm: radiusInfo.distanceKm,
      });
    }
  };

  return (
    <div className="address-form-wrapper" style={{ marginBottom: '1rem' }}>
      {/* 20-minute location lock banner */}
      {isLocked && (
        <div
          style={{
            background: '#eff6ff',
            border: '1px solid #bfdbfe',
            borderRadius: '8px',
            padding: '0.65rem 0.85rem',
            marginBottom: '0.75rem',
            display: 'flex',
            alignItems: 'center',
            gap: '0.55rem',
            color: '#1e40af',
            fontSize: '0.82rem',
          }}
        >
          <span style={{ fontSize: '1.1rem' }}>🔒</span>
          <div>
            <strong>Delivery location locked post-checkout</strong>
            <div style={{ marginTop: '0.15rem' }}>
              Locked for 20 minutes from checkout. Can be changed in{' '}
              <strong style={{ color: '#1d4ed8' }}>
                {lockTimeRemaining || '20:00'}
              </strong>
              .
            </div>
          </div>
        </div>
      )}

      {/* Address Input */}
      <div className="form-group" style={{ position: 'relative', marginBottom: '0.65rem' }}>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: '0.35rem',
          }}
        >
          <label
            className="form-label"
            htmlFor="checkout-delivery-address"
            style={{ margin: 0, fontWeight: 700, fontSize: '0.82rem' }}
          >
            Delivery Address {isLocked && '(Locked)'}
          </label>
          {!isLocked && (
            <button
              type="button"
              onClick={handleUseCurrentLocation}
              disabled={isLocating}
              style={{
                background: 'none',
                border: 'none',
                color: 'var(--accent-honey, #d97706)',
                fontSize: '0.8rem',
                fontWeight: 600,
                cursor: 'pointer',
                padding: 0,
                display: 'flex',
                alignItems: 'center',
                gap: '0.25rem',
              }}
            >
              📍 {isLocating ? 'Locating...' : 'Use Current Location'}
            </button>
          )}
        </div>

        <input
          id="checkout-delivery-address"
          type="text"
          required
          readOnly={isLocked}
          className="form-input"
          placeholder={isLocked ? 'Delivery location locked' : 'Search address or click on map...'}
          value={inputVal}
          onChange={handleAddressChange}
          onFocus={() => !isLocked && suggestions.length > 0 && setShowSuggestions(true)}
          autoComplete="off"
          style={{
            width: '100%',
            padding: '0.65rem 0.85rem',
            borderRadius: '8px',
            border: '1px solid #cbd5e1',
            fontSize: '0.9rem',
            boxSizing: 'border-box',
            backgroundColor: isLocked ? 'var(--bg-mist, #f8fafc)' : '#ffffff',
            cursor: isLocked ? 'not-allowed' : 'text',
          }}
        />

        {/* Suggestions dropdown */}
        {!isLocked && showSuggestions && suggestions.length > 0 && (
          <ul
            style={{
              position: 'absolute',
              top: '100%',
              left: 0,
              right: 0,
              zIndex: 1000,
              background: '#ffffff',
              border: '1px solid var(--border-soft, #e2e8f0)',
              borderRadius: '8px',
              boxShadow: '0 8px 18px rgba(0,0,0,0.12)',
              listStyle: 'none',
              padding: 0,
              margin: '4px 0 0 0',
              maxHeight: '160px',
              overflowY: 'auto',
            }}
          >
            {suggestions.map((s) => (
              <li
                key={s.id}
                onClick={() => handleSelectSuggestion(s)}
                style={{
                  padding: '8px 12px',
                  fontSize: '0.84rem',
                  cursor: 'pointer',
                  borderBottom: '1px solid #f1f5f9',
                  lineHeight: '1.3',
                }}
                onMouseEnter={(e) => (e.currentTarget.style.background = '#f8fafc')}
                onMouseLeave={(e) => (e.currentTarget.style.background = '#ffffff')}
              >
                📍 {s.place_name}
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Map Preview */}
      <div style={{ marginBottom: '0.65rem' }}>
        <div
          style={{
            fontSize: '0.74rem',
            color: 'var(--text-muted, #64748b)',
            marginBottom: '0.35rem',
          }}
        >
          {isLocked
            ? '📍 Delivery location confirmed on the map.'
            : '💡 Drag pin or click anywhere on the map to set exact delivery spot.'}
        </div>
        <div
          ref={mapContainerRef}
          style={{
            height: '160px',
            width: '100%',
            borderRadius: '8px',
            border: '1px solid var(--border-soft, #e2e8f0)',
            overflow: 'hidden',
          }}
        />
      </div>

      {/* Delivery Zone Status Pill */}
      {deliveryStatus && (
        <div
          style={{
            fontSize: '0.78rem',
            fontWeight: 600,
            padding: '0.4rem 0.65rem',
            borderRadius: '8px',
            background: deliveryStatus.allowed ? '#dcfce7' : '#fee2e2',
            color: deliveryStatus.allowed ? '#166534' : '#991b1b',
            display: 'flex',
            alignItems: 'center',
            gap: '0.4rem',
          }}
        >
          <span>{deliveryStatus.allowed ? '✅' : '⚠️'}</span>
          <span>
            {deliveryStatus.allowed
              ? `Within delivery area (${deliveryStatus.distanceKm.toFixed(1)} km from shop)`
              : `Outside delivery area (${deliveryStatus.distanceKm.toFixed(1)} km away, max ${deliveryStatus.maxRadius} km)`}
          </span>
        </div>
      )}
    </div>
  );
}
