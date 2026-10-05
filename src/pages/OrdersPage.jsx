import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { onAuthStateChanged } from 'firebase/auth';
import { collection, onSnapshot, query, orderBy, updateDoc, doc, serverTimestamp } from 'firebase/firestore';
import { auth, db } from '../firebase/config';

const ADMIN_EMAIL = 'admin@shop.com';

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
  const [isAuthReady, setIsAuthReady] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [ordersError, setOrdersError] = useState('');

  useEffect(() => {
    let unsubscribeOrders = null;
    const unsubscribeAuth = onAuthStateChanged(auth, (user) => {
      if (unsubscribeOrders) {
        unsubscribeOrders();
        unsubscribeOrders = null;
      }

      const authorized = user?.email?.toLowerCase() === ADMIN_EMAIL;
      setIsAuthReady(true);
      setIsAdmin(authorized);
      setOrdersError('');

      if (!authorized) {
        setOrders([]);
        setSelectedOrderId(null);
        return;
      }

      const ordersQuery = query(collection(db, 'orders'), orderBy('createdAt', 'desc'));
      unsubscribeOrders = onSnapshot(ordersQuery, (snapshot) => {
        const list = snapshot.docs.map(docSnap => ({
          id: docSnap.id,
          ...docSnap.data()
        }));
        setOrders(list);
        setSelectedOrderId(current => current || list[0]?.orderId || null);
      }, (error) => {
        console.error('Unable to load orders:', error);
        setOrdersError(error.code || 'unknown Firestore error');
      });
    });

    return () => {
      unsubscribeAuth();
      if (unsubscribeOrders) unsubscribeOrders();
    };
  }, []);

  const selectedOrder = useMemo(
    () => orders.find(order => order.orderId === selectedOrderId) || null,
    [orders, selectedOrderId]
  );

  const handleStatusChange = async (orderId, nextStatus) => {
    const targetOrder = orders.find(order => order.orderId === orderId);
    if (!targetOrder) return;

    await updateDoc(doc(db, 'orders', targetOrder.id), {
      orderStatus: nextStatus,
      updatedAt: serverTimestamp()
    });
  };

  if (!isAuthReady || !isAdmin || ordersError) {
    const message = !isAuthReady
      ? 'Checking admin access...'
      : !isAdmin
        ? 'Sign in with the authorized admin account to view orders.'
        : `Unable to load orders (${ordersError}). Check the deployed Firestore rules.`;

    return (
      <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', background: '#f8fafc', color: '#0f172a', padding: '2rem' }}>
        <div>
          <h1>Orders</h1>
          <p>{message}</p>
          <Link to="/">Back to storefront</Link>
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
              Admin Panel
            </div>
            <h1 style={{ margin: '0.35rem 0 0', fontSize: '2.2rem' }}>Orders</h1>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
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
              ← Dashboard
            </Link>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1.1fr 1.6fr', gap: '1.25rem' }}>
          <div style={{ background: '#fff', borderRadius: '18px', border: '1px solid #e2e8f0', overflow: 'hidden', boxShadow: '0 10px 22px rgba(15,23,42,0.04)' }}>
            <div style={{ padding: '1rem 1rem 0.5rem', borderBottom: '1px solid #eef2f7', fontWeight: 700, fontSize: '1rem' }}>
              Order Queue
            </div>

            <div style={{ maxHeight: '750px', overflowY: 'auto' }}>
              {orders.length === 0 ? (
                <div style={{ padding: '2rem 1rem', textAlign: 'center', color: '#64748b' }}>
                  No orders yet. Orders placed through checkout will appear here.
                </div>
              ) : (
                orders.map(order => (
                  <button
                    key={order.orderId}
                    onClick={() => setSelectedOrderId(order.orderId)}
                    style={{
                      width: '100%',
                      textAlign: 'left',
                      border: 'none',
                      borderBottom: '1px solid #edf2f7',
                      background: selectedOrderId === order.orderId ? '#f8fafc' : '#fff',
                      cursor: 'pointer',
                      padding: '1rem',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem', alignItems: 'center' }}>
                      <div>
                        <div style={{ fontWeight: 800, fontSize: '0.98rem' }}>{order.customer?.name || 'Customer'}</div>
                        <div style={{ color: '#64748b', fontSize: '0.78rem', marginTop: '0.2rem' }}>{order.customer?.contact || 'No contact'}</div>
                      </div>

                      <span
                        style={{
                          ...statusStyles[order.orderStatus] || statusStyles.new,
                          borderRadius: '999px',
                          padding: '0.35rem 0.65rem',
                          fontSize: '0.72rem',
                          fontWeight: 700,
                          textTransform: 'capitalize'
                        }}
                      >
                        {formatStatusLabel(order.orderStatus)}
                      </span>
                    </div>

                    <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '0.8rem', color: '#475569', fontSize: '0.8rem' }}>
                      <span>{order.orderId}</span>
                      <strong>₹{Number(order.pricing?.grandTotal || 0).toFixed(2)}</strong>
                    </div>
                  </button>
                ))
              )}
            </div>
          </div>

          <div style={{ background: '#fff', borderRadius: '18px', border: '1px solid #e2e8f0', padding: '1.25rem', boxShadow: '0 10px 22px rgba(15,23,42,0.04)' }}>
            {selectedOrder ? (
              <>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.8rem', marginBottom: '1.2rem' }}>
                  <div>
                    <div style={{ color: '#64748b', fontSize: '0.76rem', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Order Details</div>
                    <h2 style={{ margin: '0.2rem 0 0', fontSize: '1.7rem' }}>{selectedOrder.orderId}</h2>
                  </div>

                  <div style={{ ...statusStyles[selectedOrder.orderStatus] || statusStyles.new, borderRadius: '999px', padding: '0.45rem 0.8rem', fontSize: '0.8rem', fontWeight: 800 }}>
                    {formatStatusLabel(selectedOrder.orderStatus)}
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '1rem', marginBottom: '1.5rem' }}>
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
                Select an order to see details.
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
