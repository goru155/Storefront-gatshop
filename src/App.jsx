import React, { useState, useMemo, useRef, useEffect } from 'react';
import { Routes, Route, Link, NavLink } from 'react-router-dom';
import { collection, getDocs, query, where, doc, setDoc, serverTimestamp } from 'firebase/firestore';
import { createUserWithEmailAndPassword, sendEmailVerification, signInWithEmailAndPassword } from 'firebase/auth';
import { auth, db } from './firebase/config';

// LEGACY SMS AUTH - kept for future Firebase Phone Auth use only.
// import { RecaptchaVerifier, signInWithPhoneNumber } from 'firebase/auth';

import { useCart } from './context/CartContext';
import { getCategoryIcon } from './firebase/config';
import OrdersPage from './pages/OrdersPage';
import LoginModal from './components/LoginModal';
import SignUpModal from './components/SignUpModal';
import ProfileModal from './components/ProfileModal';
import AddressForm from './components/AddressForm';
import { getCurrentPosition, isWithinDeliveryArea, DELIVERY_RADIUS_KM } from './utils/geofence';
import { reverseGeocodeCoords, geocodeAddress, updateCustomerLocation } from './utils/mapboxGeocode';

const CUSTOMER_DRAFT_STORAGE_KEY = 'shop_storefront_customer_draft';

const readCustomerDraft = () => {
  try {
    return JSON.parse(localStorage.getItem(CUSTOMER_DRAFT_STORAGE_KEY) || '{}');
  } catch {
    return {};
  }
};

const StorefrontPage = () => {
  const {
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
    pendingReservations,
    shopSettings,
    toasts,
    showToast
  } = useCart();

  // Search & Filter State
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearchQuery, setDebouncedSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState('featured');
  const [isSearchPopupOpen, setIsSearchPopupOpen] = useState(false);

  // Debounce search query updates (300ms) to prevent per-keystroke re-filtering overhead
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearchQuery(searchQuery);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  // Dynamic Categories strictly derived from Database Products & Admin Categories
  const dynamicCategories = useMemo(() => {
    const categorySet = new Set();
    
    // Collect from loaded products
    products.forEach(p => {
      if (p.category) {
        categorySet.add(p.category.toLowerCase().trim());
      }
    });

    // Also collect from adminCategories if any
    (adminCategories || []).forEach(c => {
      if (c) {
        categorySet.add(c.toLowerCase().trim());
      }
    });

    const categoriesList = Array.from(categorySet).map(catKey => ({
      id: catKey,
      name: catKey.charAt(0).toUpperCase() + catKey.slice(1),
      icon: getCategoryIcon(catKey)
    }));

    return [{ id: 'all', name: 'All Products', icon: '✨' }, ...categoriesList];
  }, [products, adminCategories]);

  // LEGACY SMS AUTH CODE - kept for future Firebase Phone Auth implementation.
  // const DEFAULT_COUNTRY_CODE = '+91';
  // const recaptchaRef = useRef(null);
  // const confirmationResultRef = useRef(null);
  // const getDisplayPhone = (value = '') => String(value || '').replace(/^\+91/, '').replace(/\D/g, '').slice(0, 10);
  // const formatPhoneForDisplay = (value = '') => {
  //   const digits = getDisplayPhone(value);
  //   if (!digits) return DEFAULT_COUNTRY_CODE;
  //   return `${DEFAULT_COUNTRY_CODE}${digits}`;
  // };
  // const normalizePhoneNumber = (value = '') => {
  //   const digits = getDisplayPhone(value);
  //   if (!digits || digits.length !== 10) return '';
  //   return `${DEFAULT_COUNTRY_CODE}${digits}`;
  // };

  // OTP Modal State
  const [otpStep, setOtpStep] = useState(1);
  const [customerForm, setCustomerForm] = useState(() => {
    const draft = readCustomerDraft();
    return {
      name: draft.name || verifiedCustomer?.name || '',
      contact: draft.contact || verifiedCustomer?.contact || '',
      email: draft.email || verifiedCustomer?.email || '',
      password: '',
      address: draft.address || verifiedCustomer?.address || ''
    };
  });
  const [enteredOtp, setEnteredOtp] = useState(['', '', '', '', '', '']);
  const [isSubmittingOrder, setIsSubmittingOrder] = useState(false);
  const [isCheckingLocation, setIsCheckingLocation] = useState(false);
  const [customerLocation, setCustomerLocation] = useState(() => {
    try {
      const lock = JSON.parse(localStorage.getItem('shop_checkout_location_lock') || '{}');
      if (lock?.lockedUntil && Number(lock.lockedUntil) > Date.now()) {
        return lock;
      }
    } catch {}
    return null;
  });

  // 20-minute post-checkout location lock state
  const [locationLock, setLocationLock] = useState(() => {
    try {
      const raw = localStorage.getItem('shop_checkout_location_lock');
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (parsed?.lockedUntil && Number(parsed.lockedUntil) > Date.now()) {
        return parsed;
      }
    } catch {}
    return null;
  });

  const [lockTimeRemaining, setLockTimeRemaining] = useState(() => {
    try {
      const raw = localStorage.getItem('shop_checkout_location_lock');
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (parsed?.lockedUntil && Number(parsed.lockedUntil) > Date.now()) {
        const sec = Math.floor((parsed.lockedUntil - Date.now()) / 1000);
        const m = Math.floor(sec / 60);
        const s = sec % 60;
        return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
      }
    } catch {}
    return null;
  });

  const isLocationLocked = Boolean(locationLock && lockTimeRemaining);

  // Monitor 20-minute location lock countdown every second
  useEffect(() => {
    const timer = setInterval(() => {
      try {
        const raw = localStorage.getItem('shop_checkout_location_lock');
        if (!raw) {
          if (locationLock) setLocationLock(null);
          if (lockTimeRemaining) setLockTimeRemaining(null);
          return;
        }
        const parsed = JSON.parse(raw);
        const diffMs = (parsed?.lockedUntil ? Number(parsed.lockedUntil) : 0) - Date.now();
        if (diffMs > 0) {
          const totalSec = Math.floor(diffMs / 1000);
          const m = Math.floor(totalSec / 60);
          const s = totalSec % 60;
          setLockTimeRemaining(`${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`);
          if (!locationLock) setLocationLock(parsed);
        } else {
          localStorage.removeItem('shop_checkout_location_lock');
          setLocationLock(null);
          setLockTimeRemaining(null);
        }
      } catch {
        setLocationLock(null);
        setLockTimeRemaining(null);
      }
    }, 1000);

    return () => clearInterval(timer);
  }, [locationLock, lockTimeRemaining]);
  const [isProfileModalOpen, setIsProfileModalOpen] = useState(false);
  const [isLoginModalOpen, setIsLoginModalOpen] = useState(false);
  const [isSignUpModalOpen, setIsSignUpModalOpen] = useState(false);
  const explicitSignOutRef = useRef(false);
  const customerSyncRequestRef = useRef(0);

  useEffect(() => {
    const draft = {
      name: customerForm.name,
      contact: customerForm.contact,
      email: customerForm.email,
      address: customerForm.address
    };

    try {
      if (Object.values(draft).some(value => String(value || '').trim())) {
        localStorage.setItem(CUSTOMER_DRAFT_STORAGE_KEY, JSON.stringify(draft));
      } else {
        localStorage.removeItem(CUSTOMER_DRAFT_STORAGE_KEY);
      }
    } catch (error) {
      console.warn('Unable to save customer form draft:', error);
    }
  }, [customerForm.name, customerForm.contact, customerForm.email, customerForm.address]);

  const normalizeCustomerName = (name, email) => {
    const trimmedName = String(name || '').trim();
    const trimmedEmail = String(email || '').trim();

    if (trimmedName && trimmedName !== trimmedEmail && !trimmedName.includes('@')) {
      return trimmedName;
    }

    if (trimmedEmail) {
      const localPart = trimmedEmail.split('@')[0]?.trim();
      return localPart || 'Customer';
    }

    return trimmedName || 'Customer';
  };

  const syncCustomerNameFromEmail = async (email) => {
    const targetEmail = String(email || '').trim();
    const signedInEmail = String(auth.currentUser?.email || '').trim();
    if (!targetEmail || !signedInEmail || targetEmail.toLowerCase() !== signedInEmail.toLowerCase()) return;
    const requestId = ++customerSyncRequestRef.current;

    try {
      const customerSnap = await getDocs(query(
        collection(db, 'customers'),
        where('email', '==', signedInEmail)
      ));
      if (requestId !== customerSyncRequestRef.current || explicitSignOutRef.current) return;
      const match = customerSnap.docs.find(docSnap => {
        const data = docSnap.data() || {};
        const existingEmail = String(data.email || '').trim().toLowerCase();
        return existingEmail === signedInEmail.toLowerCase();
      });

      if (!match) return;

      const matchedData = match.data() || {};
      const resolvedName = normalizeCustomerName(matchedData.name, targetEmail);

      setCustomerForm(prev => {
        if (prev.name === resolvedName && prev.email === targetEmail) return prev;
        return { ...prev, name: resolvedName, email: targetEmail };
      });

      setVerifiedCustomer(prev => ({
        ...(prev || {}),
        id: match.id,
        name: resolvedName,
        email: targetEmail,
        contact: matchedData.contact || prev?.contact || targetEmail,
        address: matchedData.address || prev?.address || ''
      }));

      // Reuse one-time geocoded coordinates stored on customer document
      if (typeof matchedData.lat === 'number' && typeof matchedData.lng === 'number') {
        const dist = isWithinDeliveryArea(
          matchedData.lat,
          matchedData.lng,
          { lat: shopSettings?.lat, lng: shopSettings?.lng },
          shopSettings?.radiusKm || DELIVERY_RADIUS_KM
        ).distanceKm;
        const locPayload = {
          lat: matchedData.lat,
          lng: matchedData.lng,
          address: matchedData.address || '',
          distanceKm: dist,
          isFixated: true
        };
        setCustomerLocation(locPayload);
        try {
          localStorage.setItem('shop_fixed_signup_location', JSON.stringify(locPayload));
        } catch {}
      } else if (matchedData.address && matchedData.address.trim()) {
        // One-time geocode for legacy customer without coordinates, updating customer doc in-place
        try {
          const geoRes = await geocodeAddress(matchedData.address.trim());
          if (geoRes && typeof geoRes.lat === 'number' && typeof geoRes.lng === 'number') {
            const dist = isWithinDeliveryArea(
              geoRes.lat,
              geoRes.lng,
              { lat: shopSettings?.lat, lng: shopSettings?.lng },
              shopSettings?.radiusKm || DELIVERY_RADIUS_KM
            ).distanceKm;
            const updatedLoc = {
              lat: geoRes.lat,
              lng: geoRes.lng,
              address: geoRes.formatted || matchedData.address,
              distanceKm: dist,
              isFixated: true
            };
            setCustomerLocation(updatedLoc);
            try {
              localStorage.setItem('shop_fixed_signup_location', JSON.stringify(updatedLoc));
            } catch {}
            // Update existing customer document directly without creating new collections
            await updateCustomerLocation(match.id, {
              lat: geoRes.lat,
              lng: geoRes.lng,
              address: geoRes.formatted || matchedData.address
            });
          }
        } catch (geoErr) {
          console.warn('Could not auto-geocode customer address:', geoErr);
        }
      }
    } catch (error) {
      console.warn('Unable to sync customer name from email:', error);
    }
  };

  const currentUserName = auth.currentUser?.displayName || verifiedCustomer?.name || auth.currentUser?.email?.split('@')[0] || 'User';
  const isUserEmailVerified = !!auth.currentUser && auth.currentUser.emailVerified;
  const hasActiveProfile = Boolean(auth.currentUser || verifiedCustomer?.email);
  const isCurrentCustomerVerified = !!auth.currentUser && !!auth.currentUser.emailVerified && auth.currentUser.email === customerForm.email;

  const handleOpenLoginModal = () => {
    setIsOtpModalOpen(false);
    setIsProfileModalOpen(false);
    setIsSignUpModalOpen(false);
    setIsLoginModalOpen(true);
  };

  const handleCloseLoginModal = () => {
    setIsLoginModalOpen(false);
  };

  const handleOpenSignUpModal = () => {
    setIsOtpModalOpen(false);
    setIsProfileModalOpen(false);
    setIsLoginModalOpen(false);
    setIsSignUpModalOpen(true);
  };

  const handleCloseSignUpModal = () => {
    setIsSignUpModalOpen(false);
  };

  const handleProfileButtonClick = () => {
    if (hasActiveProfile) {
      setIsOtpModalOpen(false);
      setIsLoginModalOpen(false);
      setIsSignUpModalOpen(false);
      setIsProfileModalOpen(true);
      return;
    }

    handleOpenSignUpModal();
  };

  // Handle customer registration from SignUpModal (Name, Email, Password only - no delivery address)
  const handleSignUpSubmit = async ({ name, email, password }) => {
    try {
      let userCredential;
      try {
        userCredential = await createUserWithEmailAndPassword(auth, email, password);
      } catch (createErr) {
        if (createErr.code === 'auth/email-already-in-use') {
          // If already registered, attempt sign-in
          userCredential = await signInWithEmailAndPassword(auth, email, password);
        } else {
          throw createErr;
        }
      }

      const user = userCredential.user;
      await sendEmailVerification(user);

      // Save customer details into local state & draft (no address on signup)
      setCustomerForm(prev => ({
        ...prev,
        name,
        email,
        contact: email,
        password: '',
      }));

      // Persist customer record in Firestore (/customers/{uid}) without delivery address
      try {
        const customerDocRef = doc(db, 'customers', user.uid);
        await setDoc(customerDocRef, {
          name,
          email,
          contact: email,
          updatedAt: serverTimestamp()
        }, { merge: true });
      } catch (saveErr) {
        console.warn('Could not persist customer to Firestore:', saveErr);
      }

      setIsSignUpModalOpen(false);
      showToast('🎉 Account created! A verification link was sent to your email.', 'success');
    } catch (err) {
      console.error('Sign-up error:', err);
      let msg = 'Failed to create account.';
      if (err.code === 'auth/weak-password') msg = 'Password should be at least 6 characters.';
      if (err.code === 'auth/invalid-email') msg = 'Invalid email address.';
      if (err.code === 'auth/email-already-in-use') msg = 'This email is already in use. Try logging in.';
      showToast(msg, 'error');
    }
  };

  const handleCloseProfileModal = () => setIsProfileModalOpen(false);

  const handleSignOutProfile = async () => {
    explicitSignOutRef.current = true;
    customerSyncRequestRef.current += 1;

    try {
      await auth.signOut();
      setVerifiedCustomer(null);
      sessionStorage.removeItem('shop_storefront_customer');
      localStorage.removeItem(CUSTOMER_DRAFT_STORAGE_KEY);
      setCustomerForm({ name: '', email: '', contact: '', password: '', address: '' });
      setIsProfileModalOpen(false);
      showToast('Signed out successfully.', 'success');
    } catch (error) {
      explicitSignOutRef.current = false;
      console.error('Profile sign-out failed:', error);
      showToast('Unable to sign out right now.', 'error');
    }
  };

  useEffect(() => {
    const unsubscribe = auth.onAuthStateChanged((user) => {
      if (!user) {
        if (explicitSignOutRef.current) {
          customerSyncRequestRef.current += 1;
          setVerifiedCustomer(null);
          setCustomerForm({ name: '', email: '', contact: '', password: '', address: '' });
          return;
        }

        setCustomerForm(prev => ({
          ...prev,
          email: verifiedCustomer?.email || '',
          contact: verifiedCustomer?.contact || '',
          name: verifiedCustomer?.name || ''
        }));
        return;
      }

      explicitSignOutRef.current = false;
      const resolvedEmail = user.email || '';
      const fallbackName = user.displayName || resolvedEmail.split('@')[0] || 'Customer';

      setCustomerForm(prev => ({
        ...prev,
        email: resolvedEmail || prev.email || '',
        contact: prev.contact || resolvedEmail || '',
        name: prev.name || fallbackName || ''
      }));

      if (!verifiedCustomer || verifiedCustomer.email !== resolvedEmail) {
        setVerifiedCustomer({
          name: fallbackName,
          contact: resolvedEmail || '',
          email: resolvedEmail || '',
          address: ''
        });
      }

      if (resolvedEmail) {
        syncCustomerNameFromEmail(resolvedEmail);
      }
    });

    return () => unsubscribe();
  }, [setVerifiedCustomer, verifiedCustomer]);

  useEffect(() => {
    if (!customerForm.email) return;
    syncCustomerNameFromEmail(customerForm.email);
  }, [customerForm.email]);

  // Filtered & Sorted Products
  const filteredProducts = useMemo(() => {
    const q = debouncedSearchQuery.toLowerCase().trim();
    return products
      .filter(p => {
        const matchesCategory = selectedCategory === 'all' || 
          (p.category && p.category.toLowerCase().trim() === selectedCategory.toLowerCase().trim());
        
        if (!matchesCategory) return false;

        if (!q) return true;

        const nameMatch = p.name ? p.name.toLowerCase().includes(q) : false;
        const categoryMatch = p.category ? p.category.toLowerCase().includes(q) : false;
        const descMatch = p.description ? p.description.toLowerCase().includes(q) : false;
        const weightMatch = p.weight ? p.weight.toLowerCase().includes(q) : false;

        return nameMatch || categoryMatch || descMatch || weightMatch;
      })
      .sort((a, b) => {
        if (sortBy === 'price-low') return a.price - b.price;
        if (sortBy === 'price-high') return b.price - a.price;
        if (sortBy === 'rating') return (b.rating || 0) - (a.rating || 0);
        return 0;
      });
  }, [products, selectedCategory, debouncedSearchQuery, sortBy]);

  // Scroll to Products Section
  const scrollToProducts = () => {
    const el = document.getElementById('products-section');
    if (el) {
      el.scrollIntoView({ behavior: 'smooth' });
    }
  };

  const handleSearchSubmit = () => {
    setIsSearchPopupOpen(false);
    scrollToProducts();
  };

  // Trigger Checkout: Directly opens the checkout verification modal
  // If a location lock exists from checkout in the last 20 minutes, it remains locked
  const handleProceedToCheckout = () => {
    if (cart.length === 0) {
      showToast("Your cart is empty!", "error");
      return;
    }

    // Check if location is locked from a checkout in the last 20 mins
    try {
      const raw = localStorage.getItem('shop_checkout_location_lock');
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed?.lockedUntil && Number(parsed.lockedUntil) > Date.now()) {
          setLocationLock(parsed);
          setCustomerLocation(parsed);
          if (parsed.address) {
            setCustomerForm(prev => ({ ...prev, address: parsed.address }));
          }
        }
      }
    } catch {}

    setOtpStep(1);
    setEnteredOtp(['', '', '', '', '', '']);
    setIsCartOpen(false);
    setIsOtpModalOpen(true);
  };

  const handleCloseOtpModal = () => {
    setIsOtpModalOpen(false);
    setOtpStep(1);
    setEnteredOtp(['', '', '', '', '', '']);
    setIsSubmittingOrder(false);
    showToast("Verification paused. Your cart and timer are still active.", "info");
  };

  // Real Firebase email signup + email verification for checkout.
  const handleSendOtp = async (e) => {
    e.preventDefault();
    explicitSignOutRef.current = false;
    if (!customerForm.name || !customerForm.email || !customerForm.address || !customerForm.address.trim()) {
      showToast("Please fill in your name, email, and delivery address.", "warning");
      return;
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(customerForm.email)) {
      showToast("Please enter a valid email address.", "warning");
      return;
    }

    // Geofence radius validation for delivery location
    if (customerLocation?.lat && customerLocation?.lng && shopSettings?.lat && shopSettings?.lng) {
      const maxRadius = shopSettings?.radiusKm || DELIVERY_RADIUS_KM;
      const { allowed, distanceKm } = isWithinDeliveryArea(
        customerLocation.lat,
        customerLocation.lng,
        { lat: shopSettings.lat, lng: shopSettings.lng },
        maxRadius
      );
      if (!allowed) {
        showToast(
          `🛑 Cannot deliver: address is ${distanceKm.toFixed(1)} km away (outside the ${maxRadius} km delivery zone).`,
          "error"
        );
        return;
      }
    }

    try {
      if (auth.currentUser) {
        if (auth.currentUser.email !== customerForm.email) {
          showToast('This signed-in account does not match the selected email. Please sign out or change the email.', 'warning');
          return;
        }

        if (auth.currentUser.emailVerified) {
          setOtpStep(2);
          showToast('Your email is already verified. You can continue.', 'success');
          return;
        }

        await sendEmailVerification(auth.currentUser);
        setOtpStep(2);
        showToast(`Verification email sent again to ${customerForm.email}.`, 'info');
        return;
      }

      if (!customerForm.password || customerForm.password.length < 6) {
        showToast("Password must be at least 6 characters long.", "warning");
        return;
      }

      let userCredential;
      try {
        userCredential = await createUserWithEmailAndPassword(
          auth,
          customerForm.email,
          customerForm.password
        );
      } catch (createErr) {
        if (createErr.code !== 'auth/email-already-in-use') {
          throw createErr;
        }

        try {
          userCredential = await signInWithEmailAndPassword(
            auth,
            customerForm.email,
            customerForm.password
          );
        } catch (signInErr) {
          if (signInErr.code === 'auth/invalid-credential' || signInErr.code === 'auth/wrong-password') {
            showToast('An account already exists for this email, but the password did not match.', 'error');
            return;
          }
          throw signInErr;
        }
      }

      if (userCredential.user.emailVerified) {
        setOtpStep(2);
        showToast('Your email is already verified. You can continue.', 'success');
        return;
      }

      await sendEmailVerification(userCredential.user);
      setOtpStep(2);
      showToast(`Verification email sent to ${customerForm.email}. Please verify before finishing checkout.`, "info");
    } catch (err) {
      console.error('Firebase email signup failed:', err);
      const errCode = err?.code;

      if (errCode === 'auth/invalid-email') {
        showToast('Please enter a valid email address.', 'error');
      } else if (
        errCode === 'auth/operation-not-allowed'
      ) {
        showToast(
          'Email/Password sign-in is disabled for this Firebase project. Enable it in Firebase Console > Authentication > Sign-in method.',
          'error'
        );
      } else if (errCode?.includes('identity-toolkit-api-has-not-been-used')) {
        showToast('Firebase Identity Toolkit API is disabled for this project. Enable it in Google Cloud Console, then retry.', 'error');
      } else {
        showToast('Unable to process this email right now. Please try again.', 'error');
      }
    }
  };

  // Handle OTP digit inputs
  const handleOtpDigitChange = (index, value) => {
    if (value.length > 1) {
      value = value.slice(-1);
    }
    const newOtp = [...enteredOtp];
    newOtp[index] = value;
    setEnteredOtp(newOtp);

    if (value && index < 5) {
      const nextInput = document.getElementById(`otp-input-${index + 1}`);
      if (nextInput) nextInput.focus();
    }
  };

  // Verify OTP & Process Order
  const handleVerifyOtpAndOrder = async () => {
    try {
      if (auth.currentUser) {
        await auth.currentUser.reload();
        await auth.currentUser.getIdToken(true);
      }

      if (!auth.currentUser || !auth.currentUser.emailVerified) {
        showToast('Please verify your email before placing the order.', 'warning');
        return;
      }

      setIsSubmittingOrder(true);

      const normalizedCustomer = {
        ...customerForm,
        name: normalizeCustomerName(customerForm.name, customerForm.email),
        contact: customerForm.contact || customerForm.email,
        email: customerForm.email,
        location: customerLocation || null
      };

      setVerifiedCustomer(normalizedCustomer);

      const success = await placeOrder(normalizedCustomer);
      setIsSubmittingOrder(false);

      if (success) {
        // Lock the delivery location for 20 minutes once checked out
        const lockedUntil = Date.now() + 20 * 60 * 1000;
        const lockPayload = {
          address: normalizedCustomer.address,
          lat: customerLocation?.lat ?? null,
          lng: customerLocation?.lng ?? null,
          distanceKm: customerLocation?.distanceKm ?? null,
          lockedUntil,
        };
        try {
          localStorage.setItem('shop_checkout_location_lock', JSON.stringify(lockPayload));
        } catch (e) {
          console.warn('Could not save location lock:', e);
        }
        setLocationLock(lockPayload);
        setLockTimeRemaining('20:00');
        setOtpStep(3);
      }
    } catch (err) {
      setIsSubmittingOrder(false);
      console.error('Firebase email verification failed:', err);
      showToast('Email verification could not be confirmed. Please try again.', 'error');
    }
  };

  return (
    <div className="app-container">
      {/* ===================================================================
          Top Navigation Bar
          =================================================================== */}
      <header className="navbar-wrapper">
        <nav className="navbar">
          <div className="nav-brand" style={{ cursor: 'pointer' }} onClick={() => { setSelectedCategory('all'); setSearchQuery(''); }}>
            <div className="brand-icon">🛒</div>
            <div className="brand-name">
              Store<span>front</span>
            </div>
          </div>

          <div className="nav-links">
            <Link to="/" className="nav-link-item active">Home</Link>
            <a href="#categories" className="nav-link-item" onClick={scrollToProducts}>Categories</a>
            <a href="#products-section" className="nav-link-item" onClick={scrollToProducts}>Products</a>
            <NavLink to="/orders" className={({ isActive }) => `nav-link-item ${isActive ? 'active' : ''}`}>
              Orders
            </NavLink>
          </div>

          {/* Search Box */}
          <div className="nav-search">
            <svg className="search-icon-svg" width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              type="text"
              placeholder="Search products by name, category..."
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                scrollToProducts();
              }}
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                style={{
                  position: 'absolute',
                  right: '0.8rem',
                  top: '50%',
                  transform: 'translateY(-50%)',
                  background: 'none',
                  color: 'var(--text-muted)',
                  fontSize: '0.9rem',
                  fontWeight: 'bold'
                }}
                title="Clear search"
              >
                ✕
              </button>
            )}
          </div>

          <div className="nav-actions">
            <button
              className="mobile-search-button"
              type="button"
              onClick={() => setIsSearchPopupOpen(true)}
              aria-label="Open product search"
              title="Search products"
            >
              <svg width="18" height="18" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
            </button>

            {/* 20-Min Cart Session Timer */}
            {timeLeft > 0 && (
              <div className={`timer-chip ${isTimerWarning ? 'warning' : ''}`} title="Cart session timer (auto-clears on expiration)">
                <span>⏱️</span>
                <span>{formatTimeLeft()}</span>
              </div>
            )}

            {/* Cart Nav Button */}
            <button
              className="cart-nav-btn"
              onClick={() => setIsCartOpen(true)}
              aria-label="Open Cart"
            >
              <svg width="20" height="20" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 11-4 0 2 2 0 014 0z" />
              </svg>
              {totalCartCount > 0 && <span className="cart-badge">{totalCartCount}</span>}
            </button>

            {/* Verification / Account Button */}
            {hasActiveProfile ? (
              <button
                className="btn-auth"
                onClick={handleProfileButtonClick}
              >
                {`Hi, ${currentUserName.split(' ')[0]}`}
              </button>
            ) : (
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                <button
                  type="button"
                  className="btn-auth-outline"
                  onClick={handleOpenLoginModal}
                >
                  Log In
                </button>
                <button
                  type="button"
                  className="btn-auth"
                  onClick={handleOpenSignUpModal}
                >
                  Sign Up
                </button>
              </div>
            )}
          </div>
        </nav>
      </header>

      {isSearchPopupOpen && (
        <div className="search-popup-overlay" onClick={() => setIsSearchPopupOpen(false)}>
          <div className="search-popup-card" onClick={(e) => e.stopPropagation()}>
            <div className="search-popup-header">
              <h3>Search Products</h3>
              <button type="button" className="search-popup-close" onClick={() => setIsSearchPopupOpen(false)} aria-label="Close search">✕</button>
            </div>

            <div className="search-popup-subtitle">Find products, categories, and delivery essentials.</div>

            <div className="nav-search search-popup-search">
              <svg className="search-icon-svg" width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              <input
                type="text"
                autoFocus
                placeholder="Search products by name, category..."
                value={searchQuery}
                onChange={(e) => {
                  setSearchQuery(e.target.value);
                  scrollToProducts();
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    handleSearchSubmit();
                  }
                }}
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  className="search-clear-button"
                  title="Clear search"
                >
                  ✕
                </button>
              )}
            </div>

            <div className="search-popup-actions">
              <button
                type="button"
                className="search-popup-secondary"
                onClick={() => {
                  setSearchQuery('');
                  setIsSearchPopupOpen(false);
                }}
              >
                Clear
              </button>
              <button
                type="button"
                className="search-popup-primary"
                onClick={handleSearchSubmit}
              >
                Search
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ===================================================================
          Main Storefront Body
          =================================================================== */}
      <main className="main-content">
        {/* Hero Section */}
        <section id="home" className="hero-section">
          <div className="hero-glow-bg"></div>

          <div className="hero-content">
            <div className="hero-tag">
              <span>🌱</span> Fresh Delivery Service
            </div>
            <h1 className="hero-title">
              Fastest <br />
              <span>Delivery &amp;</span>
              Easy Pickup.
            </h1>
            <div className="hero-actions">
              <button className="btn-hero-cta" onClick={scrollToProducts}>
                Shop Now →
              </button>
              <div className="hero-social-proof">
                <div className="avatar-group">
                  <img src="https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=100&auto=format&fit=crop&q=80" alt="Customer" className="avatar-img" />
                  <img src="https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=100&auto=format&fit=crop&q=80" alt="Customer" className="avatar-img" />
                  <img src="https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=100&auto=format&fit=crop&q=80" alt="Customer" className="avatar-img" />
                </div>
                <div className="social-proof-text">
                  <strong>Our Happy Customer</strong>
                  <span>★ 4.8 (12.5k Reviews)</span>
                </div>
              </div>
            </div>
          </div>

          <div className="hero-visual-wrapper">
            <img
              src="https://images.unsplash.com/photo-1542838132-92c53300491e?w=800&auto=format&fit=crop&q=80"
              alt="Fresh Organic Basket"
              className="hero-basket-img"
            />
            <div className="floating-badge">
              <span>✨</span> 100% Fresh &amp; Organic
            </div>
          </div>
        </section>

        {/* Dynamic Database Categories Section */}
        <section id="categories" className="categories-container">
          <div className="section-header">
            <h2 className="section-title">Shop By Category</h2>
            <span className="view-all-link" onClick={() => setSelectedCategory('all')}>
              {selectedCategory !== 'all' ? 'Reset to All Categories' : `Showing ${dynamicCategories.length - 1} Categories`}
            </span>
          </div>

          <div className="categories-grid">
            {dynamicCategories.map(cat => (
              <div
                key={cat.id}
                className={`category-card ${selectedCategory === cat.id ? 'active' : ''}`}
                onClick={() => {
                  setSelectedCategory(cat.id);
                  scrollToProducts();
                }}
              >
                <div className="category-icon-wrap">{cat.icon}</div>
                <span className="category-title">{cat.name}</span>
              </div>
            ))}
          </div>
        </section>

        {/* Our Products Section */}
        <section id="products-section">
          <div className="section-header">
            <h2 className="section-title">
              Our Products {selectedCategory !== 'all' && `— ${selectedCategory.toUpperCase()}`}
            </h2>
            <span className="view-all-link" onClick={() => { setSelectedCategory('all'); setSearchQuery(''); }}>
              Reset Filters ({filteredProducts.length} items)
            </span>
          </div>

          {/* Search Result Feedback Bar */}
          {searchQuery && (
            <div style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              background: 'var(--bg-mist)',
              padding: '0.6rem 1rem',
              borderRadius: 'var(--radius-sm)',
              marginBottom: '1rem',
              fontSize: '0.88rem'
            }}>
              <span>
                Search results for: <strong>"{searchQuery}"</strong> ({filteredProducts.length} items found)
              </span>
              <button
                onClick={() => setSearchQuery('')}
                style={{
                  background: 'none',
                  color: 'var(--accent-honey)',
                  fontWeight: 700,
                  fontSize: '0.85rem'
                }}
              >
                Clear Search
              </button>
            </div>
          )}

          {/* Filter Bar with Dynamic Database Category Chips */}
          <div className="filter-bar">
            <div className="filter-chips">
              {dynamicCategories.map(cat => (
                <button
                  key={cat.id}
                  className={`filter-chip ${selectedCategory === cat.id ? 'active' : ''}`}
                  onClick={() => setSelectedCategory(cat.id)}
                >
                  {cat.name}
                </button>
              ))}
            </div>

            <select
              className="sort-select"
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value)}
            >
              <option value="featured">Sort: Featured</option>
              <option value="price-low">Price: Low to High</option>
              <option value="price-high">Price: High to Low</option>
              <option value="rating">Highest Rated</option>
            </select>
          </div>

          {/* Products Grid */}
          <div className="products-grid">
            {filteredProducts.map(product => {
              const reservedStock = Number(pendingReservations[product.id] || 0);
              const stock = Math.max(0, (product.stock ?? 10) - reservedStock);
              const isOutOfStock = stock <= 0;
              const isLowStock = stock > 0 && stock <= 5;

              return (
                <div key={product.id} className="product-card">
                  <span className={`product-badge-stock ${isOutOfStock ? 'out-of-stock' : isLowStock ? 'low-stock' : ''}`}>
                    {isOutOfStock ? 'Out of Stock' : isLowStock ? `Only ${stock} Left` : `In Stock (${stock})`}
                  </span>

                  <div className="product-image-container">
                    <img src={product.image} alt={product.name} className="product-img" />
                  </div>

                  <div className="product-info">
                    <span className="product-category-label">{product.category}</span>
                    <h3 className="product-title" title={product.name}>{product.name}</h3>

                    <div className="product-meta-row">
                      <span className="product-weight">{product.weight}</span>
                      <span className="product-rating">
                        ★ {product.rating || 4.8} <span style={{ color: 'var(--text-light)', fontSize: '0.75rem' }}>({product.reviewsCount || 100})</span>
                      </span>
                    </div>

                    <div className="product-price-row">
                      <span className="product-price">₹{Number(product.price).toFixed(2)}</span>
                      <button
                        className="btn-add-cart"
                        onClick={() => addToCart(product, 1)}
                        disabled={isOutOfStock}
                        title={isOutOfStock ? "Product is out of stock" : "Add to cart"}
                        aria-label="Add to cart"
                      >
                        +
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {filteredProducts.length === 0 && (
            <div style={{ textAlign: 'center', padding: '4rem 1rem', color: 'var(--text-muted)' }}>
              <h3>No products found matching your search.</h3>
              <button
                className="btn-hero-cta"
                style={{ marginTop: '1rem' }}
                onClick={() => { setSelectedCategory('all'); setSearchQuery(''); }}
              >
                Clear Search &amp; Filters
              </button>
            </div>
          )}
        </section>
      </main>

      {/* ===================================================================
          Slide-Over Cart Drawer
          =================================================================== */}
      {isCartOpen && (
        <div className="drawer-backdrop" onClick={() => setIsCartOpen(false)}>
          <div className="cart-drawer" onClick={(e) => e.stopPropagation()}>
            <div className="drawer-header">
              <div className="drawer-title">
                <span>🛒</span> Your Cart ({totalCartCount})
              </div>
              <button className="btn-close-drawer" onClick={() => setIsCartOpen(false)}>✕</button>
            </div>

            {/* 20-Minute Countdown Session Indicator */}
            {timeLeft > 0 && (
              <div className="cart-timer-banner">
                <div>
                  <strong>Session Expiration:</strong> Items held in cart
                </div>
                <div className="countdown">{formatTimeLeft()}</div>
              </div>
            )}

            <div className="cart-items-list">
              {cart.length === 0 ? (
                <div className="cart-empty-state">
                  <span style={{ fontSize: '3rem' }}>🛍️</span>
                  <h4>Your cart is empty</h4>
                  <p>Add some fresh products from our catalog.</p>
                </div>
              ) : (
                cart.map(item => (
                  <div key={item.id} className="cart-item-row">
                    <div className="cart-item-img-wrap">
                      <img src={item.image} alt={item.name} className="cart-item-img" />
                    </div>

                    <div className="cart-item-details">
                      <h4 className="cart-item-name">{item.name}</h4>
                      <div className="cart-item-unit-price">
                        ₹{Number(item.price).toFixed(2)} / {item.weight}
                      </div>
                    </div>

                    <div className="cart-item-actions">
                      <button className="qty-btn" onClick={() => updateQuantity(item.id, -1)}>-</button>
                      <span className="qty-number">{item.quantity}</span>
                      <button className="qty-btn" onClick={() => updateQuantity(item.id, 1)}>+</button>
                    </div>

                    <div className="cart-item-total-price">
                      ₹{(item.price * item.quantity).toFixed(2)}
                    </div>

                    <button
                      className="btn-remove-item"
                      onClick={() => removeFromCart(item.id)}
                      title="Remove item"
                    >
                      🗑️
                    </button>
                  </div>
                ))
              )}
            </div>

            {cart.length > 0 && (
              <div className="drawer-footer">
                <div className="cost-row">
                  <span>Subtotal</span>
                  <strong>₹{cartSubtotal.toFixed(2)}</strong>
                </div>
                <div className="cost-row">
                  <span>Estimated Tax (5%)</span>
                  <span>₹{cartTax.toFixed(2)}</span>
                </div>
                <div className="cost-row">
                  <span>Delivery</span>
                  <span style={{ color: '#16a34a', fontWeight: 700 }}>FREE</span>
                </div>
                <div className="cost-row total">
                  <span>Total Amount</span>
                  <span>₹{cartTotal.toFixed(2)}</span>
                </div>

                <button
                  className="btn-checkout-cta"
                  onClick={handleProceedToCheckout}
                  disabled={isCheckingLocation}
                  style={isCheckingLocation ? { opacity: 0.7, cursor: 'not-allowed' } : {}}
                >
                  {isCheckingLocation ? '📍 Checking Delivery Area...' : 'Proceed to Checkout →'}
                </button>

                {!hasActiveProfile && (
                  <div style={{ textAlign: 'center', fontSize: '0.82rem', color: 'var(--text-muted)', marginTop: '0.2rem' }}>
                    Already a member?{' '}
                    <button
                      type="button"
                      onClick={() => {
                        setIsCartOpen(false);
                        handleOpenLoginModal();
                      }}
                      style={{ background: 'none', border: 'none', color: 'var(--accent-honey)', fontWeight: 700, cursor: 'pointer', padding: 0 }}
                    >
                      Log In
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ===================================================================
          Profile Details Modal
          =================================================================== */}
      <ProfileModal
        isOpen={isProfileModalOpen}
        onClose={handleCloseProfileModal}
        currentUserName={currentUserName}
        verifiedCustomer={verifiedCustomer}
        customerForm={customerForm}
        onSignOut={handleSignOutProfile}
      />

      {isOtpModalOpen && (
        <div className="modal-overlay" onClick={handleCloseOtpModal}>
          <div id="otp-recaptcha-container"></div>
          <div
            className="modal-card"
            style={{ maxWidth: '500px', width: '92%', maxHeight: '90vh', overflowY: 'auto' }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Step 1: Customer Details & Delivery Address */}
            {otpStep === 1 && (
              <form onSubmit={handleSendOtp}>
                <div className="modal-header">
                  <div className="modal-icon-badge">📦</div>
                  <h3 className="modal-title">Checkout Verification</h3>
                  <p className="modal-subtitle">
                    Confirm your details and delivery location to complete your order.
                  </p>
                </div>

                <div className="form-group">
                  <label className="form-label">Full Name</label>
                  <input
                    type="text"
                    required
                    className="form-input"
                    placeholder="Enter your name"
                    value={customerForm.name}
                    onChange={(e) => setCustomerForm({ ...customerForm, name: e.target.value })}
                  />
                </div>

                <div className="form-group">
                  <label className="form-label">Email Address</label>
                  <input
                    type="email"
                    required
                    className="form-input"
                    placeholder="Enter your email address"
                    value={customerForm.email}
                    onChange={(e) => setCustomerForm({ ...customerForm, email: e.target.value, contact: e.target.value })}
                  />
                </div>

                {!auth.currentUser && (
                  <div className="form-group">
                    <label className="form-label">Password</label>
                    <input
                      type="password"
                      required
                      className="form-input"
                      placeholder="Create a password (min 6 characters)"
                      value={customerForm.password}
                      onChange={(e) => setCustomerForm({ ...customerForm, password: e.target.value })}
                    />
                  </div>
                )}

                {/* Delivery Address & Location Selection (Exclusively at Checkout with 20-min window) */}
                <AddressForm
                  address={customerForm.address}
                  coords={customerLocation}
                  isLocked={isLocationLocked}
                  lockTimeRemaining={lockTimeRemaining}
                  onChange={({ address, coords, isWithinZone, distanceKm }) => {
                    setCustomerForm(prev => ({ ...prev, address }));
                    setCustomerLocation(coords ? { ...coords, address, distanceKm, isFixated: true } : null);
                  }}
                />

                <div className="modal-actions" style={{ marginTop: '1.25rem' }}>
                  <button type="button" className="btn-modal-cancel" onClick={handleCloseOtpModal}>
                    Cancel
                  </button>
                  <button type="submit" className="btn-modal-primary">
                    {isCurrentCustomerVerified ? 'Continue →' : (auth.currentUser ? 'Send Verification Email →' : 'Send Verification Code →')}
                  </button>
                </div>

                {!auth.currentUser && (
                  <div style={{ marginTop: '1.25rem', textAlign: 'center', fontSize: '0.86rem', color: 'var(--text-muted)' }}>
                    Already have an account?{' '}
                    <button
                      type="button"
                      onClick={() => {
                        setIsOtpModalOpen(false);
                        setIsLoginModalOpen(true);
                      }}
                      style={{ background: 'none', border: 'none', color: 'var(--accent-honey)', fontWeight: 700, cursor: 'pointer', padding: 0 }}
                    >
                      Log In
                    </button>
                  </div>
                )}
              </form>
            )}

            {/* Step 2: 6-Digit OTP Verification */}
            {otpStep === 2 && (
              <div>
                <div className="modal-header">
                  <div className="modal-icon-badge">🔒</div>
                  <h3 className="modal-title">Verify Your Email</h3>
                  <p className="modal-subtitle">
                    We sent a verification email to <strong>{customerForm.email}</strong>. Please verify it before placing the order.
                  </p>
                </div>

                <div className="test-otp-helper" style={{ justifyContent: 'center' }}>
                  <span>Check your inbox and confirm the email before continuing.</span>
                </div>

                <div className="modal-actions">
                  <button type="button" className="btn-modal-cancel" onClick={() => {
                    setOtpStep(1);
                    setEnteredOtp(['', '', '', '', '', '']);
                  }}>
                    Back
                  </button>
                  <button
                    type="button"
                    className="btn-modal-primary"
                    onClick={handleVerifyOtpAndOrder}
                    disabled={isSubmittingOrder}
                  >
                    {isSubmittingOrder ? "Generating Order File..." : "Verify Email & Place Order"}
                  </button>
                </div>
              </div>
            )}

            {/* Step 3: Order Confirmation & Bill Download */}
            {otpStep === 3 && lastOrderSuccess && (
              <div style={{ textAlign: 'center' }}>
                <div className="modal-icon-badge" style={{ background: '#ecfdf5', borderColor: '#a7f3d0' }}>
                  🎉
                </div>
                <h3 className="modal-title" style={{ color: '#065f46' }}>Order Placed (Test Mode)</h3>
                <p className="modal-subtitle" style={{ marginBottom: '1.2rem' }}>
                  Your invoice bill has been automatically downloaded.
                </p>

                <div style={{ background: 'var(--bg-mist)', padding: '1rem', borderRadius: 'var(--radius-sm)', textAlign: 'left', fontSize: '0.88rem', marginBottom: '1.2rem' }}>
                  <div><strong>Order ID:</strong> {lastOrderSuccess.orderId}</div>
                  <div><strong>Customer:</strong> {lastOrderSuccess.customer.name}</div>
                  <div><strong>Delivery Address:</strong> {lastOrderSuccess.customer.deliveryAddress}</div>
                  <div><strong>Total Amount:</strong> ₹{lastOrderSuccess.pricing.grandTotal}</div>
                  <div><strong>Invoice File:</strong> <code>{lastOrderSuccess.orderId}_bill.pdf</code></div>
                </div>

                <div style={{ display: 'flex', gap: '0.8rem', flexDirection: 'column' }}>
                  <button
                    type="button"
                    className="btn-modal-primary"
                    onClick={() => downloadOrderBill(lastOrderSuccess)}
                  >
                    📄 Download Bill Again
                  </button>
                  <button
                    type="button"
                    className="btn-modal-cancel"
                    onClick={handleCloseOtpModal}
                  >
                    Continue Shopping
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ===================================================================
          Customer Email & Password Login Modal
          =================================================================== */}
      <LoginModal
        isOpen={isLoginModalOpen}
        onClose={handleCloseLoginModal}
        onSwitchToSignUp={() => {
          setIsLoginModalOpen(false);
          setIsSignUpModalOpen(true);
        }}
        showToast={showToast}
        auth={auth}
        initialEmail={customerForm.email}
      />

      {/* ===================================================================
          Customer Sign-Up Modal (with Real-time Location, Search & Map)
          =================================================================== */}
      <SignUpModal
        isOpen={isSignUpModalOpen}
        onClose={handleCloseSignUpModal}
        onSwitchToLogin={() => {
          setIsSignUpModalOpen(false);
          setIsLoginModalOpen(true);
        }}
        onSignUpSuccess={handleSignUpSubmit}
      />

      {/* ===================================================================
          Toast Notifications Container
          =================================================================== */}
      <div className="toast-container">
        {toasts.map(toast => (
          <div key={toast.id} className="toast-item">
            <span>{toast.type === 'error' ? '⚠️' : toast.type === 'warning' ? '⏰' : '✅'}</span>
            <span>{toast.message}</span>
          </div>
        ))}
      </div>

      {/* ===================================================================
          Clean Footer
          =================================================================== */}
      <footer id="footer" className="site-footer" style={{ padding: '2rem 1.5rem', textAlign: 'center' }}>
        <div style={{ maxWidth: '1280px', margin: '0 auto', fontSize: '0.85rem', color: '#94a3b8' }}>
          <p>© 2026 Storefront. All rights reserved.</p>
        </div>
      </footer>
    </div>
  );
};

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<StorefrontPage />} />
      <Route path="/orders" element={<OrdersPage />} />
    </Routes>
  );
}
