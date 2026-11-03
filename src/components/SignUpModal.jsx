import React, { useState, useEffect, useRef } from 'react';
import { searchAddressSuggestions, reverseGeocodeCoords } from '../utils/mapboxGeocode';
import { isWithinDeliveryArea, getCurrentPosition } from '../utils/geofence';
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

export default function SignUpModal({
  isOpen,
  onClose,
  onSwitchToLogin,
  onSignUpSuccess,
}) {
  const { showToast, shopSettings } = useCart();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [address, setAddress] = useState('');
  const [coords, setCoords] = useState(null); // { lat, lng }
  const [isLocating, setIsLocating] = useState(false);
  const [suggestions, setSuggestions] = useState([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [isSearching, setIsSearching] = useState(false);

  const mapContainerRef = useRef(null);
  const leafletMapRef = useRef(null);
  const markerRef = useRef(null);
  const searchTimeoutRef = useRef(null);

  // Radius validation check helper
  const checkRadius = (lat, lng) => {
    if (shopSettings?.lat && shopSettings?.lng) {
      const maxRadius = shopSettings?.radiusKm || 5;
      const { allowed, distanceKm } = isWithinDeliveryArea(
        lat,
        lng,
        { lat: shopSettings.lat, lng: shopSettings.lng },
        maxRadius
      );
      if (!allowed) {
        showToast(
          `⚠️ Address is ${distanceKm.toFixed(1)} km away (outside the ${maxRadius} km delivery zone). You can still browse and sign up.`,
          'warning'
        );
      } else {
        showToast(`✅ Delivery available (${distanceKm.toFixed(1)} km from shop).`, 'success');
      }
    }
  };

  // Reset form when modal opens
  useEffect(() => {
    if (isOpen) {
      setName('');
      setEmail('');
      setPassword('');
      setAddress('');
      setCoords(null);
      setSuggestions([]);
      setShowSuggestions(false);
    }
  }, [isOpen]);

  // Leaflet map setup & updates
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

    const initialLat = coords?.lat || shopSettings?.lat || 28.6139;
    const initialLng = coords?.lng || shopSettings?.lng || 77.2090;

    if (!leafletMapRef.current) {
      const map = L.map(mapContainerRef.current).setView([initialLat, initialLng], coords ? 15 : 13);
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; OpenStreetMap contributors',
      }).addTo(map);

      // Click on map to place/move pin
      map.on('click', async (e) => {
        const { lat, lng } = e.latlng;
        setCoords({ lat, lng });
        checkRadius(lat, lng);

        try {
          const resolvedAddress = await reverseGeocodeCoords(lat, lng);
          setAddress(resolvedAddress);
        } catch {
          // ignore error
        }
      });

      leafletMapRef.current = map;
    }

    if (coords && leafletMapRef.current) {
      leafletMapRef.current.setView([coords.lat, coords.lng], 15);

      if (!markerRef.current) {
        const marker = L.marker([coords.lat, coords.lng], { draggable: true }).addTo(leafletMapRef.current);
        marker.on('dragend', async (e) => {
          const { lat, lng } = e.target.getLatLng();
          setCoords({ lat, lng });
          checkRadius(lat, lng);
          try {
            const resolvedAddress = await reverseGeocodeCoords(lat, lng);
            setAddress(resolvedAddress);
          } catch {
            // ignore
          }
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
      setCoords({ lat: pos.lat, lng: pos.lng });
      checkRadius(pos.lat, pos.lng);

      const resolvedAddress = await reverseGeocodeCoords(pos.lat, pos.lng);
      setAddress(resolvedAddress);
    } catch (err) {
      showToast(err.message || 'Could not fetch current location.', 'error');
    } finally {
      setIsLocating(false);
    }
  };

  // Debounced search-as-you-type autocomplete
  const handleAddressChange = (e) => {
    const val = e.target.value;
    setAddress(val);

    if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);

    if (val.trim().length >= 3) {
      setIsSearching(true);
      searchTimeoutRef.current = setTimeout(async () => {
        try {
          const results = await searchAddressSuggestions(val);
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
    setCoords({ lat: item.lat, lng: item.lng });
    setSuggestions([]);
    setShowSuggestions(false);
    checkRadius(item.lat, item.lng);
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!name.trim() || !email.trim() || !password) {
      showToast('Please fill in name, email, and password.', 'warning');
      return;
    }
    if (password.length < 6) {
      showToast('Password must be at least 6 characters.', 'warning');
      return;
    }
    if (!address.trim()) {
      showToast('Please specify a delivery address.', 'warning');
      return;
    }

    onSignUpSuccess({
      name: name.trim(),
      email: email.trim(),
      password,
      address: address.trim(),
      coords,
    });
  };

  if (!isOpen) return null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card" style={{ maxWidth: '440px', width: '92%' }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-icon-badge">✨</div>
          <h3 className="modal-title">Create Customer Account</h3>
          <p className="modal-subtitle">Sign up to track orders, save addresses, and start shopping.</p>
        </div>

        <form onSubmit={handleSubmit} noValidate>
          <div className="form-group">
            <label className="form-label" htmlFor="signup-name">Full Name</label>
            <input
              id="signup-name"
              type="text"
              required
              className="form-input"
              placeholder="e.g. John Doe"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>

          <div className="form-group">
            <label className="form-label" htmlFor="signup-email">Email Address</label>
            <input
              id="signup-email"
              type="email"
              required
              className="form-input"
              placeholder="e.g. john@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>

          <div className="form-group">
            <label className="form-label" htmlFor="signup-password">Password</label>
            <input
              id="signup-password"
              type="password"
              required
              minLength={6}
              className="form-input"
              placeholder="At least 6 characters"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>

          {/* Delivery Address with Autocomplete + GPS Button */}
          <div className="form-group" style={{ position: 'relative' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.35rem' }}>
              <label className="form-label" htmlFor="signup-address" style={{ margin: 0 }}>Delivery Address</label>
              <button
                type="button"
                onClick={handleUseCurrentLocation}
                disabled={isLocating}
                style={{
                  background: 'none',
                  border: 'none',
                  color: 'var(--accent-honey)',
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
              id="signup-address"
              type="text"
              required
              className="form-input"
              placeholder="Search address or tap on map..."
              value={address}
              onChange={handleAddressChange}
              onFocus={() => suggestions.length > 0 && setShowSuggestions(true)}
              autoComplete="off"
            />

            {/* Suggestions dropdown */}
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
                  maxHeight: '180px',
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

          {/* Interactive Leaflet Map Preview & Pin Dragging */}
          <div style={{ marginTop: '0.75rem', marginBottom: '1.25rem' }}>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '0.35rem' }}>
              💡 Drag the pin or click anywhere on the map to adjust exact location.
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

          <div className="modal-actions">
            <button type="button" className="btn-modal-cancel" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="btn-modal-primary">
              Sign Up →
            </button>
          </div>

          <div style={{ marginTop: '1.25rem', textAlign: 'center', fontSize: '0.86rem', color: 'var(--text-muted)' }}>
            Already have an account?{' '}
            <button
              type="button"
              onClick={onSwitchToLogin}
              style={{ background: 'none', border: 'none', color: 'var(--accent-honey)', fontWeight: 700, cursor: 'pointer', padding: 0 }}
            >
              Log In
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

