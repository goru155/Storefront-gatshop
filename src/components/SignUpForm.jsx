import React, { useState, useEffect, useRef } from 'react';
import { geocodeAddress } from '../utils/mapboxGeocode';
import { isWithinDeliveryArea } from '../utils/geofence';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { useCart } from '../context/CartContext';

/**
 * Sign‑Up form with address search, Mapbox geocoding, and a map preview.
 *
 * Behaviour:
 *  • User enters a free‑form address and clicks **Find address**.
 *  • The address is geocoded via Mapbox (helper in `utils/mapboxGeocode.js`).
 *  • Returned coordinates are stored in state and a Leaflet map shows a marker.
 *  • The shop’s location & delivery radius are taken from `shopSettings` (via useCart).
 *  • If the point lies **outside** the delivery radius, a warning toast is shown –
 *    the sign‑up can still continue.
 */
export default function SignUpForm({ onSignUpSuccess }) {
  // UI matches the design in the provided screenshot
  // Header mimics the LoginModal style with an icon badge and titles
  // All form groups use the shared .form-group / .form-label / .form-input classes

  const { showToast, shopSettings } = useCart();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [address, setAddress] = useState('');
  const [coords, setCoords] = useState(null); // { lat, lng, formatted }
  const mapRef = useRef(null);
  const leafletMapRef = useRef(null);
  const markerRef = useRef(null);

  // Initialise or update Leaflet map when we have coordinates.
  useEffect(() => {
    if (!coords) return;
    if (!leafletMapRef.current) {
      leafletMapRef.current = L.map(mapRef.current, {
        center: [coords.lat, coords.lng],
        zoom: 13,
        layers: [L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png')],
      });
      markerRef.current = L.marker([coords.lat, coords.lng]).addTo(leafletMapRef.current);
    } else {
      leafletMapRef.current.setView([coords.lat, coords.lng], 13);
      if (markerRef.current) {
        markerRef.current.setLatLng([coords.lat, coords.lng]);
      }
    }
  }, [coords]);

  const handleGeocode = async () => {
    if (!address.trim()) {
      showToast('Please enter an address to search.', 'warning');
      return;
    }
    try {
      const result = await geocodeAddress(address.trim());
      setCoords(result);

      // Perform radius check against shop settings.
      if (shopSettings?.lat && shopSettings?.lng) {
        const maxRadius = shopSettings?.radiusKm || 5; // km fallback
        const { allowed, distanceKm } = isWithinDeliveryArea(
          result.lat,
          result.lng,
          { lat: shopSettings.lat, lng: shopSettings.lng },
          maxRadius
        );
        if (!allowed) {
          showToast(
            `⚠️ Your address is ${distanceKm.toFixed(1)} km away – outside the ${maxRadius} km delivery zone.`,
            'warning'
          );
        } else {
          showToast(
            `✅ Address is within ${distanceKm.toFixed(1)} km of the shop.`,
            'success'
          );
        }
      }
    } catch (err) {
      console.error('Geocode error:', err);
      showToast(err.message || 'Failed to locate address.', 'error');
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!name || !email || !password) {
      showToast('Name, email and password are required.', 'warning');
      return;
    }
    if (onSignUpSuccess) {
      onSignUpSuccess({ name, email, password, address, coords });
    }
  };

  return (
    <div className="modal-card" style={{ width: '100%', maxWidth: '420px', margin: '0 auto' }}>
      {/* Header similar to login modal */}
      <div className="modal-header">
        <div className="modal-icon-badge">🛒</div>
        <h3 className="modal-title">Create Account</h3>
        <p className="modal-subtitle">Enter your details to sign up and start shopping.</p>
      </div>
      <form onSubmit={handleSubmit} noValidate>
        <div className="form-group">
          <label className="form-label" htmlFor="signup-name">Name</label>
          <input
            id="signup-name"
            type="text"
            required
            className="form-input"
            placeholder="Your name"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <div className="form-group">
          <label className="form-label" htmlFor="signup-email">Email</label>
          <input
            id="signup-email"
            type="email"
            required
            className="form-input"
            placeholder="you@example.com"
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
        {/* Address search */}
        <div className="form-group">
          <label className="form-label">Current Location</label>
          <p className="form-input" style={{margin:0}}>{coords ? `${coords.lat.toFixed(5)}, ${coords.lng.toFixed(5)}` : 'Fetching location...'}</p>
        </div>
        {coords && (
          <div className="map-preview" style={{ height: '200px', marginTop: '1rem' }} ref={mapRef} />
        )}
        <div className="modal-actions" style={{ marginTop: '1.5rem' }}>
          <button type="submit" className="btn-primary">
            Sign Up →
          </button>
        </div>
      </form>
    </div>
  );
}