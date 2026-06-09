import React, { useState, useEffect, useMemo } from 'react';
import { 
  Coins, 
  ArrowDownRight, 
  ArrowUpLeft, 
  Gift, 
  History, 
  TrendingUp, 
  RefreshCw, 
  CheckCircle2, 
  AlertCircle, 
  User, 
  ShieldCheck, 
  X, 
  Sparkles, 
  Wallet,
  Smartphone,
  Key,
  Check,
  Plus,
  FileText
} from 'lucide-react';

const API_BASE = 'http://localhost:3000';
const DEFAULT_USER_ID = 'd3b07384-d113-4956-a5cc-9c60dfd2948e'; // Seeded Ario Demo User

interface UserProfile {
  user_id: string;
  first_name: string;
  last_name: string;
  mobile_number: string;
  kyc_tier: number;
  sheba_number: string;
  is_active: boolean;
}

interface GoldBalance {
  karat18_mg: number;
  karat24_mg: number;
}

interface Transaction {
  transaction_id: string;
  from_account: string;
  to_account: string;
  gold_weight_mg: number;
  karat: number;
  tx_type: string;
  spot_price_per_mg_irr: number;
  created_at: string;
}

interface PriceRate {
  karat: number;
  base_price_per_g_irr: number;
  ask_price_per_g_irr: number;
  bid_price_per_g_irr: number;
  spread_percentage: number;
  updated_at: string;
}

interface PriceHistory {
  timestamp: string;
  rate18k: number;
  rate24k: number;
}

export default function App() {
  // Routing state
  const [currentPath, setCurrentPath] = useState<string>(window.location.pathname);

  useEffect(() => {
    const handleLocationChange = () => {
      setCurrentPath(window.location.pathname);
    };
    window.addEventListener('popstate', handleLocationChange);
    return () => window.removeEventListener('popstate', handleLocationChange);
  }, []);

  const navigateTo = (path: string) => {
    window.history.pushState({}, '', path);
    setCurrentPath(path);
  };

  // User state
  const [userId] = useState<string>(DEFAULT_USER_ID);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [fiatBalance, setFiatBalance] = useState<number>(0);
  const [goldBalance, setGoldBalance] = useState<GoldBalance>({ karat18_mg: 0, karat24_mg: 0 });
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  
  // Live rates state
  const [rates, setRates] = useState<PriceRate[]>([]);
  const [priceHistory, setPriceHistory] = useState<PriceHistory[]>([]);
  const [selectedKaratForChart, setSelectedKaratForChart] = useState<18 | 24>(18);
  
  // Modal states
  const [activeModal, setActiveModal] = useState<'buy' | 'sell' | 'gift' | null>(null);
  const [modalKarat, setModalKarat] = useState<18 | 24>(18);
  const [modalAmountToman, setModalAmountToman] = useState<string>('');
  const [modalAmountWeightMg, setModalAmountWeightMg] = useState<string>('');
  const [modalInputType, setModalInputType] = useState<'toman' | 'weight'>('toman');
  const [modalRecipientMobile, setModalRecipientMobile] = useState<string>('');
  
  // Calculator state
  const [calcKarat, setCalcKarat] = useState<18 | 24>(18);
  const [calcTomans, setCalcTomans] = useState<string>('100000');
  const [calcMg, setCalcMg] = useState<string>('');
  const [calcDirection, setCalcDirection] = useState<'toman_to_mg' | 'mg_to_toman'>('toman_to_mg');

  // Network and transaction feedback
  const [loading, setLoading] = useState<boolean>(true);
  const [actionLoading, setActionLoading] = useState<boolean>(false);
  const [statusMessage, setStatusMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [ratesRefreshing, setRatesRefreshing] = useState<boolean>(false);
  const [hoveredChartPoint, setHoveredChartPoint] = useState<number | null>(null);

  // Load initial data
  useEffect(() => {
    fetchUserData(userId);
    fetchLiveRates();
    fetchPriceHistory();
  }, [userId]);

  // Recalculate calculator when rates, input values, karat or direction changes
  useEffect(() => {
    runCalculator();
  }, [calcTomans, calcMg, calcKarat, calcDirection, rates]);

  const fetchUserData = async (id: string) => {
    setLoading(true);
    try {
      // 1. Fetch user profile and fiat balance
      const profRes = await fetch(`${API_BASE}/api/auth/profile/${id}`);
      const profData = await profRes.json();
      if (profData.success) {
        setProfile(profData.data.user);
        setFiatBalance(profData.data.balance_irr);
      }

      // 2. Fetch gold balances and transactions
      const goldRes = await fetch(`${API_BASE}/api/gold/balance/${id}`);
      const goldData = await goldRes.json();
      if (goldData.success) {
        setGoldBalance(goldData.data.balances);
        setTransactions(goldData.data.transactions);
      }
    } catch (error) {
      console.error('Error fetching user data:', error);
    } finally {
      setLoading(false);
    }
  };

  const fetchLiveRates = async () => {
    setRatesRefreshing(true);
    try {
      const res = await fetch(`${API_BASE}/api/gold/rates`);
      const data = await res.json();
      if (data.success) {
        setRates(data.rates);
      }
    } catch (error) {
      console.error('Error fetching rates:', error);
    } finally {
      setRatesRefreshing(false);
    }
  };

  const fetchPriceHistory = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/gold/prices/history`);
      const data = await res.json();
      if (data.success) {
        setPriceHistory(data.history);
      }
    } catch (error) {
      console.error('Error fetching price history:', error);
    }
  };

  // Live conversion rates (Tomans <-> Rials)
  // 1 Toman = 10 IRR (Rials)
  const getRateDetails = (karat: 18 | 24) => {
    const rate = rates.find(r => r.karat === karat);
    if (!rate) {
      // Fallbacks
      return {
        base_g_toman: karat === 18 ? 3200000 : 4266000,
        ask_g_toman: karat === 18 ? 3238400 : 4317192,
        bid_g_toman: karat === 18 ? 3174400 : 4231872,
        ask_mg_toman: karat === 18 ? 3238.4 : 4317.192,
        bid_mg_toman: karat === 18 ? 3174.4 : 4231.872,
        base_price_per_g_irr: karat === 18 ? 32000000 : 42660000,
        ask_price_per_g_irr: karat === 18 ? 32384000 : 43171920,
        bid_price_per_g_irr: karat === 18 ? 31744000 : 42318720,
      };
    }
    const askIrr = parseFloat(rate.ask_price_per_g_irr.toString());
    const bidIrr = parseFloat(rate.bid_price_per_g_irr.toString());
    const baseIrr = parseFloat(rate.base_price_per_g_irr.toString());

    return {
      base_g_toman: baseIrr / 10.0,
      ask_g_toman: askIrr / 10.0,
      bid_g_toman: bidIrr / 10.0,
      ask_mg_toman: askIrr / 10000.0,
      bid_mg_toman: bidIrr / 10000.0,
      base_price_per_g_irr: baseIrr,
      ask_price_per_g_irr: askIrr,
      bid_price_per_g_irr: bidIrr,
    };
  };

  // Calculator logic
  const runCalculator = () => {
    const rate = getRateDetails(calcKarat);
    if (calcDirection === 'toman_to_mg') {
      const tomanVal = parseFloat(calcTomans);
      if (!isNaN(tomanVal) && tomanVal > 0) {
        // Use base price per mg for general reference
        const mgVal = tomanVal / (rate.base_g_toman / 1000.0);
        setCalcMg(mgVal.toFixed(3));
      } else {
        setCalcMg('');
      }
    } else {
      const mgVal = parseFloat(calcMg);
      if (!isNaN(mgVal) && mgVal > 0) {
        const tomanVal = mgVal * (rate.base_g_toman / 1000.0);
        setCalcTomans(tomanVal.toFixed(0));
      } else {
        setCalcTomans('');
      }
    }
  };

  // Buy Gold Transaction
  const handleBuyGold = async (e: React.FormEvent) => {
    e.preventDefault();
    setActionLoading(true);
    setStatusMessage(null);

    let body: any = { user_id: userId, karat: modalKarat };

    if (modalInputType === 'toman') {
      const toman = parseFloat(modalAmountToman);
      if (isNaN(toman) || toman <= 0) {
        setStatusMessage({ type: 'error', text: 'Please enter a valid Toman amount.' });
        setActionLoading(false);
        return;
      }
      body.amount_irr = toman * 10; // Convert Toman to Rials
    } else {
      const mg = parseFloat(modalAmountWeightMg);
      if (isNaN(mg) || mg <= 0) {
        setStatusMessage({ type: 'error', text: 'Please enter a valid gold weight.' });
        setActionLoading(false);
        return;
      }
      body.gold_weight_mg = mg;
    }

    try {
      const res = await fetch(`${API_BASE}/api/gold/buy`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      const data = await res.json();
      if (data.success) {
        setStatusMessage({ 
          type: 'success', 
          text: `Purchased successfully! Received ${data.data.gold_weight_mg.toLocaleString()} mg of ${data.data.karat}k gold.` 
        });
        // Clear modal state
        setModalAmountToman('');
        setModalAmountWeightMg('');
        // Refresh balance and transactions
        fetchUserData(userId);
        setTimeout(() => setActiveModal(null), 3000);
      } else {
        setStatusMessage({ type: 'error', text: data.message || 'Transaction failed.' });
      }
    } catch (error) {
      console.error('Error buying gold:', error);
      setStatusMessage({ type: 'error', text: 'Failed to connect to core API server.' });
    } finally {
      setActionLoading(false);
    }
  };

  // Sell Gold Transaction
  const handleSellGold = async (e: React.FormEvent) => {
    e.preventDefault();
    setActionLoading(true);
    setStatusMessage(null);

    let body: any = { user_id: userId, karat: modalKarat };

    if (modalInputType === 'toman') {
      const toman = parseFloat(modalAmountToman);
      if (isNaN(toman) || toman <= 0) {
        setStatusMessage({ type: 'error', text: 'Please enter a valid Toman amount.' });
        setActionLoading(false);
        return;
      }
      body.amount_irr = toman * 10; // Convert Toman to Rials
    } else {
      const mg = parseFloat(modalAmountWeightMg);
      if (isNaN(mg) || mg <= 0) {
        setStatusMessage({ type: 'error', text: 'Please enter a valid gold weight.' });
        setActionLoading(false);
        return;
      }
      body.gold_weight_mg = mg;
    }

    try {
      const res = await fetch(`${API_BASE}/api/gold/sell`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      const data = await res.json();
      if (data.success) {
        setStatusMessage({ 
          type: 'success', 
          text: `Sold successfully! Transferred ${data.data.gold_weight_mg.toLocaleString()} mg and received ${Math.round(data.data.amount_irr / 10).toLocaleString()} Tomans.` 
        });
        setModalAmountToman('');
        setModalAmountWeightMg('');
        fetchUserData(userId);
        setTimeout(() => setActiveModal(null), 3000);
      } else {
        setStatusMessage({ type: 'error', text: data.message || 'Transaction failed.' });
      }
    } catch (error) {
      console.error('Error selling gold:', error);
      setStatusMessage({ type: 'error', text: 'Failed to connect to core API server.' });
    } finally {
      setActionLoading(false);
    }
  };

  // P2P Gift Transaction
  const handleGiftGold = async (e: React.FormEvent) => {
    e.preventDefault();
    setActionLoading(true);
    setStatusMessage(null);

    const mg = parseFloat(modalAmountWeightMg);
    if (isNaN(mg) || mg <= 0) {
      setStatusMessage({ type: 'error', text: 'Please enter a valid gold weight.' });
      setActionLoading(false);
      return;
    }

    if (!recipientMobilePattern.test(modalRecipientMobile)) {
      setStatusMessage({ type: 'error', text: 'Please enter a valid Iranian mobile number (starts with 09 and exactly 11 digits).' });
      setActionLoading(false);
      return;
    }

    try {
      const res = await fetch(`${API_BASE}/api/gold/gift`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sender_id: userId,
          recipient_mobile: modalRecipientMobile,
          karat: modalKarat,
          gold_weight_mg: mg
        })
      });
      const data = await res.json();
      if (data.success) {
        setStatusMessage({ 
          type: 'success', 
          text: `Gift sent successfully! Transferred ${mg} mg of ${modalKarat}k gold to ${data.data.recipient_name}.` 
        });
        setModalAmountWeightMg('');
        setModalRecipientMobile('');
        fetchUserData(userId);
        setTimeout(() => setActiveModal(null), 3000);
      } else {
        setStatusMessage({ type: 'error', text: data.message || 'Gifting transaction failed.' });
      }
    } catch (error) {
      console.error('Error gifting gold:', error);
      setStatusMessage({ type: 'error', text: 'Failed to connect to core API server.' });
    } finally {
      setActionLoading(false);
    }
  };

  // Mock Upgrade KYC Tier
  const handleUpgradeKYC = async () => {
    if (!profile) return;
    if (profile.kyc_tier >= 2) return;
    
    // Animate local update to Tier 2
    setProfile(prev => prev ? { ...prev, kyc_tier: 2 } : null);
    
    // Show premium notification
    alert('Congratulations! Your vault-level audit records have been reviewed. You have been upgraded to KYC Tier 2 (Physical Gold Vault Access).');
  };

  // Chart math & layout
  const chartPoints = useMemo(() => {
    if (!priceHistory.length) return [];
    
    // Map history to simple values based on selection
    return priceHistory.map((p, idx) => ({
      index: idx,
      timestamp: new Date(p.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      price: selectedKaratForChart === 18 ? p.rate18k : p.rate24k,
    }));
  }, [priceHistory, selectedKaratForChart]);

  const chartSVGDimensions = { width: 600, height: 240, padding: 30 };
  const chartBounds = useMemo(() => {
    if (!chartPoints.length) return { min: 0, max: 0 };
    const prices = chartPoints.map(p => p.price);
    const min = Math.min(...prices) * 0.9995; // padding factor
    const max = Math.max(...prices) * 1.0005;
    return { min, max };
  }, [chartPoints]);

  const svgPathData = useMemo(() => {
    if (!chartPoints.length) return { line: '', area: '' };
    const { width, height, padding } = chartSVGDimensions;
    const { min, max } = chartBounds;
    const range = max - min;
    const innerWidth = width - padding * 2;
    const innerHeight = height - padding * 2;

    const coords = chartPoints.map(p => {
      const x = padding + (p.index / (chartPoints.length - 1)) * innerWidth;
      const y = padding + innerHeight - ((p.price - min) / range) * innerHeight;
      return { x, y };
    });

    const linePath = coords.reduce((acc, c, idx) => {
      return idx === 0 ? `M ${c.x} ${c.y}` : `${acc} L ${c.x} ${c.y}`;
    }, '');

    const areaPath = `
      ${linePath} 
      L ${coords[coords.length - 1].x} ${height - padding} 
      L ${coords[0].x} ${height - padding} Z
    `;

    return { line: linePath, area: areaPath };
  }, [chartPoints, chartBounds]);

  const recipientMobilePattern = /^09\d{9}$/;

  return (
    <div className="min-h-screen pb-16 bg-charcoal text-slate-100 flex flex-col font-sans select-none antialiased">
      {/* Header */}
      <header className="sticky top-0 z-40 bg-charcoal border-b border-gray-800 bg-opacity-80 backdrop-blur-md px-4 py-3 sm:px-6 md:px-8 flex justify-between items-center transition-all duration-300">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-gold-dark via-gold to-gold-light flex items-center justify-center shadow-gold-glow animate-pulse">
            <Coins className="text-charcoal w-6 h-6 stroke-[2.5]" />
          </div>
          <div>
            <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-gold-gradient font-serif">MelliZarr</h1>
            <p className="text-[10px] text-gray-500 uppercase tracking-widest -mt-1 font-sans">Bazaar Tokenized Gold</p>
          </div>
        </div>

        <div className="flex items-center gap-4">
          {/* Multisig Admin Toggle */}
          {currentPath === '/admin/multisig' ? (
            <button 
              onClick={() => navigateTo('/')}
              className="flex items-center gap-2 px-3 py-1.5 bg-gray-900 border border-gray-800 hover:border-gold hover:text-gold rounded-xl text-xs font-bold text-gray-300 transition-all duration-300 active:scale-95 cursor-pointer"
            >
              <Smartphone className="w-4 h-4 text-gold" />
              <span>App Dashboard</span>
            </button>
          ) : (
            <button 
              onClick={() => navigateTo('/admin/multisig')}
              className="flex items-center gap-2 px-3 py-1.5 bg-gray-900 border border-gray-800 hover:border-gold hover:text-gold rounded-xl text-xs font-bold text-gray-300 transition-all duration-300 active:scale-95 cursor-pointer"
            >
              <ShieldCheck className="w-4 h-4 text-gold" />
              <span>Admin Multisig</span>
            </button>
          )}

          {/* Connection status */}
          <div className="hidden md:flex items-center gap-2 bg-gray-900 border border-gray-800 px-3 py-1 rounded-full text-xs text-gray-400">
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.7)]"></span>
            <span>Grand Bazaar Core Online</span>
          </div>

          {/* User profile & KYC Badge */}
          {profile && (
            <div className="flex items-center gap-3 bg-charcoal-light bg-opacity-70 border border-gray-800 rounded-xl px-3 py-1.5 shadow-sm">
              <div className="w-8 h-8 rounded-lg bg-gray-900 border border-gray-700 flex items-center justify-center text-gold">
                <User className="w-4 h-4" />
              </div>
              <div className="hidden sm:block text-left">
                <p className="text-xs font-semibold">{profile.first_name} {profile.last_name}</p>
                <div className="flex items-center gap-1">
                  <span className={`w-1.5 h-1.5 rounded-full ${profile.kyc_tier >= 1 ? 'bg-amber-400' : 'bg-red-400'}`}></span>
                  <span className="text-[9px] text-gray-400 font-mono">KYC Tier {profile.kyc_tier}</span>
                </div>
              </div>
              {profile.kyc_tier >= 1 ? (
                <div title="KYC Status Verified" className="cursor-pointer" onClick={handleUpgradeKYC}>
                  <ShieldCheck className="w-5 h-5 text-gold stroke-[2] shadow-gold-glow" />
                </div>
              ) : (
                <AlertCircle className="w-5 h-5 text-red-400" />
              )}
            </div>
          )}
        </div>
      </header>

      {/* Main Content Area */}
      {currentPath === '/admin/multisig' ? (
        <AdminMultisigPanel 
          API_BASE={API_BASE} 
          DEFAULT_USER_ID={DEFAULT_USER_ID}
          navigateTo={navigateTo}
        />
      ) : (
        <main className="flex-1 w-full max-w-7xl mx-auto px-4 py-6 sm:px-6 md:px-8 space-y-6">
        
        {/* Loading overlay */}
        {loading && (
          <div className="fixed inset-0 z-50 bg-charcoal bg-opacity-80 backdrop-blur-md flex items-center justify-center">
            <div className="text-center space-y-4">
              <div className="w-16 h-16 rounded-full border-4 border-gold-dark border-t-gold animate-spin mx-auto"></div>
              <h2 className="text-lg font-serif text-gold-gradient font-bold animate-pulse">Syncing with Tehran Grand Bazaar...</h2>
              <p className="text-sm text-gray-500">Loading ledger state and live price feeds</p>
            </div>
          </div>
        )}

        {/* Top Widgets Grid (KYC Banner + Action Buttons) */}
        <div className="grid grid-cols-1 md:grid-cols-12 gap-6">
          
          {/* KYC Tier Upgrade/Status Banner */}
          {profile && (
            <div className="md:col-span-8 p-5 rounded-2xl glass-panel-gold border-gold border-opacity-20 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 relative overflow-hidden">
              <div className="absolute right-0 top-0 w-32 h-32 bg-gold opacity-[0.03] rounded-full blur-2xl ambient-gold-glow"></div>
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <span className="bg-gold bg-opacity-20 text-gold-light text-[10px] font-bold uppercase tracking-widest px-2 py-0.5 rounded-md">Tier {profile.kyc_tier} Verified</span>
                  <Sparkles className="w-4 h-4 text-gold animate-bounce" />
                </div>
                <h3 className="text-lg font-serif font-bold text-slate-100">
                  {profile.kyc_tier === 1 ? 'Shahkar Match: Tier 1 Active' : 'Vault Partner: Tier 2 Active'}
                </h3>
                <p className="text-xs text-gray-400 max-w-xl">
                  {profile.kyc_tier === 1 
                    ? 'Your Iranian national code matches your mobile subscription. You can save, withdraw, and P2P gift gold. Upgrade to Tier 2 for full physical vault redemption.'
                    : 'Your account is premium. You are eligible for physical gold coin minting, sealed bullion bar redemption, and zero storage fees in the Grand Bazaar Vaults.'}
                </p>
              </div>
              {profile.kyc_tier === 1 && (
                <button 
                  onClick={handleUpgradeKYC}
                  className="w-full sm:w-auto px-5 py-2.5 bg-gradient-to-r from-gold-dark to-gold text-charcoal font-bold text-xs rounded-xl shadow-gold-glow hover:shadow-gold-glow-strong hover:scale-105 transition-all duration-300 whitespace-nowrap active:scale-95"
                >
                  Upgrade to Tier 2
                </button>
              )}
            </div>
          )}

          {/* Quick Action Box */}
          <div className="md:col-span-4 p-5 rounded-2xl glass-panel flex flex-col justify-between">
            <h3 className="text-xs font-bold uppercase tracking-wider text-gray-500 mb-3">Quick Transfers</h3>
            <div className="grid grid-cols-3 gap-3">
              <button 
                onClick={() => { setActiveModal('buy'); setModalKarat(18); }}
                className="flex flex-col items-center justify-center p-3 rounded-xl bg-emerald-500 bg-opacity-10 border border-emerald-500 border-opacity-20 hover:bg-opacity-20 text-emerald-400 transition-all duration-300 group active:scale-95"
              >
                <div className="w-10 h-10 rounded-lg bg-emerald-500 bg-opacity-25 flex items-center justify-center mb-2 group-hover:scale-110 transition-transform">
                  <ArrowDownRight className="w-6 h-6" />
                </div>
                <span className="text-xs font-bold">Buy Gold</span>
              </button>
              <button 
                onClick={() => { setActiveModal('sell'); setModalKarat(18); }}
                className="flex flex-col items-center justify-center p-3 rounded-xl bg-rose-500 bg-opacity-10 border border-rose-500 border-opacity-20 hover:bg-opacity-20 text-rose-400 transition-all duration-300 group active:scale-95"
              >
                <div className="w-10 h-10 rounded-lg bg-rose-500 bg-opacity-25 flex items-center justify-center mb-2 group-hover:scale-110 transition-transform">
                  <ArrowUpLeft className="w-6 h-6" />
                </div>
                <span className="text-xs font-bold">Sell Gold</span>
              </button>
              <button 
                onClick={() => { setActiveModal('gift'); setModalKarat(18); }}
                className="flex flex-col items-center justify-center p-3 rounded-xl bg-gold bg-opacity-10 border border-gold border-opacity-20 hover:bg-opacity-20 text-gold transition-all duration-300 group active:scale-95"
              >
                <div className="w-10 h-10 rounded-lg bg-gold bg-opacity-25 flex items-center justify-center mb-2 group-hover:scale-110 transition-transform">
                  <Gift className="w-6 h-6" />
                </div>
                <span className="text-xs font-bold">P2P Gift</span>
              </button>
            </div>
          </div>
        </div>

        {/* Ledger Balance & Rates Summary Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          
          {/* Wallet Overview Panel */}
          <div className="lg:col-span-4 space-y-6">
            
            {/* Fiat Card */}
            <div className="p-6 rounded-2xl glass-panel relative overflow-hidden flex flex-col justify-between h-48 border border-gray-800">
              <div className="flex justify-between items-start">
                <div className="space-y-1">
                  <p className="text-xs font-bold uppercase tracking-wider text-gray-500">Fiat Cash Balance</p>
                  <h3 className="text-3xl font-bold tracking-tight text-white font-mono">
                    {Math.round(fiatBalance / 10).toLocaleString()} <span className="text-sm text-gray-400 font-sans font-normal">Tomans</span>
                  </h3>
                  <p className="text-[10px] text-gray-500 font-mono">({fiatBalance.toLocaleString()} IRR)</p>
                </div>
                <div className="w-10 h-10 rounded-xl bg-gray-900 border border-gray-800 flex items-center justify-center text-gray-400">
                  <Wallet className="w-5 h-5" />
                </div>
              </div>
              <div className="border-t border-gray-800 border-opacity-50 pt-4 flex justify-between items-center text-xs text-gray-400">
                <span>Direct Sheba Deposit</span>
                <span className="text-white font-mono text-[10px]">{profile?.sheba_number || 'No Account Bound'}</span>
              </div>
            </div>

            {/* Gold Assets Card */}
            <div className="p-6 rounded-2xl glass-panel-gold relative overflow-hidden flex flex-col justify-between h-72 border border-gold border-opacity-20">
              <div className="absolute right-0 bottom-0 w-36 h-36 bg-gold opacity-[0.02] rounded-full blur-2xl ambient-gold-glow"></div>
              <div>
                <div className="flex justify-between items-start mb-6">
                  <div>
                    <p className="text-xs font-bold uppercase tracking-wider text-gold-dark">Tokenized Gold Assets</p>
                    <p className="text-[10px] text-gray-500">100% Backed Physical Vault Inventory</p>
                  </div>
                  <div className="w-10 h-10 rounded-xl bg-gold bg-opacity-10 border border-gold border-opacity-20 flex items-center justify-center text-gold">
                    <Coins className="w-5 h-5 shadow-gold-glow" />
                  </div>
                </div>

                <div className="space-y-4">
                  {/* 18 Karat holdings */}
                  <div className="flex items-center justify-between border-b border-gray-800 border-opacity-50 pb-3">
                    <div className="flex items-center gap-2">
                      <span className="w-6 h-6 rounded-md bg-gold bg-opacity-20 border border-gold border-opacity-25 flex items-center justify-center text-[10px] text-gold font-bold font-mono">18</span>
                      <div>
                        <p className="text-xs font-semibold">18-Karat Gold</p>
                        <p className="text-[9px] text-gray-500">Jewelry Grade (750 Purity)</p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-bold font-mono text-white">{(goldBalance.karat18_mg / 1000.0).toFixed(3)} g</p>
                      <p className="text-[10px] text-gold-light font-mono">{(goldBalance.karat18_mg).toLocaleString()} mg</p>
                    </div>
                  </div>

                  {/* 24 Karat holdings */}
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="w-6 h-6 rounded-md bg-yellow-600 bg-opacity-20 border border-yellow-600 border-opacity-25 flex items-center justify-center text-[10px] text-yellow-500 font-bold font-mono">24</span>
                      <div>
                        <p className="text-xs font-semibold">24-Karat Gold</p>
                        <p className="text-[9px] text-gray-500">Investment Grade (999 Purity)</p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-bold font-mono text-white">{(goldBalance.karat24_mg / 1000.0).toFixed(3)} g</p>
                      <p className="text-[10px] text-gold-light font-mono">{(goldBalance.karat24_mg).toLocaleString()} mg</p>
                    </div>
                  </div>
                </div>
              </div>

              {/* Estimated net worth calculation */}
              <div className="border-t border-gray-800 border-opacity-50 pt-4 flex justify-between items-center text-xs">
                <span className="text-gray-400">Total Gold Value (Est.)</span>
                <span className="text-gold font-bold font-mono">
                  {Math.round(
                    (goldBalance.karat18_mg * (getRateDetails(18).base_g_toman / 1000.0)) + 
                    (goldBalance.karat24_mg * (getRateDetails(24).base_g_toman / 1000.0))
                  ).toLocaleString()} Tomans
                </span>
              </div>
            </div>

          </div>

          {/* Price Chart & Calculator Panel */}
          <div className="lg:col-span-8 space-y-6">
            
            {/* Live Chart Container */}
            <div className="p-6 rounded-2xl glass-panel relative border border-gray-800">
              <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6">
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <TrendingUp className="text-gold w-4 h-4" />
                    <h3 className="text-md font-serif font-bold text-slate-100">Live Gold Spot Exchange Chart</h3>
                  </div>
                  <p className="text-xs text-gray-500">Tehran Grand Bazaar 24H rolling feed</p>
                </div>
                
                <div className="flex items-center gap-2 bg-gray-900 bg-opacity-70 p-1 border border-gray-800 rounded-xl">
                  <button 
                    onClick={() => setSelectedKaratForChart(18)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all duration-300 ${selectedKaratForChart === 18 ? 'bg-gold text-charcoal' : 'text-gray-400 hover:text-white'}`}
                  >
                    18-Karat Rate
                  </button>
                  <button 
                    onClick={() => setSelectedKaratForChart(24)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all duration-300 ${selectedKaratForChart === 24 ? 'bg-gold text-charcoal' : 'text-gray-400 hover:text-white'}`}
                  >
                    24-Karat Rate
                  </button>
                  <button 
                    onClick={fetchLiveRates}
                    className="p-1.5 text-gray-500 hover:text-gold transition-colors duration-300 active:scale-95"
                    disabled={ratesRefreshing}
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${ratesRefreshing ? 'animate-spin' : ''}`} />
                  </button>
                </div>
              </div>

              {/* The SVG Line Chart */}
              <div className="relative w-full overflow-hidden bg-charcoal-dark rounded-xl border border-gray-800 border-opacity-50">
                {!priceHistory.length ? (
                  <div className="h-60 flex items-center justify-center text-xs text-gray-500">
                    Loading historical pricing stream...
                  </div>
                ) : (
                  <svg 
                    viewBox={`0 0 ${chartSVGDimensions.width} ${chartSVGDimensions.height}`}
                    className="w-full h-auto"
                    onMouseLeave={() => setHoveredChartPoint(null)}
                  >
                    {/* Gradients */}
                    <defs>
                      <linearGradient id="chartGlow" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#D4AF37" stopOpacity="0.25" />
                        <stop offset="100%" stopColor="#D4AF37" stopOpacity="0.0" />
                      </linearGradient>
                      <linearGradient id="chartStroke" x1="0" y1="0" x2="1" y2="0">
                        <stop offset="0%" stopColor="#AA7C11" />
                        <stop offset="50%" stopColor="#D4AF37" />
                        <stop offset="100%" stopColor="#F3E5AB" />
                      </linearGradient>
                    </defs>

                    {/* Horizontal grid lines */}
                    {[0, 0.25, 0.5, 0.75, 1].map((p, idx) => {
                      const y = chartSVGDimensions.padding + p * (chartSVGDimensions.height - chartSVGDimensions.padding * 2);
                      return (
                        <line 
                          key={idx} 
                          x1={chartSVGDimensions.padding} 
                          y1={y} 
                          x2={chartSVGDimensions.width - chartSVGDimensions.padding} 
                          y2={y} 
                          stroke="#1F2833" 
                          strokeWidth="0.75" 
                          strokeDasharray="4 4" 
                        />
                      );
                    })}

                    {/* Area under the line */}
                    <path d={svgPathData.area} fill="url(#chartGlow)" />

                    {/* The Line */}
                    <path d={svgPathData.line} fill="none" stroke="url(#chartStroke)" strokeWidth="2.5" strokeLinecap="round" />

                    {/* Interactive hover circle & overlay */}
                    {chartPoints.map((p, idx) => {
                      const { width, padding } = chartSVGDimensions;
                      const innerWidth = width - padding * 2;
                      const x = padding + (p.index / (chartPoints.length - 1)) * innerWidth;
                      
                      return (
                        <rect 
                          key={idx}
                          x={x - 10}
                          y={0}
                          width={20}
                          height={chartSVGDimensions.height}
                          fill="transparent"
                          className="cursor-pointer"
                          onMouseEnter={() => setHoveredChartPoint(idx)}
                        />
                      );
                    })}

                    {/* Hover cursor details */}
                    {hoveredChartPoint !== null && (
                      (() => {
                        const point = chartPoints[hoveredChartPoint];
                        const { width, height, padding } = chartSVGDimensions;
                        const { min, max } = chartBounds;
                        const range = max - min;
                        const innerWidth = width - padding * 2;
                        const innerHeight = height - padding * 2;
                        
                        const x = padding + (point.index / (chartPoints.length - 1)) * innerWidth;
                        const y = padding + innerHeight - ((point.price - min) / range) * innerHeight;

                        return (
                          <g>
                            <line x1={x} y1={padding} x2={x} y2={height - padding} stroke="#D4AF37" strokeWidth="1" strokeDasharray="3 3" />
                            <circle cx={x} cy={y} r={6} fill="#0B0C10" stroke="#D4AF37" strokeWidth="2.5" />
                          </g>
                        );
                      })()
                    )}
                  </svg>
                )}

                {/* Live rate pill boxes inside chart */}
                <div className="absolute top-4 left-4 grid grid-cols-2 gap-3 bg-charcoal bg-opacity-80 p-3 border border-gray-800 rounded-xl">
                  <div>
                    <span className="text-[9px] uppercase tracking-wider text-gray-500 block">Buy Gold (Ask)</span>
                    <span className="text-sm font-bold font-mono text-emerald-400">
                      {Math.round(getRateDetails(selectedKaratForChart).ask_g_toman).toLocaleString()} <span className="text-[9px] font-sans font-normal">T/g</span>
                    </span>
                  </div>
                  <div>
                    <span className="text-[9px] uppercase tracking-wider text-gray-500 block">Sell Gold (Bid)</span>
                    <span className="text-sm font-bold font-mono text-rose-400">
                      {Math.round(getRateDetails(selectedKaratForChart).bid_g_toman).toLocaleString()} <span className="text-[9px] font-sans font-normal">T/g</span>
                    </span>
                  </div>
                </div>

                {/* Tooltip detail element */}
                {hoveredChartPoint !== null && priceHistory[hoveredChartPoint] && (
                  <div className="absolute bottom-4 right-4 bg-charcoal bg-opacity-90 border border-gold border-opacity-30 p-2.5 rounded-lg text-right shadow-gold-glow">
                    <p className="text-[9px] text-gray-400">{new Date(priceHistory[hoveredChartPoint].timestamp).toLocaleString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</p>
                    <p className="text-xs font-bold text-white font-mono">
                      {Math.round((selectedKaratForChart === 18 ? priceHistory[hoveredChartPoint].rate18k : priceHistory[hoveredChartPoint].rate24k) / 10).toLocaleString()} Tomans/g
                    </p>
                    <p className="text-[9px] text-gold font-mono">
                      ({(selectedKaratForChart === 18 ? priceHistory[hoveredChartPoint].rate18k : priceHistory[hoveredChartPoint].rate24k).toLocaleString()} IRR/g)
                    </p>
                  </div>
                )}
              </div>
            </div>

            {/* Interactive Calculator Panel */}
            <div className="p-6 rounded-2xl glass-panel relative border border-gray-800">
              <div className="absolute right-0 top-0 w-24 h-24 bg-gold opacity-[0.01] rounded-full blur-xl ambient-gold-glow"></div>
              <h3 className="text-sm font-serif font-bold text-gold-light mb-4">MelliZarr Toman <span className="text-gray-500">&lt;&gt;</span> Milligram Converter</h3>
              
              <div className="space-y-4">
                {/* Karat select + direction toggle */}
                <div className="flex flex-col sm:flex-row justify-between items-stretch sm:items-center gap-3">
                  <div className="flex gap-2">
                    <button 
                      onClick={() => setCalcKarat(18)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all duration-300 ${calcKarat === 18 ? 'bg-gold text-charcoal' : 'bg-gray-900 text-gray-400 border border-gray-800'}`}
                    >
                      18k Gold
                    </button>
                    <button 
                      onClick={() => setCalcKarat(24)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all duration-300 ${calcKarat === 24 ? 'bg-gold text-charcoal' : 'bg-gray-900 text-gray-400 border border-gray-800'}`}
                    >
                      24k Gold
                    </button>
                  </div>

                  <button 
                    onClick={() => {
                      setCalcDirection(prev => prev === 'toman_to_mg' ? 'mg_to_toman' : 'toman_to_mg');
                    }}
                    className="px-3 py-1.5 bg-gray-900 border border-gray-800 rounded-lg text-xs font-semibold hover:border-gold hover:text-gold transition-all duration-300 active:scale-95 text-center"
                  >
                    Swap Direction ({calcDirection === 'toman_to_mg' ? 'Toman ➔ mg' : 'mg ➔ Toman'})
                  </button>
                </div>

                {/* Main input cards */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {/* Toman input */}
                  <div className="bg-charcoal-dark border border-gray-800 rounded-xl p-4 flex flex-col justify-between">
                    <label className="text-[10px] uppercase font-bold tracking-wider text-gray-500 mb-1">Toman Amount</label>
                    <div className="flex items-center justify-between">
                      <input 
                        type="number"
                        placeholder="0"
                        value={calcTomans}
                        onChange={(e) => {
                          setCalcDirection('toman_to_mg');
                          setCalcTomans(e.target.value);
                        }}
                        className="bg-transparent text-xl font-bold font-mono text-white outline-none w-full"
                      />
                      <span className="text-xs text-gray-400 ml-2">Tomans</span>
                    </div>
                  </div>

                  {/* Milligram input */}
                  <div className="bg-charcoal-dark border border-gray-800 rounded-xl p-4 flex flex-col justify-between">
                    <label className="text-[10px] uppercase font-bold tracking-wider text-gray-500 mb-1">Gold Weight (mg)</label>
                    <div className="flex items-center justify-between">
                      <input 
                        type="number"
                        placeholder="0.000"
                        value={calcMg}
                        onChange={(e) => {
                          setCalcDirection('mg_to_toman');
                          setCalcMg(e.target.value);
                        }}
                        className="bg-transparent text-xl font-bold font-mono text-gold-light outline-none w-full"
                      />
                      <span className="text-xs text-gray-400 ml-2">mg</span>
                    </div>
                  </div>
                </div>

                <div className="text-[10px] text-gray-500 text-center sm:text-right">
                  * Calculated based on local TGJU average base price: <span className="font-mono text-gray-400">{Math.round(getRateDetails(calcKarat).base_g_toman).toLocaleString()} Tomans/gram</span>
                </div>
              </div>
            </div>

          </div>

        </div>

        {/* Ledger Transaction History List */}
        <div className="p-6 rounded-2xl glass-panel relative border border-gray-800">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <History className="text-gold w-5 h-5" />
              <h3 className="text-md font-serif font-bold text-slate-100">Ledger Activity Feed</h3>
            </div>
            <span className="text-[10px] text-gray-500">Double-entry audit compliance logged</span>
          </div>

          <div className="overflow-x-auto w-full">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="border-b border-gray-800 text-gray-500 uppercase text-[10px] tracking-wider">
                  <th className="pb-3 font-semibold">Transaction ID</th>
                  <th className="pb-3 font-semibold">Type</th>
                  <th className="pb-3 font-semibold">Karat</th>
                  <th className="pb-3 font-semibold">Weight</th>
                  <th className="pb-3 font-semibold">Spot Price / mg</th>
                  <th className="pb-3 font-semibold">Total Value (Toman)</th>
                  <th className="pb-3 font-semibold text-right">Date</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-900 font-mono">
                {!transactions.length ? (
                  <tr>
                    <td colSpan={7} className="py-8 text-center text-gray-500 font-sans">
                      No ledger transactions found. Use the quick actions panel to make your first buy order.
                    </td>
                  </tr>
                ) : (
                  transactions.map((t) => {
                    const isSender = t.from_account === `USER_${userId}`;
                    const valueToman = Math.round(t.gold_weight_mg * t.spot_price_per_mg_irr / 10);
                    
                    return (
                      <tr key={t.transaction_id} className="hover:bg-charcoal-light hover:bg-opacity-10 transition-colors">
                        <td className="py-3 text-gray-400 max-w-[120px] truncate" title={t.transaction_id}>
                          {t.transaction_id.replace('TX_BUY_', '').replace('TX_SELL_', '').replace('TX_GIFT_', '').substring(0, 12)}...
                        </td>
                        <td className="py-3">
                          <span className={`px-2 py-0.5 rounded font-sans text-[10px] font-bold ${
                            t.tx_type === 'BUY' 
                              ? 'bg-emerald-500 bg-opacity-10 text-emerald-400' 
                              : t.tx_type === 'SELL' 
                                ? 'bg-rose-500 bg-opacity-10 text-rose-400'
                                : 'bg-gold bg-opacity-10 text-gold'
                          }`}>
                            {t.tx_type} {t.tx_type === 'GIFT_P2P' ? (isSender ? '➔ Sent' : '➔ Recv') : ''}
                          </span>
                        </td>
                        <td className="py-3 text-slate-100">{t.karat}k</td>
                        <td className={`py-3 font-bold ${isSender && t.tx_type !== 'BUY' ? 'text-rose-400' : 'text-emerald-400'}`}>
                          {isSender && t.tx_type !== 'BUY' ? '-' : '+'}{t.gold_weight_mg.toLocaleString()} mg
                        </td>
                        <td className="py-3 text-gray-400">
                          {Math.round(t.spot_price_per_mg_irr / 10).toLocaleString()} T
                        </td>
                        <td className="py-3 text-slate-200">
                          {valueToman.toLocaleString()}
                        </td>
                        <td className="py-3 text-right text-gray-500 font-sans text-[10px]">
                          {new Date(t.created_at).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>

        </main>
      )}

      {/* FOOTER */}
      <footer className="w-full text-center py-6 text-[10px] text-gray-600 border-t border-gray-900 mt-12 space-y-2">
        <p>© 2026 MelliZarr. All rights reserved. Backed by Grand Bazaar Gold vault network.</p>
        <p className="font-mono text-gray-700">Audit Protocol SHA256: 0000000000000000000000000000000000000000000000000000000000000000</p>
      </footer>

      {/* BUY MODAL */}
      {activeModal === 'buy' && (
        <div className="fixed inset-0 z-50 bg-charcoal bg-opacity-80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-charcoal-light border border-gray-800 rounded-2xl p-6 relative shadow-gold-glow">
            <button 
              onClick={() => { setActiveModal(null); setStatusMessage(null); }}
              className="absolute top-4 right-4 text-gray-400 hover:text-white transition-colors duration-300"
            >
              <X className="w-5 h-5" />
            </button>

            <h3 className="text-lg font-serif font-bold text-gold-light mb-4 flex items-center gap-2">
              <ArrowDownRight className="text-emerald-400" /> Buy Platform Gold (Tokenize)
            </h3>

            {/* Error/Success Feedbacks */}
            {statusMessage && (
              <div className={`p-4 rounded-xl mb-4 flex items-start gap-2 text-xs font-semibold ${statusMessage.type === 'success' ? 'bg-emerald-500 bg-opacity-10 text-emerald-400 border border-emerald-500 border-opacity-20' : 'bg-rose-500 bg-opacity-10 text-rose-400 border border-rose-500 border-opacity-20'}`}>
                {statusMessage.type === 'success' ? <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0" /> : <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />}
                <span>{statusMessage.text}</span>
              </div>
            )}

            <form onSubmit={handleBuyGold} className="space-y-4">
              
              {/* Karat select */}
              <div>
                <label className="text-[10px] uppercase font-bold tracking-wider text-gray-500 block mb-1.5">Select Gold Purity</label>
                <div className="grid grid-cols-2 gap-3">
                  <button 
                    type="button"
                    onClick={() => setModalKarat(18)}
                    className={`p-3 rounded-xl text-xs font-bold transition-all duration-300 ${modalKarat === 18 ? 'bg-gold text-charcoal shadow-gold-glow' : 'bg-gray-900 text-gray-400 border border-gray-800'}`}
                  >
                    18-Karat Rate ({Math.round(getRateDetails(18).ask_g_toman).toLocaleString()} T/g)
                  </button>
                  <button 
                    type="button"
                    onClick={() => setModalKarat(24)}
                    className={`p-3 rounded-xl text-xs font-bold transition-all duration-300 ${modalKarat === 24 ? 'bg-gold text-charcoal shadow-gold-glow' : 'bg-gray-900 text-gray-400 border border-gray-800'}`}
                  >
                    24-Karat Rate ({Math.round(getRateDetails(24).ask_g_toman).toLocaleString()} T/g)
                  </button>
                </div>
              </div>

              {/* Input Type Select */}
              <div className="flex gap-4 border-b border-gray-800 pb-2">
                <button 
                  type="button"
                  onClick={() => setModalInputType('toman')}
                  className={`text-xs font-bold ${modalInputType === 'toman' ? 'text-gold' : 'text-gray-500'}`}
                >
                  By Toman Amount
                </button>
                <button 
                  type="button"
                  onClick={() => setModalInputType('weight')}
                  className={`text-xs font-bold ${modalInputType === 'weight' ? 'text-gold' : 'text-gray-500'}`}
                >
                  By Milligram Weight
                </button>
              </div>

              {/* Amount Inputs */}
              {modalInputType === 'toman' ? (
                <div>
                  <label className="text-[10px] uppercase font-bold tracking-wider text-gray-500 block mb-1">Buy Toman Amount</label>
                  <div className="bg-charcoal-dark border border-gray-800 rounded-xl p-3 flex justify-between items-center">
                    <input 
                      type="number"
                      placeholder="Min 100,000"
                      value={modalAmountToman}
                      onChange={(e) => setModalAmountToman(e.target.value)}
                      className="bg-transparent font-bold font-mono text-white outline-none w-full"
                    />
                    <span className="text-xs text-gray-400">Tomans</span>
                  </div>
                  <span className="text-[9px] text-gray-500 mt-1 block">
                    Equivalent Gold Weight: <span className="font-mono text-gray-400">
                      {modalAmountToman ? (parseFloat(modalAmountToman) / getRateDetails(modalKarat).ask_mg_toman).toFixed(3) : '0.000'} mg
                    </span>
                  </span>
                </div>
              ) : (
                <div>
                  <label className="text-[10px] uppercase font-bold tracking-wider text-gray-500 block mb-1">Buy Weight (mg)</label>
                  <div className="bg-charcoal-dark border border-gray-800 rounded-xl p-3 flex justify-between items-center">
                    <input 
                      type="number"
                      placeholder="Min 1"
                      value={modalAmountWeightMg}
                      onChange={(e) => setModalAmountWeightMg(e.target.value)}
                      className="bg-transparent font-bold font-mono text-white outline-none w-full"
                    />
                    <span className="text-xs text-gray-400">mg</span>
                  </div>
                  <span className="text-[9px] text-gray-500 mt-1 block">
                    Estimated Cost: <span className="font-mono text-gray-400">
                      {modalAmountWeightMg ? Math.round(parseFloat(modalAmountWeightMg) * getRateDetails(modalKarat).ask_mg_toman).toLocaleString() : '0'} Tomans
                    </span>
                  </span>
                </div>
              )}

              {/* Confirm details */}
              <div className="bg-charcoal-dark border border-gray-900 rounded-xl p-3.5 space-y-2 text-xs">
                <div className="flex justify-between">
                  <span className="text-gray-500">Karat Selected</span>
                  <span className="text-white font-mono">{modalKarat}k</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">Ask Rate (Spot + Spread)</span>
                  <span className="text-white font-mono">{Math.round(getRateDetails(modalKarat).ask_g_toman).toLocaleString()} T/g</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">Min Order Requirement</span>
                  <span className="text-white font-mono">10,000 Tomans (1 mg)</span>
                </div>
              </div>

              <button 
                type="submit"
                disabled={actionLoading}
                className="w-full py-3 bg-gradient-to-r from-gold-dark to-gold text-charcoal font-bold text-xs rounded-xl shadow-gold-glow hover:scale-[1.02] active:scale-95 transition-all duration-300 disabled:opacity-50 disabled:pointer-events-none"
              >
                {actionLoading ? 'Verifying Liquidity on Ledger...' : 'Confirm Tokenize Order'}
              </button>

            </form>
          </div>
        </div>
      )}

      {/* SELL MODAL */}
      {activeModal === 'sell' && (
        <div className="fixed inset-0 z-50 bg-charcoal bg-opacity-80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-charcoal-light border border-gray-800 rounded-2xl p-6 relative shadow-gold-glow">
            <button 
              onClick={() => { setActiveModal(null); setStatusMessage(null); }}
              className="absolute top-4 right-4 text-gray-400 hover:text-white transition-colors duration-300"
            >
              <X className="w-5 h-5" />
            </button>

            <h3 className="text-lg font-serif font-bold text-gold-light mb-4 flex items-center gap-2">
              <ArrowUpLeft className="text-rose-400" /> Sell Gold (De-tokenize)
            </h3>

            {statusMessage && (
              <div className={`p-4 rounded-xl mb-4 flex items-start gap-2 text-xs font-semibold ${statusMessage.type === 'success' ? 'bg-emerald-500 bg-opacity-10 text-emerald-400 border border-emerald-500 border-opacity-20' : 'bg-rose-500 bg-opacity-10 text-rose-400 border border-rose-500 border-opacity-20'}`}>
                {statusMessage.type === 'success' ? <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0" /> : <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />}
                <span>{statusMessage.text}</span>
              </div>
            )}

            <form onSubmit={handleSellGold} className="space-y-4">
              
              {/* Karat select */}
              <div>
                <label className="text-[10px] uppercase font-bold tracking-wider text-gray-500 block mb-1.5">Select Gold Purity</label>
                <div className="grid grid-cols-2 gap-3">
                  <button 
                    type="button"
                    onClick={() => setModalKarat(18)}
                    className={`p-3 rounded-xl text-xs font-bold transition-all duration-300 ${modalKarat === 18 ? 'bg-gold text-charcoal shadow-gold-glow' : 'bg-gray-900 text-gray-400 border border-gray-800'}`}
                  >
                    18-Karat Rate ({Math.round(getRateDetails(18).bid_g_toman).toLocaleString()} T/g)
                  </button>
                  <button 
                    type="button"
                    onClick={() => setModalKarat(24)}
                    className={`p-3 rounded-xl text-xs font-bold transition-all duration-300 ${modalKarat === 24 ? 'bg-gold text-charcoal shadow-gold-glow' : 'bg-gray-900 text-gray-400 border border-gray-800'}`}
                  >
                    24-Karat Rate ({Math.round(getRateDetails(24).bid_g_toman).toLocaleString()} T/g)
                  </button>
                </div>
              </div>

              {/* Input Type Select */}
              <div className="flex gap-4 border-b border-gray-800 pb-2">
                <button 
                  type="button"
                  onClick={() => setModalInputType('toman')}
                  className={`text-xs font-bold ${modalInputType === 'toman' ? 'text-gold' : 'text-gray-500'}`}
                >
                  By Toman Amount
                </button>
                <button 
                  type="button"
                  onClick={() => setModalInputType('weight')}
                  className={`text-xs font-bold ${modalInputType === 'weight' ? 'text-gold' : 'text-gray-500'}`}
                >
                  By Milligram Weight
                </button>
              </div>

              {/* Amount Inputs */}
              {modalInputType === 'toman' ? (
                <div>
                  <label className="text-[10px] uppercase font-bold tracking-wider text-gray-500 block mb-1">Sell Toman Amount</label>
                  <div className="bg-charcoal-dark border border-gray-800 rounded-xl p-3 flex justify-between items-center">
                    <input 
                      type="number"
                      placeholder="0"
                      value={modalAmountToman}
                      onChange={(e) => setModalAmountToman(e.target.value)}
                      className="bg-transparent font-bold font-mono text-white outline-none w-full"
                    />
                    <span className="text-xs text-gray-400">Tomans</span>
                  </div>
                  <span className="text-[9px] text-gray-500 mt-1 block">
                    Equivalent Weight to Deduct: <span className="font-mono text-gray-400">
                      {modalAmountToman ? (parseFloat(modalAmountToman) / getRateDetails(modalKarat).bid_mg_toman).toFixed(3) : '0.000'} mg
                    </span>
                  </span>
                </div>
              ) : (
                <div>
                  <label className="text-[10px] uppercase font-bold tracking-wider text-gray-500 block mb-1">Sell Weight (mg)</label>
                  <div className="bg-charcoal-dark border border-gray-800 rounded-xl p-3 flex justify-between items-center">
                    <input 
                      type="number"
                      placeholder="Min 1"
                      value={modalAmountWeightMg}
                      onChange={(e) => setModalAmountWeightMg(e.target.value)}
                      className="bg-transparent font-bold font-mono text-white outline-none w-full"
                    />
                    <span className="text-xs text-gray-400">mg</span>
                  </div>
                  <span className="text-[9px] text-gray-500 mt-1 block">
                    Estimated Proceeds: <span className="font-mono text-gray-400">
                      {modalAmountWeightMg ? Math.round(parseFloat(modalAmountWeightMg) * getRateDetails(modalKarat).bid_mg_toman).toLocaleString() : '0'} Tomans
                    </span>
                  </span>
                </div>
              )}

              {/* Current balance context */}
              <div className="bg-charcoal-dark border border-gray-900 rounded-xl p-3.5 space-y-2 text-xs">
                <div className="flex justify-between">
                  <span className="text-gray-500">Karat Selected</span>
                  <span className="text-white font-mono">{modalKarat}k</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">Current holdings for {modalKarat}k</span>
                  <span className="text-gold font-bold font-mono">
                    {modalKarat === 18 ? goldBalance.karat18_mg.toLocaleString() : goldBalance.karat24_mg.toLocaleString()} mg
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">Bid Rate (Spot - Spread)</span>
                  <span className="text-white font-mono">{Math.round(getRateDetails(modalKarat).bid_g_toman).toLocaleString()} T/g</span>
                </div>
              </div>

              <button 
                type="submit"
                disabled={actionLoading}
                className="w-full py-3 bg-gradient-to-r from-rose-700 to-rose-500 text-white font-bold text-xs rounded-xl shadow-md hover:scale-[1.02] active:scale-95 transition-all duration-300 disabled:opacity-50 disabled:pointer-events-none"
              >
                {actionLoading ? 'Liquidating gold reserve...' : 'Confirm De-tokenize Order'}
              </button>

            </form>
          </div>
        </div>
      )}

      {/* P2P GIFT MODAL */}
      {activeModal === 'gift' && (
        <div className="fixed inset-0 z-50 bg-charcoal bg-opacity-80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-charcoal-light border border-gray-800 rounded-2xl p-6 relative shadow-gold-glow">
            <button 
              onClick={() => { setActiveModal(null); setStatusMessage(null); }}
              className="absolute top-4 right-4 text-gray-400 hover:text-white transition-colors duration-300"
            >
              <X className="w-5 h-5" />
            </button>

            <h3 className="text-lg font-serif font-bold text-gold-light mb-4 flex items-center gap-2">
              <Gift className="text-gold" /> MelliZarr Gold Gift (P2P Ledger Transfer)
            </h3>

            {statusMessage && (
              <div className={`p-4 rounded-xl mb-4 flex items-start gap-2 text-xs font-semibold ${statusMessage.type === 'success' ? 'bg-emerald-500 bg-opacity-10 text-emerald-400 border border-emerald-500 border-opacity-20' : 'bg-rose-500 bg-opacity-10 text-rose-400 border border-rose-500 border-opacity-20'}`}>
                {statusMessage.type === 'success' ? <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0" /> : <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />}
                <span>{statusMessage.text}</span>
              </div>
            )}

            <form onSubmit={handleGiftGold} className="space-y-4">
              
              {/* Karat select */}
              <div>
                <label className="text-[10px] uppercase font-bold tracking-wider text-gray-500 block mb-1.5">Select Gold Purity</label>
                <div className="grid grid-cols-2 gap-3">
                  <button 
                    type="button"
                    onClick={() => setModalKarat(18)}
                    className={`p-3 rounded-xl text-xs font-bold transition-all duration-300 ${modalKarat === 18 ? 'bg-gold text-charcoal shadow-gold-glow' : 'bg-gray-900 text-gray-400 border border-gray-800'}`}
                  >
                    18-Karat Gold
                  </button>
                  <button 
                    type="button"
                    onClick={() => setModalKarat(24)}
                    className={`p-3 rounded-xl text-xs font-bold transition-all duration-300 ${modalKarat === 24 ? 'bg-gold text-charcoal shadow-gold-glow' : 'bg-gray-900 text-gray-400 border border-gray-800'}`}
                  >
                    24-Karat Gold
                  </button>
                </div>
              </div>

              {/* Recipient Mobile number */}
              <div>
                <label className="text-[10px] uppercase font-bold tracking-wider text-gray-500 block mb-1">Recipient Mobile Number</label>
                <div className="bg-charcoal-dark border border-gray-800 rounded-xl p-3 flex justify-between items-center">
                  <Smartphone className="w-5 h-5 text-gray-500 mr-2" />
                  <input 
                    type="text"
                    placeholder="e.g. 09123456789"
                    value={modalRecipientMobile}
                    onChange={(e) => setModalRecipientMobile(e.target.value)}
                    className="bg-transparent font-bold font-mono text-white outline-none w-full"
                  />
                </div>
                <span className="text-[9px] text-gray-500 mt-1 block">
                  Must be registered under Shahkar verification to accept transfers.
                </span>
              </div>

              {/* Weight input */}
              <div>
                <label className="text-[10px] uppercase font-bold tracking-wider text-gray-500 block mb-1">Gift Weight (mg)</label>
                <div className="bg-charcoal-dark border border-gray-800 rounded-xl p-3 flex justify-between items-center">
                  <input 
                    type="number"
                    placeholder="Min 1"
                    value={modalAmountWeightMg}
                    onChange={(e) => setModalAmountWeightMg(e.target.value)}
                    className="bg-transparent font-bold font-mono text-white outline-none w-full"
                  />
                  <span className="text-xs text-gray-400">mg</span>
                </div>
                <span className="text-[9px] text-gray-500 mt-1 block">
                  Estimated market value: <span className="font-mono text-gray-400">
                    {modalAmountWeightMg ? Math.round(parseFloat(modalAmountWeightMg) * (getRateDetails(modalKarat).base_g_toman / 1000.0)).toLocaleString() : '0'} Tomans
                  </span>
                </span>
              </div>

              {/* Current balance Context */}
              <div className="bg-charcoal-dark border border-gray-900 rounded-xl p-3.5 space-y-2 text-xs">
                <div className="flex justify-between">
                  <span className="text-gray-500">Sender Account</span>
                  <span className="text-white font-mono">{profile?.first_name} {profile?.last_name}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">Available {modalKarat}k Balance</span>
                  <span className="text-gold font-bold font-mono">
                    {modalKarat === 18 ? goldBalance.karat18_mg.toLocaleString() : goldBalance.karat24_mg.toLocaleString()} mg
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">Audit Status</span>
                  <span className="text-emerald-400 font-bold">100% Backed Reserves</span>
                </div>
              </div>

              <button 
                type="submit"
                disabled={actionLoading}
                className="w-full py-3 bg-gradient-to-r from-gold-dark to-gold text-charcoal font-bold text-xs rounded-xl shadow-gold-glow hover:scale-[1.02] active:scale-95 transition-all duration-300 disabled:opacity-50 disabled:pointer-events-none"
              >
                {actionLoading ? 'Broadcasting double-entry block...' : 'Transmit Gold Gift'}
              </button>

            </form>
          </div>
        </div>
      )}

    </div>
  );
}

// ============================================================================
// CO-FOUNDER MULTISIG ADMIN PANEL COMPONENT
// ============================================================================
interface MultisigRequest {
  request_id: string;
  requested_by: string;
  action_type: string;
  action_payload: any;
  approved_by_tech: boolean;
  approved_by_biz: boolean;
  status: string;
  created_at: string;
  updated_at: string;
}

function AdminMultisigPanel({
  API_BASE,
  DEFAULT_USER_ID,
  navigateTo,
}: {
  API_BASE: string;
  DEFAULT_USER_ID: string;
  navigateTo: (path: string) => void;
}) {
  const [requests, setRequests] = useState<MultisigRequest[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [success, setSuccess] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Form States
  const [requestedBy, setRequestedBy] = useState<'TECH_FOUNDER' | 'BIZ_FOUNDER'>('TECH_FOUNDER');
  const [actionType, setActionType] = useState<'MANUAL_LEDGER_ADJUSTMENT' | 'BULK_WITHDRAWAL' | 'HEDGE_LIQUIDATION'>('MANUAL_LEDGER_ADJUSTMENT');

  // Ledger form states
  const [fromAccount, setFromAccount] = useState<string>('SYSTEM_RESERVE');
  const [toAccount, setToAccount] = useState<string>(`USER_${DEFAULT_USER_ID}`);
  const [goldWeightMg, setGoldWeightMg] = useState<string>('150000');
  const [karat, setKarat] = useState<18 | 24>(24);
  const [txType, setTxType] = useState<string>('RESERVE_INVENTORY');
  const [spotPricePerMgIrr, setSpotPricePerMgIrr] = useState<string>('42660');

  // Withdrawal form states
  const [withdrawUserId, setWithdrawUserId] = useState<string>(DEFAULT_USER_ID);
  const [withdrawAmountIrr, setWithdrawAmountIrr] = useState<string>('75000000');

  // Hedge form states
  const [hedgeAsset, setHedgeAsset] = useState<string>('GOLD_FUTURE_HEX_06');
  const [hedgeValueIrr, setHedgeValueIrr] = useState<string>('250000000');

  useEffect(() => {
    fetchRequests();
  }, []);

  const fetchRequests = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/api/multisig/requests`);
      const data = await res.json();
      if (data.success) {
        setRequests(data.requests);
      } else {
        setError(data.message || 'Failed to fetch requests.');
      }
    } catch (err) {
      console.error(err);
      setError('Failed to connect to core API.');
    } finally {
      setLoading(false);
    }
  };

  const handleApprove = async (requestId: string, adminType: 'tech' | 'biz') => {
    setSubmitting(true);
    setError(null);
    setSuccess(null);
    try {
      const res = await fetch(`${API_BASE}/api/multisig/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ request_id: requestId, admin_type: adminType }),
      });
      const data = await res.json();
      if (data.success) {
        setSuccess(data.message);
        fetchRequests();
      } else {
        setError(data.message || 'Approval failed.');
      }
    } catch (err) {
      console.error(err);
      setError('Connection failed.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleSubmitRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    setSuccess(null);

    let payload: any = {};
    if (actionType === 'MANUAL_LEDGER_ADJUSTMENT') {
      payload = {
        from_account: fromAccount,
        to_account: toAccount,
        gold_weight_mg: parseFloat(goldWeightMg),
        karat: karat,
        tx_type: txType,
        spot_price_per_mg_irr: parseFloat(spotPricePerMgIrr),
      };
    } else if (actionType === 'BULK_WITHDRAWAL') {
      payload = {
        user_id: withdrawUserId,
        amount_irr: parseFloat(withdrawAmountIrr),
      };
    } else {
      payload = {
        asset: hedgeAsset,
        liquidation_value_irr: parseFloat(hedgeValueIrr),
      };
    }

    try {
      const res = await fetch(`${API_BASE}/api/multisig/request`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requested_by: requestedBy,
          action_type: actionType,
          action_payload: payload,
        }),
      });
      const data = await res.json();
      if (data.success) {
        setSuccess('Multisig request successfully proposed.');
        fetchRequests();
      } else {
        setError(data.message || 'Failed to submit request.');
      }
    } catch (err) {
      console.error(err);
      setError('Connection failed.');
    } finally {
      setSubmitting(false);
    }
  };

  const formatPayload = (type: string, payload: any) => {
    const parsed = typeof payload === 'string' ? JSON.parse(payload) : payload;
    if (type === 'MANUAL_LEDGER_ADJUSTMENT') {
      return (
        <div className="space-y-1 text-xs font-mono text-gray-400">
          <p><span className="text-gold">From:</span> {parsed.from_account}</p>
          <p><span className="text-gold">To:</span> {parsed.to_account}</p>
          <p><span className="text-gold">Weight:</span> {parsed.gold_weight_mg?.toLocaleString()} mg ({parsed.karat}k)</p>
          <p><span className="text-gold">Type:</span> {parsed.tx_type}</p>
          <p><span className="text-gold">Spot Rate:</span> {Math.round(parsed.spot_price_per_mg_irr / 10).toLocaleString()} T/mg <span className="text-gray-600">({parsed.spot_price_per_mg_irr} IRR)</span></p>
          <p className="text-slate-100 font-sans mt-2 pt-2 border-t border-gray-800">
            Total Value: <strong className="text-gold font-mono">{Math.round((parsed.gold_weight_mg * parsed.spot_price_per_mg_irr) / 10).toLocaleString()} Tomans</strong>
          </p>
        </div>
      );
    }
    if (type === 'BULK_WITHDRAWAL') {
      return (
        <div className="space-y-1 text-xs font-mono text-gray-400">
          <p><span className="text-gold">User ID:</span> {parsed.user_id}</p>
          <p><span className="text-gold">Amount:</span> {Math.round(parsed.amount_irr / 10).toLocaleString()} Tomans <span className="text-gray-600">({parsed.amount_irr.toLocaleString()} IRR)</span></p>
        </div>
      );
    }
    if (type === 'HEDGE_LIQUIDATION') {
      return (
        <div className="space-y-1 text-xs font-mono text-gray-400">
          <p><span className="text-gold">Asset Ref:</span> {parsed.asset}</p>
          <p><span className="text-gold">Liquidation Val:</span> {Math.round(parsed.liquidation_value_irr / 10).toLocaleString()} Tomans <span className="text-gray-600">({parsed.liquidation_value_irr.toLocaleString()} IRR)</span></p>
        </div>
      );
    }
    return <pre className="text-[10px]">{JSON.stringify(parsed, null, 2)}</pre>;
  };

  return (
    <main className="flex-1 w-full max-w-7xl mx-auto px-4 py-6 sm:px-6 md:px-8 space-y-6">
      {/* Page Header */}
      <div className="p-6 rounded-2xl glass-panel-gold border-gold border-opacity-20 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 relative overflow-hidden">
        <div className="absolute right-0 top-0 w-32 h-32 bg-gold opacity-[0.03] rounded-full blur-2xl ambient-gold-glow"></div>
        <div className="space-y-1 text-left">
          <div className="flex items-center gap-2">
            <span className="bg-gold bg-opacity-20 text-gold-light text-[10px] font-bold uppercase tracking-widest px-2 py-0.5 rounded-md">2/2 Signatures Required</span>
            <Key className="w-4 h-4 text-gold animate-bounce" />
          </div>
          <h2 className="text-2xl font-serif font-bold text-gold-gradient">Co-Founder Governance Vault</h2>
          <p className="text-xs text-gray-400 max-w-2xl">
            This secure interface governs tokenized physical reserves, double-entry bookkeeping, and large treasury movements. All actions staged here require cryptographic consent from both Tech and Biz Co-founders before write operations execute.
          </p>
        </div>
        <button 
          onClick={fetchRequests}
          className="p-2.5 bg-gray-900 border border-gray-800 hover:border-gold hover:text-gold rounded-xl transition-all duration-300 active:scale-95 text-gray-400 cursor-pointer"
          title="Sync Feed"
        >
          <RefreshCw className="w-4 h-4" />
        </button>
      </div>

      {/* Global Alerts */}
      {success && (
        <div className="p-4 rounded-xl bg-emerald-500 bg-opacity-10 text-emerald-400 border border-emerald-500 border-opacity-20 flex items-start gap-2 text-xs font-semibold text-left">
          <Check className="w-4 h-4 mt-0.5 shrink-0" />
          <span>{success}</span>
        </div>
      )}
      {error && (
        <div className="p-4 rounded-xl bg-rose-500 bg-opacity-10 text-rose-400 border border-rose-500 border-opacity-20 flex items-start gap-2 text-xs font-semibold text-left">
          <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Dashboard Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        
        {/* Left: Proposal Creation Form */}
        <div className="lg:col-span-5 p-6 rounded-2xl glass-panel border border-gray-800 space-y-6 text-left">
          <div>
            <h3 className="text-sm font-serif font-bold text-gold-light flex items-center gap-2">
              <Plus className="w-4 h-4" /> Stage Vault Operation
            </h3>
            <p className="text-[10px] text-gray-500">Propose a financial ledger mutation</p>
          </div>

          <form onSubmit={handleSubmitRequest} className="space-y-4">
            {/* Proposer Toggle */}
            <div>
              <label className="text-[10px] uppercase font-bold tracking-wider text-gray-500 block mb-1.5 font-sans">Proposing Key</label>
              <div className="grid grid-cols-2 gap-2 bg-gray-900 p-1 rounded-xl border border-gray-800">
                <button
                  type="button"
                  onClick={() => setRequestedBy('TECH_FOUNDER')}
                  className={`py-2 rounded-lg text-xs font-bold transition-all duration-300 cursor-pointer ${requestedBy === 'TECH_FOUNDER' ? 'bg-gold text-charcoal shadow-gold-glow' : 'text-gray-400 hover:text-white'}`}
                >
                  Tech Founder
                </button>
                <button
                  type="button"
                  onClick={() => setRequestedBy('BIZ_FOUNDER')}
                  className={`py-2 rounded-lg text-xs font-bold transition-all duration-300 cursor-pointer ${requestedBy === 'BIZ_FOUNDER' ? 'bg-gold text-charcoal shadow-gold-glow' : 'text-gray-400 hover:text-white'}`}
                >
                  Biz Founder
                </button>
              </div>
            </div>

            {/* Action Type Tabs */}
            <div>
              <label className="text-[10px] uppercase font-bold tracking-wider text-gray-500 block mb-1.5 font-sans">Operation Type</label>
              <div className="space-y-2">
                <button
                  type="button"
                  onClick={() => setActionType('MANUAL_LEDGER_ADJUSTMENT')}
                  className={`w-full py-2 px-3 rounded-lg text-left text-xs font-semibold border transition-all duration-300 flex items-center justify-between cursor-pointer ${actionType === 'MANUAL_LEDGER_ADJUSTMENT' ? 'bg-gold bg-opacity-10 text-gold border-gold' : 'bg-gray-900 text-gray-400 border-gray-800 hover:border-gray-700'}`}
                >
                  <span>1. Ledger Adjustment</span>
                  <Coins className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => setActionType('BULK_WITHDRAWAL')}
                  className={`w-full py-2 px-3 rounded-lg text-left text-xs font-semibold border transition-all duration-300 flex items-center justify-between cursor-pointer ${actionType === 'BULK_WITHDRAWAL' ? 'bg-gold bg-opacity-10 text-gold border-gold' : 'bg-gray-900 text-gray-400 border-gray-800 hover:border-gray-700'}`}
                >
                  <span>2. Bulk Cash Withdrawal</span>
                  <Wallet className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => setActionType('HEDGE_LIQUIDATION')}
                  className={`w-full py-2 px-3 rounded-lg text-left text-xs font-semibold border transition-all duration-300 flex items-center justify-between cursor-pointer ${actionType === 'HEDGE_LIQUIDATION' ? 'bg-gold bg-opacity-10 text-gold border-gold' : 'bg-gray-900 text-gray-400 border-gray-800 hover:border-gray-700'}`}
                >
                  <span>3. Hedge Liquidation</span>
                  <FileText className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>

            {/* Dynamic Input Sections */}
            {actionType === 'MANUAL_LEDGER_ADJUSTMENT' && (
              <div className="space-y-3 pt-2 border-t border-gray-900">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-[10px] text-gray-500 block mb-1 font-sans">From Account</label>
                    <input 
                      type="text" 
                      value={fromAccount} 
                      onChange={(e) => setFromAccount(e.target.value)}
                      className="w-full bg-gray-900 border border-gray-800 focus:border-gold rounded-lg px-2.5 py-1.5 text-xs text-white outline-none font-mono"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] text-gray-500 block mb-1 font-sans">To Account</label>
                    <input 
                      type="text" 
                      value={toAccount} 
                      onChange={(e) => setToAccount(e.target.value)}
                      className="w-full bg-gray-900 border border-gray-800 focus:border-gold rounded-lg px-2.5 py-1.5 text-xs text-white outline-none font-mono"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-[10px] text-gray-500 block mb-1 font-sans">Gold Weight (mg)</label>
                    <input 
                      type="number" 
                      value={goldWeightMg} 
                      onChange={(e) => setGoldWeightMg(e.target.value)}
                      className="w-full bg-gray-900 border border-gray-800 focus:border-gold rounded-lg px-2.5 py-1.5 text-xs text-white outline-none font-mono"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] text-gray-500 block mb-1 font-sans">Karat</label>
                    <select 
                      value={karat} 
                      onChange={(e) => setKarat(parseInt(e.target.value) as 18 | 24)}
                      className="w-full bg-gray-900 border border-gray-800 focus:border-gold rounded-lg px-2.5 py-1.5 text-xs text-white outline-none"
                    >
                      <option value="24">24 Karat</option>
                      <option value="18">18 Karat</option>
                    </select>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-[10px] text-gray-500 block mb-1 font-sans">Tx Type</label>
                    <select 
                      value={txType} 
                      onChange={(e) => setTxType(e.target.value)}
                      className="w-full bg-gray-900 border border-gray-800 focus:border-gold rounded-lg px-2.5 py-1.5 text-xs text-white outline-none"
                    >
                      <option value="RESERVE_INVENTORY">RESERVE_INVENTORY</option>
                      <option value="BUY">BUY</option>
                      <option value="SELL">SELL</option>
                      <option value="GIFT_P2P">GIFT_P2P</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-[10px] text-gray-500 block mb-1 font-sans">Spot Price (IRR/mg)</label>
                    <input 
                      type="number" 
                      value={spotPricePerMgIrr} 
                      onChange={(e) => setSpotPricePerMgIrr(e.target.value)}
                      className="w-full bg-gray-900 border border-gray-800 focus:border-gold rounded-lg px-2.5 py-1.5 text-xs text-white outline-none font-mono"
                    />
                  </div>
                </div>
              </div>
            )}

            {actionType === 'BULK_WITHDRAWAL' && (
              <div className="space-y-3 pt-2 border-t border-gray-900">
                <div>
                  <label className="text-[10px] text-gray-500 block mb-1 font-sans">User ID (UUID)</label>
                  <input 
                    type="text" 
                    value={withdrawUserId} 
                    onChange={(e) => setWithdrawUserId(e.target.value)}
                    className="w-full bg-gray-900 border border-gray-800 focus:border-gold rounded-lg px-2.5 py-1.5 text-xs text-white outline-none font-mono"
                  />
                </div>
                <div>
                  <label className="text-[10px] text-gray-500 block mb-1 font-sans">Withdrawal Amount (IRR)</label>
                  <input 
                    type="number" 
                    value={withdrawAmountIrr} 
                    onChange={(e) => setWithdrawAmountIrr(e.target.value)}
                    className="w-full bg-gray-900 border border-gray-800 focus:border-gold rounded-lg px-2.5 py-1.5 text-xs text-white outline-none font-mono"
                  />
                  <span className="text-[9px] text-gray-500 mt-1 block">
                    Equivalent to: <span className="font-mono text-gray-400">{Math.round(parseFloat(withdrawAmountIrr || '0') / 10).toLocaleString()} Tomans</span>
                  </span>
                </div>
              </div>
            )}

            {actionType === 'HEDGE_LIQUIDATION' && (
              <div className="space-y-3 pt-2 border-t border-gray-900">
                <div>
                  <label className="text-[10px] text-gray-500 block mb-1 font-sans">Asset Reference Code</label>
                  <input 
                    type="text" 
                    value={hedgeAsset} 
                    onChange={(e) => setHedgeAsset(e.target.value)}
                    className="w-full bg-gray-900 border border-gray-800 focus:border-gold rounded-lg px-2.5 py-1.5 text-xs text-white outline-none font-mono"
                  />
                </div>
                <div>
                  <label className="text-[10px] text-gray-500 block mb-1 font-sans">Liquidation Valuation (IRR)</label>
                  <input 
                    type="number" 
                    value={hedgeValueIrr} 
                    onChange={(e) => setHedgeValueIrr(e.target.value)}
                    className="w-full bg-gray-900 border border-gray-800 focus:border-gold rounded-lg px-2.5 py-1.5 text-xs text-white outline-none font-mono"
                  />
                  <span className="text-[9px] text-gray-500 mt-1 block">
                    Equivalent to: <span className="font-mono text-gray-400">{Math.round(parseFloat(hedgeValueIrr || '0') / 10).toLocaleString()} Tomans</span>
                  </span>
                </div>
              </div>
            )}

            <button
              type="submit"
              disabled={submitting}
              className="w-full py-3 mt-4 bg-gradient-to-r from-gold-dark to-gold text-charcoal font-bold text-xs rounded-xl shadow-gold-glow hover:scale-[1.02] active:scale-95 transition-all duration-300 disabled:opacity-50 cursor-pointer"
            >
              {submitting ? 'Staging proposal...' : 'Propose Vault Operation'}
            </button>
          </form>
        </div>

        {/* Right: Key Vault Request Feed */}
        <div className="lg:col-span-7 space-y-6 text-left">
          <div className="flex items-center justify-between border-b border-gray-900 pb-3">
            <div>
              <h3 className="text-sm font-serif font-bold text-slate-100 flex items-center gap-2">
                <FileText className="text-gold w-4 h-4" /> Staged Key Vault Operations
              </h3>
              <p className="text-[10px] text-gray-500">Live multi-signature approval queue</p>
            </div>
            <span className="text-xs font-mono bg-gray-900 px-2 py-0.5 rounded border border-gray-800 text-gray-400">{requests.length} Requests</span>
          </div>

          {loading ? (
            <div className="py-16 text-center text-xs text-gray-500">
              <div className="w-8 h-8 rounded-full border-2 border-gold-dark border-t-gold animate-spin mx-auto mb-3"></div>
              Querying multi-signature queue...
            </div>
          ) : requests.length === 0 ? (
            <div className="py-16 text-center text-xs text-gray-500 glass-panel border border-gray-800">
              No staged transactions found in key vault. Use the proposal form on the left to queue an operation.
            </div>
          ) : (
            <div className="space-y-4">
              {requests.map((req) => {
                const isPending = req.status === 'PENDING_APPROVAL';
                return (
                  <div 
                    key={req.request_id} 
                    className={`p-5 rounded-2xl glass-panel relative border ${req.status === 'EXECUTED' ? 'border-emerald-500 border-opacity-10 bg-emerald-950 bg-opacity-[0.02]' : 'border-gray-800'}`}
                  >
                    {/* Header */}
                    <div className="flex justify-between items-start gap-4 mb-3">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className={`px-2 py-0.5 rounded font-sans text-[8px] font-bold ${
                            req.action_type === 'MANUAL_LEDGER_ADJUSTMENT' 
                              ? 'bg-amber-500 bg-opacity-10 text-amber-400 border border-amber-500 border-opacity-10' 
                              : req.action_type === 'BULK_WITHDRAWAL' 
                                ? 'bg-emerald-500 bg-opacity-10 text-emerald-400 border border-emerald-500 border-opacity-10'
                                : 'bg-purple-500 bg-opacity-10 text-purple-400 border border-purple-500 border-opacity-10'
                          }`}>
                            {req.action_type.replace(/_/g, ' ')}
                          </span>
                          <span className="text-[9px] text-gray-500 font-mono">ID: {req.request_id.substring(0, 8)}...</span>
                        </div>
                        <span className="text-[9px] text-gray-500 mt-1 block">
                          Proposed by: <strong className="text-gray-400">{req.requested_by.replace('_', ' ')}</strong> • {new Date(req.created_at).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}
                        </span>
                      </div>

                      {/* Status badge */}
                      <span className={`px-2 py-0.5 rounded font-sans text-[9px] font-bold ${
                        req.status === 'EXECUTED' 
                          ? 'bg-emerald-500 bg-opacity-10 text-emerald-400' 
                          : 'bg-yellow-500 bg-opacity-10 text-yellow-400 animate-pulse'
                      }`}>
                        {req.status === 'EXECUTED' ? '✓ EXECUTED' : 'PENDING APPROVAL'}
                      </span>
                    </div>

                    {/* Content Block */}
                    <div className="bg-charcoal-dark border border-gray-900 border-opacity-50 rounded-xl p-3.5 my-3">
                      {formatPayload(req.action_type, req.action_payload)}
                    </div>

                    {/* Footer / Dual Approval Buttons */}
                    <div className="grid grid-cols-2 gap-3 pt-3 border-t border-gray-900 border-opacity-50">
                      {/* Admin 1 (Tech) Approval Control */}
                      {req.approved_by_tech ? (
                        <div className="flex items-center justify-center gap-1.5 py-2 rounded-xl bg-emerald-500 bg-opacity-10 border border-emerald-500 border-opacity-20 text-emerald-400 text-xs font-bold">
                          <Check className="w-3.5 h-3.5" />
                          <span>Admin 1 (Tech) approved</span>
                        </div>
                      ) : isPending ? (
                        <button
                          onClick={() => handleApprove(req.request_id, 'tech')}
                          disabled={submitting}
                          className="flex items-center justify-center gap-1.5 py-2 rounded-xl bg-gray-900 border border-amber-600 border-opacity-20 hover:border-opacity-50 text-amber-500 text-xs font-bold transition-all duration-300 hover:bg-amber-600 hover:bg-opacity-[0.03] active:scale-95 cursor-pointer disabled:opacity-50"
                        >
                          <Key className="w-3.5 h-3.5 text-amber-500" />
                          <span>Approve Admin 1 (Tech)</span>
                        </button>
                      ) : (
                        <div className="flex items-center justify-center gap-1.5 py-2 rounded-xl bg-gray-900 border border-gray-800 text-gray-500 text-xs font-semibold">
                          <span>Admin 1 (Tech) not signed</span>
                        </div>
                      )}

                      {/* Admin 2 (Biz) Approval Control */}
                      {req.approved_by_biz ? (
                        <div className="flex items-center justify-center gap-1.5 py-2 rounded-xl bg-emerald-500 bg-opacity-10 border border-emerald-500 border-opacity-20 text-emerald-400 text-xs font-bold">
                          <Check className="w-3.5 h-3.5" />
                          <span>Admin 2 (Biz) approved</span>
                        </div>
                      ) : isPending ? (
                        <button
                          onClick={() => handleApprove(req.request_id, 'biz')}
                          disabled={submitting}
                          className="flex items-center justify-center gap-1.5 py-2 rounded-xl bg-gray-900 border border-amber-600 border-opacity-20 hover:border-opacity-50 text-amber-500 text-xs font-bold transition-all duration-300 hover:bg-amber-600 hover:bg-opacity-[0.03] active:scale-95 cursor-pointer disabled:opacity-50"
                        >
                          <Key className="w-3.5 h-3.5 text-amber-500" />
                          <span>Approve Admin 2 (Biz)</span>
                        </button>
                      ) : (
                        <div className="flex items-center justify-center gap-1.5 py-2 rounded-xl bg-gray-900 border border-gray-800 text-gray-500 text-xs font-semibold">
                          <span>Admin 2 (Biz) not signed</span>
                        </div>
                      )}
                    </div>

                  </div>
                );
              })}
            </div>
          )}
        </div>

      </div>
    </main>
  );
}

