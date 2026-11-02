"use strict";
// Aether — chargeur du tableau de bord statique (https://yooshy240.github.io/aether/).
// 1) Lien privé à ouvrir UNE fois : …/aether/#k=<jeton>. Le fragment n'est jamais envoyé au serveur ;
//    le jeton est gardé dans ce navigateur (localStorage) puis effacé de la barre d'adresse.
// 2) snapshot.enc.json (publié à chaque passage horaire) est déchiffré ici (HKDF-SHA256 -> AES-256-GCM).
// 3) Les appels /api/* de app.js sont servis depuis l'instantané : même affichage que le serveur local.
(async () => {
  const STORE = "aether_k";
  const te = (s) => new TextEncoder().encode(s);
  const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
  const paris = new Intl.DateTimeFormat("fr-FR", { timeZone: "Europe/Paris", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

  function note(html, kind) {
    let el = document.getElementById("aetherSnapNote");
    if (!el) {
      el = document.createElement("div");
      el.id = "aetherSnapNote";
      el.setAttribute("role", "status");
      el.style.cssText = "margin:8px 16px;padding:8px 12px;border-radius:10px;font-size:13px;line-height:1.4;" +
        "background:#121620;color:#aab3c5;border:1px solid #232a38";
      const top = document.querySelector("header.top");
      (top && top.parentNode) ? top.parentNode.insertBefore(el, top.nextSibling) : document.body.prepend(el);
    }
    if (kind === "err") el.style.borderColor = "#7a2e2e";
    el.innerHTML = html;
  }

  const m = location.hash.match(/[#&]k=([A-Za-z0-9_-]{32,})/);
  let tok = m ? m[1] : null;
  if (m) {
    try { localStorage.setItem(STORE, tok); } catch (e) { /* navigation privée : jeton gardé pour cette visite */ }
    history.replaceState(null, "", location.pathname + location.search);
  }
  if (!tok) { try { tok = localStorage.getItem(STORE); } catch (e) { tok = null; } }
  if (!tok) {
    document.getElementById("statusText").textContent = "accès privé";
    note("<b>Accès privé.</b> Ouvre une seule fois ton lien personnel Aether (celui qui se termine par <code>#k=…</code>) " +
         "sur cet appareil : ensuite cette adresse fixe s'ouvre directement, sans reconnexion.", "err");
    return;
  }

  let key;
  async function deriveKey() {
    const ikm = await crypto.subtle.importKey("raw", te(tok), "HKDF", false, ["deriveKey"]);
    return crypto.subtle.deriveKey({ name: "HKDF", hash: "SHA-256", salt: te("aether-static-v1"), info: te("snapshot") },
      ikm, { name: "AES-GCM", length: 256 }, false, ["decrypt"]);
  }
  async function load() {
    const r = await fetch("snapshot.enc.json?ts=" + Date.now(), { cache: "no-store" });
    if (!r.ok) throw new Error("snapshot " + r.status);
    const enc = await r.json();
    key = key || await deriveKey();
    const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(enc.iv), additionalData: te("aether-snapshot-v1") },
      key, unb64(enc.ct));
    return JSON.parse(new TextDecoder().decode(pt));
  }

  let snap;
  try { snap = await load(); }
  catch (e) {
    const bad = e && e.name === "OperationError";
    if (bad) { try { localStorage.removeItem(STORE); } catch (_) {} }
    document.getElementById("statusText").textContent = bad ? "lien invalide" : "instantané indisponible";
    note(bad ? "Le lien enregistré sur cet appareil n'est plus valide : rouvre ton lien personnel Aether une fois."
             : "Instantané momentanément indisponible, réessaie dans une minute.", "err");
    return;
  }

  function banner() {
    const t = Date.parse(snap.generated_at);
    let html = "Instantané chiffré du <b>" + (isNaN(t) ? "?" : paris.format(new Date(t))) + "</b> (heure de Paris) · " +
      "mis à jour automatiquement à chaque passage horaire d'Aether.";
    if (snap.live_url && /^https:\/\/[a-z0-9-]+\.hostc\.app$/.test(snap.live_url)) {
      const href = snap.live_url + "/?t=" + encodeURIComponent(tok);
      html += " <a rel='noreferrer' style='color:#7cf' href='" + href + "'>Version live</a> <span style='opacity:.7'>(seulement quand Aether tourne)</span>";
    }
    note(html);
  }
  banner();

  const realFetch = window.fetch.bind(window);
  window.fetch = async (input, opts) => {
    const u = typeof input === "string" ? input : input.url;
    const p = new URL(u, location.href).pathname.replace(/^.*(\/api\/[a-z]+)$/, "$1");
    if (p.startsWith("/api/")) {
      const d = snap.api[p];
      return new Response(JSON.stringify(d ?? { error: "absent" }), { status: d ? 200 : 404, headers: { "Content-Type": "application/json" } });
    }
    return realFetch(input, opts);
  };
  // nouvel instantané toutes les 5 min (s'il a été publié entre-temps)
  setInterval(async () => { try { const s = await load(); if (s.generated_at !== snap.generated_at) { snap = s; banner(); } } catch (e) {} }, 300000);

  const s = document.createElement("script");
  s.src = "app.js?v=" + encodeURIComponent(snap.generated_at);
  document.body.appendChild(s);
})();
