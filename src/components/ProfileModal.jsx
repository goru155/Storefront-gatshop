import React, { useState, useEffect, useRef } from 'react';
import {
  searchAddressSuggestions,
  reverseGeocodeCoords,
  geocodeAddress,
  updateCustomerLocation,
} from '../utils/mapboxGeocode';
import { isWithinDeliveryArea, getCurrentPosition } from '../utils/geofence';
import { DEFAULT_SHOP_LOCATION } from '../config/geoConfig';
import { collection, query, where, getDocs, doc, setDoc, serverTimestamp } from 'firebase/firestore';
import { auth, db } from '../firebase/config';
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

export default function ProfileModal({
  isOpen,
  onClose,
  currentUserName,
  verifiedCustomer,
  customerForm,
  customerLocation,
  onAddressUpdated,
  onSignOut,
}) {
  const { showToast, shopSettings } = useCart();
  const [address, setAddress] = useState('');
  const [coords, setCoords] = useState(null); // { lat, lng }
  const [pinnedPointerCoords, setPinnedPointerCoords] = useState(null);
  const [isLocating, setIsLocating] = useState(false);
  const [isUpdating, setIsUpdating] = useState(false);
  const [suggestions, setSuggestions] = useState([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  const [deliveryStatus, setDeliveryStatus] = useState(null); // { allowed, distanceKm, maxRadius }

  const mapContainerRef = useRef(null);
  const leafletMapRef = useRef(null);
  const markerRef = useRef(null);
  const searchTimeoutRef = useRef(null);
  const abortControllerRef = useRef(null);
  const hasInitializedRef = useRef(false);

  // Helper to validate distance against shop delivery radius
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
            `⚠️ Address is ${distanceKm.toFixed(1)} km away (outside the ${maxRadius} km delivery zone).`,
            'warning'
          );
        } else {
          showToast(`✅ Delivery available (${distanceKm.toFixed(1)} km from shop).`, 'success');
        }
      }
      return { allowed, distanceKm, maxRadius };
    }
    return { allowed: true, distanceKm: 0, maxRadius: 5 };
  };

  // Populate initial profile address and coordinates when modal opens
  useEffect(() => {
    if (!isOpen) {
      hasInitializedRef.current = false;
      setSuggestions([]);
      setShowSuggestions(false);
      return;
    }

    if (hasInitializedRef.current) {
      return;
    }
    hasInitializedRef.current = true;

    const initialAddress =
      verifiedCustomer?.address ||
      customerForm?.address ||
      customerLocation?.address ||
      '';
    setAddress(initialAddress);

    let initialCoords = null;
    if (
      typeof customerLocation?.lat === 'number' &&
      typeof customerLocation?.lng === 'number'
    ) {
      initialCoords = {
        lat: customerLocation.lat,
        lng: customerLocation.lng,
      };
    } else if (
      typeof verifiedCustomer?.location?.lat === 'number' &&
      typeof verifiedCustomer?.location?.lng === 'number'
    ) {
      initialCoords = {
        lat: verifiedCustomer.location.lat,
        lng: verifiedCustomer.location.lng,
      };
    } else {
      try {
        const stored = JSON.parse(
          localStorage.getItem('shop_fixed_signup_location') || '{}'
        );
        if (
          typeof stored.lat === 'number' &&
          typeof stored.lng === 'number'
        ) {
          initialCoords = { lat: stored.lat, lng: stored.lng };
        }
      } catch {}
    }

    if (initialCoords) {
      setCoords(initialCoords);
      setPinnedPointerCoords(initialCoords);
      checkRadius(initialCoords.lat, initialCoords.lng, false);
    } else if (initialAddress.trim()) {
      // Forward geocode once if coordinates aren't in state
      geocodeAddress(initialAddress.trim())
        .then((res) => {
          if (res && typeof res.lat === 'number' && typeof res.lng === 'number') {
            const resolvedCoords = { lat: res.lat, lng: res.lng };
            setCoords(resolvedCoords);
            setPinnedPointerCoords(resolvedCoords);
            checkRadius(res.lat, res.lng, false);
          }
        })
        .catch(() => {});
    }
  }, [isOpen, customerLocation, verifiedCustomer, customerForm]);

  // Leaflet map setup and updates (matching SignUpModal)
  useEffect(() => {
    if (!isOpen) {
      if (leafletMapRef.current) {
        leafletMapRef.current.remove();
        leafletMapRef.current = null;
        markerRef.current = null;
      }
      return;
    }

    if (!mapContainerRef.current) return;

    const initialLat =
      coords?.lat ||
      customerLocation?.lat ||
      shopSettings?.lat ||
      DEFAULT_SHOP_LOCATION.lat;
    const initialLng =
      coords?.lng ||
      customerLocation?.lng ||
      shopSettings?.lng ||
      DEFAULT_SHOP_LOCATION.lng;

    if (!leafletMapRef.current) {
      const map = L.map(mapContainerRef.current).setView(
        [initialLat, initialLng],
        coords ? 15 : 13
      );
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; OpenStreetMap contributors',
      }).addTo(map);

      // Invalidate size to ensure clean tiles in modal
      setTimeout(() => {
        map.invalidateSize();
      }, 200);

      // Click on map to place/move pin
      map.on('click', async (e) => {
        const { lat, lng } = e.latlng;
        // Snap pointer immediately to clicked position
        if (!markerRef.current) {
          const marker = L.marker([lat, lng], { draggable: true }).addTo(map);
          marker.on('dragend', async (dragEvt) => {
            const pos = dragEvt.target.getLatLng();
            setPinnedPointerCoords({ lat: pos.lat, lng: pos.lng });
            setCoords({ lat: pos.lat, lng: pos.lng });
            checkRadius(pos.lat, pos.lng, true);
            try {
              const resAddr = await reverseGeocodeCoords(pos.lat, pos.lng);
              if (resAddr) setAddress(resAddr);
            } catch {}
          });
          markerRef.current = marker;
        } else {
          markerRef.current.setLatLng([lat, lng]);
        }
        map.panTo([lat, lng]);

        setPinnedPointerCoords({ lat, lng });
        setCoords({ lat, lng });
        checkRadius(lat, lng, true);

        try {
          const resolvedAddress = await reverseGeocodeCoords(lat, lng);
          if (resolvedAddress) setAddress(resolvedAddress);
        } catch {}
      });

      leafletMapRef.current = map;
    }

    if (coords && leafletMapRef.current) {
      leafletMapRef.current.setView([coords.lat, coords.lng], 15);

      if (!markerRef.current) {
        const marker = L.marker([coords.lat, coords.lng], {
          draggable: true,
        }).addTo(leafletMapRef.current);

        marker.on('dragend', async (e) => {
          const { lat, lng } = e.target.getLatLng();
          setPinnedPointerCoords({ lat, lng });
          setCoords({ lat, lng });
          checkRadius(lat, lng, true);

          try {
            const resolvedAddress = await reverseGeocodeCoords(lat, lng);
            if (resolvedAddress) setAddress(resolvedAddress);
          } catch {}
        });

        markerRef.current = marker;
      } else {
        markerRef.current.setLatLng([coords.lat, coords.lng]);
      }
    }
  }, [isOpen, coords, shopSettings]);

  // Handle GPS Auto-detect
  const handleUseCurrentLocation = async () => {
    setIsLocating(true);
    showToast('📍 Getting current location...', 'info');
    try {
      const pos = await getCurrentPosition();
      const detectedCoords = { lat: pos.lat, lng: pos.lng };
      setCoords(detectedCoords);
      setPinnedPointerCoords(detectedCoords);
      checkRadius(pos.lat, pos.lng, true);

      const resolvedAddress = await reverseGeocodeCoords(pos.lat, pos.lng);
      if (resolvedAddress) setAddress(resolvedAddress);
    } catch (err) {
      showToast(err.message || 'Could not fetch current location.', 'error');
    } finally {
      setIsLocating(false);
    }
  };

  // Debounced search-as-you-type autocomplete with in-flight cancellation
  const handleAddressChange = (e) => {
    const val = e.target.value;
    setAddress(val);

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
    setAddress(item.place_name);
    const selectedCoords = { lat: item.lat, lng: item.lng };
    setCoords(selectedCoords);
    setPinnedPointerCoords(selectedCoords);
    setSuggestions([]);
    setShowSuggestions(false);
    checkRadius(item.lat, item.lng, true);
  };

  // Save updated delivery address & coordinates
  const handleUpdateAddress = async () => {
    if (!address.trim()) {
      showToast('Please specify a delivery address.', 'warning');
      return;
    }

    setIsUpdating(true);
    try {
      // 1. Resolve final coordinates
      let finalCoords = pinnedPointerCoords || coords;
      if (!finalCoords && address.trim()) {
        try {
          const geoRes = await geocodeAddress(address.trim());
          if (
            geoRes &&
            typeof geoRes.lat === 'number' &&
            typeof geoRes.lng === 'number'
          ) {
            finalCoords = { lat: geoRes.lat, lng: geoRes.lng };
          }
        } catch {}
      }

      const shopCoords = { lat: shopSettings?.lat, lng: shopSettings?.lng };
      const maxRadius = shopSettings?.radiusKm || 5;
      let dist = 0;
      let isAllowed = true;

      if (finalCoords && typeof finalCoords.lat === 'number') {
        const validation = isWithinDeliveryArea(
          finalCoords.lat,
          finalCoords.lng,
          shopCoords,
          maxRadius
        );
        dist = validation.distanceKm;
        isAllowed = validation.allowed;
      }

      const finalAddress = address.trim();
      const updatedPayload = {
        lat: finalCoords?.lat ?? null,
        lng: finalCoords?.lng ?? null,
        address: finalAddress,
        distanceKm: dist,
        isFixated: true,
      };

      // 2. Persist update directly into Firestore on the correct existing customer document (no new collection)
      let docId = verifiedCustomer?.id;
      // If we don't have the ID, fall back to auth UID when it matches the same email
      if (!docId && auth.currentUser?.uid && auth.currentUser?.email?.toLowerCase() === verifiedCustomer?.email?.toLowerCase()) {
        docId = auth.currentUser.uid;
      }
      // If still missing, query by email to obtain the UID
      if (!docId && verifiedCustomer?.email) {
        const q = query(collection(db, 'customers'), where('email', '==', verifiedCustomer.email));
        const snap = await getDocs(q);
        if (!snap.empty) {
          docId = snap.docs[0].id;
        }
      }
      if (docId) {
        const custRef = doc(db, 'customers', docId);
        await setDoc(custRef, {
          address: finalAddress,
          lat: finalCoords?.lat ?? null,
          lng: finalCoords?.lng ?? null,
          updatedAt: serverTimestamp(),
        }, { merge: true });
        // After persisting, sync local state to reflect saved values
        setAddress(finalAddress);
        setCoords(finalCoords);
        setPinnedPointerCoords(finalCoords);
      }

      // 3. Cache to localStorage for customer session fixation
      try {
        localStorage.setItem(
          'shop_fixed_signup_location',
          JSON.stringify(updatedPayload)
        );
      } catch {}

      // 4. Notify parent state
      if (onAddressUpdated) {
        onAddressUpdated(updatedPayload);
      }

      if (!isAllowed) {
        showToast(
          `⚠️ Delivery address updated! Note: location is ${dist.toFixed(1)} km away (outside the ${maxRadius} km zone).`,
          'warning'
        );
      } else {
        showToast(
          `🎉 Delivery address updated successfully (${dist.toFixed(1)} km from shop)!`,
          'success'
        );
      }

      onClose();
    } catch (err) {
      console.error('Failed to update delivery address:', err);
      showToast(`Error updating address: ${err.message}`, 'error');
    } finally {
      setIsUpdating(false);
    }
  };

  if (!isOpen) return null;

  const displayName =
    verifiedCustomer?.name || customerForm?.name || currentUserName;
  const displayEmail =
    verifiedCustomer?.email ||
    customerForm?.email ||
    auth.currentUser?.email ||
    'Not provided';
  const displayContact =
    verifiedCustomer?.contact || customerForm?.contact || 'Not provided';

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal-card"
        style={{ maxWidth: '480px', width: '92%' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <div className="modal-icon-badge">👤</div>
          <h3 className="modal-title">My Profile</h3>
          <p className="modal-subtitle">
            {currentUserName !== 'User'
              ? `Welcome back, ${currentUserName}.`
              : 'Your account details are shown here.'}
          </p>
        </div>

        {/* Read-Only Profile Details (Name, Email, Contact) */}
        <div style={{ display: 'grid', gap: '0.75rem', marginBottom: '1.1rem' }}>
          <div
            className="detail-box"
            style={{
              padding: '0.75rem 0.9rem',
              borderRadius: '10px',
              background: 'var(--bg-mist, #f8fafc)',
            }}
          >
            <h4
              style={{
                margin: '0 0 0.25rem',
                fontSize: '0.7rem',
                color: 'var(--text-muted, #64748b)',
                textTransform: 'uppercase',
                letterSpacing: '0.08em',
              }}
            >
              Name
            </h4>
            <div style={{ fontWeight: 700, fontSize: '0.95rem' }}>
              {displayName}
            </div>
          </div>

          <div
            className="detail-box"
            style={{
              padding: '0.75rem 0.9rem',
              borderRadius: '10px',
              background: 'var(--bg-mist, #f8fafc)',
            }}
          >
            <h4
              style={{
                margin: '0 0 0.25rem',
                fontSize: '0.7rem',
                color: 'var(--text-muted, #64748b)',
                textTransform: 'uppercase',
                letterSpacing: '0.08em',
              }}
            >
              Email
            </h4>
            <div style={{ fontSize: '0.92rem' }}>{displayEmail}</div>
          </div>

          <div
            className="detail-box"
            style={{
              padding: '0.75rem 0.9rem',
              borderRadius: '10px',
              background: 'var(--bg-mist, #f8fafc)',
            }}
          >
            <h4
              style={{
                margin: '0 0 0.25rem',
                fontSize: '0.7rem',
                color: 'var(--text-muted, #64748b)',
                textTransform: 'uppercase',
                letterSpacing: '0.08em',
              }}
            >
              Contact
            </h4>
            <div style={{ fontSize: '0.92rem' }}>{displayContact}</div>
          </div>
        </div>

        {/* Editable Delivery Address (Matching SignUpModal Functionality) */}
        <div className="form-group" style={{ position: 'relative', marginBottom: '0.75rem' }}>
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
              htmlFor="profile-address-input"
              style={{ margin: 0, fontWeight: 700, fontSize: '0.82rem', color: '#334155' }}
            >
              Delivery Address (Editable)
            </label>
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
          </div>

          <input
            id="profile-address-input"
            type="text"
            className="form-input"
            placeholder="Search address or tap on map..."
            value={address}
            onChange={handleAddressChange}
            onFocus={() => suggestions.length > 0 && setShowSuggestions(true)}
            autoComplete="off"
            style={{
              width: '100%',
              padding: '0.65rem 0.85rem',
              borderRadius: '8px',
              border: '1px solid #cbd5e1',
              fontSize: '0.9rem',
              boxSizing: 'border-box',
            }}
          />

          {/* Suggestions Dropdown */}
          {showSuggestions && suggestions.length > 0 && (
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

        {/* Interactive Leaflet Map Preview & Draggable Marker */}
        <div style={{ marginBottom: '0.85rem' }}>
          <div
            style={{
              fontSize: '0.74rem',
              color: 'var(--text-muted, #64748b)',
              marginBottom: '0.35rem',
            }}
          >
            💡 Drag the pin or click anywhere on the map to adjust exact delivery location.
          </div>
          <div
            ref={mapContainerRef}
            style={{
              height: '170px',
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
              padding: '0.45rem 0.7rem',
              borderRadius: '8px',
              background: deliveryStatus.allowed ? '#dcfce7' : '#fee2e2',
              color: deliveryStatus.allowed ? '#166534' : '#991b1b',
              marginBottom: '1.1rem',
              display: 'flex',
              alignItems: 'center',
              gap: '0.4rem',
            }}
          >
            <span>{deliveryStatus.allowed ? '✅' : '⚠️'}</span>
            <span>
              {deliveryStatus.allowed
                ? `Inside delivery zone (${deliveryStatus.distanceKm.toFixed(1)} km from shop)`
                : `Outside delivery zone (${deliveryStatus.distanceKm.toFixed(1)} km away, max ${deliveryStatus.maxRadius} km)`}
            </span>
          </div>
        )}

        {/* Modal Actions: Update Button Next to Close Button */}
        <div
          className="modal-actions"
          style={{
            display: 'flex',
            gap: '0.65rem',
            alignItems: 'center',
            flexWrap: 'wrap',
          }}
        >
          <button
            type="button"
            className="btn-modal-cancel"
            onClick={onClose}
            style={{ minWidth: '90px' }}
          >
            Close
          </button>
          <button
            type="button"
            className="btn-modal-primary"
            onClick={handleUpdateAddress}
            disabled={isUpdating}
            style={{
              minWidth: '120px',
              background: 'var(--primary-slate, #0f172a)',
              color: '#ffffff',
            }}
          >
            {isUpdating ? 'Updating...' : 'Update'}
          </button>
          {auth.currentUser && (
            <button
              type="button"
              className="btn-modal-cancel"
              onClick={onSignOut}
              style={{
                marginLeft: 'auto',
                color: '#dc2626',
                borderColor: '#fca5a5',
              }}
            >
              Sign Out
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

