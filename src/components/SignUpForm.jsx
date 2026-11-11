import React, { useState } from 'react';
import { useCart } from '../context/CartContext';

/**
 * Sign‑Up form with Name, Email, and Password.
 * Delivery address is removed from signup and now lives exclusively in the checkout flow.
 */
export default function SignUpForm({ onSignUpSuccess }) {
  const { showToast } = useCart();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!name || !email || !password) {
      showToast('Name, email and password are required.', 'warning');
      return;
    }
    if (password.length < 6) {
      showToast('Password must be at least 6 characters.', 'warning');
      return;
    }
    if (onSignUpSuccess) {
      onSignUpSuccess({ name, email, password });
    }
  };

  return (
    <div className="modal-card" style={{ width: '100%', maxWidth: '420px', margin: '0 auto' }}>
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
        <div className="modal-actions" style={{ marginTop: '1.5rem' }}>
          <button type="submit" className="btn-primary">
            Sign Up →
          </button>
        </div>
      </form>
    </div>
  );
}
