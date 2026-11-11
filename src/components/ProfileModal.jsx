import React from 'react';
import { auth } from '../firebase/config';

export default function ProfileModal({
  isOpen,
  onClose,
  currentUserName,
  verifiedCustomer,
  customerForm,
  onSignOut,
}) {
  if (!isOpen) return null;

  const displayName =
    verifiedCustomer?.name || customerForm?.name || currentUserName || 'Customer';
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
        style={{ maxWidth: '440px', width: '92%' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <div className="modal-icon-badge">👤</div>
          <h3 className="modal-title">My Profile</h3>
          <p className="modal-subtitle">
            {currentUserName && currentUserName !== 'User'
              ? `Welcome back, ${currentUserName}.`
              : 'Your account details are shown here.'}
          </p>
        </div>

        {/* Read-Only Profile Details (Name, Email, Contact) */}
        <div style={{ display: 'grid', gap: '0.75rem', marginBottom: '1.5rem' }}>
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

        {/* Modal Actions */}
        <div
          className="modal-actions"
          style={{
            display: 'flex',
            gap: '0.65rem',
            alignItems: 'center',
            justifyContent: 'space-between',
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
          {auth.currentUser && (
            <button
              type="button"
              className="btn-modal-cancel"
              onClick={onSignOut}
              style={{
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
