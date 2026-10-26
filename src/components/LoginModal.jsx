import React, { useState, useEffect } from 'react';
import { signInWithEmailAndPassword } from 'firebase/auth';

export default function LoginModal({
  isOpen,
  onClose,
  onSwitchToSignUp,
  onLoginSuccess,
  showToast,
  auth,
  initialEmail = ''
}) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  useEffect(() => {
    if (isOpen) {
      setEmail(initialEmail || '');
      setPassword('');
      setErrorMessage('');
      setIsLoading(false);
    }
  }, [isOpen, initialEmail]);

  if (!isOpen) return null;

  const handleSubmit = async (e) => {
    e.preventDefault();
    setErrorMessage('');

    const cleanEmail = email.trim();
    if (!cleanEmail) {
      setErrorMessage('Please enter your email address.');
      showToast?.('Please enter your email address.', 'warning');
      return;
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(cleanEmail)) {
      setErrorMessage('Please enter a valid email address.');
      showToast?.('Please enter a valid email address.', 'warning');
      return;
    }

    if (!password) {
      setErrorMessage('Please enter your password.');
      showToast?.('Please enter your password.', 'warning');
      return;
    }

    setIsLoading(true);

    try {
      const userCredential = await signInWithEmailAndPassword(auth, cleanEmail, password);
      const user = userCredential.user;
      const displayName = user.displayName || user.email?.split('@')[0] || 'Customer';

      showToast?.(`Welcome back, ${displayName}!`, 'success');
      onLoginSuccess?.(user);
      onClose();
    } catch (err) {
      console.error('Login error:', err);
      const errCode = err?.code || '';
      let friendlyMsg = 'Failed to log in. Please check your credentials.';

      if (
        errCode === 'auth/invalid-credential' ||
        errCode === 'auth/wrong-password' ||
        errCode === 'auth/user-not-found'
      ) {
        friendlyMsg = 'Invalid email or password. Please verify and try again.';
      } else if (errCode === 'auth/invalid-email') {
        friendlyMsg = 'The email address format is invalid.';
      } else if (errCode === 'auth/too-many-requests') {
        friendlyMsg = 'Access temporarily restricted due to multiple failed login attempts. Please try again later.';
      } else if (errCode === 'auth/user-disabled') {
        friendlyMsg = 'This account has been disabled. Please contact support.';
      } else if (errCode === 'auth/network-request-failed') {
        friendlyMsg = 'Network error. Please verify your internet connection.';
      }

      setErrorMessage(friendlyMsg);
      showToast?.(friendlyMsg, 'error');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <form onSubmit={handleSubmit} noValidate>
          <div className="modal-header">
            <div className="modal-icon-badge">🔑</div>
            <h3 className="modal-title">Customer Login</h3>
            <p className="modal-subtitle">
              Sign in with your email and password to access your account.
            </p>
          </div>

          {errorMessage && (
            <div
              style={{
                background: '#fef2f2',
                border: '1px solid #fecaca',
                color: '#991b1b',
                padding: '0.75rem 1rem',
                borderRadius: 'var(--radius-sm)',
                fontSize: '0.85rem',
                marginBottom: '1rem',
                lineHeight: 1.4
              }}
            >
              ⚠️ {errorMessage}
            </div>
          )}

          <div className="form-group">
            <label className="form-label" htmlFor="user-login-email">
              Email Address
            </label>
            <input
              id="user-login-email"
              type="email"
              required
              autoFocus
              className="form-input"
              placeholder="e.g. customer@example.com"
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                if (errorMessage) setErrorMessage('');
              }}
              disabled={isLoading}
            />
          </div>

          <div className="form-group">
            <label className="form-label" htmlFor="user-login-password">
              Password
            </label>
            <input
              id="user-login-password"
              type="password"
              required
              className="form-input"
              placeholder="Enter your password"
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                if (errorMessage) setErrorMessage('');
              }}
              disabled={isLoading}
            />
          </div>

          <div className="modal-actions" style={{ marginTop: '1.6rem' }}>
            <button
              type="button"
              className="btn-modal-cancel"
              onClick={onClose}
              disabled={isLoading}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="btn-modal-primary"
              disabled={isLoading}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '0.5rem',
                opacity: isLoading ? 0.75 : 1
              }}
            >
              {isLoading ? 'Signing In...' : 'Log In →'}
            </button>
          </div>

          {onSwitchToSignUp && (
            <div
              style={{
                marginTop: '1.25rem',
                textAlign: 'center',
                fontSize: '0.86rem',
                color: 'var(--text-muted)'
              }}
            >
              Don't have an account?{' '}
              <button
                type="button"
                onClick={() => {
                  onClose();
                  onSwitchToSignUp();
                }}
                style={{
                  background: 'none',
                  border: 'none',
                  color: 'var(--accent-honey)',
                  fontWeight: 700,
                  cursor: 'pointer',
                  padding: 0
                }}
              >
                Sign Up
              </button>
            </div>
          )}
        </form>
      </div>
    </div>
  );
}
