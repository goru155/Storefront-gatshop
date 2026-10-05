import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { auth, db, INITIAL_PRODUCTS, getCategoryFallbackImage } from '../firebase/config';
import { collection, onSnapshot, addDoc, serverTimestamp } from 'firebase/firestore';

const CartContext = createContext();

const CART_STORAGE_KEY = 'shop_storefront_cart';
const CUSTOMER_STORAGE_KEY = 'shop_storefront_customer';
const TIMER_STORAGE_KEY = 'shop_cart_expires_at';
const LOCAL_ORDERS_KEY = 'shop_session_test_orders';
const TWENTY_MINUTES_MS = 20 * 60 * 1000;

const clearSessionMemory = () => {
  try {
    sessionStorage.removeItem(CART_STORAGE_KEY);
    sessionStorage.removeItem(CUSTOMER_STORAGE_KEY);
    sessionStorage.removeItem(TIMER_STORAGE_KEY);
    sessionStorage.removeItem(LOCAL_ORDERS_KEY);
  } catch (err) {
    console.error('Failed to clear session memory:', err);
  }
};

export function CartProvider({ children }) {
  // 1. Inventory State with Real-time synchronization from Firestore
  const [products, setProducts] = useState(INITIAL_PRODUCTS);
  const pendingReservations = {};
  const [adminCategories, setAdminCategories] = useState([]);
  const [isDbConnected, setIsDbConnected] = useState(false);

  // 2. Cart Items State from sessionStorage
  const [cart, setCart] = useState(() => {
    try {
      const saved = sessionStorage.getItem(CART_STORAGE_KEY);
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });

  // 3. Verified Customer State from sessionStorage
  const [verifiedCustomer, setVerifiedCustomer] = useState(() => {
    try {
      const saved = sessionStorage.getItem(CUSTOMER_STORAGE_KEY);
      return saved ? JSON.parse(saved) : null;
    } catch {
      return null;
    }
  });

  // 4. Cart Expiration Timer State (20 Minutes Max)
  const [expiresAt, setExpiresAt] = useState(() => {
    try {
      const saved = sessionStorage.getItem(TIMER_STORAGE_KEY);
      return saved ? parseInt(saved, 10) : null;
    } catch {
      return null;
    }
  });

  const [timeLeft, setTimeLeft] = useState(0);
  const [toasts, setToasts] = useState([]);
  const [isCartOpen, setIsCartOpen] = useState(false);
  const [isOtpModalOpen, setIsOtpModalOpen] = useState(false);
  const [lastOrderSuccess, setLastOrderSuccess] = useState(null);

  // Toast notification helper
  const showToast = useCallback((message, type = 'info') => {
    const id = Date.now() + Math.random();
    setToasts(prev => [...prev, { id, message, type }]);
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
    }, 4000);
  }, []);

  const getAvailableProductStock = useCallback((productId) => {
    const product = products.find(item => item.id === productId);
    const baseStock = Number(product?.stock ?? 0);
    const pendingQty = Number(pendingReservations[productId] || 0);
    return Math.max(0, baseStock - pendingQty);
  }, [products, pendingReservations]);

  // Listen to Firestore real-time updates for inventory collection
  useEffect(() => {
    let unsubscribeInv = null;
    let unsubscribeCats = null;

    try {
      const invRef = collection(db, 'inventory');
      unsubscribeInv = onSnapshot(invRef, (snapshot) => {
        if (!snapshot.empty) {
          const remoteProducts = snapshot.docs
            .map(docSnap => {
              const data = docSnap.data();
              const category = data.category || 'General';
              return {
                id: docSnap.id,
                name: data.name || 'Unnamed Item',
                category: category,
                price: Number(data.price) || 0,
                stock: data.stock !== undefined ? Number(data.stock) : 10,
                isVisible: data.isVisible !== false, // defaults to true unless explicitly false in admin
                rating: data.rating || 4.8,
                reviewsCount: data.reviewsCount || 10,
                weight: data.weight || '500gm',
                image: data.image || getCategoryFallbackImage(category),
                description: data.description || `${data.name || 'Product'} fresh in inventory.`
              };
            })
            .filter(p => p.isVisible !== false); // Correlate with Admin Show/Hide Toggle

          setProducts(remoteProducts);
          setIsDbConnected(true);
        } else {
          setProducts(INITIAL_PRODUCTS);
        }
      }, (err) => {
        setProducts(INITIAL_PRODUCTS);
      });

      // Listen to Firestore categories collection (from Admin category manager)
      const catsRef = collection(db, 'categories');
      unsubscribeCats = onSnapshot(catsRef, (snapshot) => {
        if (!snapshot.empty) {
          const cats = snapshot.docs.map(docSnap => docSnap.data().name).filter(Boolean);
          setAdminCategories(cats);
        }
      }, (err) => {});
    } catch (e) {
      setProducts(INITIAL_PRODUCTS);
    }

    return () => {
      if (unsubscribeInv) unsubscribeInv();
      if (unsubscribeCats) unsubscribeCats();
    };
  }, []);

  // Sync Cart to sessionStorage
  useEffect(() => {
    try {
      sessionStorage.setItem(CART_STORAGE_KEY, JSON.stringify(cart));
    } catch (err) {
      console.error("Failed to save cart to sessionStorage:", err);
    }
  }, [cart]);

  useEffect(() => {
    const handleBeforeUnload = () => {
      clearSessionMemory();
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, []);

  // Sync Verified Customer to sessionStorage
  useEffect(() => {
    try {
      if (verifiedCustomer) {
        sessionStorage.setItem(CUSTOMER_STORAGE_KEY, JSON.stringify(verifiedCustomer));
      } else {
        sessionStorage.removeItem(CUSTOMER_STORAGE_KEY);
      }
    } catch (err) {
      console.error("Failed to save customer to sessionStorage:", err);
    }
  }, [verifiedCustomer]);

  // Sync ExpiresAt to sessionStorage
  useEffect(() => {
    try {
      if (expiresAt) {
        sessionStorage.setItem(TIMER_STORAGE_KEY, expiresAt.toString());
      } else {
        sessionStorage.removeItem(TIMER_STORAGE_KEY);
      }
    } catch (err) {
      console.error("Failed to save timer to sessionStorage:", err);
    }
  }, [expiresAt]);

  // 20-Minute Countdown Interval Handler
  useEffect(() => {
    if (!expiresAt || cart.length === 0) {
      setTimeLeft(0);
      return;
    }

    const interval = setInterval(() => {
      const now = Date.now();
      const remainingMs = expiresAt - now;

      if (remainingMs <= 0) {
        setCart([]);
        setExpiresAt(null);
        setTimeLeft(0);
        sessionStorage.removeItem(CART_STORAGE_KEY);
        sessionStorage.removeItem(TIMER_STORAGE_KEY);
        showToast("⏰ Your 20-minute cart reservation has expired. Cart items have been cleared.", "warning");
        clearInterval(interval);
      } else {
        setTimeLeft(Math.floor(remainingMs / 1000));
      }
    }, 1000);

    const now = Date.now();
    const remainingMs = expiresAt - now;
    if (remainingMs <= 0) {
      setCart([]);
      setExpiresAt(null);
      setTimeLeft(0);
    } else {
      setTimeLeft(Math.floor(remainingMs / 1000));
    }

    return () => clearInterval(interval);
  }, [expiresAt, cart.length, showToast]);

  // Add To Cart with Stock limit and Timer Start
  const addToCart = (product, quantity = 1) => {
    const currentProduct = products.find(p => p.id === product.id) || product;
    const availableStock = getAvailableProductStock(currentProduct.id);

    if (availableStock <= 0) {
      showToast(`Sorry, "${product.name}" is currently reserved for another customer and is unavailable right now.`, 'error');
      return;
    }

    setCart(prev => {
      const existing = prev.find(item => item.id === product.id);
      const currentQtyInCart = existing ? existing.quantity : 0;
      const targetQty = currentQtyInCart + quantity;

      if (targetQty > availableStock) {
        showToast(`Stock limit reached! Only ${availableStock} units available for ${product.name}.`, 'warning');
        return prev;
      }

      if (!expiresAt || prev.length === 0) {
        const newExpiry = Date.now() + TWENTY_MINUTES_MS;
        setExpiresAt(newExpiry);
      }

      showToast(`Added ${quantity}x ${product.name} to cart!`, 'success');

      if (existing) {
        return prev.map(item =>
          item.id === product.id ? { ...item, quantity: targetQty } : item
        );
      } else {
        return [...prev, { ...product, quantity }];
      }
    });
  };

  // Update Item Quantity
  const updateQuantity = (productId, delta) => {
    const currentProduct = products.find(p => p.id === productId);
    const availableStock = currentProduct ? getAvailableProductStock(currentProduct.id) : 10;

    setCart(prev => {
      return prev.map(item => {
        if (item.id === productId) {
          const newQty = item.quantity + delta;
          if (newQty > availableStock) {
            showToast(`Cannot add more. Only ${availableStock} left in stock!`, 'warning');
            return item;
          }
          if (newQty <= 0) {
            return null;
          }
          return { ...item, quantity: newQty };
        }
        return item;
      }).filter(Boolean);
    });
  };

  // Remove Item
  const removeFromCart = (productId) => {
    setCart(prev => {
      const filtered = prev.filter(item => item.id !== productId);
      if (filtered.length === 0) {
        setExpiresAt(null);
      }
      return filtered;
    });
    showToast("Item removed from cart.", "info");
  };

  // Clear Cart
  const clearCart = () => {
    setCart([]);
    setExpiresAt(null);
    setTimeLeft(0);
    sessionStorage.removeItem(CART_STORAGE_KEY);
    sessionStorage.removeItem(TIMER_STORAGE_KEY);
  };

  // Format Time Left into MM:SS
  const formatTimeLeft = () => {
    if (timeLeft <= 0) return "00:00";
    const minutes = Math.floor(timeLeft / 60);
    const seconds = timeLeft % 60;
    return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  };

  // Generate and download a proper invoice PDF for the placed order
  const downloadOrderBill = async (orderData) => {
    try {
      if (!window.jspdf?.jsPDF) {
        await new Promise((resolve, reject) => {
          const script = document.createElement('script');
          script.src = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js';
          script.onload = resolve;
          script.onerror = () => reject(new Error('Failed to load jsPDF'));
          document.head.appendChild(script);
        });
      }

      const { jsPDF } = window.jspdf;
      const doc = new jsPDF();
      const pageWidth = doc.internal.pageSize.getWidth();
      const pageHeight = doc.internal.pageSize.getHeight();
      const margin = 15;
      let y = 20;

      doc.setFillColor(43, 104, 126);
      doc.rect(0, 0, pageWidth, 30, 'F');

      doc.setTextColor(255, 255, 255);
      doc.setFontSize(20);
      doc.text('INVOICE', margin, 20);
      doc.setFontSize(11);
      doc.text('Fresh Basket', pageWidth - margin, 15, { align: 'right' });
      doc.text('Groceries & Delivery', pageWidth - margin, 21, { align: 'right' });
      doc.text(`Order #${orderData.orderId}`, pageWidth - margin, 27, { align: 'right' });

      doc.setTextColor(0, 0, 0);
      doc.setFontSize(11);
      y = 42;
      doc.text(`Bill To: ${orderData.customer?.name || 'Customer'}`, margin, y);
      y += 7;
      doc.text(`Phone: ${orderData.customer?.contact || 'N/A'}`, margin, y);
      y += 7;
      doc.text(`Address: ${String(orderData.customer?.deliveryAddress || 'N/A')}`, margin, y);
      y += 7;
      doc.text(`Date: ${new Date(orderData.timestamp || orderData.createdAt || Date.now()).toLocaleString()}`, margin, y);
      y += 16;

      doc.setFillColor(232, 240, 248);
      doc.rect(margin, y - 4, pageWidth - (margin * 2), 9, 'F');
      doc.setTextColor(15, 23, 42);
      doc.text('Item', margin + 2, y + 1);
      doc.text('Qty', 120, y + 1);
      doc.text('Rate', 145, y + 1);
      doc.text('Amount', 170, y + 1);
      y += 12;

      (orderData.items || []).forEach((item) => {
        if (y > 240) {
          doc.addPage();
          y = 22;
        }

        const unitPrice = Number(item.unitPrice || 0);
        const lineTotal = Number(item.itemTotal || (unitPrice * (item.quantity || 0)) || 0);

        doc.setTextColor(15, 23, 42);
        doc.setFontSize(10);
        doc.text(String(item.name || 'Product').slice(0, 35), margin, y);
        doc.text(String(item.quantity || 0), 122, y);
        doc.text(`₹${unitPrice.toFixed(2)}`, 145, y);
        doc.text(`₹${lineTotal.toFixed(2)}`, 170, y);
        y += 8;
      });

      y += 8;
      doc.line(margin, y, pageWidth - margin, y);
      y += 10;

      doc.setFontSize(11);
      doc.text('Subtotal', 120, y);
      doc.text(`₹${Number(orderData.pricing?.subtotal || 0).toFixed(2)}`, 170, y);
      y += 8;
      doc.text('Tax', 120, y);
      doc.text(`₹${Number(orderData.pricing?.tax || 0).toFixed(2)}`, 170, y);
      y += 10;
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(13);
      doc.text('Total', 120, y);
      doc.text(`₹${Number(orderData.pricing?.grandTotal || 0).toFixed(2)}`, 170, y);

      doc.setFillColor(43, 104, 126);
      doc.rect(0, pageHeight - 16, pageWidth, 16, 'F');
      doc.setTextColor(255, 255, 255);
      doc.setFontSize(10);
      doc.text('Thank you for shopping with Fresh Basket!', pageWidth / 2, pageHeight - 7, { align: 'center' });

      doc.save(`${orderData.orderId}_bill.pdf`);
    } catch (err) {
      console.error('Failed to generate order invoice:', err);
      throw err;
    }
  };

  // Place Order (Testing Mode: creates a downloadable invoice bill for each order)
  const placeOrder = async (customerData) => {
    if (cart.length === 0) {
      showToast("Cart is empty!", "error");
      return false;
    }

    try {
      // Check stock availability in real-time before placing the order.
      const stockErrors = [];
      cart.forEach(cartItem => {
        const liveProd = products.find(p => p.id === cartItem.id);
        const liveStock = liveProd ? getAvailableProductStock(liveProd.id) : 0;

        if (!liveProd || liveStock <= 0) {
          stockErrors.push(`"${cartItem.name}" is no longer available in stock.`);
          return;
        }

        if (cartItem.quantity > liveStock) {
          stockErrors.push(`"${cartItem.name}" has only ${liveStock} remaining (you requested ${cartItem.quantity})`);
        }
      });

      if (stockErrors.length > 0) {
        clearCart();
        showToast(
          '⚠️ One or more products in your cart are no longer available. Your cart has been cleared and the order was not placed.',
          'error'
        );
        return false;
      }

      const subtotal = cart.reduce((sum, item) => sum + item.price * item.quantity, 0);
      const tax = Number((subtotal * 0.05).toFixed(2));
      const total = Number((subtotal + tax).toFixed(2));

      const contactValue = String(customerData.contact || '').trim();
      const emailValue = String(customerData.email || '').trim();
      const digitsOnly = String(contactValue || '').replace(/\D/g, '');
      const isTenDigitPhone = /^\d{10}$/.test(digitsOnly);

      const normalizedContact = isTenDigitPhone
        ? `+91${digitsOnly}`
        : (emailValue || contactValue || '');

      const orderPayload = {
        orderId: 'ORD-' + Math.floor(100000 + Math.random() * 900000),
        timestamp: new Date().toISOString(),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        orderStatus: 'new',
        source: 'test_mode',
        customer: {
          name: customerData.name,
          contact: normalizedContact,
          email: auth.currentUser?.email || customerData.email || '',
          deliveryAddress: customerData.address
        },
        items: cart.map(item => ({
          productId: item.id,
          name: item.name,
          category: item.category,
          unitPrice: item.price,
          quantity: item.quantity,
          weight: item.weight,
          itemTotal: Number((item.price * item.quantity).toFixed(2))
        })),
        pricing: {
          subtotal: Number(subtotal.toFixed(2)),
          tax: tax,
          deliveryFee: 0.00,
          grandTotal: total
        }
      };

      try {
        await addDoc(collection(db, 'orders'), {
          ...orderPayload,
          createdAt: orderPayload.createdAt,
          updatedAt: orderPayload.updatedAt,
        });
      } catch (firestoreError) {
        console.error('Failed to save order to Firestore:', firestoreError);
        if (firestoreError?.code === 'permission-denied') {
          showToast('Order not saved: Firestore denied this write. Check the deployed rules for signed-in customer order creation. Your cart is still available.', 'error');
        } else if (firestoreError?.code === 'unauthenticated') {
          showToast('Order not saved: please sign in again, then retry. Your cart is still available.', 'error');
        } else if (firestoreError?.code === 'unavailable') {
          showToast('Order not saved: Firestore is temporarily unavailable. Check your connection and retry; your cart is still available.', 'error');
        } else {
          showToast(`Order not saved (${firestoreError?.code || 'unknown Firestore error'}). Your cart is still available.`, 'error');
        }
        return false;
      }

      try {
        const existingOrders = JSON.parse(sessionStorage.getItem(LOCAL_ORDERS_KEY) || '[]');
        existingOrders.unshift(orderPayload);
        sessionStorage.setItem(LOCAL_ORDERS_KEY, JSON.stringify(existingOrders.slice(0, 50)));
      } catch (e) {}

      await downloadOrderBill(orderPayload);

      setLastOrderSuccess(orderPayload);
      clearCart();
      setIsCartOpen(false);
      showToast("🎉 Order placed! Your invoice bill has been downloaded.", "success");
      return true;
    } catch (err) {
      console.error("Order processing error:", err);
      showToast("Failed to process test order.", "error");
      return false;
    }
  };

  const totalCartCount = cart.reduce((sum, item) => sum + item.quantity, 0);
  const cartSubtotal = cart.reduce((sum, item) => sum + item.price * item.quantity, 0);
  const cartTax = Number((cartSubtotal * 0.05).toFixed(2));
  const cartTotal = Number((cartSubtotal + cartTax).toFixed(2));
  const isTimerWarning = timeLeft > 0 && timeLeft < 180;

  return (
    <CartContext.Provider value={{
      products,
      adminCategories,
      cart,
      addToCart,
      updateQuantity,
      removeFromCart,
      clearCart,
      totalCartCount,
      cartSubtotal,
      cartTax,
      cartTotal,
      timeLeft,
      formatTimeLeft,
      isTimerWarning,
      verifiedCustomer,
      setVerifiedCustomer,
      placeOrder,
      downloadOrderBill,
      isCartOpen,
      setIsCartOpen,
      isOtpModalOpen,
      setIsOtpModalOpen,
      lastOrderSuccess,
      setLastOrderSuccess,
      pendingReservations,
      toasts,
      showToast
    }}>
      {children}
    </CartContext.Provider>
  );
}

export function useCart() {
  const context = useContext(CartContext);
  if (!context) {
    throw new Error('useCart must be used within a CartProvider');
  }
  return context;
}
