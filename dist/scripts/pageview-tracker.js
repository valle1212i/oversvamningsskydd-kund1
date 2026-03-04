// Pageview tracker för vattentrygg.se (statisk sajt)
(function(){
    // ======= Konfig =======
    const ENDPOINT = 'https://source-database.onrender.com/api/pageviews/track';
  
    // ======= Hjälpare =======
    const dntOn = () => (
      navigator.doNotTrack === '1' ||
      window.doNotTrack === '1' ||
      navigator.msDoNotTrack === '1'
    );
  
    const hasAnalyticsConsent = () => {
      try { return !!document.querySelector('#consent-analytics')?.checked; }
      catch { return false; }
    };
  
    const hostnameNoWWW = (h) => (h || location.hostname).replace(/^www\./i, '');
  
    function sendJSON(url, payload){
      // Temporary debug logging
      console.log("[PageviewTracker] Sending pageview payload:", payload);
      console.log("[PageviewTracker] Endpoint:", url);
      try {
        const body = JSON.stringify(payload);
        if (navigator.sendBeacon) {
          return navigator.sendBeacon(url, new Blob([body], { type: 'application/json' }));
        }
        return fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body,
          keepalive: true
        })
          .then(function (response) {
            console.log("[PageviewTracker] Response status:", response.status);
            return response.text();
          })
          .then(function (text) {
            var data;
            try { data = text ? JSON.parse(text) : null; } catch (_) { data = text; }
            console.log("[PageviewTracker] Response body:", data);
          })
          .catch(function (err) {
            console.error("[PageviewTracker] Tracking request failed:", err);
          });
      } catch(e){
        console.error("[PageviewTracker] Tracking request failed:", e);
      }
    }
  
    function buildPayload(){
      return {
        site: "vattentrygg",
        url: location.href,
        referrer: document.referrer || '',
        title: document.title || '',
        ts: Date.now(),
        viewport: { w: window.innerWidth, h: window.innerHeight },
        ua: navigator.userAgent || '',
        consent: true
      };
    }
  
    let sentOnce = false;
    function trackOnce(){
      if (sentOnce) return;
      sentOnce = true;
      sendJSON(ENDPOINT, buildPayload());
    }
  
    function tryTrackNow(){
      if (dntOn()) return;               // Respektera Do Not Track
      if (!hasAnalyticsConsent()) return; // Kräver CMP “Analys”
      trackOnce();
    }
  
    // Kör när DOM är redo (om consent redan finns)
    if (document.readyState === 'loading'){
      document.addEventListener('DOMContentLoaded', tryTrackNow, { once:true });
    } else {
      tryTrackNow();
    }
  
    // Reagera när användaren klickar i CMP (dina knappar #cmp-accept / #cmp-save)
    const onCmpDecision = () => setTimeout(tryTrackNow, 0);
    ['#cmp-accept', '#cmp-save'].forEach(sel=>{
      const btn = document.querySelector(sel);
      if (btn) btn.addEventListener('click', onCmpDecision, { passive:true });
    });
  
    // (Valfritt) Om du har “in-page navigation” utan full reload (SPA),
    // avkommentera nedan för att spåra “virtuella” sidvisningar också:
    /*
    const _pushState = history.pushState;
    history.pushState = function(){
      _pushState.apply(this, arguments);
      sentOnce = false;
      tryTrackNow();
    };
    window.addEventListener('popstate', () => {
      sentOnce = false;
      tryTrackNow();
    });
    */
  })();
  