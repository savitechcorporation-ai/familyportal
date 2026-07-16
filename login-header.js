// Shared login-header component for FamilyPortal's admin and parent logins.
// Renders the banner + round logo + school name + tagline block from the one
// branding record both apps read, so a future logo/banner/color/tagline
// change made in School Settings applies identically to both logins without
// touching either page's own markup.
//
// Usage: give the login header container an id, e.g.
//   <div class="login-header" id="loginHeader"></div>
// then call:
//   initLoginHeader({
//     apiBase, mountId: 'loginHeader',
//     taglineField: 'admin_portal_tagline' | 'parent_portal_tagline',
//     defaultTagline, defaultTitle, defaultScrimColor, titleSuffix
//   });

(function () {
  function hexToRgb(hex) {
    const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex || '');
    if (!m) return null;
    return { r: parseInt(m[1], 16), g: parseInt(m[2], 16), b: parseInt(m[3], 16) };
  }
  function rgbToHex(r, g, b) {
    return '#' + [r, g, b].map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
  }
  function darkenHex(hex, amount) {
    const rgb = hexToRgb(hex);
    if (!rgb) return hex;
    return rgbToHex(rgb.r * (1 - amount), rgb.g * (1 - amount), rgb.b * (1 - amount));
  }
  function hexToRgba(hex, alpha) {
    const rgb = hexToRgb(hex);
    if (!rgb) return `rgba(0,0,0,${alpha})`;
    return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${alpha})`;
  }

  function renderLoginHeader(mountId, fallbackTitle) {
    const mount = document.getElementById(mountId);
    if (!mount) return;
    mount.innerHTML =
      '<div class="login-header-logo" id="loginHeaderLogoBox">' +
        '<span id="loginHeaderLogoEmoji">🏫</span>' +
        '<img id="loginHeaderLogoImg" class="hidden" alt="" />' +
      '</div>' +
      '<h1 id="loginHeaderTitle"></h1>' +
      '<p id="loginHeaderSubtitle"></p>';
    document.getElementById('loginHeaderTitle').textContent = fallbackTitle;
  }

  // Fetches the shared branding record (public endpoint - runs pre-login)
  // and paints the header: banner background with a dark scrim so white
  // text stays readable on any photo, round logo, display name, and a
  // tagline scoped to this portal. Falls back gracefully to a plain color
  // background, the default icon, and the given default title/tagline if
  // nothing has been uploaded/configured yet, or if the fetch fails.
  window.initLoginHeader = async function initLoginHeader(config) {
    const { apiBase, mountId, taglineField, defaultTagline, defaultTitle, titleSuffix, defaultScrimColor } = config;

    renderLoginHeader(mountId, defaultTitle);
    document.getElementById('loginHeaderSubtitle').textContent = defaultTagline;

    try {
      const response = await fetch(`${apiBase}/branding?schoolId=1`);
      const data = await response.json();

      const displayName = data.display_name || defaultTitle;
      document.getElementById('loginHeaderTitle').textContent = displayName;
      document.title = titleSuffix ? `${displayName} — ${titleSuffix}` : displayName;
      document.getElementById('loginHeaderSubtitle').textContent = data[taglineField] || defaultTagline;

      const mount = document.getElementById(mountId);
      const v = data.updated_at ? new Date(data.updated_at).getTime() : Date.now();

      if (data.hasLogo) {
        const img = document.getElementById('loginHeaderLogoImg');
        const emoji = document.getElementById('loginHeaderLogoEmoji');
        img.onload = () => { img.classList.remove('hidden'); emoji.classList.add('hidden'); };
        img.onerror = () => { img.classList.add('hidden'); emoji.classList.remove('hidden'); };
        img.src = `${apiBase}/branding/logo?schoolId=1&v=${v}`;
      }

      if (data.hasBanner && mount) {
        const scrim = data.primary_color || defaultScrimColor;
        mount.style.backgroundImage =
          `linear-gradient(${hexToRgba(scrim, 0.78)}, ${hexToRgba(darkenHex(scrim, 0.18), 0.85)}), url('${apiBase}/branding/banner?schoolId=1&v=${v}')`;
        mount.style.backgroundSize = 'cover';
        mount.style.backgroundPosition = 'center';
      }

      return data;

    } catch (error) {
      console.error('Failed to load login header branding (using defaults):', error.message);
      return null;
    }
  };
})();
