import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.18.0/firebase-app.js';
import { getAuth, signInAnonymously } from 'https://www.gstatic.com/firebasejs/12.18.0/firebase-auth.js';
import { getDatabase, onValue, ref, set } from 'https://www.gstatic.com/firebasejs/12.18.0/firebase-database.js';

(() => {
  'use strict';

  const APP_VERSION = '3.3.0';
  const STORAGE_KEY = 'massageCreditsApp_v1';
  const PENDING_SYNC_KEY = 'massageCreditsPendingSync_v1';
  const DEVICE_ID_KEY = 'massageCreditsDeviceId_v1';
  const FIREBASE_STATE_PATH = 'apps/massageCredits/sharedState';
  const MAX_HISTORY = 1000;
  const DEFAULT_PIN = '1234';

  const firebaseConfig = {
    apiKey: 'AIzaSyAc2NQ354sRFt5RSYHfTKok7IMg5y5tvKc',
    authDomain: 'massage-credits.firebaseapp.com',
    databaseURL: 'https://massage-credits-default-rtdb.europe-west1.firebasedatabase.app',
    projectId: 'massage-credits',
    storageBucket: 'massage-credits.firebasestorage.app',
    messagingSenderId: '667486056032',
    appId: '1:667486056032:web:7cc017f2f5433272e91d05'
  };

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

  const elements = {};
  let state;
  let adminUnlocked = false;
  let pendingAdminNavigation = false;
  let currentView = 'home';
  let currentCouponTab = 'store';
  let currentHistoryFilter = 'all';
  let timerHandle = null;
  let deferredInstallPrompt = null;
  let toastTimer = null;
  let confirmResolver = null;
  let lastPersistedSecond = -1;
  let firebaseApp = null;
  let firebaseAuth = null;
  let database = null;
  let sharedStateRef = null;
  let firebaseConnected = false;
  let firebaseAuthenticated = false;
  let firebaseDataReady = false;
  let firebaseConnectionListenerBound = false;
  let firebaseStateListenerBound = false;
  let firebaseInitialising = false;
  let firebaseLastError = '';
  let firebaseLastSyncAt = null;
  let cloudReady = false;
  let applyingRemoteState = false;
  let cloudSaveChain = Promise.resolve();
  let lastQueuedUpdatedAt = null;

  const DEVICE_ID = (() => {
    const existing = localStorage.getItem(DEVICE_ID_KEY);
    if (existing) return existing;
    const generated = window.crypto?.randomUUID
      ? `device-${window.crypto.randomUUID()}`
      : `device-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    localStorage.setItem(DEVICE_ID_KEY, generated);
    return generated;
  })();

  function uid(prefix = 'id') {
    if (window.crypto?.randomUUID) return `${prefix}-${window.crypto.randomUUID()}`;
    return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  function isoNow() {
    return new Date().toISOString();
  }

  function defaultCoupons() {
    return [
      {
        id: 'coupon-10-min',
        name: 'Massagem de 10 minutos',
        description: 'Uma pausa breve e focada para aliviar a tensão do dia.',
        price: 15,
        durationMinutes: 10,
        active: true
      },
      {
        id: 'coupon-20-min',
        name: 'Massagem de 20 minutos',
        description: 'Tempo adicional para uma sessão calma, confortável e reparadora.',
        price: 28,
        durationMinutes: 20,
        active: true
      },
      {
        id: 'coupon-complete',
        name: 'Massagem relaxante completa',
        description: 'Uma experiência completa para desligar, recuperar e voltar ao equilíbrio.',
        price: 55,
        durationMinutes: 45,
        active: true
      },
      {
        id: 'coupon-shoulders',
        name: 'Massagem aos ombros',
        description: 'Foco no pescoço e ombros, ideal depois de um dia exigente.',
        price: 20,
        durationMinutes: 15,
        active: true
      },
      {
        id: 'coupon-feet',
        name: 'Massagem pés e pernas',
        description: 'Uma sessão dedicada ao descanso das pernas e ao conforto dos pés.',
        price: 25,
        durationMinutes: 25,
        active: true
      },
      {
        id: 'coupon-surprise',
        name: 'Massagem surpresa',
        description: 'O formato e a duração ficam reservados para uma surpresa especial.',
        price: 18,
        durationMinutes: 20,
        active: true
      },
      {
        id: 'coupon-weekend',
        name: 'Cupão premium de fim de semana',
        description: 'Uma experiência premium para aproveitar sem pressa durante o fim de semana.',
        price: 80,
        durationMinutes: 60,
        active: true
      }
    ];
  }

  function createDefaultState() {
    const createdAt = isoNow();
    return {
      version: 1,
      credits: 80,
      adminPin: DEFAULT_PIN,
      minutePrice: 1,
      shopCoupons: defaultCoupons(),
      ownedCoupons: [],
      history: [
        {
          id: uid('history'),
          date: createdAt,
          category: 'credits',
          description: '+80 créditos adicionados — Saldo inicial',
          creditsDelta: 80,
          meta: { admin: true }
        }
      ],
      stats: {
        totalMinutesUsed: 0,
        totalMassageSessions: 0,
        totalMassageUses: 0,
        totalCouponsPurchased: 0,
        totalCouponsUsed: 0,
        totalCreditsAdded: 80,
        totalCreditsRemoved: 0,
        totalCreditsSpent: 0,
        rewards: {
          massage5Milestones: 0,
          minutes60Milestones: 0,
          reached100: false,
          vipUnlockedLogged: false
        },
        vipManual: false
      },
      activeSession: null,
      lastSessionSummary: null,
      createdAt,
      updatedAt: createdAt
    };
  }

  function normaliseState(saved) {
    const base = createDefaultState();
    if (!saved || typeof saved !== 'object') return base;

    const merged = {
      version: 1,
      credits: Number.isFinite(Number(saved.credits)) ? Math.max(0, Math.floor(Number(saved.credits))) : base.credits,
      minutePrice: Number.isFinite(Number(saved.minutePrice)) ? Math.max(1, Math.floor(Number(saved.minutePrice))) : base.minutePrice,
      adminPin: /^\d{4,8}$/.test(String(saved.adminPin || '')) ? String(saved.adminPin) : DEFAULT_PIN,
      shopCoupons: Array.isArray(saved.shopCoupons) ? saved.shopCoupons : base.shopCoupons,
      ownedCoupons: Array.isArray(saved.ownedCoupons) ? saved.ownedCoupons : [],
      history: Array.isArray(saved.history) ? saved.history : base.history,
      stats: {
        ...base.stats,
        ...(saved.stats || {}),
        rewards: {
          ...base.stats.rewards,
          ...(saved.stats?.rewards || {})
        }
      },
      activeSession: saved.activeSession && typeof saved.activeSession === 'object' ? saved.activeSession : null,
      lastSessionSummary: saved.lastSessionSummary && typeof saved.lastSessionSummary === 'object' ? saved.lastSessionSummary : null,
      createdAt: saved.createdAt || base.createdAt,
      updatedAt: saved.updatedAt || base.updatedAt
    };

    merged.shopCoupons = merged.shopCoupons.map((coupon) => ({
      id: String(coupon.id || uid('coupon')),
      name: String(coupon.name || 'Cupão'),
      description: String(coupon.description || ''),
      price: Math.max(1, Math.floor(Number(coupon.price) || 1)),
      durationMinutes: Math.max(0, Math.floor(Number(coupon.durationMinutes) || 0)),
      active: coupon.active !== false
    }));

    merged.ownedCoupons = merged.ownedCoupons.map((coupon) => ({
      instanceId: String(coupon.instanceId || uid('owned')),
      couponId: String(coupon.couponId || ''),
      name: String(coupon.name || 'Cupão'),
      description: String(coupon.description || ''),
      durationMinutes: Math.max(0, Math.floor(Number(coupon.durationMinutes) || 0)),
      purchasedAt: coupon.purchasedAt || isoNow(),
      usedAt: coupon.usedAt || null,
      status: coupon.status === 'used' ? 'used' : 'active',
      isReward: Boolean(coupon.isReward)
    }));

    merged.history = merged.history
      .filter((entry) => entry && entry.date && entry.description)
      .slice(0, MAX_HISTORY);

    return merged;
  }

  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? normaliseState(JSON.parse(raw)) : createDefaultState();
    } catch (error) {
      console.warn('Não foi possível ler os dados locais:', error);
      return createDefaultState();
    }
  }

  function saveLocalState() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      return true;
    } catch (error) {
      console.error('Não foi possível guardar os dados locais:', error);
      showToast('Não foi possível guardar os dados neste dispositivo.');
      return false;
    }
  }

  function queueCloudSave() {
    if (!cloudReady || !sharedStateRef || applyingRemoteState || !firebaseConnected || !firebaseAuthenticated || !firebaseDataReady) return;

    const payload = JSON.parse(JSON.stringify(state));
    const payloadUpdatedAt = String(payload.updatedAt || '');

    // Evita colocar a mesma versão várias vezes na fila quando o listener recebe
    // eventos intermédios enquanto já existe uma gravação em curso.
    if (payloadUpdatedAt && payloadUpdatedAt === lastQueuedUpdatedAt) return;
    lastQueuedUpdatedAt = payloadUpdatedAt;

    cloudSaveChain = cloudSaveChain
      .then(() => set(sharedStateRef, payload))
      .then(() => {
        firebaseLastError = '';
        firebaseLastSyncAt = new Date();
        updateConnectionStatus();

        // Só considera tudo sincronizado se o estado local não tiver sido
        // alterado novamente durante esta gravação.
        if (String(state.updatedAt || '') === payloadUpdatedAt) {
          localStorage.removeItem(PENDING_SYNC_KEY);
        } else {
          localStorage.setItem(PENDING_SYNC_KEY, '1');
          queueCloudSave();
        }
      })
      .catch((error) => {
        console.error('Não foi possível sincronizar com o Firebase:', error);
        firebaseLastError = friendlyFirebaseError(error);
        updateConnectionStatus();
        localStorage.setItem(PENDING_SYNC_KEY, '1');
        showToast('Alteração guardada localmente. A sincronização será repetida quando houver ligação.');
      })
      .finally(() => {
        if (lastQueuedUpdatedAt === payloadUpdatedAt) lastQueuedUpdatedAt = null;
      });
  }

  function saveState({ syncCloud = true } = {}) {
    state.updatedAt = isoNow();
    const savedLocally = saveLocalState();

    if (syncCloud && !applyingRemoteState) {
      localStorage.setItem(PENDING_SYNC_KEY, '1');
      queueCloudSave();
    }

    return savedLocally;
  }

  function applyRemoteState(remoteState) {
    const containsLegacyPing = Object.prototype.hasOwnProperty.call(remoteState || {}, '__ping');

    applyingRemoteState = true;
    state = normaliseState(remoteState);
    saveLocalState();
    applyingRemoteState = false;
    recoverSession();
    renderAll();

    if (containsLegacyPing) {
      localStorage.setItem(PENDING_SYNC_KEY, '1');
      queueCloudSave();
    }
  }

  function friendlyFirebaseError(error) {
    const code = String(error?.code || error?.name || '').trim();
    const message = String(error?.message || error || 'Erro desconhecido').trim();

    if (code.includes('operation-not-allowed')) {
      return 'O login anónimo está desativado no Firebase Authentication.';
    }
    if (code.includes('unauthorized-domain')) {
      return 'O domínio desta aplicação não está autorizado no Firebase Authentication.';
    }
    if (code.includes('network-request-failed')) {
      return 'O navegador não conseguiu contactar o serviço de autenticação do Firebase.';
    }
    if (code.toLowerCase().includes('permission') || message.toLowerCase().includes('permission_denied')) {
      return 'As regras do Realtime Database recusaram a leitura ou a gravação.';
    }
    if (message.toLowerCase().includes('content security policy') || message.toLowerCase().includes('csp')) {
      return 'A Política de Segurança de Conteúdos bloqueou uma ligação necessária ao Firebase.';
    }

    return code ? `${code}: ${message}` : message;
  }

  function updateAdminDiagnostics() {
    if (elements.appVersion) elements.appVersion.textContent = `Versão ${APP_VERSION}`;
    if (elements.firebaseStatusText) {
      let text = 'A iniciar';
      let status = 'connecting';

      if (!navigator.onLine) {
        text = 'Sem ligação à Internet';
        status = 'offline';
      } else if (firebaseLastError) {
        text = 'Erro de sincronização';
        status = 'offline';
      } else if (!firebaseAuthenticated) {
        text = 'A autenticar no Firebase';
      } else if (!firebaseConnected) {
        text = 'A ligar ao Realtime Database';
      } else if (!firebaseDataReady) {
        text = 'A validar acesso aos dados';
      } else {
        text = 'Ligado e sincronizado';
        status = 'online';
      }

      elements.firebaseStatusText.textContent = text;
      elements.firebaseStatusText.dataset.status = status;
    }

    if (elements.firebaseErrorText) {
      elements.firebaseErrorText.textContent = firebaseLastError || 'Nenhum erro detetado.';
      elements.firebaseErrorText.classList.toggle('has-error', Boolean(firebaseLastError));
    }

    if (elements.firebaseLastSyncText) {
      elements.firebaseLastSyncText.textContent = firebaseLastSyncAt
        ? formatDate(firebaseLastSyncAt, { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
        : 'Ainda não sincronizou';
    }

    if (elements.firebaseDeviceText) {
      elements.firebaseDeviceText.textContent = DEVICE_ID.slice(-12);
    }
  }

  async function initialiseFirebaseSync({ force = false } = {}) {
    if (firebaseInitialising) return;
    if (!force && firebaseAuthenticated && firebaseStateListenerBound) return;

    firebaseInitialising = true;
    firebaseLastError = '';
    updateConnectionStatus();

    try {
      if (!firebaseApp) firebaseApp = initializeApp(firebaseConfig);

      if (!database) {
        database = getDatabase(firebaseApp);
        sharedStateRef = ref(database, FIREBASE_STATE_PATH);
      }

      // A ligação à base é observada antes da autenticação. Assim, o painel
      // distingue falhas de Internet, autenticação e permissões de dados.
      if (!firebaseConnectionListenerBound) {
        firebaseConnectionListenerBound = true;
        onValue(ref(database, '.info/connected'), (snapshot) => {
          firebaseConnected = snapshot.val() === true;
          updateConnectionStatus();

          if (
            firebaseConnected &&
            firebaseAuthenticated &&
            firebaseDataReady &&
            localStorage.getItem(PENDING_SYNC_KEY) === '1'
          ) {
            queueCloudSave();
          }
        });
      }

      if (!firebaseAuth) firebaseAuth = getAuth(firebaseApp);
      const credential = firebaseAuth.currentUser
        ? { user: firebaseAuth.currentUser }
        : await signInAnonymously(firebaseAuth);

      firebaseAuthenticated = Boolean(credential.user);

      console.info('[Firebase] Autenticação concluída', {
        uid: credential.user.uid,
        path: FIREBASE_STATE_PATH,
        appVersion: APP_VERSION
      });

      if (!firebaseStateListenerBound) {
        firebaseStateListenerBound = true;

        onValue(
          sharedStateRef,
          (snapshot) => {
            firebaseDataReady = true;
            firebaseLastError = '';
            firebaseLastSyncAt = new Date();
            const hasPendingLocalChanges = localStorage.getItem(PENDING_SYNC_KEY) === '1';

            if (!snapshot.exists()) {
              cloudReady = true;
              localStorage.setItem(PENDING_SYNC_KEY, '1');
              updateConnectionStatus();
              queueCloudSave();
              return;
            }

            const remoteState = snapshot.val();
            const localUpdatedAt = Date.parse(state.updatedAt || '') || 0;
            const remoteUpdatedAt = Date.parse(remoteState?.updatedAt || '') || 0;

            cloudReady = true;

            if (hasPendingLocalChanges && localUpdatedAt > remoteUpdatedAt) {
              updateConnectionStatus();
              queueCloudSave();
              return;
            }

            if (hasPendingLocalChanges && remoteUpdatedAt >= localUpdatedAt) {
              localStorage.removeItem(PENDING_SYNC_KEY);
            }

            if (JSON.stringify(remoteState) !== JSON.stringify(state)) {
              applyRemoteState(remoteState);
            }

            updateConnectionStatus();
          },
          (error) => {
            console.error('Erro ao receber dados do Firebase:', error);
            firebaseDataReady = false;
            firebaseLastError = friendlyFirebaseError(error);
            updateConnectionStatus();
            showToast(firebaseLastError);
          }
        );
      }
    } catch (error) {
      console.error('Firebase não inicializado:', error);
      firebaseAuthenticated = false;
      firebaseDataReady = false;
      firebaseLastError = friendlyFirebaseError(error);
      updateConnectionStatus();
      showToast(firebaseLastError);
    } finally {
      firebaseInitialising = false;
      updateConnectionStatus();
    }
  }

  function escapeHTML(value) {
    return String(value ?? '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;');
  }

  function formatDate(dateValue, options = {}) {
    const date = new Date(dateValue);
    if (Number.isNaN(date.getTime())) return 'Data indisponível';
    return new Intl.DateTimeFormat('pt-PT', options).format(date);
  }

  function formatDateTime(dateValue) {
    return formatDate(dateValue, {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  }

  function formatDuration(seconds) {
    const safeSeconds = Math.max(0, Math.floor(Number(seconds) || 0));
    const minutes = Math.floor(safeSeconds / 60);
    const remainder = safeSeconds % 60;
    return `${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}`;
  }

  function plural(value, singular, pluralForm) {
    return `${value} ${value === 1 ? singular : pluralForm}`;
  }

  function addHistory(category, description, creditsDelta = null, meta = {}) {
    state.history.unshift({
      id: uid('history'),
      date: isoNow(),
      category,
      description,
      creditsDelta: Number.isFinite(Number(creditsDelta)) ? Number(creditsDelta) : null,
      meta
    });
    state.history = state.history.slice(0, MAX_HISTORY);
  }

  function getActiveCoupons() {
    return state.ownedCoupons.filter((coupon) => coupon.status === 'active');
  }

  function getLevel() {
    const vipAutomatic = state.stats.totalMassageUses >= 15 || state.stats.totalMinutesUsed >= 180;
    if (state.stats.vipManual || vipAutomatic) {
      return {
        name: 'VIP Pai',
        className: 'vip',
        caption: 'Nível especial ativo. Experiência privada no patamar máximo.'
      };
    }
    if (state.credits > 150) {
      return {
        name: 'Ouro',
        className: 'gold',
        caption: 'Saldo elevado e liberdade total para escolher a próxima experiência.'
      };
    }
    if (state.credits >= 51) {
      return {
        name: 'Prata',
        className: 'silver',
        caption: 'Um saldo confortável para manter uma rotina regular de descanso.'
      };
    }
    return {
      name: 'Bronze',
      className: 'bronze',
      caption: 'A base está pronta. Cada crédito aproxima o próximo momento de pausa.'
    };
  }

  function showToast(message) {
    if (!elements.toast) return;
    elements.toast.textContent = message;
    elements.toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => elements.toast.classList.remove('show'), 2800);
  }

  function openDialog(dialog) {
    if (!dialog) return;
    if (typeof dialog.showModal === 'function') dialog.showModal();
    else dialog.setAttribute('open', '');
  }

  function closeDialog(dialog) {
    if (!dialog) return;
    if (typeof dialog.close === 'function') dialog.close();
    else dialog.removeAttribute('open');
  }

  function askConfirmation({ title, message, acceptLabel = 'Confirmar', danger = false, icon = '◇' }) {
    elements.confirmTitle.textContent = title;
    elements.confirmMessage.textContent = message;
    elements.confirmAcceptButton.textContent = acceptLabel;
    elements.confirmIcon.textContent = icon;
    elements.confirmAcceptButton.className = danger ? 'danger-button' : 'primary-button';
    openDialog(elements.confirmModal);

    return new Promise((resolve) => {
      confirmResolver = resolve;
    });
  }

  function applyAutomaticRewards() {
    let rewardGiven = false;

    const usesMilestone = Math.floor(state.stats.totalMassageUses / 5);
    while (state.stats.rewards.massage5Milestones < usesMilestone) {
      state.stats.rewards.massage5Milestones += 1;
      state.credits += 10;
      state.stats.totalCreditsAdded += 10;
      addHistory(
        'reward',
        '+10 créditos bónus — Recompensa por 5 massagens utilizadas',
        10,
        { reward: 'five-massages' }
      );
      rewardGiven = true;
    }

    const minutesMilestone = Math.floor(state.stats.totalMinutesUsed / 60);
    while (state.stats.rewards.minutes60Milestones < minutesMilestone) {
      state.stats.rewards.minutes60Milestones += 1;
      const rewardCoupon = {
        instanceId: uid('owned'),
        couponId: 'reward-60-minutes',
        name: 'Cupão Bónus — 15 minutos',
        description: 'Recompensa automática por cada 60 minutos de massagens acumulados.',
        durationMinutes: 15,
        purchasedAt: isoNow(),
        usedAt: null,
        status: 'active',
        isReward: true
      };
      state.ownedCoupons.unshift(rewardCoupon);
      addHistory(
        'reward',
        'Cupão Bónus de 15 minutos oferecido — 60 minutos acumulados',
        null,
        { reward: 'sixty-minutes', coupon: true }
      );
      rewardGiven = true;
    }

    if (state.credits >= 100 && !state.stats.rewards.reached100) {
      state.stats.rewards.reached100 = true;
      state.ownedCoupons.unshift({
        instanceId: uid('owned'),
        couponId: 'reward-100-credits',
        name: 'Recompensa Especial — Ritual Privado',
        description: 'Experiência exclusiva desbloqueada ao atingir 100 créditos.',
        durationMinutes: 30,
        purchasedAt: isoNow(),
        usedAt: null,
        status: 'active',
        isReward: true
      });
      addHistory(
        'reward',
        'Recompensa Especial desbloqueada — Meta de 100 créditos atingida',
        null,
        { reward: 'hundred-credits', coupon: true }
      );
      rewardGiven = true;
    }

    const vipAutomatic = state.stats.totalMassageUses >= 15 || state.stats.totalMinutesUsed >= 180;
    if (vipAutomatic && !state.stats.rewards.vipUnlockedLogged) {
      state.stats.rewards.vipUnlockedLogged = true;
      addHistory(
        'reward',
        'Nível VIP Pai desbloqueado automaticamente',
        null,
        { reward: 'vip' }
      );
      rewardGiven = true;
    }

    return rewardGiven;
  }

  function renderAll() {
    renderHome();
    renderCoupons();
    renderMinute();
    renderHistory();
    renderAdmin();
    updateNavigation();
    updateConnectionStatus();
  }

  function renderHome() {
    const level = getLevel();
    const availableMinutes = Math.floor(state.credits / state.minutePrice);
    const activeCoupons = getActiveCoupons();
    const now = new Date();
    const weekStart = new Date(now);
    const daysSinceMonday = (weekStart.getDay() + 6) % 7;
    weekStart.setHours(0, 0, 0, 0);
    weekStart.setDate(weekStart.getDate() - daysSinceMonday);
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekEnd.getDate() + 6);
    const weekIndex = Math.floor(weekStart.getTime() / 604800000);
    const messages = [
      'Uma sugestão especial para aproveitar esta semana.',
      'Um momento de pausa escolhido para esta semana.',
      'Esta semana merece uma experiência diferente.',
      'O cupão em destaque fica disponível durante toda a semana.'
    ];
    const messageIndex = Math.abs(weekIndex) % messages.length;

    elements.balanceValue.textContent = String(state.credits);
    elements.levelBadge.textContent = level.name;
    elements.levelBadge.dataset.level = level.className;
    elements.levelCaption.textContent = level.caption;
    elements.availableMinutesRing.textContent = `${availableMinutes}m`;
    elements.balanceRing.style.setProperty('--ring-progress', `${Math.min(100, (state.credits / 200) * 100)}%`);
    elements.minutesAvailable.textContent = String(availableMinutes);
    elements.activeCouponsCount.textContent = String(activeCoupons.length);
    elements.totalMinutesUsed.textContent = String(state.stats.totalMinutesUsed);
    elements.todayDate.textContent = `${formatDate(weekStart, { day: '2-digit', month: 'short' })} — ${formatDate(weekEnd, { day: '2-digit', month: 'short' })}`;
    elements.todayMessage.textContent = messages[messageIndex];

    const weeklyCoupons = state.shopCoupons.filter((coupon) => coupon.active);
    if (weeklyCoupons.length) {
      const weeklyCoupon = weeklyCoupons[Math.abs(weekIndex) % weeklyCoupons.length];
      elements.recommendedCoupon.textContent = weeklyCoupon.name;
    } else {
      elements.recommendedCoupon.textContent = 'Sem cupão em destaque';
    }

    const lastMassageEntry = state.history.find((entry) => entry.category === 'massage' || entry.meta?.massageUse);
    elements.lastMassage.textContent = lastMassageEntry
      ? formatDate(lastMassageEntry.date, { day: '2-digit', month: 'short' })
      : 'Sem registo';

    renderActivityList(elements.recentActivity, state.history.slice(0, 4), true);
  }

  function couponStoreCard(coupon) {
    const canBuy = state.credits >= coupon.price;
    const durationText = coupon.durationMinutes > 0
      ? `${coupon.durationMinutes} min estimados`
      : 'Duração flexível';

    return `
      <article class="coupon-card ${canBuy ? '' : 'insufficient'}">
        <div class="coupon-top">
          <div>
            <h3>${escapeHTML(coupon.name)}</h3>
          </div>
          <span class="coupon-price">${coupon.price} cr.</span>
        </div>
        <p>${escapeHTML(coupon.description)}</p>
        <div class="coupon-meta">
          <small>${escapeHTML(durationText)}</small>
          <button class="${canBuy ? 'primary-button' : 'secondary-button'} small" type="button" data-buy-coupon="${escapeHTML(coupon.id)}" ${canBuy ? '' : 'disabled'}>
            ${canBuy ? 'Comprar' : 'Saldo insuficiente'}
          </button>
        </div>
      </article>
    `;
  }

  function ownedCouponCard(coupon) {
    return `
      <article class="coupon-card ${coupon.isReward ? 'reward' : ''}">
        <div class="coupon-top">
          <div>
            <span class="eyebrow">${coupon.isReward ? 'Recompensa' : 'Cupão ativo'}</span>
            <h3>${escapeHTML(coupon.name)}</h3>
          </div>
          <span class="coupon-price">${coupon.durationMinutes ? `${coupon.durationMinutes} min` : 'Livre'}</span>
        </div>
        <p>${escapeHTML(coupon.description)}</p>
        <div class="coupon-meta">
          <small>Comprado em ${escapeHTML(formatDate(coupon.purchasedAt, { day: '2-digit', month: 'short', year: 'numeric' }))}</small>
          <button class="primary-button small" type="button" data-use-coupon="${escapeHTML(coupon.instanceId)}">Usar cupão</button>
        </div>
      </article>
    `;
  }

  function renderCoupons() {
    const storeCoupons = state.shopCoupons.filter((coupon) => coupon.active);
    const activeOwned = getActiveCoupons();

    elements.couponStore.innerHTML = storeCoupons.length
      ? storeCoupons.map(couponStoreCard).join('')
      : emptyState('Loja sem cupões', 'Cria um novo cupão no painel admin.');

    elements.myCoupons.innerHTML = activeOwned.length
      ? activeOwned.map(ownedCouponCard).join('')
      : emptyState('Ainda não existem cupões ativos', 'Compra um cupão na loja ou desbloqueia uma recompensa.');

    elements.couponTabCount.textContent = String(activeOwned.length);

    $$('.segmented-control button').forEach((button) => {
      button.classList.toggle('active', button.dataset.couponTab === currentCouponTab);
    });
    elements.couponStorePanel.classList.toggle('active', currentCouponTab === 'store');
    elements.myCouponsPanel.classList.toggle('active', currentCouponTab === 'mine');
  }

  function renderMinute() {
    const session = state.activeSession;
    elements.minutePriceDisplay.textContent = String(session?.pricePerMinute || state.minutePrice);
    elements.sessionBalance.textContent = String(state.credits);

    if (session?.active) {
      elements.timerCard.classList.add('active-session');
      elements.timerDisplay.textContent = formatDuration(session.totalSeconds);
      elements.sessionCredits.textContent = String(session.chargedCredits);
      elements.timerStatus.textContent = session.running ? 'Em curso' : 'Em pausa';
      elements.timerStatus.classList.toggle('paused', !session.running);
      elements.timerProgress.style.width = `${((session.totalSeconds % 60) / 60) * 100}%`;
      elements.startSessionButton.classList.add('hidden');
      elements.timerControls.classList.remove('hidden');
      elements.pauseSessionButton.textContent = session.running ? 'Pausar' : 'Retomar';
    } else {
      elements.timerCard.classList.remove('active-session');
      elements.timerDisplay.textContent = '00:00';
      elements.sessionCredits.textContent = '0';
      elements.timerStatus.textContent = 'Pronto';
      elements.timerStatus.classList.remove('paused');
      elements.timerProgress.style.width = '0%';
      elements.startSessionButton.classList.remove('hidden');
      elements.timerControls.classList.add('hidden');
      elements.startSessionButton.disabled = state.credits < state.minutePrice;
      elements.startSessionButton.textContent = state.credits < state.minutePrice
        ? 'Créditos insuficientes'
        : 'Iniciar massagem ao minuto';
    }

    if (state.lastSessionSummary) {
      elements.lastSessionCard.classList.remove('hidden');
      elements.summaryTime.textContent = formatDuration(state.lastSessionSummary.seconds);
      elements.summaryCredits.textContent = `${state.lastSessionSummary.credits} cr.`;
      elements.summaryBalance.textContent = `${state.lastSessionSummary.balanceAfter} cr.`;
    } else {
      elements.lastSessionCard.classList.add('hidden');
    }

    ensureTimerLoop();
  }

  function historyMatchesFilter(entry) {
    if (currentHistoryFilter === 'all') return true;
    if (currentHistoryFilter === 'credits') return entry.category === 'credits' || entry.category === 'reward';
    if (currentHistoryFilter === 'coupons') return entry.category === 'coupons' || entry.meta?.coupon;
    if (currentHistoryFilter === 'massage') return entry.category === 'massage' || entry.meta?.massageUse;
    if (currentHistoryFilter === 'admin') return entry.category === 'admin' || entry.meta?.admin;
    return true;
  }

  function renderHistory() {
    const activeCoupons = getActiveCoupons().length;
    elements.historySummary.innerHTML = `
      <div><span>Registos</span><strong>${state.history.length}</strong></div>
      <div><span>Créditos gastos</span><strong>${state.stats.totalCreditsSpent}</strong></div>
      <div><span>Cupões ativos</span><strong>${activeCoupons}</strong></div>
    `;

    const filtered = state.history.filter(historyMatchesFilter);
    renderActivityList(elements.historyList, filtered, false);

    $$('.filter-chip', elements.historyFilters).forEach((button) => {
      button.classList.toggle('active', button.dataset.historyFilter === currentHistoryFilter);
    });
  }

  function renderActivityList(container, entries, compact = false) {
    if (!entries.length) {
      container.innerHTML = emptyState('Sem movimentos', compact ? 'A atividade mais recente aparecerá aqui.' : 'Não existem registos para este filtro.');
      return;
    }

    container.innerHTML = entries.map((entry) => {
      const value = entry.creditsDelta;
      const hasValue = Number.isFinite(Number(value));
      const valueClass = Number(value) < 0 ? 'negative' : '';
      const itemClass = `${Number(value) < 0 ? 'negative' : ''} ${entry.meta?.admin || entry.category === 'admin' ? 'admin' : ''}`;
      return `
        <article class="activity-item ${itemClass}">
          <span class="activity-icon">${activityIcon(entry)}</span>
          <div class="activity-main">
            <strong>${escapeHTML(entry.description)}</strong>
            <small>${escapeHTML(formatDateTime(entry.date))}</small>
          </div>
          ${hasValue ? `<span class="activity-value ${valueClass}">${Number(value) > 0 ? '+' : ''}${Number(value)} cr.</span>` : ''}
        </article>
      `;
    }).join('');
  }

  function activityIcon(entry) {
    if (entry.category === 'massage') return '◷';
    if (entry.category === 'coupons' || entry.meta?.coupon) return '⌁';
    if (entry.category === 'reward') return '✦';
    if (entry.category === 'admin' || entry.meta?.admin) return '◆';
    return Number(entry.creditsDelta) < 0 ? '−' : '+';
  }

  function renderAdmin() {
    if (!adminUnlocked) return;

    const level = getLevel();
    elements.adminSummary.innerHTML = `
      <div><span>Saldo atual</span><strong>${state.credits} cr.</strong></div>
      <div><span>Nível</span><strong>${escapeHTML(level.name)}</strong></div>
      <div><span>Utilizações</span><strong>${state.stats.totalMassageUses}</strong></div>
      <div><span>Minutos usados</span><strong>${state.stats.totalMinutesUsed}</strong></div>
      <div><span>Cupões comprados</span><strong>${state.stats.totalCouponsPurchased}</strong></div>
      <div><span>Sessões ao minuto</span><strong>${state.stats.totalMassageSessions}</strong></div>
    `;

    elements.minutePriceInput.value = String(state.minutePrice);
    elements.vipToggle.checked = Boolean(state.stats.vipManual);
    updateAdminDiagnostics();

    elements.adminCouponList.innerHTML = state.shopCoupons.length
      ? state.shopCoupons.map((coupon) => `
          <article class="admin-coupon-item ${coupon.active ? '' : 'inactive'}">
            <div>
              <strong>${escapeHTML(coupon.name)}</strong>
              <small>${coupon.price} créditos · ${coupon.durationMinutes || 0} min · ${coupon.active ? 'Ativo' : 'Inativo'}</small>
            </div>
            <div class="admin-item-actions">
              <button class="mini-button" type="button" data-edit-coupon="${escapeHTML(coupon.id)}">Editar</button>
              <button class="mini-button delete" type="button" data-delete-coupon="${escapeHTML(coupon.id)}">Apagar</button>
            </div>
          </article>
        `).join('')
      : emptyState('Sem cupões no catálogo', 'Cria o primeiro cupão para a loja.');
  }

  function emptyState(title, description) {
    return `<div class="empty-state"><strong>${escapeHTML(title)}</strong>${escapeHTML(description)}</div>`;
  }

  function updateNavigation() {
    $$('.bottom-nav [data-nav]').forEach((button) => {
      button.classList.toggle('active', button.dataset.nav === currentView);
    });
  }

  function navigateTo(view, bypassAdminCheck = false) {
    if (view === 'admin' && !adminUnlocked && !bypassAdminCheck) {
      pendingAdminNavigation = true;
      elements.pinUnlockInput.value = '';
      elements.pinError.textContent = '';
      openDialog(elements.pinModal);
      window.setTimeout(() => elements.pinUnlockInput.focus(), 120);
      return;
    }

    if (!elements.views.some((section) => section.dataset.view === view)) return;
    currentView = view;
    elements.views.forEach((section) => section.classList.toggle('active', section.dataset.view === view));
    updateNavigation();
    window.scrollTo({ top: 0, behavior: 'smooth' });
    document.title = `${viewTitle(view)} — Massagens`;

    if (view === 'admin') renderAdmin();
  }

  function viewTitle(view) {
    const titles = {
      home: 'Início',
      coupons: 'Cupões',
      minute: 'Massagem ao Minuto',
      history: 'Histórico',
      admin: 'Admin'
    };
    return titles[view] || 'Massagens';
  }

  async function buyCoupon(couponId) {
    const coupon = state.shopCoupons.find((item) => item.id === couponId && item.active);
    if (!coupon) return;
    if (state.credits < coupon.price) {
      showToast('Saldo insuficiente para comprar este cupão.');
      return;
    }

    const accepted = await askConfirmation({
      title: 'Comprar cupão',
      message: `${coupon.name} por ${coupon.price} créditos?`,
      acceptLabel: 'Comprar',
      icon: '⌁'
    });
    if (!accepted) return;

    state.credits -= coupon.price;
    state.stats.totalCouponsPurchased += 1;
    state.stats.totalCreditsSpent += coupon.price;
    state.ownedCoupons.unshift({
      instanceId: uid('owned'),
      couponId: coupon.id,
      name: coupon.name,
      description: coupon.description,
      durationMinutes: coupon.durationMinutes,
      purchasedAt: isoNow(),
      usedAt: null,
      status: 'active',
      isReward: false
    });
    addHistory(
      'coupons',
      `Cupão ${coupon.name} comprado — ${coupon.price} créditos`,
      -coupon.price,
      { coupon: true, action: 'purchase' }
    );

    saveState();
    currentCouponTab = 'mine';
    renderAll();
    showToast('Cupão comprado e guardado em “Os meus cupões”.');
  }

  async function useCoupon(instanceId) {
    const coupon = state.ownedCoupons.find((item) => item.instanceId === instanceId && item.status === 'active');
    if (!coupon) return;

    const accepted = await askConfirmation({
      title: 'Usar cupão',
      message: `Confirmas a utilização de “${coupon.name}”? Esta ação fica registada no histórico.`,
      acceptLabel: 'Usar cupão',
      icon: '◇'
    });
    if (!accepted) return;

    coupon.status = 'used';
    coupon.usedAt = isoNow();
    state.stats.totalCouponsUsed += 1;
    state.stats.totalMassageUses += 1;
    state.stats.totalMinutesUsed += coupon.durationMinutes || 0;
    addHistory(
      'coupons',
      `Cupão ${coupon.name} utilizado`,
      null,
      { coupon: true, massageUse: true, durationMinutes: coupon.durationMinutes || 0 }
    );

    const rewarded = applyAutomaticRewards();
    saveState();
    renderAll();
    showToast(rewarded ? 'Cupão utilizado. Nova recompensa desbloqueada.' : 'Cupão utilizado com sucesso.');
  }

  function requestMinuteSessionStart() {
    if (state.activeSession?.active) return;
    if (state.credits < state.minutePrice) {
      showToast('Não existem créditos suficientes para iniciar a sessão.');
      return;
    }

    elements.sessionPinInput.value = '';
    elements.sessionPinError.textContent = '';
    openDialog(elements.sessionPinModal);
    window.setTimeout(() => elements.sessionPinInput.focus(), 120);
  }

  function authoriseMinuteSessionStart(event) {
    event.preventDefault();
    const pin = elements.sessionPinInput.value;

    if (pin !== state.adminPin) {
      elements.sessionPinError.textContent = 'PIN incorreto. A sessão não foi iniciada.';
      elements.sessionPinInput.select();
      return;
    }

    elements.sessionPinError.textContent = '';
    closeDialog(elements.sessionPinModal);
    startMinuteSession();
  }

  function startMinuteSession() {
    if (state.activeSession?.active) return;
    if (state.credits < state.minutePrice) {
      showToast('Não existem créditos suficientes para iniciar a sessão.');
      return;
    }

    const price = state.minutePrice;
    state.credits -= price;
    state.stats.totalCreditsSpent += price;
    state.activeSession = {
      id: uid('session'),
      active: true,
      running: true,
      startedAt: isoNow(),
      lastTimestamp: Date.now(),
      totalSeconds: 0,
      billedMinutes: 1,
      chargedCredits: price,
      pricePerMinute: price,
      ownerDeviceId: DEVICE_ID
    };
    lastPersistedSecond = 0;
    saveState();
    renderAll();
    showToast('Sessão iniciada. O primeiro minuto está ativo.');
  }

  function syncSessionTime() {
    const session = state.activeSession;
    if (!session?.active || !session.running) return false;
    if (session.ownerDeviceId && session.ownerDeviceId !== DEVICE_ID) return false;
    if (!session.ownerDeviceId) session.ownerDeviceId = DEVICE_ID;

    const now = Date.now();
    const previous = Number(session.lastTimestamp) || now;
    const elapsedSeconds = Math.max(0, Math.floor((now - previous) / 1000));
    if (elapsedSeconds <= 0) return false;

    session.totalSeconds += elapsedSeconds;
    session.lastTimestamp = previous + elapsedSeconds * 1000;
    let charged = false;

    while (session.totalSeconds > session.billedMinutes * 60) {
      if (state.credits >= session.pricePerMinute) {
        state.credits -= session.pricePerMinute;
        state.stats.totalCreditsSpent += session.pricePerMinute;
        session.billedMinutes += 1;
        session.chargedCredits += session.pricePerMinute;
        charged = true;
      } else {
        session.totalSeconds = session.billedMinutes * 60;
        finishMinuteSession('Saldo esgotado', true);
        return true;
      }
    }

    if (charged || session.totalSeconds - lastPersistedSecond >= 5) {
      lastPersistedSecond = session.totalSeconds;
      saveState();
    }
    return true;
  }

  function togglePauseSession() {
    const session = state.activeSession;
    if (!session?.active) return;

    if (session.ownerDeviceId !== DEVICE_ID) {
      session.ownerDeviceId = DEVICE_ID;
      session.lastTimestamp = Date.now();
    }

    if (session.running) {
      syncSessionTime();
      if (!state.activeSession?.active) return;
      session.running = false;
      session.lastTimestamp = Date.now();
      showToast('Sessão em pausa.');
    } else {
      session.running = true;
      session.lastTimestamp = Date.now();
      showToast('Sessão retomada.');
    }

    saveState();
    renderAll();
  }

  function finishMinuteSession(reason = 'Terminada pelo utilizador', automatic = false) {
    const session = state.activeSession;
    if (!session?.active) return;

    if (session.ownerDeviceId !== DEVICE_ID) {
      session.ownerDeviceId = DEVICE_ID;
      session.lastTimestamp = Date.now();
    }

    if (session.running && !automatic) syncSessionTime();
    if (!state.activeSession?.active) return;

    const finalSession = { ...state.activeSession };
    const usedMinutes = Math.max(1, Math.ceil(finalSession.totalSeconds / 60));

    state.stats.totalMassageSessions += 1;
    state.stats.totalMassageUses += 1;
    state.stats.totalMinutesUsed += usedMinutes;
    state.activeSession = null;

    addHistory(
      'massage',
      `Massagem ao minuto terminada — ${plural(usedMinutes, 'minuto', 'minutos')} — ${finalSession.chargedCredits} créditos usados`,
      -finalSession.chargedCredits,
      {
        massageUse: true,
        sessionId: finalSession.id,
        durationMinutes: usedMinutes,
        durationSeconds: finalSession.totalSeconds,
        reason
      }
    );

    const rewarded = applyAutomaticRewards();
    state.lastSessionSummary = {
      date: isoNow(),
      seconds: finalSession.totalSeconds,
      minutes: usedMinutes,
      credits: finalSession.chargedCredits,
      balanceAfter: state.credits,
      reason
    };

    saveState();
    renderAll();
    const baseMessage = automatic ? 'Sessão terminada automaticamente por falta de saldo.' : 'Sessão terminada e registada.';
    showToast(rewarded ? `${baseMessage} Nova recompensa desbloqueada.` : baseMessage);
  }

  function ensureTimerLoop() {
    const session = state.activeSession;
    const shouldRun = Boolean(
      session?.active && (!session.ownerDeviceId || session.ownerDeviceId === DEVICE_ID)
    );
    if (shouldRun && !timerHandle) {
      timerHandle = window.setInterval(() => {
        if (!state.activeSession?.active) {
          clearInterval(timerHandle);
          timerHandle = null;
          return;
        }
        syncSessionTime();
        renderMinute();
        renderHome();
      }, 1000);
    } else if (!shouldRun && timerHandle) {
      clearInterval(timerHandle);
      timerHandle = null;
    }
  }

  function handleCreditsSubmit(event) {
    event.preventDefault();
    const operation = elements.creditOperation.value;
    const requestedAmount = Math.floor(Number(elements.creditAmount.value));
    const reason = elements.creditReason.value.trim();

    if (!Number.isFinite(requestedAmount) || requestedAmount < 1 || !reason) {
      showToast('Indica uma quantidade válida e uma descrição.');
      return;
    }

    if (operation === 'remove' && requestedAmount > state.credits) {
      showToast('Não é possível remover mais créditos do que o saldo atual.');
      return;
    }

    const delta = operation === 'add' ? requestedAmount : -requestedAmount;
    state.credits += delta;

    if (delta > 0) state.stats.totalCreditsAdded += delta;
    else state.stats.totalCreditsRemoved += Math.abs(delta);

    const actionText = delta > 0 ? 'adicionados' : 'removidos';
    addHistory(
      'credits',
      `${delta > 0 ? '+' : '−'}${Math.abs(delta)} créditos ${actionText} — ${reason}`,
      delta,
      { admin: true }
    );

    const rewarded = applyAutomaticRewards();
    saveState();
    event.target.reset();
    renderAll();
    showToast(rewarded ? 'Movimento aplicado. Nova recompensa desbloqueada.' : 'Movimento de créditos aplicado.');
  }

  async function resetBalance() {
    if (state.activeSession?.active) {
      showToast('Termina primeiro a sessão de massagem em curso.');
      return;
    }
    const accepted = await askConfirmation({
      title: 'Repor saldo',
      message: `O saldo atual de ${state.credits} créditos será reposto para zero.`,
      acceptLabel: 'Repor para zero',
      danger: true,
      icon: '−'
    });
    if (!accepted) return;

    const removed = state.credits;
    state.credits = 0;
    if (removed > 0) state.stats.totalCreditsRemoved += removed;
    addHistory('admin', `Saldo reposto para zero pelo admin — ${removed} créditos removidos`, removed ? -removed : 0, { admin: true });
    saveState();
    renderAll();
    showToast('Saldo reposto para zero.');
  }

  function handleMinutePriceSubmit(event) {
    event.preventDefault();
    const value = Math.floor(Number(elements.minutePriceInput.value));
    if (!Number.isFinite(value) || value < 1 || value > 100) {
      showToast('Define um preço entre 1 e 100 créditos.');
      return;
    }

    const previous = state.minutePrice;
    state.minutePrice = value;
    addHistory('admin', `Preço da massagem ao minuto alterado — ${previous} para ${value} créditos`, null, { admin: true });
    saveState();
    renderAll();
    showToast(state.activeSession?.active ? 'Preço guardado para as próximas sessões.' : 'Preço por minuto atualizado.');
  }

  function openCouponEditor(couponId = null) {
    const coupon = couponId ? state.shopCoupons.find((item) => item.id === couponId) : null;
    elements.couponModalTitle.textContent = coupon ? 'Editar cupão' : 'Novo cupão';
    elements.couponEditId.value = coupon?.id || '';
    elements.couponNameInput.value = coupon?.name || '';
    elements.couponDescriptionInput.value = coupon?.description || '';
    elements.couponPriceInput.value = coupon?.price || '';
    elements.couponDurationInput.value = coupon?.durationMinutes ?? 0;
    elements.couponActiveInput.checked = coupon ? coupon.active : true;
    openDialog(elements.couponModal);
  }

  function handleCouponEditorSubmit(event) {
    event.preventDefault();
    const editId = elements.couponEditId.value;
    const name = elements.couponNameInput.value.trim();
    const description = elements.couponDescriptionInput.value.trim();
    const price = Math.floor(Number(elements.couponPriceInput.value));
    const durationMinutes = Math.floor(Number(elements.couponDurationInput.value));
    const active = elements.couponActiveInput.checked;

    if (!name || !description || !Number.isFinite(price) || price < 1 || !Number.isFinite(durationMinutes) || durationMinutes < 0) {
      showToast('Preenche todos os dados do cupão corretamente.');
      return;
    }

    if (editId) {
      const coupon = state.shopCoupons.find((item) => item.id === editId);
      if (!coupon) return;
      coupon.name = name;
      coupon.description = description;
      coupon.price = price;
      coupon.durationMinutes = durationMinutes;
      coupon.active = active;
      addHistory('admin', `Cupão editado — ${name}`, null, { admin: true, coupon: true });
    } else {
      state.shopCoupons.push({
        id: uid('coupon'),
        name,
        description,
        price,
        durationMinutes,
        active
      });
      addHistory('admin', `Novo cupão criado — ${name}`, null, { admin: true, coupon: true });
    }

    saveState();
    closeDialog(elements.couponModal);
    renderAll();
    showToast(editId ? 'Cupão atualizado.' : 'Novo cupão criado.');
  }

  async function deleteCoupon(couponId) {
    const coupon = state.shopCoupons.find((item) => item.id === couponId);
    if (!coupon) return;

    const accepted = await askConfirmation({
      title: 'Apagar cupão',
      message: `O cupão “${coupon.name}” será removido da loja. Os cupões já comprados não serão afetados.`,
      acceptLabel: 'Apagar',
      danger: true,
      icon: '×'
    });
    if (!accepted) return;

    state.shopCoupons = state.shopCoupons.filter((item) => item.id !== couponId);
    addHistory('admin', `Cupão apagado da loja — ${coupon.name}`, null, { admin: true, coupon: true });
    saveState();
    renderAll();
    showToast('Cupão removido da loja.');
  }

  function handlePinChange(event) {
    event.preventDefault();
    const currentPin = elements.currentPin.value;
    const newPin = elements.newPin.value;
    const confirmPin = elements.confirmPin.value;

    if (currentPin !== state.adminPin) {
      showToast('O PIN atual não está correto.');
      return;
    }
    if (!/^\d{4,8}$/.test(newPin)) {
      showToast('O novo PIN deve ter entre 4 e 8 algarismos.');
      return;
    }
    if (newPin !== confirmPin) {
      showToast('A confirmação do novo PIN não coincide.');
      return;
    }

    state.adminPin = newPin;
    addHistory('admin', 'PIN de administração alterado', null, { admin: true });
    saveState();
    event.target.reset();
    showToast('PIN alterado com sucesso.');
  }

  async function clearHistory() {
    const accepted = await askConfirmation({
      title: 'Limpar histórico',
      message: 'Todos os registos de atividade serão apagados neste dispositivo. As estatísticas e os saldos serão mantidos.',
      acceptLabel: 'Limpar histórico',
      danger: true,
      icon: '≡'
    });
    if (!accepted) return;

    state.history = [];
    saveState();
    renderAll();
    showToast('Histórico limpo.');
  }

  async function clearLocalCache() {
    const accepted = await askConfirmation({
      title: 'Limpar cache local',
      message: 'Serão removidos deste dispositivo os dados locais da aplicação, caches, sessão temporária e credenciais locais do Firebase. Os dados guardados no Firebase não serão apagados. Continuar?',
      acceptLabel: 'Limpar cache',
      danger: true,
      icon: '×'
    });
    if (!accepted) return;

    const accessKey = localStorage.getItem('authKey');

    try {
      if ('caches' in window) {
        const cacheNames = await caches.keys();
        await Promise.all(cacheNames.map((name) => caches.delete(name)));
      }

      sessionStorage.clear();
      localStorage.clear();
      if (accessKey) localStorage.setItem('authKey', accessKey);

      if (window.indexedDB?.databases) {
        const databases = await indexedDB.databases();
        const firebaseDatabases = databases
          .map((db) => db.name)
          .filter((name) => name && /firebase/i.test(name));
        await Promise.all(firebaseDatabases.map((name) => new Promise((resolve) => {
          const request = indexedDB.deleteDatabase(name);
          request.onsuccess = request.onerror = request.onblocked = () => resolve();
        })));
      }

      showToast('Cache local limpo. A aplicação vai reiniciar.');
      window.setTimeout(() => {
        const url = new URL(window.location.href);
        url.searchParams.set('refresh', Date.now().toString());
        window.location.replace(url.toString());
      }, 500);
    } catch (error) {
      console.error('Não foi possível limpar totalmente o cache local:', error);
      showToast('Parte do cache não pôde ser removida. Tenta novamente após recarregar a aplicação.');
    }
  }

  function handleVipToggle() {
    state.stats.vipManual = elements.vipToggle.checked;
    addHistory(
      'admin',
      `Nível VIP Pai ${state.stats.vipManual ? 'ativado' : 'desativado'} manualmente`,
      null,
      { admin: true }
    );
    saveState();
    renderAll();
    showToast(`VIP Pai ${state.stats.vipManual ? 'ativado' : 'desativado'}.`);
  }

  function unlockAdmin(event) {
    event.preventDefault();
    const pin = elements.pinUnlockInput.value;
    if (pin !== state.adminPin) {
      elements.pinError.textContent = 'PIN incorreto. Tenta novamente.';
      elements.pinUnlockInput.select();
      return;
    }

    adminUnlocked = true;
    elements.pinError.textContent = '';
    closeDialog(elements.pinModal);
    if (pendingAdminNavigation) navigateTo('admin', true);
    pendingAdminNavigation = false;
    renderAdmin();
    showToast('Painel admin desbloqueado.');
  }

  function lockAdmin() {
    adminUnlocked = false;
    pendingAdminNavigation = false;
    navigateTo('home', true);
    showToast('Painel admin bloqueado.');
  }

  function updateConnectionStatus() {
    if (!elements.connectionStatus) return;

    const browserOnline = navigator.onLine;
    const fullySynced = Boolean(
      browserOnline &&
      firebaseConnected &&
      firebaseAuthenticated &&
      firebaseDataReady &&
      !firebaseLastError
    );
    const connecting = browserOnline && !fullySynced && !firebaseLastError;

    elements.connectionStatus.classList.toggle('offline', !fullySynced && !connecting);
    elements.connectionStatus.classList.toggle('connecting', connecting);

    if (!browserOnline) {
      elements.connectionStatus.title = 'Offline — alterações guardadas neste dispositivo';
    } else if (firebaseLastError) {
      elements.connectionStatus.title = `Firebase: ${firebaseLastError}`;
    } else if (!firebaseAuthenticated) {
      elements.connectionStatus.title = 'Online — a autenticar no Firebase';
    } else if (!firebaseConnected) {
      elements.connectionStatus.title = 'Online — a ligar ao Realtime Database';
    } else if (!firebaseDataReady) {
      elements.connectionStatus.title = 'Firebase ligado — a validar permissões';
    } else {
      elements.connectionStatus.title = 'Firebase ligado — dados sincronizados';
    }

    elements.connectionStatus.setAttribute('aria-label', elements.connectionStatus.title);
    updateAdminDiagnostics();
  }

  async function installApp() {
    if (!deferredInstallPrompt) {
      showToast('No navegador, abre o menu e escolhe “Adicionar ao ecrã principal”.');
      return;
    }
    deferredInstallPrompt.prompt();
    await deferredInstallPrompt.userChoice;
    deferredInstallPrompt = null;
    elements.installButton.classList.add('hidden');
  }

  function registerServiceWorker() {
    if (!('serviceWorker' in navigator) || !location.protocol.startsWith('http')) return;

    navigator.serviceWorker
      .register('./service-worker.js?v=3.1.0', { updateViaCache: 'none' })
      .then((registration) => registration.update())
      .catch((error) => {
        console.warn('Service worker não registado:', error);
      });
  }

  function cacheElements() {
    Object.assign(elements, {
      views: $$('.view'),
      toast: $('#toast'),
      connectionStatus: $('#connectionStatus'),
      installButton: $('#installButton'),
      balanceValue: $('#balanceValue'),
      levelBadge: $('#levelBadge'),
      levelCaption: $('#levelCaption'),
      availableMinutesRing: $('#availableMinutesRing'),
      balanceRing: $('#balanceRing'),
      minutesAvailable: $('#minutesAvailable'),
      activeCouponsCount: $('#activeCouponsCount'),
      totalMinutesUsed: $('#totalMinutesUsed'),
      todayDate: $('#todayDate'),
      todayMessage: $('#todayMessage'),
      recommendedCoupon: $('#recommendedCoupon'),
      lastMassage: $('#lastMassage'),
      recentActivity: $('#recentActivity'),
      couponStore: $('#couponStore'),
      myCoupons: $('#myCoupons'),
      couponTabCount: $('#couponTabCount'),
      couponStorePanel: $('#couponStorePanel'),
      myCouponsPanel: $('#myCouponsPanel'),
      timerCard: $('#timerCard'),
      timerStatus: $('#timerStatus'),
      minutePriceDisplay: $('#minutePriceDisplay'),
      timerDisplay: $('#timerDisplay'),
      timerProgress: $('#timerProgress'),
      sessionCredits: $('#sessionCredits'),
      sessionBalance: $('#sessionBalance'),
      startSessionButton: $('#startSessionButton'),
      timerControls: $('#timerControls'),
      pauseSessionButton: $('#pauseSessionButton'),
      endSessionButton: $('#endSessionButton'),
      lastSessionCard: $('#lastSessionCard'),
      summaryTime: $('#summaryTime'),
      summaryCredits: $('#summaryCredits'),
      summaryBalance: $('#summaryBalance'),
      historySummary: $('#historySummary'),
      historyFilters: $('#historyFilters'),
      historyList: $('#historyList'),
      adminSummary: $('#adminSummary'),
      adminCouponList: $('#adminCouponList'),
      creditsForm: $('#creditsForm'),
      creditOperation: $('#creditOperation'),
      creditAmount: $('#creditAmount'),
      creditReason: $('#creditReason'),
      resetBalanceButton: $('#resetBalanceButton'),
      minutePriceForm: $('#minutePriceForm'),
      minutePriceInput: $('#minutePriceInput'),
      addCouponButton: $('#addCouponButton'),
      vipToggle: $('#vipToggle'),
      pinForm: $('#pinForm'),
      currentPin: $('#currentPin'),
      newPin: $('#newPin'),
      confirmPin: $('#confirmPin'),
      lockAdminButton: $('#lockAdminButton'),
      clearHistoryButton: $('#clearHistoryButton'),
      clearLocalCacheButton: $('#clearLocalCacheButton'),
      retryFirebaseButton: $('#retryFirebaseButton'),
      appVersion: $('#appVersion'),
      firebaseStatusText: $('#firebaseStatusText'),
      firebaseErrorText: $('#firebaseErrorText'),
      firebaseLastSyncText: $('#firebaseLastSyncText'),
      firebaseDeviceText: $('#firebaseDeviceText'),
      pinModal: $('#pinModal'),
      pinUnlockForm: $('#pinUnlockForm'),
      pinUnlockInput: $('#pinUnlockInput'),
      pinError: $('#pinError'),
      sessionPinModal: $('#sessionPinModal'),
      sessionPinForm: $('#sessionPinForm'),
      sessionPinInput: $('#sessionPinInput'),
      sessionPinError: $('#sessionPinError'),
      couponModal: $('#couponModal'),
      couponEditorForm: $('#couponEditorForm'),
      couponModalTitle: $('#couponModalTitle'),
      couponEditId: $('#couponEditId'),
      couponNameInput: $('#couponNameInput'),
      couponDescriptionInput: $('#couponDescriptionInput'),
      couponPriceInput: $('#couponPriceInput'),
      couponDurationInput: $('#couponDurationInput'),
      couponActiveInput: $('#couponActiveInput'),
      confirmModal: $('#confirmModal'),
      confirmTitle: $('#confirmTitle'),
      confirmMessage: $('#confirmMessage'),
      confirmIcon: $('#confirmIcon'),
      confirmAcceptButton: $('#confirmAcceptButton')
    });
  }

  function bindEvents() {
    document.addEventListener('click', (event) => {
      const closeButton = event.target.closest('[data-close-dialog]');
      if (closeButton) {
        closeDialog(closeButton.closest('dialog'));
        return;
      }

      const navButton = event.target.closest('[data-nav]');
      if (navButton) navigateTo(navButton.dataset.nav);
    });

    $$('.segmented-control [data-coupon-tab]').forEach((button) => {
      button.addEventListener('click', () => {
        currentCouponTab = button.dataset.couponTab;
        renderCoupons();
      });
    });

    elements.couponStore.addEventListener('click', (event) => {
      const button = event.target.closest('[data-buy-coupon]');
      if (button) buyCoupon(button.dataset.buyCoupon);
    });

    elements.myCoupons.addEventListener('click', (event) => {
      const button = event.target.closest('[data-use-coupon]');
      if (button) useCoupon(button.dataset.useCoupon);
    });

    elements.historyFilters.addEventListener('click', (event) => {
      const button = event.target.closest('[data-history-filter]');
      if (!button) return;
      currentHistoryFilter = button.dataset.historyFilter;
      renderHistory();
    });

    elements.startSessionButton.addEventListener('click', requestMinuteSessionStart);
    elements.pauseSessionButton.addEventListener('click', togglePauseSession);
    elements.endSessionButton.addEventListener('click', () => finishMinuteSession());

    elements.creditsForm.addEventListener('submit', handleCreditsSubmit);
    elements.resetBalanceButton.addEventListener('click', resetBalance);
    elements.minutePriceForm.addEventListener('submit', handleMinutePriceSubmit);
    elements.addCouponButton.addEventListener('click', () => openCouponEditor());
    elements.couponEditorForm.addEventListener('submit', handleCouponEditorSubmit);
    elements.pinForm.addEventListener('submit', handlePinChange);
    elements.vipToggle.addEventListener('change', handleVipToggle);
    elements.lockAdminButton.addEventListener('click', lockAdmin);
    elements.clearHistoryButton.addEventListener('click', clearHistory);
    elements.clearLocalCacheButton.addEventListener('click', clearLocalCache);
    elements.retryFirebaseButton.addEventListener('click', () => {
      firebaseLastError = '';
      initialiseFirebaseSync({ force: true });
      showToast('Novo teste de ligação iniciado.');
    });
    elements.pinUnlockForm.addEventListener('submit', unlockAdmin);
    elements.sessionPinForm.addEventListener('submit', authoriseMinuteSessionStart);
    elements.installButton.addEventListener('click', installApp);

    elements.adminCouponList.addEventListener('click', (event) => {
      const editButton = event.target.closest('[data-edit-coupon]');
      const deleteButton = event.target.closest('[data-delete-coupon]');
      if (editButton) openCouponEditor(editButton.dataset.editCoupon);
      if (deleteButton) deleteCoupon(deleteButton.dataset.deleteCoupon);
    });

    elements.confirmModal.addEventListener('close', () => {
      if (confirmResolver) {
        confirmResolver(elements.confirmModal.returnValue === 'default');
        confirmResolver = null;
      }
    });

    elements.pinModal.addEventListener('close', () => {
      if (!adminUnlocked) pendingAdminNavigation = false;
    });

    elements.sessionPinModal.addEventListener('close', () => {
      elements.sessionPinInput.value = '';
      elements.sessionPinError.textContent = '';
    });

    window.addEventListener('online', () => {
      updateConnectionStatus();
      initialiseFirebaseSync({ force: true });
    });
    window.addEventListener('offline', updateConnectionStatus);

    window.addEventListener('beforeinstallprompt', (event) => {
      event.preventDefault();
      deferredInstallPrompt = event;
      elements.installButton.classList.remove('hidden');
    });

    window.addEventListener('appinstalled', () => {
      deferredInstallPrompt = null;
      elements.installButton.classList.add('hidden');
      showToast('Aplicação instalada com sucesso.');
    });

    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        syncSessionTime();
        renderAll();
        return;
      }

      const session = state.activeSession;
      const ownedByThisDevice = session?.active &&
        (!session.ownerDeviceId || session.ownerDeviceId === DEVICE_ID);

      if (ownedByThisDevice) {
        syncSessionTime();
        saveLocalState();
        localStorage.setItem(PENDING_SYNC_KEY, '1');
        queueCloudSave();
      }
    });

    window.addEventListener('beforeunload', () => {
      const session = state.activeSession;
      const ownedByThisDevice = session?.active &&
        (!session.ownerDeviceId || session.ownerDeviceId === DEVICE_ID);

      if (ownedByThisDevice) {
        syncSessionTime();
        localStorage.setItem(PENDING_SYNC_KEY, '1');
      }

      saveLocalState();
    });
  }

  function recoverSession() {
    const session = state.activeSession;
    if (!session?.active) return;
    session.totalSeconds = Math.max(0, Math.floor(Number(session.totalSeconds) || 0));
    session.billedMinutes = Math.max(1, Math.floor(Number(session.billedMinutes) || 1));
    session.chargedCredits = Math.max(session.pricePerMinute || state.minutePrice, Math.floor(Number(session.chargedCredits) || 0));
    session.pricePerMinute = Math.max(1, Math.floor(Number(session.pricePerMinute) || state.minutePrice));
    session.lastTimestamp = Number(session.lastTimestamp) || Date.now();
    session.running = session.running !== false;
    if (!session.ownerDeviceId) session.ownerDeviceId = DEVICE_ID;
    lastPersistedSecond = session.totalSeconds;
    if (session.ownerDeviceId === DEVICE_ID) syncSessionTime();
  }

  function init() {
    cacheElements();
    state = loadState();
    saveLocalState();
    bindEvents();
    recoverSession();
    renderAll();
    initialiseFirebaseSync();
    registerServiceWorker();
  }

  document.addEventListener('DOMContentLoaded', init);
})();