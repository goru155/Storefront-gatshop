import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { onAuthStateChanged } from 'firebase/auth';
import { collection, onSnapshot, query, where, orderBy, updateDoc, setDoc, doc, serverTimestamp } from 'firebase/firestore';
import { auth, db } from '../firebase/config';

const ADMIN_EMAIL = import.meta.env.VITE_ADMIN_EMAIL || 'admin@shop.com';

const STATUS_OPTIONS = [
  'new',
  'confirmed',
  'preparing',
  'out_for_delivery',
  'delivered',
  'cancelled'
];

const statusStyles = {
  new: { background: '#e0f2fe', color: '#075985' },
  confirmed: { background: '#dcfce7', color: '#166534' },
  preparing: { background: '#fef3c7', color: '#92400e' },
  out_for_delivery: { background: '#ede9fe', color: '#5b21b6' },
  delivered: { background: '#dcfce7', color: '#166534' },
  cancelled: { background: '#fee2e2', color: '#991b1b' },
};

const formatStatusLabel = (status) => {
  if (!status) return 'new';
  return status
    .split('_')
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
};

const formatDate = (value) => {
  if (!value) return 'N/A';

  if (typeof value === 'object' && value !== null && typeof value.toDate === 'function') {
    return value.toDate().toLocaleString();
  }

  try {
    return new Date(value).toLocaleString();
  } catch {
    return 'N/A';
  }
};

export default function OrdersPage() {
  const [orders, setOrders] = useState([]);
  const [selectedOrderId, setSelectedOrderId] = useState(null);
  const [currentUser, setCurrentUser] = useState(null);
  const [isAuthReady, setIsAuthReady] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [ordersError, setOrdersError] = useState('');

  // Admin Shop Location & Boundary Setup state
  const [isLocationModalOpen, setIsLocationModalOpen] = useState(false);
  const [shopSettings, setShopSettings] = useState({
    lat: 28.6139,
    lng: 77.2090,
    radiusKm: 5,
    address: 'Main Shop'
  });
  const [isSavingLocation, setIsSavingLocation] = useState(false);
  const [locationStatusMsg, setLocationStatusMsg] = useState({ text: '', type: '' });

  useEffect(() => {
    let unsubscribeOrders = null;
    let unsubscribeShop = null;

    const unsubscribeAuth = onAuthStateChanged(auth, (user) => {
      if (unsubscribeOrders) {
        unsubscribeOrders();
        unsubscribeOrders = null;
      }
      if (unsubscribeShop) {
        unsubscribeShop();
        unsubscribeShop = null;
      }

      setIsAuthReady(true);
      setCurrentUser(user);
      const authorizedAdmin = user?.email?.toLowerCase() === ADMIN_EMAIL;
      setIsAdmin(authorizedAdmin);
      setOrdersError('');

      if (!user) {
        setOrders([]);
        setSelectedOrderId(null);
        return;
      }

      // If Admin: query all orders sorted by createdAt desc
      // If Customer: query only their own orders by customer.email
      let ordersQuery;
      if (authorizedAdmin) {
        ordersQuery = query(collection(db, 'orders'), orderBy('createdAt', 'desc'));
      } else {
        ordersQuery = query(
          collection(db, 'orders'),
          where('customer.email', '==', user.email)
        );
      }

      unsubscribeOrders = onSnapshot(ordersQuery, (snapshot) => {
        const list = snapshot.docs.map(docSnap => ({
          id: docSnap.id,
          ...docSnap.data()
        }));

        // Sort descending by date if client-filtered
        list.sort((a, b) => {
          const dateA = new Date(a.createdAt || a.timestamp || 0).getTime();
          const dateB = new Date(b.createdAt || b.timestamp || 0).getTime();
          return dateB - dateA;
        });

        setOrders(list);
        setSelectedOrderId(current => current || list[0]?.orderId || null);
      }, (error) => {
        console.error('Unable to load orders:', error);
        setOrdersError(error.code || 'unknown Firestore error');
      });

      // If admin, also listen to shop settings document
      if (authorizedAdmin) {
        const shopDocRef = doc(db, 'settings', 'shop');
        unsubscribeShop = onSnapshot(shopDocRef, (docSnap) => {
          if (docSnap.exists()) {
            const data = docSnap.data();
            setShopSettings({
              lat: typeof data.lat === 'number' ? data.lat : 28.6139,
              lng: typeof data.lng === 'number' ? data.lng : 77.2090,
              radiusKm: typeof data.radiusKm === 'number' ? data.radiusKm : 5,
              address: data.address || '',
              updatedAt: data.updatedAt || null
            });
          }
        }, (err) => {
          console.warn('Could not load shop settings:', err);
        });
      }
    });

    return () => {
      unsubscribeAuth();
      if (unsubscribeOrders) unsubscribeOrders();
      if (unsubscribeShop) unsubscribeShop();
    };
  }, []);

  const selectedOrder = useMemo(
    () => orders.find(order => order.orderId === selectedOrderId) || null,
    [orders, selectedOrderId]
  );

  const handleStatusChange = async (orderId, nextStatus) => {
    if (!isAdmin) return;
    const targetOrder = orders.find(order => order.orderId === orderId);
    if (!targetOrder) return;

    await updateDoc(doc(db, 'orders', targetOrder.id), {
      orderStatus: nextStatus,
      updatedAt: serverTimestamp()
    });
  };

  const handleDetectGPS = () => {
    if (!navigator.geolocation) {
      setLocationStatusMsg({ text: 'Geolocation is not supported by this browser.', type: 'error' });
      return;
    }
    setLocationStatusMsg({ text: 'Acquiring GPS coordinates...', type: 'info' });
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setShopSettings(prev => ({
          ...prev,
          lat: Math.round(pos.coords.latitude * 100000) / 100000,
          lng: Math.round(pos.coords.longitude * 100000) / 100000,
        }));
        setLocationStatusMsg({ text: '📍 Coordinates detected from device GPS!', type: 'success' });
      },
      (err) => {
        setLocationStatusMsg({ text: `GPS error: ${err.message}`, type: 'error' });
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  };

  const handleSaveShopLocation = async (e) => {
    e.preventDefault();
    if (!isAdmin) return;
    setIsSavingLocation(true);
    setLocationStatusMsg({ text: '', type: '' });

    const latNum = parseFloat(shopSettings.lat);
    const lngNum = parseFloat(shopSettings.lng);
    const radiusNum = parseFloat(shopSettings.radiusKm);

    if (isNaN(latNum) || isNaN(lngNum) || isNaN(radiusNum) || radiusNum <= 0) {
      setLocationStatusMsg({
        text: 'Please enter valid numerical coordinates and a positive radius (km).',
        type: 'error'
      });
      setIsSavingLocation(false);
      return;
    }

    try {
      await setDoc(doc(db, 'settings', 'shop'), {
        lat: latNum,
        lng: lngNum,
        radiusKm: radiusNum,
        address: shopSettings.address || '',
        updatedAt: serverTimestamp(),
        updatedBy: auth.currentUser?.email || ADMIN_EMAIL
      });

      setLocationStatusMsg({
        text: '✅ Shop location & delivery boundary saved successfully!',
        type: 'success'
      });
      setTimeout(() => {
        setIsLocationModalOpen(false);
        setLocationStatusMsg({ text: '', type: '' });
      }, 1400);
    } catch (err) {
      console.error('Failed to save shop settings:', err);
      setLocationStatusMsg({
        text: `Error saving: ${err.message}`,
        type: 'error'
      });
    } finally {
      setIsSavingLocation(false);
    }
  };

  if (!isAuthReady) {
    return (
      <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', background: '#f8fafc', color: '#0f172a' }}>
        <p>Loading orders...</p>
      </div>
    );
  }

  // Not signed in
  if (!currentUser) {
    return (
      <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', background: '#f8fafc', color: '#0f172a', padding: '2rem' }}>
        <div style={{ maxWidth: '420px', textAlign: 'center', background: '#fff', border: '1px solid #e2e8f0', borderRadius: '16px', padding: '2.5rem 2rem', boxShadow: '0 12px 30px rgba(15,23,42,0.06)' }}>
          <div style={{ fontSize: '2.5rem', marginBottom: '0.8rem' }}>📦</div>
          <h1 style={{ margin: '0 0 0.5rem' }}>My Orders</h1>
          <p style={{ color: '#64748b', marginBottom: '1.5rem', lineHeight: 1.5 }}>
            Please sign in to view your orders and track their delivery status.
          </p>
          <Link
            to="/"
            style={{
              background: '#6b3fa0',
              color: '#fff',
              padding: '0.75rem 1.5rem',
              borderRadius: '10px',
              fontWeight: 700,
              textDecoration: 'none',
              display: 'inline-block'
            }}
          >
            Go to Storefront & Log In
          </Link>
        </div>
      </div>
    );
  }

  // Error loading orders
  if (ordersError) {
    return (
      <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', background: '#f8fafc', color: '#0f172a', padding: '2rem' }}>
        <div style={{ maxWidth: '440px', textAlign: 'center', background: '#fff', border: '1px solid #e2e8f0', borderRadius: '16px', padding: '2.5rem 2rem', boxShadow: '0 12px 30px rgba(15,23,42,0.06)' }}>
          <div style={{ fontSize: '2.5rem', marginBottom: '0.8rem' }}>⚠️</div>
          <h1>Orders</h1>
          <p style={{ color: '#ef4444', marginBottom: '1.5rem' }}>
            Unable to load orders ({ordersError}).
          </p>
          <Link to="/" style={{ color: '#6b3fa0', fontWeight: 700, textDecoration: 'none' }}>Back to storefront</Link>
        </div>
      </div>
    );
  }

  return (
    <div style={{ minHeight: '100vh', background: '#f8fafc', color: '#0f172a', padding: '2rem 1.5rem 3rem' }}>
      <div style={{ maxWidth: '1400px', margin: '0 auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem', gap: '1rem', flexWrap: 'wrap' }}>
          <div>
            <div style={{ fontSize: '0.78rem', letterSpacing: '0.12em', textTransform: 'uppercase', color: '#64748b', fontWeight: 700 }}>
              {isAdmin ? 'Admin Portal' : 'Customer Account'}
            </div>
            <h1 style={{ margin: '0.35rem 0 0', fontSize: '2.2rem' }}>
              {isAdmin ? 'Orders Management' : 'My Orders'}
            </h1>
            <p style={{ margin: '0.3rem 0 0', color: '#64748b', fontSize: '0.9rem' }}>
              Signed in as <strong>{currentUser.email}</strong> {isAdmin && <span style={{ color: '#6b3fa0', fontWeight: 700 }}>(Admin)</span>}
            </p>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
            {isAdmin && (
              <button
                type="button"
                onClick={() => {
                  setLocationStatusMsg({ text: '', type: '' });
                  setIsLocationModalOpen(true);
                }}
                style={{
                  background: '#6b3fa0',
                  color: '#fff',
                  border: 'none',
                  borderRadius: '12px',
                  padding: '0.8rem 1.2rem',
                  fontWeight: 700,
                  cursor: 'pointer',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '0.5rem',
                  boxShadow: '0 4px 14px rgba(107, 63, 160, 0.25)'
                }}
              >
                <span>📍</span>
                <span>Shop Location & Radius ({shopSettings.radiusKm} km)</span>
              </button>
            )}

            <Link
              to="/"
              style={{
                background: '#fff',
                color: '#0f172a',
                border: '1px solid #cbd5e1',
                borderRadius: '12px',
                padding: '0.8rem 1.1rem',
                fontWeight: 700,
                textDecoration: 'none',
                display: 'inline-block'
              }}
            >
              ← Back to Storefront
            </Link>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1.1fr 1.6fr', gap: '1.25rem' }}>
          {/* Order Queue */}
          <div style={{ background: '#fff', borderRadius: '18px', border: '1px solid #e2e8f0', overflow: 'hidden', boxShadow: '0 10px 22px rgba(15,23,42,0.04)' }}>
            <div style={{ padding: '1rem 1rem 0.5rem', borderBottom: '1px solid #eef2f7', fontWeight: 700, fontSize: '1rem' }}>
              {isAdmin ? `All Orders (${orders.length})` : `Your Order History (${orders.length})`}
            </div>

            <div style={{ maxHeight: '750px', overflowY: 'auto' }}>
              {orders.length === 0 ? (
                <div style={{ padding: '2.5rem 1rem', textAlign: 'center', color: '#64748b' }}>
                  {isAdmin
                    ? 'No orders in the database yet.'
                    : 'You have not placed any orders yet. Browse our storefront to place an order!'}
                </div>
              ) : (
                orders.map(order => (
                  <button
                    key={order.id}
                    onClick={() => setSelectedOrderId(order.orderId)}
                    style={{
                      width: '100%',
                      textAlign: 'left',
                      background: order.orderId === selectedOrderId ? '#f8fafc' : '#fff',
                      border: 'none',
                      borderBottom: '1px solid #f1f5f9',
                      padding: '1rem',
                      cursor: 'pointer',
                      borderLeft: order.orderId === selectedOrderId ? '4px solid #6b3fa0' : '4px solid transparent'
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontWeight: 700 }}>{order.orderId}</span>
                      <span style={{ ...statusStyles[order.orderStatus] || statusStyles.new, borderRadius: '999px', padding: '0.2rem 0.6rem', fontSize: '0.75rem', fontWeight: 700 }}>
                        {formatStatusLabel(order.orderStatus)}
                      </span>
                    </div>

                    <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '0.8rem', color: '#475569', fontSize: '0.8rem' }}>
                      <span>{formatDate(order.timestamp || order.createdAt)}</span>
                      <strong>₹{Number(order.pricing?.grandTotal || 0).toFixed(2)}</strong>
                    </div>

                    {isAdmin && order.customer?.location && (
                      <div style={{ marginTop: '0.4rem', fontSize: '0.75rem', color: '#16a34a', fontWeight: 600 }}>
                        📍 {order.customer.location.distanceKm} km away
                      </div>
                    )}
                  </button>
                ))
              )}
            </div>
          </div>

          {/* Order Details */}
          <div style={{ background: '#fff', borderRadius: '18px', border: '1px solid #e2e8f0', padding: '1.25rem', boxShadow: '0 10px 22px rgba(15,23,42,0.04)' }}>
            {selectedOrder ? (
              <>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.8rem', marginBottom: '1.2rem', flexWrap: 'wrap' }}>
                  <div>
                    <div style={{ color: '#64748b', fontSize: '0.76rem', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Order Details</div>
                    <h2 style={{ margin: '0.2rem 0 0', fontSize: '1.7rem' }}>{selectedOrder.orderId}</h2>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                    <label style={{ fontSize: '0.82rem', fontWeight: 700, color: '#475569' }}>Status:</label>
                    {isAdmin ? (
                      <select
                        value={selectedOrder.orderStatus || 'new'}
                        onChange={(e) => handleStatusChange(selectedOrder.orderId, e.target.value)}
                        style={{
                          padding: '0.4rem 0.75rem',
                          borderRadius: '10px',
                          border: '1px solid #cbd5e1',
                          background: '#fff',
                          fontWeight: 700,
                          fontSize: '0.85rem',
                          cursor: 'pointer'
                        }}
                      >
                        {STATUS_OPTIONS.map(s => (
                          <option key={s} value={s}>{formatStatusLabel(s)}</option>
                        ))}
                      </select>
                    ) : (
                      <span
                        style={{
                          ...statusStyles[selectedOrder.orderStatus] || statusStyles.new,
                          borderRadius: '999px',
                          padding: '0.35rem 0.85rem',
                          fontSize: '0.85rem',
                          fontWeight: 700
                        }}
                      >
                        {formatStatusLabel(selectedOrder.orderStatus)}
                      </span>
                    )}
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem', marginBottom: '1.5rem' }}>
                  <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '12px', padding: '0.9rem' }}>
                    <div style={{ color: '#64748b', fontSize: '0.76rem', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Customer</div>
                    <div style={{ fontWeight: 700, marginTop: '0.4rem' }}>{selectedOrder.customer?.name || 'Unknown'}</div>
                    <div style={{ color: '#475569', marginTop: '0.2rem' }}>{selectedOrder.customer?.email || selectedOrder.customer?.contact || 'No contact'}</div>
                  </div>

                  <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '12px', padding: '0.9rem' }}>
                    <div style={{ color: '#64748b', fontSize: '0.76rem', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Total</div>
                    <div style={{ fontWeight: 800, fontSize: '1.6rem', marginTop: '0.35rem' }}>₹{Number(selectedOrder.pricing?.grandTotal || 0).toFixed(2)}</div>
                  </div>

                  <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '12px', padding: '0.9rem' }}>
                    <div style={{ color: '#64748b', fontSize: '0.76rem', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Placed</div>
                    <div style={{ marginTop: '0.45rem', color: '#334155' }}>{formatDate(selectedOrder.timestamp || selectedOrder.createdAt || selectedOrder.updatedAt)}</div>
                  </div>

                  {selectedOrder.customer?.location && (
                    <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: '12px', padding: '0.9rem' }}>
                      <div style={{ color: '#166534', fontSize: '0.76rem', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 700 }}>
                        📍 Verified Distance
                      </div>
                      <div style={{ fontWeight: 800, fontSize: '1.3rem', color: '#166534', marginTop: '0.35rem' }}>
                        {selectedOrder.customer.location.distanceKm} km away
                      </div>
                      <div style={{ color: '#16a34a', fontSize: '0.74rem', marginTop: '0.2rem' }}>
                        Within delivery zone
                      </div>
                    </div>
                  )}
                </div>

                <div style={{ marginBottom: '1.2rem' }}>
                  <div style={{ fontWeight: 700, marginBottom: '0.5rem' }}>Delivery Address</div>
                  <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '12px', padding: '0.9rem', color: '#334155' }}>
                    {selectedOrder.customer?.deliveryAddress || 'No address provided'}
                  </div>
                </div>

                <div style={{ marginBottom: '1.2rem' }}>
                  <div style={{ fontWeight: 700, marginBottom: '0.5rem' }}>Order Items</div>
                  <div style={{ border: '1px solid #e2e8f0', borderRadius: '12px', overflow: 'hidden' }}>
                    {selectedOrder.items?.map(item => (
                      <div key={`${selectedOrder.orderId}-${item.productId}`} style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', padding: '0.9rem 1rem', borderBottom: '1px solid #edf2f7' }}>
                        <div>
                          <div style={{ fontWeight: 700 }}>{item.name}</div>
                          <div style={{ color: '#64748b', fontSize: '0.8rem' }}>{item.quantity} x ₹{Number(item.unitPrice || 0).toFixed(2)}</div>
                        </div>
                        <div style={{ fontWeight: 700 }}>₹{Number(item.itemTotal || 0).toFixed(2)}</div>
                      </div>
                    ))}
                  </div>
                </div>

                <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '12px', padding: '0.9rem' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.4rem' }}>
                    <span>Subtotal</span>
                    <strong>₹{Number(selectedOrder.pricing?.subtotal || 0).toFixed(2)}</strong>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.4rem' }}>
                    <span>Tax</span>
                    <strong>₹{Number(selectedOrder.pricing?.tax || 0).toFixed(2)}</strong>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '1.1rem', fontWeight: 800 }}>
                    <span>Total</span>
                    <span>₹{Number(selectedOrder.pricing?.grandTotal || 0).toFixed(2)}</span>
                  </div>
                </div>
              </>
            ) : (
              <div style={{ textAlign: 'center', padding: '4rem 1rem', color: '#64748b' }}>
                Select an order from the list to view full details.
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Admin Shop Location & Boundary Setup Modal */}
      {isAdmin && isLocationModalOpen && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(15, 23, 42, 0.65)',
            backdropFilter: 'blur(4px)',
            display: 'grid',
            placeItems: 'center',
            zIndex: 9999,
            padding: '1.5rem'
          }}
          onClick={(e) => {
            if (e.target === e.currentTarget) setIsLocationModalOpen(false);
          }}
        >
          <div
            style={{
              background: '#fff',
              borderRadius: '20px',
              maxWidth: '520px',
              width: '100%',
              padding: '2rem',
              boxShadow: '0 25px 50px -12px rgba(0,0,0,0.25)',
              position: 'relative'
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1.2rem' }}>
              <div>
                <div style={{ fontSize: '0.78rem', letterSpacing: '0.1em', textTransform: 'uppercase', color: '#6b3fa0', fontWeight: 800 }}>
                  Admin Configuration
                </div>
                <h2 style={{ margin: '0.2rem 0 0', fontSize: '1.45rem' }}>📍 Shop Location & Boundary</h2>
              </div>
              <button
                type="button"
                onClick={() => setIsLocationModalOpen(false)}
                style={{ background: 'none', border: 'none', fontSize: '1.5rem', cursor: 'pointer', color: '#64748b', padding: '0.2rem' }}
              >
                ✕
              </button>
            </div>

            <p style={{ color: '#64748b', fontSize: '0.88rem', margin: '0 0 1.5rem', lineHeight: 1.5 }}>
              Configure the shop's physical coordinates and maximum delivery radius. Customers beyond this boundary will be blocked from checking out on the storefront.
            </p>

            <form onSubmit={handleSaveShopLocation}>
              <div style={{ marginBottom: '1rem' }}>
                <label style={{ display: 'block', fontWeight: 700, fontSize: '0.85rem', marginBottom: '0.35rem', color: '#334155' }}>
                  Shop Address / Location Label
                </label>
                <input
                  type="text"
                  placeholder="e.g. Shop #12, Market Square, New Delhi"
                  value={shopSettings.address}
                  onChange={(e) => setShopSettings(prev => ({ ...prev, address: e.target.value }))}
                  style={{
                    width: '100%',
                    padding: '0.7rem 0.9rem',
                    border: '1px solid #cbd5e1',
                    borderRadius: '10px',
                    fontSize: '0.95rem',
                    boxSizing: 'border-box'
                  }}
                />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.8rem', marginBottom: '1rem' }}>
                <div>
                  <label style={{ display: 'block', fontWeight: 700, fontSize: '0.85rem', marginBottom: '0.35rem', color: '#334155' }}>
                    Shop Latitude
                  </label>
                  <input
                    type="number"
                    step="any"
                    required
                    value={shopSettings.lat}
                    onChange={(e) => setShopSettings(prev => ({ ...prev, lat: e.target.value }))}
                    style={{
                      width: '100%',
                      padding: '0.7rem 0.9rem',
                      border: '1px solid #cbd5e1',
                      borderRadius: '10px',
                      fontSize: '0.95rem',
                      boxSizing: 'border-box'
                    }}
                  />
                </div>

                <div>
                  <label style={{ display: 'block', fontWeight: 700, fontSize: '0.85rem', marginBottom: '0.35rem', color: '#334155' }}>
                    Shop Longitude
                  </label>
                  <input
                    type="number"
                    step="any"
                    required
                    value={shopSettings.lng}
                    onChange={(e) => setShopSettings(prev => ({ ...prev, lng: e.target.value }))}
                    style={{
                      width: '100%',
                      padding: '0.7rem 0.9rem',
                      border: '1px solid #cbd5e1',
                      borderRadius: '10px',
                      fontSize: '0.95rem',
                      boxSizing: 'border-box'
                    }}
                  />
                </div>
              </div>

              <div style={{ marginBottom: '1.2rem' }}>
                <label style={{ display: 'block', fontWeight: 700, fontSize: '0.85rem', marginBottom: '0.35rem', color: '#334155' }}>
                  Delivery Radius (Kilometers)
                </label>
                <input
                  type="number"
                  min="0.1"
                  step="0.5"
                  required
                  value={shopSettings.radiusKm}
                  onChange={(e) => setShopSettings(prev => ({ ...prev, radiusKm: e.target.value }))}
                  style={{
                    width: '100%',
                    padding: '0.7rem 0.9rem',
                    border: '1px solid #cbd5e1',
                    borderRadius: '10px',
                    fontSize: '0.95rem',
                    boxSizing: 'border-box'
                  }}
                />
                <span style={{ fontSize: '0.76rem', color: '#64748b', display: 'block', marginTop: '0.25rem' }}>
                  Orders from customer locations farther than {shopSettings.radiusKm || 0} km will be blocked.
                </span>
              </div>

              <div style={{ display: 'flex', gap: '0.75rem', marginBottom: '1.2rem' }}>
                <button
                  type="button"
                  onClick={handleDetectGPS}
                  style={{
                    background: '#f1f5f9',
                    color: '#0f172a',
                    border: '1px solid #cbd5e1',
                    borderRadius: '10px',
                    padding: '0.65rem 1rem',
                    fontSize: '0.85rem',
                    fontWeight: 700,
                    cursor: 'pointer',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '0.4rem',
                    width: '100%',
                    justifyContent: 'center'
                  }}
                >
                  <span>📡</span>
                  <span>Use Device GPS Coords</span>
                </button>
              </div>

              {locationStatusMsg.text && (
                <div
                  style={{
                    padding: '0.7rem 0.9rem',
                    borderRadius: '10px',
                    fontSize: '0.85rem',
                    fontWeight: 600,
                    marginBottom: '1rem',
                    background: locationStatusMsg.type === 'error' ? '#fee2e2' : locationStatusMsg.type === 'success' ? '#dcfce7' : '#e0f2fe',
                    color: locationStatusMsg.type === 'error' ? '#991b1b' : locationStatusMsg.type === 'success' ? '#166534' : '#075985'
                  }}
                >
                  {locationStatusMsg.text}
                </div>
              )}

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem' }}>
                <button
                  type="button"
                  onClick={() => setIsLocationModalOpen(false)}
                  style={{
                    background: '#fff',
                    color: '#475569',
                    border: '1px solid #cbd5e1',
                    borderRadius: '10px',
                    padding: '0.7rem 1.2rem',
                    fontWeight: 700,
                    cursor: 'pointer'
                  }}
                >
                  Cancel
                </button>

                <button
                  type="submit"
                  disabled={isSavingLocation}
                  style={{
                    background: '#6b3fa0',
                    color: '#fff',
                    border: 'none',
                    borderRadius: '10px',
                    padding: '0.7rem 1.4rem',
                    fontWeight: 700,
                    cursor: isSavingLocation ? 'not-allowed' : 'pointer',
                    opacity: isSavingLocation ? 0.7 : 1,
                    boxShadow: '0 4px 12px rgba(107, 63, 160, 0.3)'
                  }}
                >
                  {isSavingLocation ? 'Saving...' : '💾 Save Settings'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
